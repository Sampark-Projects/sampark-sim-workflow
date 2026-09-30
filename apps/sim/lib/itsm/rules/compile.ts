import type {
  ItsmRule,
  ItsmRuleApprovalNode,
  ItsmRuleApprover,
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
  isItsmUserType,
  matchesItsmUserType,
} from '@/lib/itsm/master-data/types'
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
  type ItsmConditionField,
  parseItsmConditionBranches,
} from '@/lib/itsm/rules/condition-branches'
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
  /** Ordered as ITSM lists them, which is escalation order. */
  levels: ReadonlyMap<string, ItsmMasterDataOption>
  assignmentRules: ReadonlyMap<string, ItsmMasterDataOption>
  /** Bin ids per department, for the departments an Assign block names. */
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
  warnOnLevelOrder(nodes, nodesById, graph, lookup, issues)
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

  const compiled = matchBranches.map((branch, branchIndex) => {
    const branchName = branch.label || (branchIndex === 0 ? 'if' : `else if #${branchIndex}`)
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

function compileApproval(
  block: ItsmRuleGraphBlock,
  { lookup, issues, nextFrom }: CompileContext
): ItsmRuleApprovalNode {
  const values = (id: string) => block.subBlocks[id]?.value

  const levelId = readId(values('level'))
  const level = levelId ? lookup.levels.get(levelId) : undefined
  if (!levelId) issues.error(block, 'Choose an approval level.')
  else if (!level) issues.error(block, `Level "${levelId}" no longer exists in ITSM.`)

  const approvers: ItsmRuleApprover[] = []
  for (const id of readIdList(values('approverUsers'))) {
    const user = lookup.users.get(id)
    if (user) approvers.push({ kind: 'user', id: user.id, name: user.name })
    else issues.error(block, `Approver user ${id} is no longer an active ITSM user.`)
  }
  for (const id of readIdList(values('approverDepartments'))) {
    const department = lookup.departments.get(id)
    if (department) approvers.push({ kind: 'department', id: department.id, name: department.name })
    else issues.error(block, `Approver department ${id} no longer exists in ITSM.`)
  }
  for (const id of readIdList(values('approverBins'))) {
    const bin = lookup.bins.get(id)
    if (bin) {
      approvers.push({
        kind: 'bin',
        id: bin.id,
        name: bin.name,
        department: bin.department ? toRef(bin.department) : null,
      })
    } else {
      issues.error(block, `Approver bin ${id} no longer exists in ITSM.`)
    }
  }
  if (approvers.length === 0) issues.error(block, 'Add at least one approver.')

  const mode = values('approvalMode') === 'all' ? 'all' : 'any'
  const next = nextFrom(block, SOURCE_HANDLE, 'The approved output')

  return {
    id: block.id,
    type: 'approval',
    label: block.name,
    level: level ? toRef(level) : { id: levelId ?? '', name: '' },
    approvers,
    mode,
    next,
  }
}

function compileEscalation(
  block: ItsmRuleGraphBlock,
  lookup: ItsmMasterDataLookup,
  issues: IssueCollector,
  nextFrom: NextFrom
): ItsmRuleEscalationNode {
  const timing = readEscalationTiming(block, issues)
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
    after: timing?.after ?? 0,
    unit: timing?.unit ?? 'hours',
    users,
    next: nextFrom(block, SOURCE_HANDLE, 'The escalation output'),
  }
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
  const values = (id: string) => block.subBlocks[id]?.value
  const next = nextFrom(block, SOURCE_HANDLE, 'The output')
  const base = { id: block.id, type: 'assign' as const, label: block.name, next }

  const assignTo = values('assignTo')
  /** `subcategory` was once its own choice; it now refines a category assignment. */
  if (assignTo === 'category' || assignTo === 'subcategory') {
    const categoryId = readId(values('assignCategory'))
    const category = categoryId ? lookup.categories.get(categoryId) : undefined
    if (!categoryId) issues.error(block, 'Choose a category.')
    else if (!category) issues.error(block, `Category ${categoryId} no longer exists in ITSM.`)
    const categoryRef = { id: category?.id ?? categoryId ?? '', name: category?.name ?? '' }
    const subcategoryId = readId(values('assignSubcategory'))
    if (!subcategoryId) {
      return { ...base, assignee: { kind: 'category', ...categoryRef } }
    }

    const subcategory = lookup.subcategories.get(subcategoryId)
    if (
      !subcategory ||
      (category && !lookup.categorySubcategories.get(category.id)?.has(subcategory.id))
    ) {
      issues.error(
        block,
        `Subcategory ${subcategoryId} is not in ${category?.name ?? 'this category'}.`
      )
    }
    return {
      ...base,
      assignee: {
        kind: 'subcategory',
        id: subcategory?.id ?? subcategoryId ?? '',
        name: subcategory?.name ?? '',
        category: categoryRef,
      },
    }
  }

  if (assignTo === 'user') {
    const rawUserType = values('assignUserType')
    const userType = isItsmUserType(rawUserType) ? rawUserType : 'resolver'
    const userId = readId(values('assignUser'))
    const user = userId ? lookup.users.get(userId) : undefined
    if (!userId) issues.error(block, 'Choose the user to assign to.')
    else if (!user) issues.error(block, `User ${userId} is no longer an active ITSM user.`)
    else if (!matchesItsmUserType(user.roleType, userType)) {
      issues.error(block, `${user.name} is not a ${userType} in ITSM.`)
    }
    return {
      ...base,
      assignee: { kind: 'user', id: user?.id ?? userId ?? '', name: user?.name ?? '', userType },
    }
  }

  const departmentId = readId(values('assignDepartment'))
  const binId = readId(values('assignBin'))
  const ruleId = readId(values('assignmentRule'))
  const department = departmentId ? lookup.departments.get(departmentId) : undefined
  const bin = binId ? lookup.bins.get(binId) : undefined
  const assignmentRule = ruleId ? lookup.assignmentRules.get(ruleId) : undefined

  if (departmentId && !department) {
    issues.error(block, `Department ${departmentId} no longer exists in ITSM.`)
  }
  if (!binId) issues.error(block, 'Choose a bin.')
  else if (!bin) issues.error(block, `Bin ${binId} no longer exists in ITSM.`)
  else if (department && !lookup.departmentBins.get(department.id)?.has(bin.id)) {
    issues.error(block, `Bin "${bin.name}" does not belong to ${department.name}.`)
  }
  if (ruleId && !assignmentRule)
    issues.error(block, `Rule type "${ruleId}" no longer exists in ITSM.`)

  return {
    ...base,
    assignee: {
      kind: 'bin',
      id: bin?.id ?? binId ?? '',
      name: bin?.name ?? '',
      department: department ? toRef(department) : bin?.department ? toRef(bin.department) : null,
      assignmentRule: assignmentRule ? toRef(assignmentRule) : null,
    },
  }
}

/** Approval chains normally climb levels (L1 then L2); a descent is likely a mistake. */
function warnOnLevelOrder(
  nodes: ItsmRuleNode[],
  nodesById: ReadonlyMap<string, ItsmRuleNode>,
  graph: ItsmRuleGraph,
  lookup: ItsmMasterDataLookup,
  issues: IssueCollector
) {
  const rank = new Map([...lookup.levels.keys()].map((id, index) => [id, index]))
  for (const node of nodes) {
    if (node.type !== 'approval' || !node.next) continue
    let next = nodesById.get(node.next)
    const seen = new Set<string>()
    while (next?.type === 'escalation' && next.next && !seen.has(next.id)) {
      seen.add(next.id)
      next = nodesById.get(next.next)
    }
    if (next?.type !== 'approval') continue
    const current = rank.get(String(node.level.id))
    const following = rank.get(String(next.level.id))
    if (current !== undefined && following !== undefined && following <= current) {
      issues.warn(
        graph.blocks[next.id] ?? null,
        `Level ${next.level.name} follows level ${node.level.name}. Approval levels usually go up.`
      )
    }
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
  assignDepartmentIds: string[]
}

/**
 * The master-data lists the rule's blocks reference, so a save reads only
 * those from ITSM. Counts every block, connected or not, so it can only ask
 * for more than the compiler uses, never less.
 */
export function collectItsmMasterDataNeeds(graph: ItsmRuleGraph): ItsmMasterDataNeeds {
  const lists = new Set<ItsmMasterDataListName>()
  /** For a single-choice field. */
  const needWhen = (name: ItsmMasterDataListName, value: unknown) => {
    if (readId(value) !== null) lists.add(name)
  }
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
        lists.add('levels')
        needWhenAny('users', values('approverUsers'))
        needWhenAny('departments', values('approverDepartments'))
        needWhenAny('bins', values('approverBins'))
        break
      case ITSM_ESCALATION_BLOCK_TYPE:
        needWhenAny('users', values('escalateToUsers'))
        break
      case ITSM_ASSIGN_BLOCK_TYPE: {
        const assignTo = values('assignTo')
        if (assignTo === 'category' || assignTo === 'subcategory') {
          lists.add('categories')
          needWhen('subcategories', values('assignSubcategory'))
        } else if (assignTo === 'user') {
          lists.add('users')
        } else {
          needWhen('departments', values('assignDepartment'))
          needWhen('bins', values('assignBin'))
          needWhen('assignmentRules', values('assignmentRule'))
        }
        break
      }
    }
  }
  return {
    lists,
    categoryIds: collectReferencedCategoryIds(graph),
    assignDepartmentIds: collectAssignDepartmentIds(graph),
  }
}

/** Every department an Assign block names, so its bins can be checked. */
export function collectAssignDepartmentIds(graph: ItsmRuleGraph): string[] {
  const ids = new Set<string>()
  for (const block of Object.values(graph.blocks)) {
    if (block.type !== ITSM_ASSIGN_BLOCK_TYPE) continue
    const id = readId(block.subBlocks.assignDepartment?.value)
    if (id) ids.add(id)
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
      const id = readId(block.subBlocks.assignCategory?.value)
      if (id && readId(block.subBlocks.assignSubcategory?.value)) ids.add(id)
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
