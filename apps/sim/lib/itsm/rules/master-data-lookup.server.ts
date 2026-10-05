import {
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
import type { ItsmMasterDataOption } from '@/lib/itsm/master-data/types'
import type {
  ItsmMasterDataListName,
  ItsmMasterDataLookup,
  ItsmMasterDataNeeds,
} from '@/lib/itsm/rules/compile'

function indexById<T extends ItsmMasterDataOption>(options: readonly T[]): Map<string, T> {
  const byId = new Map<string, T>()
  for (const option of options) {
    const id = String(option.id)
    if (!byId.has(id)) byId.set(id, option)
  }
  return byId
}

/**
 * Loads the master-data lists a rule references for one ITSM customer, indexed
 * by the string id the editor stores. A list the rule does not use is left
 * empty rather than read from ITSM. Subcategories are loaded only for the
 * categories the rule uses, because ITSM lists them per category.
 */
export async function loadItsmMasterDataLookup(
  customerId: string,
  { lists, categoryIds, binDepartmentIds }: ItsmMasterDataNeeds
): Promise<ItsmMasterDataLookup> {
  const ifNeeded = <T>(name: ItsmMasterDataListName, load: () => Promise<T[]>): Promise<T[]> =>
    lists.has(name) ? load() : Promise.resolve([])

  const [
    categories,
    subcategoryLists,
    departments,
    bins,
    organizations,
    users,
    statuses,
    severities,
    levels,
    assignmentRules,
    departmentBinLists,
  ] = await Promise.all([
    ifNeeded('categories', () => listItsmCategories(customerId)),
    Promise.all(categoryIds.map((id) => listItsmSubcategories(customerId, id))),
    ifNeeded('departments', () => listItsmDepartments(customerId)),
    ifNeeded('bins', () => listItsmAllBins(customerId)),
    ifNeeded('organizations', () => listItsmOrganizations(customerId)),
    ifNeeded('users', () => listItsmUsers(customerId)),
    ifNeeded('statuses', () => listItsmStatuses(customerId)),
    ifNeeded('severities', () => listItsmSeverities(customerId)),
    ifNeeded('levels', () => listItsmLevels(customerId)),
    ifNeeded('assignmentRules', () => listItsmAssignmentRules(customerId)),
    listItsmBinsOfDepartments(customerId, binDepartmentIds),
  ])
  const categorySubcategories = new Map(
    categoryIds.map((id, index) => [
      id,
      new Set(subcategoryLists[index].map((subcategory) => subcategory.id)),
    ])
  )
  const departmentBins = new Map<string, Set<string>>()
  for (const bin of departmentBinLists) {
    if (!bin.department) continue
    const binIds = departmentBins.get(bin.department.id) ?? new Set<string>()
    binIds.add(bin.id)
    departmentBins.set(bin.department.id, binIds)
  }
  return {
    categories: indexById(categories),
    subcategories: indexById(subcategoryLists.flat()),
    departments: indexById(departments),
    bins: indexById(bins),
    organizations: indexById(organizations),
    users: indexById(users),
    statuses: indexById(statuses),
    severities: indexById(severities),
    levels: indexById(levels),
    assignmentRules: indexById(assignmentRules),
    departmentBins,
    categorySubcategories,
  }
}
