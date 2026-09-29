import { createLogger } from '@sim/logger'
import {
  ItsmGatewayNotConfiguredError,
  listItsmAllBins,
  listItsmAssignmentRules,
  listItsmBinsOfDepartments,
  listItsmCategories,
  listItsmDepartments,
  listItsmLevels,
  listItsmOrganizations,
  listItsmSeverities,
  listItsmStatuses,
  listItsmSubcategories,
  listItsmUsers,
} from '@/lib/itsm/master-data/gateway.server'
import {
  type ItsmBinOption,
  type ItsmMasterDataOption,
  isItsmUserType,
  matchesItsmUserType,
} from '@/lib/itsm/master-data/types'
import { findItsmCustomerIdByWorkspaceId } from '@/lib/itsm/sync/link'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachment,
  type ServerSelectorAttachmentMap,
  type ServerSelectorExecutionResult,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

const logger = createLogger('ItsmSelectors')

export type ItsmSelectorKey = Extract<ServerSelectorKey, `itsm.${string}`>

/** Upper bound on parent ids one subcategory lookup may fan out to. */
const MAX_PARENT_IDS = 50

function toSelectorOptions(options: readonly ItsmMasterDataOption[]): SafeSelectorOption[] {
  return options.map((option) => ({ id: String(option.id), label: option.name }))
}

/**
 * Department names repeat in ITSM (two "Sales" units); the id disambiguates the
 * label without changing the name the rule JSON carries.
 */
function labelDepartments(options: readonly ItsmMasterDataOption[]): SafeSelectorOption[] {
  const counts = new Map<string, number>()
  for (const option of options) counts.set(option.name, (counts.get(option.name) ?? 0) + 1)
  return options.map((option) => ({
    id: String(option.id),
    label: (counts.get(option.name) ?? 0) > 1 ? `${option.name} (#${option.id})` : option.name,
  }))
}

/** Across every department, the department tells same-named bins apart. */
function labelAllBins(bins: readonly ItsmBinOption[]): SafeSelectorOption[] {
  return bins.map((bin) => ({
    id: bin.id,
    label: bin.department ? `${bin.name} · ${bin.department.name}` : bin.name,
  }))
}

function parseParentIds(raw: string | undefined): string[] {
  const ids = [
    ...new Set(
      (raw ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ]
  if (ids.length === 0 || ids.length > MAX_PARENT_IDS) throw new SelectorContextUnavailableError()
  return ids
}

/**
 * Builds an attachment over a flat, fully-loaded list of the workspace's ITSM
 * customer. Detail reads resolve against the same cached list, so hydrating a
 * saved id costs no extra call.
 */
function flatItsmSelector(
  load: (args: ExecuteServerSelectorArgs, customerId: string) => Promise<SafeSelectorOption[]>
): ServerSelectorAttachment {
  return {
    destination: 'fixed',
    async execute(args): Promise<ServerSelectorExecutionResult> {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const customerId = await findItsmCustomerIdByWorkspaceId(args.workspaceId)
      if (!customerId) {
        logger.warn('ITSM selector requested for a workspace with no ITSM customer', {
          selectorKey: args.selectorKey,
          workspaceId: args.workspaceId,
        })
        throw new SelectorConnectionUnavailableError()
      }
      let options: SafeSelectorOption[]
      try {
        options = await load(args, customerId)
      } catch (error) {
        if (error instanceof SelectorContextUnavailableError) throw error
        if (error instanceof ItsmGatewayNotConfiguredError) {
          logger.warn('ITSM selector requested but the gateway is not configured', {
            selectorKey: args.selectorKey,
          })
          throw new SelectorConnectionUnavailableError()
        }
        logger.error('ITSM selector failed', { selectorKey: args.selectorKey, error })
        throw new SelectorOptionsUnavailableError()
      }
      if (args.request.kind === 'detail') {
        const detailId = args.request.id
        return detailSelectorResult(options.find((option) => option.id === detailId) ?? null)
      }
      return listSelectorResult(options)
    },
  }
}

export const itsmSelectorAttachments = {
  'itsm.categories': flatItsmSelector(async (_args, customerId) =>
    toSelectorOptions(await listItsmCategories(customerId))
  ),
  'itsm.organizations': flatItsmSelector(async (_args, customerId) =>
    toSelectorOptions(await listItsmOrganizations(customerId))
  ),
  'itsm.subcategories': flatItsmSelector(async (args, customerId) => {
    const categoryIds = parseParentIds(args.context.itsmCategoryIds)
    const lists = await Promise.all(categoryIds.map((id) => listItsmSubcategories(customerId, id)))
    return toSelectorOptions(lists.flat())
  }),
  'itsm.departments': flatItsmSelector(async (_args, customerId) =>
    labelDepartments(await listItsmDepartments(customerId))
  ),
  'itsm.bins': flatItsmSelector(async (args, customerId) => {
    const departmentIds = args.context.itsmDepartmentId
      ? parseParentIds(args.context.itsmDepartmentId)
      : []
    if (departmentIds.length > 0) {
      return toSelectorOptions(await listItsmBinsOfDepartments(customerId, departmentIds))
    }
    return labelAllBins(await listItsmAllBins(customerId))
  }),
  'itsm.allBins': flatItsmSelector(async (_args, customerId) =>
    labelAllBins(await listItsmAllBins(customerId))
  ),
  'itsm.users': flatItsmSelector(async (_args, customerId) =>
    toSelectorOptions(await listItsmUsers(customerId))
  ),
  'itsm.usersByType': flatItsmSelector(async (args, customerId) => {
    const userType = args.context.itsmUserType
    if (!isItsmUserType(userType)) throw new SelectorContextUnavailableError()
    return toSelectorOptions(
      (await listItsmUsers(customerId)).filter((user) =>
        matchesItsmUserType(user.roleType, userType)
      )
    )
  }),
  'itsm.statuses': flatItsmSelector(async (_args, customerId) =>
    toSelectorOptions(await listItsmStatuses(customerId))
  ),
  'itsm.severities': flatItsmSelector(async (_args, customerId) =>
    toSelectorOptions(await listItsmSeverities(customerId))
  ),
  'itsm.levels': flatItsmSelector(async () => toSelectorOptions(await listItsmLevels())),
  'itsm.assignmentRules': flatItsmSelector(async () =>
    toSelectorOptions(await listItsmAssignmentRules())
  ),
} satisfies ServerSelectorAttachmentMap<ItsmSelectorKey>
