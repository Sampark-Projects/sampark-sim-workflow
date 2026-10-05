import type {
  ItsmRule,
  ItsmRuleApprovalNode,
  ItsmRuleApprover,
  ItsmRuleAssignee,
  ItsmRuleAssignNode,
  ItsmRuleConditionNode,
  ItsmRuleConditionRow,
  ItsmRuleEscalationNode,
  ItsmRuleIssue,
  ItsmRuleNode,
  ItsmRuleRef,
} from '@/lib/api/contracts/itsm-rules'
import {
  type ItsmBinOption,
  type ItsmMasterDataOption,
  type ItsmUserOption,
  matchesItsmUserType,
} from '@/lib/itsm/master-data/types'
import {
  ITSM_APPROVER_FIELDS,
  ITSM_APPROVERS_SUBBLOCK_ID,
  type ItsmApproverGroup,
  parseItsmApproverGroups,
} from '@/lib/itsm/rules/approver-groups'
import {
  ITSM_ASSIGNEES_SUBBLOCK_ID,
  type ItsmAssigneeGroup,
  type ItsmAssigneeRow,
  itsmAssigneeKey,
  parseItsmAssigneeGroups,
  summarizeItsmAssigneeRow,
} from '@/lib/itsm/rules/assignee-groups'
import {
  ITSM_APPROVAL_BLOCK_TYPE,
  ITSM_ASSIGN_BLOCK_TYPE,
  ITSM_ESCALATION_BLOCK_TYPE,
  ITSM_START_BLOCK_TYPE,
} from '@/lib/itsm/rules/block-types'
import {
  ITSM_CONDITION_BLOCK_TYPE,
  ITSM_CONDITION_FIELDS,
  ITSM_CONDITION_SUBBLOCK_ID,
  type ItsmConditionBranch,
  type ItsmConditionField,
  type ItsmConditionGroup,
  parseItsmConditionBranches,
} from '@/lib/itsm/rules/condition-branches'
import { findRepeatedItsmSets, itsmSetKey } from '@/lib/itsm/rules/group-values'
import { EDGE } from '@/executor/constants'

/** Workflows created before the ITSM start block begin at Sim's own start block. */
const LEGACY_START_BLOCK_TYPE = 'start_trigger'
const SOURCE_HANDLE = 'source'
const ESCALATION_UNITS = new Set(['minutes', 'hours', 'days'])

export interface ItsmRuleGraphBlock {
  id: string
  type: string
  name: string
  enabled: boolean
  subBlocks: Record<string, { value?: unknown } | undefined>
}

export interface ItsmRuleGraphEdge {
  source: string
  sourceHandle?: string | null
  target: string
}

export interface ItsmRuleGraph {
  workflowId: string
  name: string
  description: string
  blocks: Record<string, ItsmRuleGraphBlock>
  edges: ItsmRuleGraphEdge[]
}

/** Master data the compiler resolves ids against, keyed by the string id the editor stores. */
export interface ItsmMasterDataLookup {
  categories: ReadonlyMap<string, ItsmMasterDataOption>
  subcategories: ReadonlyMap<string, ItsmMasterDataOption>
  departments: ReadonlyMap<string, ItsmMasterDataOption>
  bins: ReadonlyMap<string, ItsmBinOption>
  organizations: ReadonlyMap<string, ItsmMasterDataOption>
  users: ReadonlyMap<string, ItsmUserOption>
  statuses: ReadonlyMap<string, ItsmMasterDataOption>
  severities: ReadonlyMap<string, ItsmMasterDataOption>
  levels: ReadonlyMap<string, ItsmMasterDataOption>
  assignmentRules: ReadonlyMap<string, ItsmMasterDataOption>
  /** Bin ids per department, for the departments an Approval or Assign bin row names. */
  departmentBins: ReadonlyMap<string, ReadonlySet<string>>
  /** Subcategory ids per category, for the categories the rule references. */
  categorySubcategories: ReadonlyMap<string, ReadonlySet<string>>
}

export interface ItsmRuleCompileResult {
  rule: ItsmRule | null
  errors: ItsmRuleIssue[]
  warnings: ItsmRuleIssue[]
}

