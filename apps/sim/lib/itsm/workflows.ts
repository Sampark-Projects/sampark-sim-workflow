import { db } from '@sim/db'
import { itsmOrganizationLink } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { ItsmLinkDisabledError, ItsmLinkNotFoundError } from '@/lib/itsm/token-exchange'
import { listWorkflowsForUser } from '@/lib/workflows/queries'

export interface ItsmWorkflowSummary {
  id: string
  name: string
  workspaceId: string | null
}

/**
 * Every workflow the tenant's headless owner user can see, across every
 * workspace in their organization — the same underlying query
 * `GET /api/workflows` uses for a session, just resolved by `customerId`
 * instead. No `workspaceId` filter: an org owner sees everything they own,
 * and a tenant may have any number of workspaces.
 */
export async function listItsmWorkflows(customerId: string): Promise<ItsmWorkflowSummary[]> {
  const [link] = await db
    .select({ simUserId: itsmOrganizationLink.simUserId, status: itsmOrganizationLink.status })
    .from(itsmOrganizationLink)
    .where(eq(itsmOrganizationLink.customerId, customerId))
    .limit(1)

  if (!link) throw new ItsmLinkNotFoundError(customerId)
  if (link.status !== 'active') throw new ItsmLinkDisabledError(customerId)

  const workflows = await listWorkflowsForUser({ userId: link.simUserId, scope: 'active' })
  return workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    workspaceId: workflow.workspaceId,
  }))
}
