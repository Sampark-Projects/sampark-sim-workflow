import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import {
  ITSM_DEFAULT_REQUEST_TYPE,
  type ItsmBinOption,
  type ItsmMasterDataOption,
  type ItsmUserOption,
} from '@/lib/itsm/master-data/types'

const logger = createLogger('ItsmMasterDataGateway')

const REQUEST_TIMEOUT_MS = 10_000
/**
 * Master data changes rarely. Each list is read once for an editing session
 * and kept this long, so a change made in ITSM still shows up without a
 * redeploy.
 */
const CACHE_TTL_MS = 10 * 60_000
/**
 * An empty list is usually a real "no data" answer (a category without
 * subcategories), but it is also what ITSM answers for a moment while a
 * backend deploy rolls out. It is kept only briefly, so a transient empty
 * answer cannot blank the dropdowns for the full cache lifetime.
 */
const EMPTY_LIST_TTL_MS = 30_000
const CACHE_MAX_ENTRIES = 500

/**
 * Customer-scoped dropdown API: one public endpoint (no authorization or
 * device id), the list chosen by `type`.
 */
const CUSTOMER_DROPDOWN_PATH = '/ticket-management/api/ext/fetch/dropdown'

/** The gateway's "no rows" answer: HTTP 200 carrying `statusCode: 202`. */
const NO_DATA_STATUS_CODE = 202

export class ItsmGatewayRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ItsmGatewayRequestError'
  }
}

const envelopeSchema = z.object({
  status: z.boolean(),
  statusCode: z.number(),
  message: z.string().nullish(),
  responseObject: z.record(z.string(), z.unknown()).nullish(),
})

const dropdownItemSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  value: z.string().nullish(),
})

/**
 * The ITSM gateway each Sim deployment talks to, keyed by Sim's own domain
 * (`NEXT_PUBLIC_APP_URL`). Only the production Sim domain has a production
 * ITSM gateway; every other Sim deployment (QA, local) uses the QA gateway.
 */
const ITSM_GATEWAY_URL_BY_SIM_HOST: Record<string, string> = {
  'sim.samparkme.com': 'https://itsm.samparkme.com/gateway',
}
const DEFAULT_ITSM_GATEWAY_URL = 'https://itsmqa.samparkme.com/gateway'

/**
 * Resolves the ITSM gateway base URL from the domain Sim itself is deployed
 * on. `ITSM_GATEWAY_URL` remains a manual override for local testing against
 * a non-standard gateway; leave it unset to use the domain-based default.
 */
export function resolveItsmGatewayUrl(): string {
  const simHost = new URL(env.NEXT_PUBLIC_APP_URL).hostname
  const url =
    env.ITSM_GATEWAY_URL || ITSM_GATEWAY_URL_BY_SIM_HOST[simHost] || DEFAULT_ITSM_GATEWAY_URL
  return url.replace(/\/+$/, '')
}

/**
 * POSTs to one gateway endpoint and returns its `responseObject`, or `null`
 * when the gateway reports that there is no data.
 */
async function callGateway(
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const baseUrl = resolveItsmGatewayUrl()
  const headers = { 'Content-Type': 'application/json' }
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    })
  } catch (error) {
    throw new ItsmGatewayRequestError(`ITSM gateway request failed: ${getErrorMessage(error)}`)
  }
  if (!response.ok) {
    throw new ItsmGatewayRequestError(`ITSM gateway responded with HTTP ${response.status}`)
  }

  const envelope = envelopeSchema.safeParse(await response.json().catch(() => null))
  if (!envelope.success) {
    throw new ItsmGatewayRequestError('ITSM gateway returned an unexpected response shape')
  }
  const { status, statusCode, message, responseObject } = envelope.data
  if (statusCode === NO_DATA_STATUS_CODE || (status && !responseObject)) return null
  if (!status || !responseObject) {
    throw new ItsmGatewayRequestError(message || `ITSM gateway error (code ${statusCode})`)
  }
  return responseObject
}

function parseList<T extends z.ZodType>(
  responseObject: Record<string, unknown> | null,
  key: string,
  itemSchema: T
): z.output<T>[] {
  if (!responseObject) return []
  const parsed = z.array(itemSchema).safeParse(responseObject[key] ?? [])
  if (!parsed.success) {
    throw new ItsmGatewayRequestError(`ITSM gateway returned malformed "${key}" data`)
  }
  return parsed.data
}