/** A master-data list the compiler resolves ids against. */
export type ItsmMasterDataListName =
  | 'categories'
  | 'subcategories'
  | 'departments'
  | 'bins'
  | 'organizations'
  | 'users'
  | 'statuses'
  | 'severities'
  | 'levels'
  | 'assignmentRules'

const CONDITION_LOOKUP: Record<ItsmConditionField, ItsmMasterDataListName> = {
  category: 'categories',
  subcategory: 'subcategories',
  department: 'departments',
  bin: 'bins',
  organization: 'organizations',
  status: 'statuses',
  severity: 'severities',
}

function toRef(option: ItsmMasterDataOption): ItsmRuleRef {
  return { id: option.id, name: option.name }
}

/** Reads a single-select subblock value. */
function readId(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id ? id : null
}

/** Reads a multi-select subblock value (an array, or its JSON string form). */
function readIdList(value: unknown): string[] {
  let raw = value
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value)
    } catch {
      raw = value ? [value] : []
    }
  }
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map(readId).filter((id): id is string => id !== null))]
}

class IssueCollector {
  readonly errors: ItsmRuleIssue[] = []
  readonly warnings: ItsmRuleIssue[] = []

  private readonly seen = new Set<string>()

  error(block: ItsmRuleGraphBlock | null, message: string) {
    this.add(this.errors, block, message)
  }

  warn(block: ItsmRuleGraphBlock | null, message: string) {
    this.add(this.warnings, block, message)
  }

