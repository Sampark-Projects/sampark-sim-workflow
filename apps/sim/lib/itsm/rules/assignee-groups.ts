import { generateShortId } from '@sim/utils/id'
import { type ItsmUserType, isItsmUserType } from '@/lib/itsm/master-data/types'
import {
  type ItsmGroupValue,
  isRecord,
  joinItsmGroupSummaries,
  parseItsmGroupValue,
  readStoredArray,
} from '@/lib/itsm/rules/group-values'

/**
 * Stored shape of the ITSM Assign block's `assignees` subblock, shared by the
 * editor, the canvas card, and the rule compiler. Client-safe.
 *
 * Groups are OR-ed and the rows of a group AND-ed. Each row is one assignment
 * target built from the Assign fields: a bin (optionally narrowed by its
 * department, with a rule type), a user of a type, or a category (optionally
 * one of its subcategories).
 */

export const ITSM_ASSIGNEES_SUBBLOCK_ID = 'assignees'
export const ITSM_ASSIGNEES_SUBBLOCK_TYPE = 'itsm-assignee-groups'

export type ItsmAssignTarget = 'bin' | 'user' | 'category'

export const ITSM_ASSIGN_TARGET_OPTIONS: readonly { id: ItsmAssignTarget; label: string }[] = [
  { id: 'bin', label: 'Bin' },
  { id: 'user', label: 'User' },
  { id: 'category', label: 'Category' },
]

export interface ItsmAssigneeRow {
  id: string
  assignTo: ItsmAssignTarget
  /** Bin target: narrows the bin list; optional. */
  department: ItsmGroupValue | null
  bin: ItsmGroupValue | null
  /** Bin target: how the bin distributes the ticket; optional. */
  assignmentRule: ItsmGroupValue | null
  /** User target: the list the user is picked from. */
  userType: ItsmUserType
  user: ItsmGroupValue | null
  category: ItsmGroupValue | null
  /** Category target: refines the category; optional. */
  subcategory: ItsmGroupValue | null
}

/** Every row in a group applies together (AND). */
export interface ItsmAssigneeGroup {
  id: string
  rows: ItsmAssigneeRow[]
}

const ASSIGN_TARGETS = new Set<string>(ITSM_ASSIGN_TARGET_OPTIONS.map((option) => option.id))

function emptyRowFields(): Omit<ItsmAssigneeRow, 'id'> {
  return {
    assignTo: 'bin',
    department: null,
    bin: null,
    assignmentRule: null,
    userType: 'resolver',
    user: null,
    category: null,
    subcategory: null,
  }
}

export function createItsmAssigneeRow(): ItsmAssigneeRow {
  return { id: generateShortId(8), ...emptyRowFields() }
}

export function createItsmAssigneeGroup(): ItsmAssigneeGroup {
  return { id: generateShortId(8), rows: [createItsmAssigneeRow()] }
}

/** A row switched to another target keeps only its id: the old target's picks no longer apply. */
export function resetItsmAssigneeRow(row: ItsmAssigneeRow, assignTo: ItsmAssignTarget) {
  return { id: row.id, ...emptyRowFields(), assignTo }
}

/** The value of a block whose assignees were never written; fixed ids keep re-reads stable. */
function createDefaultItsmAssigneeGroups(): ItsmAssigneeGroup[] {
  return [{ id: 'assignees-group', rows: [{ id: 'assignees-row', ...emptyRowFields() }] }]
}

function parseRow(row: unknown): ItsmAssigneeRow | null {
  if (!isRecord(row) || typeof row.id !== 'string') return null
  return {
    id: row.id,
    assignTo:
      typeof row.assignTo === 'string' && ASSIGN_TARGETS.has(row.assignTo)
        ? (row.assignTo as ItsmAssignTarget)
        : 'bin',
    department: parseItsmGroupValue(row.department),
    bin: parseItsmGroupValue(row.bin),
    assignmentRule: parseItsmGroupValue(row.assignmentRule),
    userType: isItsmUserType(row.userType) ? row.userType : 'resolver',
    user: parseItsmGroupValue(row.user),
    category: parseItsmGroupValue(row.category),
    subcategory: parseItsmGroupValue(row.subcategory),
  }
}

export function parseItsmAssigneeGroups(value: unknown): ItsmAssigneeGroup[] {
  const raw = readStoredArray(value)
  if (!raw) return createDefaultItsmAssigneeGroups()
  const groups = raw.flatMap((group): ItsmAssigneeGroup[] => {
    if (!isRecord(group) || typeof group.id !== 'string' || !Array.isArray(group.rows)) return []
    const rows = group.rows.flatMap((row) => {
      const parsed = parseRow(row)
      return parsed ? [parsed] : []
    })
    return [{ id: group.id, rows }]
  })
  return groups.length > 0 ? groups : createDefaultItsmAssigneeGroups()
}

export function serializeItsmAssigneeGroups(groups: ItsmAssigneeGroup[]): string {
  return JSON.stringify(groups)
}

/** One assignment as read on the canvas, e.g. `Bin Testing (Roster)`; empty until picked. */
export function summarizeItsmAssigneeRow(row: ItsmAssigneeRow): string {
  if (row.assignTo === 'user') return row.user ? `User ${row.user.label}` : ''
  if (row.assignTo === 'category') {
    if (!row.category) return ''
    return row.subcategory
      ? `Category ${row.category.label} / ${row.subcategory.label}`
      : `Category ${row.category.label}`
  }
  if (!row.bin) return ''
  return row.assignmentRule
    ? `Bin ${row.bin.label} (${row.assignmentRule.label})`
    : `Bin ${row.bin.label}`
}

/** One-line reading for the canvas card, e.g. `(Bin Testing and User Rahul) or (Category HR)`. */
export function summarizeItsmAssigneeGroups(groups: ItsmAssigneeGroup[]): string {
  return joinItsmGroupSummaries(
    groups.map((group) => group.rows.map(summarizeItsmAssigneeRow).filter(Boolean).join(' and '))
  )
}

/**
 * What a row assigns to, for spotting the same assignment twice in a group:
 * the bin, the user, or the category with its subcategory. Null until picked.
 */
export function itsmAssigneeKey(row: ItsmAssigneeRow): string | null {
  if (row.assignTo === 'bin') return row.bin ? `bin:${row.bin.id}` : null
  if (row.assignTo === 'user') return row.user ? `user:${row.user.id}` : null
  if (!row.category) return null
  return `category:${row.category.id}:${row.subcategory?.id ?? ''}`
}