function cleanName(value: string | null | undefined, fallback: string): string {
  const name = value?.trim()
  return name ? name : fallback
}

/**
 * Reads one list of a customer's master data. `searchValue` carries the parent
 * id for child lists (a category's subcategories, a department's bins).
 * `requestType` narrows the lists ITSM scopes by process (categories, bins).
 * A row without an id cannot be referenced by a rule, so it is dropped.
 */
async function fetchCustomerDropdown(
  customerId: string,
  type: string,
  searchValue: string,
  requestType: string | undefined
): Promise<ItsmMasterDataOption[]> {
  const responseObject = await callGateway(CUSTOMER_DROPDOWN_PATH, {
    customerId,
    type,
    searchValue,
    ...(requestType ? { requestType } : {}),
  })
  return parseList(responseObject, 'dropdownDetails', dropdownItemSchema).flatMap((item) => {
    const id = item.id === null || item.id === undefined ? '' : String(item.id).trim()
    if (!id) {
      logger.warn('ITSM dropdown row without an id was skipped', { type })
      return []
    }
    return [{ id, name: cleanName(item.value, id) }]
  })
}

interface CacheLoadContext {
  load: () => Promise<ItsmMasterDataOption[]>
}

/** Keyed by customer, list, and parent id. */
const masterDataCache = new LRUCache<string, ItsmMasterDataOption[], CacheLoadContext>({
  max: CACHE_MAX_ENTRIES,
  ttl: CACHE_TTL_MS,
  ignoreFetchAbort: true,
  fetchMethod: async (_key, _staleValue, { context, options }) => {
    const value = await context.load()
    if (value.length === 0) options.ttl = EMPTY_LIST_TTL_MS
    return value
  },
})

/**
 * A failed read is not cached as data, so without this every dropdown, detail
 * lookup, and client retry would call ITSM again while it is failing. The
 * error is replayed for a few seconds instead, then the next read tries again.
 */
const FAILURE_REPLAY_MS = 10_000
const recentFailures = new LRUCache<string, Error>({
  max: CACHE_MAX_ENTRIES,
  ttl: FAILURE_REPLAY_MS,
})

async function cached<T extends ItsmMasterDataOption>(
  key: string,
  load: () => Promise<T[]>
): Promise<T[]> {
  const failure = recentFailures.get(key)
  if (failure !== undefined) throw failure
  try {
    const value = await masterDataCache.fetch(key, { context: { load } })
    return (value ?? []) as T[]
  } catch (error) {
    if (error instanceof ItsmGatewayRequestError) recentFailures.set(key, error)
    throw error
  }
}

function customerList(
  customerId: string,
  type: string,
  searchValue = '',
  requestType?: string
): Promise<ItsmMasterDataOption[]> {
  return cached(JSON.stringify([customerId, type, searchValue, requestType ?? null]), () =>
    fetchCustomerDropdown(customerId, type, searchValue, requestType)
  )
}

/** Every customer list that needs no parent id, as `[type, requestType]`. */
const INDEPENDENT_LISTS: readonly (readonly [string, string | undefined])[] = [
  ['CATEGORY', ITSM_DEFAULT_REQUEST_TYPE],
  ['BUSINESS_UNIT', undefined],
  ['BIN', ITSM_DEFAULT_REQUEST_TYPE],
  ['STATUS', undefined],
  ['ORGANIZATION', undefined],
  ['SEVERITY', undefined],
  ['USER', undefined],
  ['CREATOR', undefined],
  ['RESOLVER', undefined],
  ['ASSIGNMENT_RULE', undefined],
  ['LABEL', undefined],
]

/**
 * Starts every list that needs no parent id, so opening a rule reads all of
 * them from ITSM in one parallel round instead of one per dropdown as panels
 * open. Each list keeps its own cache entry: a cached list is not read again,
 * and one failing list does not fail the others. Only the lists that depend on
 * a choice (a category's subcategories, a department's bins) are read later,
 * once per parent.
 */
function warmIndependentLists(customerId: string): void {
  for (const [type, requestType] of INDEPENDENT_LISTS) {
    customerList(customerId, type, '', requestType).catch(() => {})
  }
}

/** A list with no parent id; asking for one starts all of them. */
function independentList(
  customerId: string,
  type: string,
  requestType?: string
): Promise<ItsmMasterDataOption[]> {
  warmIndependentLists(customerId)
  return customerList(customerId, type, '', requestType)
}