  private add(target: ItsmRuleIssue[], block: ItsmRuleGraphBlock | null, message: string) {
    const key = `${target === this.errors ? 'e' : 'w'}|${block?.id ?? ''}|${message}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    target.push({ blockId: block?.id ?? null, blockName: block?.name ?? null, message })
  }
}

/**
 * Compiles an ITSM workflow graph into the rule JSON the ITSM backend
 * evaluates. Pure: master data is resolved against `lookup`, loaded by the
 * caller. Returns `rule: null` whenever there is at least one error.
 */
export function compileItsmRule(
  graph: ItsmRuleGraph,
  lookup: ItsmMasterDataLookup
): ItsmRuleCompileResult {
  const issues = new IssueCollector()
  const blocks = Object.values(graph.blocks)

  const starts = blocks.filter(
    (block) => block.type === ITSM_START_BLOCK_TYPE || block.type === LEGACY_START_BLOCK_TYPE
  )
  if (starts.length === 0) {
    issues.error(null, 'Add a Start block and connect the rule to it.')
    return { rule: null, errors: issues.errors, warnings: issues.warnings }
  }
  if (starts.length > 1) {
    issues.error(null, 'Keep exactly one start block.')
    return { rule: null, errors: issues.errors, warnings: issues.warnings }
  }
  const start = starts[0]

  const targetsByHandle = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (!graph.blocks[edge.source] || !graph.blocks[edge.target]) continue
    const key = `${edge.source}|${edge.sourceHandle ?? SOURCE_HANDLE}`
    targetsByHandle.set(key, [...(targetsByHandle.get(key) ?? []), edge.target])
  }

  const nextFrom = (block: ItsmRuleGraphBlock, handle: string, what: string): string | null => {
    const targets = targetsByHandle.get(`${block.id}|${handle}`) ?? []
    if (targets.length > 1) {
      issues.error(block, `${what} connects to ${targets.length} blocks. Connect it to only one.`)
    }
    return targets[0] ?? null
  }

  const startNodeId = nextFrom(start, SOURCE_HANDLE, 'The start block')
  /** ITSM stores only rules with at least one step, so an empty rule is not saved. */
  if (!startNodeId) {
    issues.error(start, 'Connect at least one block to the Start block before saving.')
    return { rule: null, errors: issues.errors, warnings: issues.warnings }
  }

  const nodes: ItsmRuleNode[] = []
  const visited = new Set<string>()
  const queue = startNodeId ? [startNodeId] : []
  while (queue.length > 0) {
    const blockId = queue.shift() as string
    if (visited.has(blockId)) continue
    visited.add(blockId)
    const block = graph.blocks[blockId]
    if (!block) continue
    if (!block.enabled) {
      issues.error(block, 'This block is disabled. Enable it or disconnect it.')
      continue
    }

    const node = compileNode(block, { graph, lookup, issues, nextFrom, visited })
    if (!node) continue
    nodes.push(node)
    for (const next of successorsOf(node)) {
      if (!visited.has(next)) queue.push(next)
    }
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  if (hasCycle(startNodeId, nodesById)) {
    issues.error(null, 'The rule loops back on itself. Remove the connection that forms the loop.')
  }

  for (const block of blocks) {
    if (block.id === start.id || visited.has(block.id)) continue
    issues.warn(block, 'Not connected to the start block, so it is not sent to ITSM.')
  }

  if (issues.errors.length > 0)
    return { rule: null, errors: issues.errors, warnings: issues.warnings }
  return {
    rule: {
      id: graph.workflowId,
      name: graph.name,
      description: graph.description,
      startNodeId,
      nodes,
    },
    errors: issues.errors,
    warnings: issues.warnings,
  }
}

type NextFrom = (block: ItsmRuleGraphBlock, handle: string, what: string) => string | null

interface CompileContext {
  graph: ItsmRuleGraph
  lookup: ItsmMasterDataLookup
  issues: IssueCollector
  nextFrom: NextFrom
  /** Blocks already compiled. */
  visited: Set<string>
}

function compileNode(block: ItsmRuleGraphBlock, context: CompileContext): ItsmRuleNode | null {
  const { lookup, issues, nextFrom } = context
  switch (block.type) {
    case ITSM_CONDITION_BLOCK_TYPE:
      return compileCondition(block, lookup, issues, nextFrom)
    case ITSM_APPROVAL_BLOCK_TYPE:
      return compileApproval(block, context)
    case ITSM_ESCALATION_BLOCK_TYPE:
      return compileEscalation(block, lookup, issues, nextFrom)
    case ITSM_ASSIGN_BLOCK_TYPE:
      return compileAssign(block, lookup, issues, nextFrom)
    default:
      issues.error(
        block,
        'Only Condition, Approval, Escalation, and Assign blocks can be part of a rule.'
      )
      return null
  }
}

function successorsOf(node: ItsmRuleNode): string[] {
  const next =
    node.type === 'condition'
      ? [...node.branches.map((branch) => branch.next), node.elseNext]
      : [node.next]
  return next.filter((id): id is string => id !== null)
}

function compileCondition(
  block: ItsmRuleGraphBlock,
  lookup: ItsmMasterDataLookup,
  issues: IssueCollector,
  nextFrom: NextFrom
): ItsmRuleConditionNode {
  const branches = parseItsmConditionBranches(
    block.id,
    block.subBlocks[ITSM_CONDITION_SUBBLOCK_ID]?.value
  )
  const matchBranches = branches.filter((branch) => branch.kind === 'branch')
  const elseBranch = branches.find((branch) => branch.kind === 'else')

  const branchNames = matchBranches.map(
    (branch, branchIndex) => branch.label || (branchIndex === 0 ? 'if' : `else if #${branchIndex}`)
  )
  reportConditionDuplicates(block, matchBranches, branchNames, issues)

  const compiled = matchBranches.map((branch, branchIndex) => {
    const branchName = branchNames[branchIndex]
    const errorsBefore = issues.errors.length
    const groups = branch.groups.flatMap((group) => {
      const rows: ItsmRuleConditionRow[] = []
      for (const row of group.rows) {
        if (!row.field) {
          issues.error(block, `Condition "${branchName}": choose a field for every row.`)
          continue
        }
        const fieldConfig = ITSM_CONDITION_FIELDS[row.field]
        if (row.values.length === 0) {
          issues.error(block, `Condition "${branchName}": pick at least one ${fieldConfig.label}.`)
          continue
        }
        if (fieldConfig.parent?.mode === 'required') {
          const parentField = fieldConfig.parent.field
          const hasParent = group.rows.some(
            (candidate) =>
              candidate.field === parentField &&
              candidate.operator === 'in' &&
              candidate.values.length > 0
          )
          if (!hasParent) {
            issues.error(
              block,
              `Condition "${branchName}": a ${fieldConfig.label} row needs a ${ITSM_CONDITION_FIELDS[parentField].label} row in the same group.`
            )
          }
        }
        const options = lookup[CONDITION_LOOKUP[row.field]] as ReadonlyMap<
          string,
          ItsmMasterDataOption
        >
        const values: ItsmRuleRef[] = []
        for (const value of row.values) {
          const option = options.get(value.id)
          if (!option) {
            issues.error(
              block,
              `Condition "${branchName}": ${fieldConfig.label} "${value.label}" no longer exists in ITSM.`
            )
            continue
          }
          values.push(toRef(option))
        }
        if (values.length > 0) rows.push({ field: row.field, operator: row.operator, values })
      }
      return rows.length > 0 ? [{ all: rows }] : []
    })
    if (groups.length === 0 && issues.errors.length === errorsBefore) {
      issues.error(block, `Condition "${branchName}" is empty. Add at least one row.`)
    }
    return {
      id: branch.id,
      label: branch.label,
      when: { any: groups },
      next: nextFrom(block, `${EDGE.CONDITION_PREFIX}${branch.id}`, `Condition "${branchName}"`),
    }
  })

