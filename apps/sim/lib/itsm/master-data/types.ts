/**
 * ITSM master data shared by the selector layer, the ITSM blocks, and the rule
 * compiler. Client-safe: no server imports.
 */

/**
 * Request type sent to the ITSM dropdown APIs. Every ITSM workflow belongs to
 * one ITSM process; until the process is stored per workflow, all of them are
 * Service Request workflows.
 */
export const ITSM_DEFAULT_REQUEST_TYPE = 'SR' as const

/** The user types a user list can be narrowed to. */
export const ITSM_USER_TYPE_OPTIONS = [
  { label: 'Creator', id: 'creator' },
  { label: 'Resolver', id: 'resolver' },
  { label: 'Both', id: 'both' },
] as const
export type ItsmUserType = (typeof ITSM_USER_TYPE_OPTIONS)[number]['id']

const ROLE_TYPES_BY_USER_TYPE: Record<ItsmUserType, ReadonlySet<string> | null> = {
  creator: new Set(['creator', 'both']),
  resolver: new Set(['resolver', 'both']),
  both: null,
}

export function isItsmUserType(value: unknown): value is ItsmUserType {
  return typeof value === 'string' && value in ROLE_TYPES_BY_USER_TYPE
}

/**
 * Whether a user's ITSM `roleType` fits a user type. A `Both` user is both a
 * creator and a resolver; the `both` type lists every user.
 */
export function matchesItsmUserType(roleType: string | null, userType: ItsmUserType): boolean {
  const roles = ROLE_TYPES_BY_USER_TYPE[userType]
  return roles === null || roles.has(roleType?.toLowerCase() ?? '')
}

/** One master-data record, as ITSM identifies and names it. */
export interface ItsmMasterDataOption {
  id: string
  name: string
}

export interface ItsmUserOption extends ItsmMasterDataOption {
  id: string
  /** `Creator`, `Resolver`, or `Both`; null when ITSM lists the user as neither. */
  roleType: string | null
}

export interface ItsmBinOption extends ItsmMasterDataOption {
  id: string
  /** Null when the bin was listed without a department and ITSM did not say which. */
  department: ItsmMasterDataOption | null
}
