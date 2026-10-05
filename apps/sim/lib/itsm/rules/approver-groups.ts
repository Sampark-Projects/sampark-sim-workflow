import { generateShortId } from '@sim/utils/id'
import {
  type ItsmGroupValue,
  isRecord,
  joinItsmGroupSummaries,
  parseItsmGroupValues,
  readStoredArray,
} from '@/lib/itsm/rules/group-values'
import type { SelectorKey } from '@/lib/selectors/manifest'

/**
 * Stored shape of the ITSM Approval block's `approvers` subblock, shared by the
 * editor, the canvas card, and the rule compiler. Client-safe.
 *
 * The approval passes when any group passes (OR); a group passes when every row
 * in it approves (AND); a row approves when any one of its values approves.
 * A bins row may name departments, which narrow the bins it lists.
 */

export const ITSM_APPROVERS_SUBBLOCK_ID = 'approvers'
export const ITSM_APPROVERS_SUBBLOCK_TYPE = 'itsm-approver-groups'

export type ItsmApproverField = 'users' | 'bins'

interface ItsmApproverFieldConfig {
  label: string
  selectorKey: SelectorKey
}

export const ITSM_APPROVER_FIELDS: Record<ItsmApproverField, ItsmApproverFieldConfig> = {
  users: { label: 'Users', selectorKey: 'itsm.users' },
  /** Narrowed to the bins of the row's departments, when it names any. */
  bins: { label: 'Bins', selectorKey: 'itsm.bins' },
}

export const ITSM_APPROVER_FIELD_ORDER: readonly ItsmApproverField[] = ['bins', 'users']

export interface ItsmApproverRow {
  id: string
  field: ItsmApproverField | null
  values: ItsmGroupValue[]
  /** Bins rows only: the departments whose bins the row lists; empty lists every bin. */
  departments: ItsmGroupValue[]
}

/** Every row in a group must approve (AND). */
export interface ItsmApproverGroup {
  id: string
  rows: ItsmApproverRow[]
}

function isApproverField(value: unknown): value is ItsmApproverField {
  return typeof value === 'string' && value in ITSM_APPROVER_FIELDS
}

export function createItsmApproverRow(): ItsmApproverRow {
  return { id: generateShortId(8), field: null, values: [], departments: [] }
}

export function createItsmApproverGroup(): ItsmApproverGroup {
  return { id: generateShortId(8), rows: [createItsmApproverRow()] }
}

/** The value of a block whose approvers were never written; fixed ids keep re-reads stable. */
function createDefaultItsmApproverGroups(): ItsmApproverGroup[] {
  return [
    {
      id: 'approvers-group',
      rows: [{ id: 'approvers-row', field: null, values: [], departments: [] }],
    },
  ]
}

/** A row of a field the block no longer offers reads as an unchosen row. */
function parseRow(id: string, row: Record<string, unknown>): ItsmApproverRow {
  if (!isApproverField(row.field)) return { id, field: null, values: [], departments: [] }
  return {
    id,
    field: row.field,
    values: parseItsmGroupValues(row.values),
    departments: row.field === 'bins' ? parseItsmGroupValues(row.departments) : [],
  }
}

export function parseItsmApproverGroups(value: unknown): ItsmApproverGroup[] {
  const raw = readStoredArray(value)
  if (!raw) return createDefaultItsmApproverGroups()
  const groups = raw.flatMap((group): ItsmApproverGroup[] => {
    if (!isRecord(group) || typeof group.id !== 'string' || !Array.isArray(group.rows)) return []
    const rows = group.rows.flatMap((row): ItsmApproverRow[] =>
      isRecord(row) && typeof row.id === 'string' ? [parseRow(row.id, row)] : []
    )
    return [{ id: group.id, rows }]
  })
  return groups.length > 0 ? groups : createDefaultItsmApproverGroups()
}

export function serializeItsmApproverGroups(groups: ItsmApproverGroup[]): string {
  return JSON.stringify(groups)
}

/** One-line reading for the canvas card, e.g. `Users: Rahul, Parth and Bins: Testing`. */
export function summarizeItsmApproverGroups(groups: ItsmApproverGroup[]): string {
  return joinItsmGroupSummaries(
    groups.map((group) =>
      group.rows
        .flatMap((row) =>
          row.field && row.values.length > 0
            ? [
                `${ITSM_APPROVER_FIELDS[row.field].label}: ${row.values
                  .map((value) => value.label)
                  .join(', ')}`,
              ]
            : []
        )
        .join(' and ')
    )
  )
}