  return {
    id: block.id,
    type: 'condition',
    label: block.name,
    branches: compiled,
    elseNext: elseBranch
      ? nextFrom(block, `${EDGE.CONDITION_PREFIX}${elseBranch.id}`, 'The else condition')
      : null,
  }
}

/** One picked value of a row, keyed so the same pick in two rows of a group compares equal. */
interface PickedEntry {
  key: string
  label: string
}

/** The labels of picks that appear in more than one row of a group. */
function picksInSeveralRows(rows: readonly (readonly PickedEntry[])[]): string[] {
  const seen = new Map<string, { label: string; rows: number }>()
  for (const row of rows) {
    for (const entry of new Map(row.map((candidate) => [candidate.key, candidate])).values()) {
      const current = seen.get(entry.key)
      seen.set(entry.key, { label: entry.label, rows: (current?.rows ?? 0) + 1 })
    }
  }
  return [...seen.values()].filter((entry) => entry.rows > 1).map((entry) => entry.label)
}

/** A key for a whole group, or null when none of its rows is filled in yet. */
function groupKey(rowKeys: readonly (string | null)[]): string | null {
  const filled = rowKeys.filter((key): key is string => key !== null)
  return filled.length > 0 ? itsmSetKey(filled) : null
}

function conditionGroupKey(group: ItsmConditionGroup): string | null {
  return groupKey(
    group.rows.map((row) =>
      row.field && row.values.length > 0
        ? `${row.field}:${row.operator}:${itsmSetKey(row.values.map((value) => value.id))}`
        : null
    )
  )
}

/**
 * Rejects a value picked in two rows of one group, two identical groups in one
 * condition, and two identical conditions in one block.
 */
function reportConditionDuplicates(
  block: ItsmRuleGraphBlock,
  branches: readonly ItsmConditionBranch[],
  names: readonly string[],
  issues: IssueCollector
) {
  branches.forEach((branch, branchIndex) => {
    const name = names[branchIndex]
    branch.groups.forEach((group, groupIndex) => {
      const at = groupPrefix(groupIndex, branch.groups.length)
      const repeated = picksInSeveralRows(
        group.rows.map((row) => {
          const field = row.field
          if (!field) return []
          const label = ITSM_CONDITION_FIELDS[field].label
          return row.values.map((value) => ({
            key: `${field}:${value.id}`,
            label: `${label} "${value.label}"`,
          }))
        })
      )
      for (const label of repeated) {
        issues.error(block, `Condition "${name}": ${at}${label} is used in more than one row.`)
      }
    })
    for (const { index, firstIndex } of findRepeatedItsmSets(
      branch.groups.map(conditionGroupKey)
    )) {
      issues.error(
        block,
        `Condition "${name}": Group ${index + 1} is the same as Group ${firstIndex + 1}.`
      )
    }
  })
  const branchKeys = branches.map((branch) => groupKey(branch.groups.map(conditionGroupKey)))
  for (const { index, firstIndex } of findRepeatedItsmSets(branchKeys)) {
    issues.error(
      block,
      `Condition "${names[index]}" is the same as condition "${names[firstIndex]}".`
    )
  }
}

