import { generateShortId } from '@sim/utils/id'
import { ITSM_DEFAULT_REQUEST_TYPE } from '@/lib/itsm/master-data/types'
import type { SelectorKey } from '@/lib/selectors/manifest'

/**
 * Stored shape of the ITSM Condition block's `branches` subblock, shared by the
 * editor, the canvas card, and the rule compiler. Client-safe.
 *
 * Branches are ordered: the first match wins and the trailing `else` branch
 * catches everything else. Every branch id is `${blockId}-${suffix}` so the
 * shared duplicate/paste remapping rewrites it with the block id, and each
 * branch owns the `condition-${branch.id}` output handle.
 */

export const ITSM_CONDITION_BLOCK_TYPE = 'itsm_condition'
export const ITSM_CONDITION_SUBBLOCK_ID = 'branches'
export const ITSM_CONDITION_SUBBLOCK_TYPE = 'itsm-condition-input'

export type ItsmConditionField =
  | 'category'
  | 'subcategory'
  | 'department'
  | 'bin'
  | 'organization'
  | 'status'
  | 'severity'

export type ItsmConditionOperator = 'in' | 'not_in'

interface ItsmConditionFieldConfig {
  label: string
  selectorKey: SelectorKey
  /**
   * A field in the same group that narrows this field's options. `required`
   * parents must be picked first (ITSM lists subcategories per category);
   * `filter` parents only narrow an otherwise complete list.
   */
  parent?: { field: ItsmConditionField; mode: 'required' | 'filter' }
}

export const ITSM_CONDITION_FIELDS: Record<ItsmConditionField, ItsmConditionFieldConfig> = {
  category: { label: 'Category', selectorKey: 'itsm.categories' },
  subcategory: {
    label: 'Subcategory',
    selectorKey: 'itsm.subcategories',
    parent: { field: 'category', mode: 'required' },
  },
  department: { label: 'Department', selectorKey: 'itsm.departments' },
  bin: {
    label: 'Bin',
    selectorKey: 'itsm.bins',
    parent: { field: 'department', mode: 'filter' },
  },
  organization: { label: 'Organization', selectorKey: 'itsm.organizations' },
  status: { label: 'Status', selectorKey: 'itsm.statuses' },
  severity: { label: 'Severity', selectorKey: 'itsm.severities' },
}

export const ITSM_CONDITION_FIELD_ORDER: readonly ItsmConditionField[] = [
  'category',
  'subcategory',
  'department',
  'bin',
  'organization',
  'status',
  'severity',
]

/**
 * Fields that mean nothing for a request type. A Service Request workflow runs
 * before the request exists, so it has no status to test.
 */
const HIDDEN_FIELDS_BY_REQUEST_TYPE: Record<string, readonly ItsmConditionField[]> = {
  SR: ['status'],
}

export function getAvailableItsmConditionFields(
  requestType: string = ITSM_DEFAULT_REQUEST_TYPE
): ItsmConditionField[] {
  const hidden = new Set(HIDDEN_FIELDS_BY_REQUEST_TYPE[requestType] ?? [])
  return ITSM_CONDITION_FIELD_ORDER.filter((field) => !hidden.has(field))
}

export const ITSM_CONDITION_OPERATOR_LABELS: Record<ItsmConditionOperator, string> = {
  in: 'is',
  not_in: 'is not',
}

export interface ItsmConditionValue {
  id: string
  label: string
}

export interface ItsmConditionRow {
  id: string
  field: ItsmConditionField | null
  operator: ItsmConditionOperator
  values: ItsmConditionValue[]
}

/** Rows in a group must all match (AND). */
export interface ItsmConditionGroup {
  id: string
  rows: ItsmConditionRow[]
}