export function listItsmCategories(customerId: string): Promise<ItsmMasterDataOption[]> {
  return independentList(customerId, 'CATEGORY', ITSM_DEFAULT_REQUEST_TYPE)
}

export function listItsmSubcategories(
  customerId: string,
  categoryId: string
): Promise<ItsmMasterDataOption[]> {
  return customerList(customerId, 'SUB_CATEGORY', categoryId)
}

export function listItsmDepartments(customerId: string): Promise<ItsmMasterDataOption[]> {
  return independentList(customerId, 'BUSINESS_UNIT')
}

export function listItsmBins(
  customerId: string,
  departmentId: string
): Promise<ItsmMasterDataOption[]> {
  return customerList(customerId, 'BIN', departmentId, ITSM_DEFAULT_REQUEST_TYPE)
}

export function listItsmStatuses(customerId: string): Promise<ItsmMasterDataOption[]> {
  return independentList(customerId, 'STATUS')
}

export function listItsmOrganizations(customerId: string): Promise<ItsmMasterDataOption[]> {
  return independentList(customerId, 'ORGANIZATION')
}

export function listItsmSeverities(customerId: string): Promise<ItsmMasterDataOption[]> {
  return independentList(customerId, 'SEVERITY')
}

/** The bins of the given departments, each tagged with its department. */
export async function listItsmBinsOfDepartments(
  customerId: string,
  departmentIds: readonly string[]
): Promise<ItsmBinOption[]> {
  if (departmentIds.length === 0) return []
  const departments = new Map(
    (await listItsmDepartments(customerId)).map((department) => [String(department.id), department])
  )
  const lists = await Promise.all(
    departmentIds.map(async (departmentId) =>
      (await listItsmBins(customerId, departmentId)).map((bin) => ({
        id: String(bin.id),
        name: bin.name,
        department: departments.get(departmentId) ?? null,
      }))
    )
  )
  return lists.flat()
}

/**
 * Every bin of the customer. Reads the whole list in one call (`BIN` with no
 * department); where the gateway does not support that it answers with an
 * error, and the bins are read department by department instead.
 */
export async function listItsmAllBins(customerId: string): Promise<ItsmBinOption[]> {
  try {
    return (await independentList(customerId, 'BIN', ITSM_DEFAULT_REQUEST_TYPE)).map((bin) => ({
      id: String(bin.id),
      name: bin.name,
      department: null,
    }))
  } catch (error) {
    if (!(error instanceof ItsmGatewayRequestError)) throw error
    const departmentIds = (await listItsmDepartments(customerId)).map((department) =>
      String(department.id)
    )
    return listItsmBinsOfDepartments(customerId, departmentIds)
  }
}

/**
 * Every user, with a role taken from the creator and resolver lists: a user
 * in both is `Both`, a user in neither has no role.
 */
export async function listItsmUsers(customerId: string): Promise<ItsmUserOption[]> {
  const [users, creators, resolvers] = await Promise.all([
    independentList(customerId, 'USER'),
    customerList(customerId, 'CREATOR'),
    customerList(customerId, 'RESOLVER'),
  ])
  const creatorIds = new Set(creators.map((user) => user.id))
  const resolverIds = new Set(resolvers.map((user) => user.id))
  return users.map((user) => {
    const isCreator = creatorIds.has(user.id)
    const isResolver = resolverIds.has(user.id)
    const roleType =
      isCreator && isResolver ? 'Both' : isCreator ? 'Creator' : isResolver ? 'Resolver' : null
    return { ...user, roleType }
  })
}

/**
 * The escalation levels (L1, L2, ...). ITSM gives every level the same id, so a
 * level is identified by its name.
 */
export async function listItsmLevels(customerId: string): Promise<ItsmMasterDataOption[]> {
  return (await independentList(customerId, 'LABEL')).map((level) => ({
    id: level.name,
    name: level.name,
  }))
}

/**
 * The bin assignment rules (Bin Owner, Round Robin, Roster). ITSM gives every
 * rule the same id, so the rule is identified by its name, as the rule JSON
 * has always carried it.
 */
export async function listItsmAssignmentRules(customerId: string): Promise<ItsmMasterDataOption[]> {
  return (await independentList(customerId, 'ASSIGNMENT_RULE')).map((rule) => ({
    id: rule.name,
    name: rule.name,
  }))
}

export function clearItsmMasterDataCacheForTests(): void {
  masterDataCache.clear()
  recentFailures.clear()
}