/** Rejects a value picked in two rows of one group, and two identical groups. */
function reportApproverDuplicates(
  block: ItsmRuleGraphBlock,
  groups: readonly ItsmApproverGroup[],
  issues: IssueCollector
) {
  groups.forEach((group, groupIndex) => {
    const at = groupPrefix(groupIndex, groups.length)
    const repeated = picksInSeveralRows(
      group.rows.map((row) => {
        const field = row.field
        if (!field) return []
        return row.values.map((value) => ({
          key: `${field}:${value.id}`,
          label: `${ITSM_APPROVER_FIELDS[field].label} "${value.label}"`,
        }))
      })
    )
    for (const label of repeated) {
      issues.error(block, `${at}${label} is used in more than one row.`)
    }
  })
  const keys = groups.map((group) =>
    groupKey(
      group.rows.map((row) =>
        row.field && row.values.length > 0
          ? `${row.field}:${itsmSetKey(row.values.map((value) => value.id))}`
          : null
      )
    )
  )
  for (const { index, firstIndex } of findRepeatedItsmSets(keys)) {
    issues.error(block, `Group ${index + 1} is the same as Group ${firstIndex + 1}.`)
  }
}

/** Rejects the same assignment twice in one group, and two identical groups. */
function reportAssigneeDuplicates(
  block: ItsmRuleGraphBlock,
  groups: readonly ItsmAssigneeGroup[],
  issues: IssueCollector
) {
  groups.forEach((group, groupIndex) => {
    const at = groupPrefix(groupIndex, groups.length)
    const repeated = picksInSeveralRows(
      group.rows.map((row) => {
        const key = itsmAssigneeKey(row)
        return key
          ? [{ key, label: summarizeItsmAssigneeRow({ ...row, assignmentRule: null }) }]
          : []
      })
    )
    for (const label of repeated) {
      issues.error(block, `${at}${label} is used in more than one row.`)
    }
  })
  const keys = groups.map((group) =>
    groupKey(
      group.rows.map((row) => {
        const key = itsmAssigneeKey(row)
        return key
          ? `${key}:${row.department?.id ?? ''}:${row.assignmentRule?.id ?? ''}:${row.userType}`
          : null
      })
    )
  )
  for (const { index, firstIndex } of findRepeatedItsmSets(keys)) {
    issues.error(block, `Group ${index + 1} is the same as Group ${firstIndex + 1}.`)
  }
}

/** Names the group an issue is in, when the block has more than one. */
function groupPrefix(groupIndex: number, groupCount: number): string {
  return groupCount > 1 ? `Group ${groupIndex + 1}: ` : ''
}

/** Resolves picked values against ITSM, reporting each one ITSM no longer has. */
function resolvePicked<T>(
  values: readonly { id: string; label: string }[],
  options: ReadonlyMap<string, T>,
  onMissing: (label: string) => void
): T[] {
  return values.flatMap((value) => {
    const option = options.get(value.id)
    if (option) return [option]
    onMissing(value.label)
    return []
  })
}

function compileApproval(
  block: ItsmRuleGraphBlock,
  { lookup, issues, nextFrom }: CompileContext
): ItsmRuleApprovalNode {
  const groups = parseItsmApproverGroups(block.subBlocks[ITSM_APPROVERS_SUBBLOCK_ID]?.value)
  const errorsBefore = issues.errors.length
  reportApproverDuplicates(block, groups, issues)

  const any = groups.flatMap((group, groupIndex) => {
    const at = groupPrefix(groupIndex, groups.length)
    const all = group.rows.flatMap((row): ItsmRuleApprover[] => {
      if (!row.field) {
        issues.error(block, `${at}Choose Bins or Users for every row.`)
        return []
      }
      const label = ITSM_APPROVER_FIELDS[row.field].label
      if (row.values.length === 0) {
        issues.error(block, `${at}Pick at least one value in ${label}.`)
        return []
      }
      const missing = (name: string) =>
        issues.error(block, `${at}${label}: "${name}" no longer exists in ITSM.`)
      if (row.field === 'users') {
        const users = resolvePicked(row.values, lookup.users, missing)
        return users.length > 0 ? [{ kind: 'users', anyOf: users.map(toRef) }] : []
      }
      const departments = resolvePicked(row.departments, lookup.departments, (name) =>
        issues.error(block, `${at}Department "${name}" no longer exists in ITSM.`)
      )
      if (departments.length < row.departments.length) return []
      const anyOf = resolvePicked(row.values, lookup.bins, missing).flatMap((bin) => {
        if (departments.length === 0) {
          return [{ ...toRef(bin), department: bin.department ? toRef(bin.department) : null }]
        }
        const department = departments.find((candidate) =>
          lookup.departmentBins.get(candidate.id)?.has(bin.id)
        )
        if (department) return [{ ...toRef(bin), department: toRef(department) }]
        issues.error(
          block,
          `${at}Bin "${bin.name}" does not belong to ${departments.map((d) => d.name).join(' or ')}.`
        )
        return []
      })
      return anyOf.length > 0 ? [{ kind: 'bins', anyOf }] : []
    })
    return all.length > 0 ? [{ all }] : []
  })
  if (any.length === 0 && issues.errors.length === errorsBefore) {
    issues.error(block, 'Add at least one approver.')
  }

  return {
    id: block.id,
    type: 'approval',
    label: block.name,
    approvers: { any },
    next: nextFrom(block, SOURCE_HANDLE, 'The approved output'),
  }
}

