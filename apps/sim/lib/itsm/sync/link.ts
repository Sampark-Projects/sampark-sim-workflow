import { db } from '@sim/db'
import { itsmOrganizationLink, workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { decryptItsmWebhookSecret } from '@/lib/itsm/encryption'

export interface ItsmSyncLink {
  organizationId: string
  customerId: string
  simUserId: string
  webhookUrl: string
  /** Decrypted HMAC signing secret. */
  webhookSigningSecret: string
}

/**
 * Whether an organization has ITSM sync configured at all — a cheap,
 * non-security-critical gate cached so ordinary (non-ITSM) workspace/workflow
 * creation costs one in-memory lookup instead of a query. 60s staleness is
 * acceptable: worst case a webhook fires ~1 sync cycle late for a
 * newly-configured link, never incorrectly.
 */
const linkByOrganizationCache = new LRUCache<string, { link: ItsmSyncLink | null }>({
  max: 5000,
  ttl: 60_000,
})

async function fetchSyncLink(where: ReturnType<typeof eq>): Promise<ItsmSyncLink | null> {
  const [row] = await db
    .select({
      organizationId: itsmOrganizationLink.organizationId,
      customerId: itsmOrganizationLink.customerId,
      simUserId: itsmOrganizationLink.simUserId,
      status: itsmOrganizationLink.status,
      webhookUrl: itsmOrganizationLink.webhookUrl,
      webhookSigningSecretEncrypted: itsmOrganizationLink.webhookSigningSecretEncrypted,
    })
    .from(itsmOrganizationLink)
    .where(where)
    .limit(1)

  if (!row) return null
  if (row.status !== 'active') return null
  if (!row.webhookUrl || !row.webhookSigningSecretEncrypted) return null

  return {
    organizationId: row.organizationId,
    customerId: row.customerId,
    simUserId: row.simUserId,
    webhookUrl: row.webhookUrl,
    webhookSigningSecret: await decryptItsmWebhookSecret(row.webhookSigningSecretEncrypted),
  }
}

/**
 * The ITSM customer id an organization is actively linked to, whether or not a
 * sync webhook is configured. Null for unlinked or disabled organizations.
 */
export async function findItsmCustomerIdByOrganizationId(
  organizationId: string
): Promise<string | null> {
  const [row] = await db
    .select({ customerId: itsmOrganizationLink.customerId, status: itsmOrganizationLink.status })
    .from(itsmOrganizationLink)
    .where(eq(itsmOrganizationLink.organizationId, organizationId))
    .limit(1)
  return row?.status === 'active' ? row.customerId : null
}

/**
 * A workspace's ITSM customer rarely changes, and every master-data dropdown
 * asks for it, so a minute of staleness is traded for one query per minute.
 */
const customerIdByWorkspaceCache = new LRUCache<string, { customerId: string | null }>({
  max: 5000,
  ttl: 60_000,
})

/** The ITSM customer id of the organization that owns a workspace, or null if unlinked. */
export async function findItsmCustomerIdByWorkspaceId(workspaceId: string): Promise<string | null> {
  const cached = customerIdByWorkspaceCache.get(workspaceId)
  if (cached !== undefined) return cached.customerId

  const [row] = await db
    .select({ customerId: itsmOrganizationLink.customerId, status: itsmOrganizationLink.status })
    .from(workspace)
    .innerJoin(
      itsmOrganizationLink,
      eq(itsmOrganizationLink.organizationId, workspace.organizationId)
    )
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  const customerId = row?.status === 'active' ? row.customerId : null
  customerIdByWorkspaceCache.set(workspaceId, { customerId })
  return customerId
}

/** The active, webhook-configured ITSM link for an organization, or null if none/disabled. */
export async function findItsmLinkByOrganizationId(
  organizationId: string
): Promise<ItsmSyncLink | null> {
  const cached = linkByOrganizationCache.get(organizationId)
  if (cached !== undefined) return cached.link

  const link = await fetchSyncLink(eq(itsmOrganizationLink.organizationId, organizationId))
  linkByOrganizationCache.set(organizationId, { link })
  return link
}
