/**
 * Pieces shared by the stored shapes of the ITSM blocks that hold OR-ed groups
 * of AND-ed rows (Approval approvers, Assign assignees). Client-safe.
 */

/** One picked master-data value: ITSM's id, and the label shown when it was picked. */
export interface ItsmGroupValue {
  id: string
  label: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads a stored subblock value: a JSON string, or the already-parsed array. */
export function readStoredArray(value: unknown): unknown[] | null {
  let raw: unknown = value
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value)
    } catch {
      raw = null
    }
  }
  return Array.isArray(raw) ? raw : null
}

export function parseItsmGroupValue(value: unknown): ItsmGroupValue | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null
  return { id: value.id, label: typeof value.label === 'string' ? value.label : value.id }
}

export function parseItsmGroupValues(value: unknown): ItsmGroupValue[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const parsed = parseItsmGroupValue(item)
    return parsed ? [parsed] : []
  })
}

/** Joins per-group readings as `(a and b) or (c)`; a single group needs no brackets. */
export function joinItsmGroupSummaries(groups: string[]): string {
  const filled = groups.filter(Boolean)
  if (filled.length <= 1) return filled[0] ?? ''
  return filled.map((group) => `(${group})`).join(' or ')
}

/**
 * An order-insensitive key for a set of parts (a row's values, a group's rows),
 * so two sets holding the same parts in any order compare equal.
 */
export function itsmSetKey(parts: readonly string[]): string {
  return JSON.stringify([...new Set(parts)].sort())
}

/** Pairs each set whose key repeats an earlier one with that earlier set's index. */
export function findRepeatedItsmSets(keys: readonly (string | null)[]): {
  index: number
  firstIndex: number
}[] {
  const firstByKey = new Map<string, number>()
  const repeats: { index: number; firstIndex: number }[] = []
  keys.forEach((key, index) => {
    if (key === null) return
    const firstIndex = firstByKey.get(key)
    if (firstIndex === undefined) firstByKey.set(key, index)
    else repeats.push({ index, firstIndex })
  })
  return repeats
}

/** The ids the other rows of a group already hold, so a row's picker can hide them. */
export function itsmIdsHeldByOtherRows<R extends { id: string }>(
  rows: readonly R[],
  rowId: string,
  idsOf: (row: R) => readonly string[]
): ReadonlySet<string> {
  return new Set(rows.filter((row) => row.id !== rowId).flatMap(idsOf))
}