function compileEscalation(
  block: ItsmRuleGraphBlock,
  lookup: ItsmMasterDataLookup,
  issues: IssueCollector,
  nextFrom: NextFrom
): ItsmRuleEscalationNode {
  const timing = readEscalationTiming(block, issues)
  const level = readEscalationLevel(block, lookup, issues)
  const users = readIdList(block.subBlocks.escalateToUsers?.value).flatMap((id) => {
    const user = lookup.users.get(id)
    if (user) return [{ id: user.id, name: user.name }]
    issues.error(block, `User ${id} is no longer an active ITSM user.`)
    return []
  })
  return {
    id: block.id,
    type: 'escalation',
    label: block.name,
    level: level ?? { id: '', name: '' },
    after: timing?.after ?? 0,
    unit: timing?.unit ?? 'hours',
    users,
    next: nextFrom(block, SOURCE_HANDLE, 'The escalation output'),
  }
}

function readEscalationLevel(
  block: ItsmRuleGraphBlock,
  lookup: ItsmMasterDataLookup,
  issues: IssueCollector
): ItsmRuleRef | null {
  const id = readId(block.subBlocks.level?.value)
  if (!id) {
    issues.error(block, 'Choose a level.')
    return null
  }
  const level = lookup.levels.get(id)
  if (!level) {
    issues.error(block, `Level "${id}" no longer exists in ITSM.`)
    return null
  }
  return toRef(level)
}

function readEscalationTiming(
  block: ItsmRuleGraphBlock,
  issues: IssueCollector
): { after: number; unit: 'minutes' | 'hours' | 'days' } | null {
  const rawAfter = block.subBlocks.escalateAfter?.value
  const afterText =
    typeof rawAfter === 'number'
      ? String(rawAfter)
      : typeof rawAfter === 'string'
        ? rawAfter.trim()
        : ''
  const after = Number(afterText)
  const unit = readId(block.subBlocks.escalateUnit?.value) ?? 'hours'
  if (!afterText || !Number.isFinite(after) || after <= 0) {
    issues.error(block, 'Escalate after must be a number greater than 0.')
    return null
  }
  if (!ESCALATION_UNITS.has(unit)) {
    issues.error(block, 'Choose an escalation unit.')
    return null
  }
  return { after, unit: unit as 'minutes' | 'hours' | 'days' }
}

function compileAssign(
  block: ItsmRuleGraphBlock,
  lookup: ItsmMasterDataLookup,
  issues: IssueCollector,
  nextFrom: NextFrom
): ItsmRuleAssignNode {
  const groups = parseItsmAssigneeGroups(block.subBlocks[ITSM_ASSIGNEES_SUBBLOCK_ID]?.value)
  const errorsBefore = issues.errors.length
  reportAssigneeDuplicates(block, groups, issues)

  const any = groups.flatMap((group, groupIndex) => {
    const at = groupPrefix(groupIndex, groups.length)
    const all = group.rows.flatMap((row) => {
      const assignee = compileAssignee(row, lookup, (message) =>
        issues.error(block, `${at}${message}`)
      )
      return assignee ? [assignee] : []
    })
    return all.length > 0 ? [{ all }] : []
  })
  if (any.length === 0 && issues.errors.length === errorsBefore) {
    issues.error(block, 'Add at least one assignee.')
  }

  return {
    id: block.id,
    type: 'assign',
    label: block.name,
    assignees: { any },
    next: nextFrom(block, SOURCE_HANDLE, 'The output'),
  }
}