/** A branch matches when any of its groups matches (OR). */
export interface ItsmConditionBranch {
  id: string
  kind: 'branch' | 'else'
  label: string
  groups: ItsmConditionGroup[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isConditionField(value: unknown): value is ItsmConditionField {
  return typeof value === 'string' && value in ITSM_CONDITION_FIELDS
}

export function createItsmConditionRow(field: ItsmConditionField | null = null): ItsmConditionRow {
  return { id: generateShortId(8), field, operator: 'in', values: [] }
}

export function createItsmConditionGroup(): ItsmConditionGroup {
  return { id: generateShortId(8), rows: [createItsmConditionRow()] }
}

export function createItsmConditionBranch(blockId: string): ItsmConditionBranch {
  return {
    id: `${blockId}-${generateShortId(8)}`,
    kind: 'branch',
    label: '',
    groups: [createItsmConditionGroup()],
  }
}

function createElseBranch(blockId: string): ItsmConditionBranch {
  return { id: `${blockId}-else`, kind: 'else', label: 'Else', groups: [] }
}

/**
 * The branches of a block whose value was never written. Ids are derived from
 * the block id rather than generated, so the canvas and the editor agree on the
 * `if` handle before anything is persisted and an edge drawn from it survives.
 */
export function createDefaultItsmConditionBranches(blockId: string): ItsmConditionBranch[] {
  return [
    {
      id: `${blockId}-if`,
      kind: 'branch',
      label: '',
      groups: [
        {
          id: `${blockId}-if-group`,
          rows: [{ id: `${blockId}-if-row`, field: null, operator: 'in', values: [] }],
        },
      ],
    },
    createElseBranch(blockId),
  ]
}

function parseValues(value: unknown): ItsmConditionValue[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    isRecord(item) && typeof item.id === 'string' && item.id
      ? [{ id: item.id, label: typeof item.label === 'string' ? item.label : item.id }]
      : []
  )
}

function parseRows(value: unknown): ItsmConditionRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return []
    return [
      {
        id: item.id,
        field: isConditionField(item.field) ? item.field : null,
        operator: item.operator === 'not_in' ? 'not_in' : 'in',
        values: parseValues(item.values),
      },
    ]
  })
}

function parseGroups(value: unknown): ItsmConditionGroup[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    isRecord(item) && typeof item.id === 'string'
      ? [{ id: item.id, rows: parseRows(item.rows) }]
      : []
  )
}

/**
 * Reads the stored subblock value (a JSON string, or an already-parsed array)
 * into branches. Always returns exactly one trailing `else` branch, so the
 * canvas handles stay stable even for an empty or malformed value.
 */
export function parseItsmConditionBranches(blockId: string, value: unknown): ItsmConditionBranch[] {
  let raw: unknown = value
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value)
    } catch {
      raw = null
    }
  }
  if (!Array.isArray(raw)) return createDefaultItsmConditionBranches(blockId)

  const branches: ItsmConditionBranch[] = []
  let elseBranch: ItsmConditionBranch | null = null
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string') continue
    if (item.kind === 'else') {
      elseBranch = { id: item.id, kind: 'else', label: 'Else', groups: [] }
      continue
    }
    branches.push({
      id: item.id,
      kind: 'branch',
      label: typeof item.label === 'string' ? item.label : '',
      groups: parseGroups(item.groups),
    })
  }
  if (branches.length === 0) return createDefaultItsmConditionBranches(blockId)
  return [...branches, elseBranch ?? createElseBranch(blockId)]
}

export function serializeItsmConditionBranches(branches: ItsmConditionBranch[]): string {
  return JSON.stringify(branches)
}

/** One-line reading of a branch for the canvas card, e.g. `Category is A, B and Severity is SEV-0`. */
export function summarizeItsmConditionBranch(branch: ItsmConditionBranch): string {
  if (branch.kind === 'else') return 'Everything else'
  const groups = branch.groups
    .map((group) =>
      group.rows
        .filter((row) => row.field && row.values.length > 0)
        .map((row) => {
          const field = ITSM_CONDITION_FIELDS[row.field as ItsmConditionField].label
          const operator = ITSM_CONDITION_OPERATOR_LABELS[row.operator]
          return `${field} ${operator} ${row.values.map((value) => value.label).join(', ')}`
        })
        .join(' and ')
    )
    .filter(Boolean)
  const summary = groups.length > 1 ? groups.map((group) => `(${group})`).join(' or ') : groups[0]
  return branch.label ? `${branch.label}${summary ? ` — ${summary}` : ''}` : (summary ?? '')
}