/** One assignment target, or null when a required pick is missing or gone from ITSM. */
function compileAssignee(
  row: ItsmAssigneeRow,
  lookup: ItsmMasterDataLookup,
  error: (message: string) => void
): ItsmRuleAssignee | null {
  if (row.assignTo === 'category') {
    if (!row.category) {
      error('Choose a category.')
      return null
    }
    const category = lookup.categories.get(row.category.id)
    if (!category) {
      error(`Category "${row.category.label}" no longer exists in ITSM.`)
      return null
    }
    if (!row.subcategory) return { kind: 'category', ...toRef(category) }
    const subcategory = lookup.subcategories.get(row.subcategory.id)
    if (!subcategory || !lookup.categorySubcategories.get(category.id)?.has(subcategory.id)) {
      error(`Subcategory "${row.subcategory.label}" is not in ${category.name}.`)
      return null
    }
    return { kind: 'subcategory', ...toRef(subcategory), category: toRef(category) }
  }

  if (row.assignTo === 'user') {
    if (!row.user) {
      error('Choose the user to assign to.')
      return null
    }
    const user = lookup.users.get(row.user.id)
    if (!user) {
      error(`User "${row.user.label}" is no longer an active ITSM user.`)
      return null
    }
    if (!matchesItsmUserType(user.roleType, row.userType)) {
      error(`${user.name} is not a ${row.userType} in ITSM.`)
      return null
    }
    return { kind: 'user', ...toRef(user), userType: row.userType }
  }

  if (!row.bin) {
    error('Choose a bin.')
    return null
  }
  const bin = lookup.bins.get(row.bin.id)
  if (!bin) {
    error(`Bin "${row.bin.label}" no longer exists in ITSM.`)
    return null
  }
  const department = row.department ? lookup.departments.get(row.department.id) : undefined
  if (row.department && !department) {
    error(`Department "${row.department.label}" no longer exists in ITSM.`)
    return null
  }
  if (department && !lookup.departmentBins.get(department.id)?.has(bin.id)) {
    error(`Bin "${bin.name}" does not belong to ${department.name}.`)
    return null
  }
  const assignmentRule = row.assignmentRule
    ? lookup.assignmentRules.get(row.assignmentRule.id)
    : undefined
  if (row.assignmentRule && !assignmentRule) {
    error(`Rule type "${row.assignmentRule.label}" no longer exists in ITSM.`)
    return null
  }
  return {
    kind: 'bin',
    ...toRef(bin),
    department: department ? toRef(department) : bin.department ? toRef(bin.department) : null,
    assignmentRule: assignmentRule ? toRef(assignmentRule) : null,
  }
}

function hasCycle(startNodeId: string | null, nodesById: ReadonlyMap<string, ItsmRuleNode>) {
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string): boolean => {
    const current = state.get(id)
    if (current === 'visiting') return true
    if (current === 'done') return false
    state.set(id, 'visiting')
    const node = nodesById.get(id)
    const cyclic = node ? successorsOf(node).some(visit) : false
    state.set(id, 'done')
    return cyclic
  }
  return startNodeId ? visit(startNodeId) : false
}

/** What a save has to read from ITSM to compile a rule. */
export interface ItsmMasterDataNeeds {
  lists: ReadonlySet<ItsmMasterDataListName>
  /** Categories whose subcategories are needed. */
  categoryIds: string[]
  /** Departments whose bins are needed. */
  binDepartmentIds: string[]
}

/**
 * The master-data lists the rule's blocks reference, so a save reads only
 * those from ITSM. Counts every block, connected or not, so it can only ask
 * for more than the compiler uses, never less.
 */
export function collectItsmMasterDataNeeds(graph: ItsmRuleGraph): ItsmMasterDataNeeds {
  const lists = new Set<ItsmMasterDataListName>()
  /** For a multi-select field. */
  const needWhenAny = (name: ItsmMasterDataListName, value: unknown) => {
    if (readIdList(value).length > 0) lists.add(name)
  }
  for (const block of Object.values(graph.blocks)) {
    const values = (id: string) => block.subBlocks[id]?.value
    switch (block.type) {
      case ITSM_CONDITION_BLOCK_TYPE:
        for (const branch of parseItsmConditionBranches(
          block.id,
          values(ITSM_CONDITION_SUBBLOCK_ID)
        )) {
          for (const group of branch.groups) {
            for (const row of group.rows) {
              if (row.field && row.values.length > 0) lists.add(CONDITION_LOOKUP[row.field])
            }
          }
        }
        break
      case ITSM_APPROVAL_BLOCK_TYPE:
        for (const group of parseItsmApproverGroups(values(ITSM_APPROVERS_SUBBLOCK_ID))) {
          for (const row of group.rows) {
            if (row.field && row.values.length > 0) lists.add(row.field)
            if (row.departments.length > 0) lists.add('departments')
          }
        }
        break
      case ITSM_ESCALATION_BLOCK_TYPE:
        if (readId(values('level'))) lists.add('levels')
        needWhenAny('users', values('escalateToUsers'))
        break
      case ITSM_ASSIGN_BLOCK_TYPE:
        for (const row of assigneeRowsOf(block)) {
          if (row.assignTo === 'category') {
            if (row.category) lists.add('categories')
            if (row.subcategory) lists.add('subcategories')
          } else if (row.assignTo === 'user') {
            if (row.user) lists.add('users')
          } else {
            if (row.department) lists.add('departments')
            if (row.bin) lists.add('bins')
            if (row.assignmentRule) lists.add('assignmentRules')
          }
        }
        break
    }
  }
  return {
    lists,
    categoryIds: collectReferencedCategoryIds(graph),
    binDepartmentIds: collectBinDepartmentIds(graph),
  }
}

function assigneeRowsOf(block: ItsmRuleGraphBlock): ItsmAssigneeRow[] {
  return parseItsmAssigneeGroups(block.subBlocks[ITSM_ASSIGNEES_SUBBLOCK_ID]?.value).flatMap(
    (group: ItsmAssigneeGroup) => group.rows
  )
}

/** Every department an Approval or Assign bin row names, so its bins can be checked. */
export function collectBinDepartmentIds(graph: ItsmRuleGraph): string[] {
  const ids = new Set<string>()
  for (const block of Object.values(graph.blocks)) {
    if (block.type === ITSM_APPROVAL_BLOCK_TYPE) {
      for (const group of parseItsmApproverGroups(
        block.subBlocks[ITSM_APPROVERS_SUBBLOCK_ID]?.value
      )) {
        for (const row of group.rows) {
          for (const department of row.departments) ids.add(department.id)
        }
      }
    }
    if (block.type !== ITSM_ASSIGN_BLOCK_TYPE) continue
    for (const row of assigneeRowsOf(block)) {
      if (row.assignTo === 'bin' && row.department) ids.add(row.department.id)
    }
  }
  return [...ids]
}

/**
 * Every category id a condition or a subcategory assignment references, so
 * their subcategories can be loaded.
 */
export function collectReferencedCategoryIds(graph: ItsmRuleGraph): string[] {
  const ids = new Set<string>()
  for (const block of Object.values(graph.blocks)) {
    if (block.type === ITSM_ASSIGN_BLOCK_TYPE) {
      for (const row of assigneeRowsOf(block)) {
        if (row.assignTo === 'category' && row.category && row.subcategory) {
          ids.add(row.category.id)
        }
      }
      continue
    }
    if (block.type !== ITSM_CONDITION_BLOCK_TYPE) continue
    const branches = parseItsmConditionBranches(
      block.id,
      block.subBlocks[ITSM_CONDITION_SUBBLOCK_ID]?.value
    )
    for (const branch of branches) {
      for (const group of branch.groups) {
        for (const row of group.rows) {
          if (row.field === 'category') for (const value of row.values) ids.add(value.id)
        }
      }
    }
  }
  return [...ids]
}
