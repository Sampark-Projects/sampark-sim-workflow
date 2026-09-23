import { AuditAction, AuditResourceType, recordAuditOnce } from '@sim/audit'
import { db } from '@sim/db'
import { itsmOrganizationLink } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { APIError } from 'better-auth/api'
import { eq, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import {
  createOrganizationWithOwnerTx,
  OrganizationSlugTakenError,
} from '@/lib/billing/organizations/create-organization'
import type { DbOrTx } from '@/lib/db/types'
import { encryptItsmWebhookSecret } from '@/lib/itsm/encryption'
import { deleteUserAccount } from '@/lib/users/account-deletion'

const logger = createLogger('ItsmProvisioning')

/** Bounds the advisory-lock wait so a stuck holder raises rather than hangs the request. */
const ITSM_PROVISION_LOCK_TIMEOUT_MS = 10_000

export interface ProvisionItsmOrganizationInput {
  customerId: string
  /** Supplied by ITSM — the same email the person registered with. */
  email: string
  /** ITSM sends the tenant's first name here; used as the Sim organization's display name. */
  organizationName: string
  webhookUrl?: string
  webhookSigningSecret?: string
}

export interface ProvisionItsmOrganizationResult {
  organizationId: string
  simUserId: string
  customerId: string
  /** False when this call found an existing link and returned it unchanged (idempotent replay). */
  created: boolean
}

export class ItsmEmailConflictError extends Error {
  constructor(email: string) {
    super(`Another Sim account already uses the email address "${email}"`)
    this.name = 'ItsmEmailConflictError'
  }
}

async function findLinkByCustomerId(
  customerId: string
): Promise<ProvisionItsmOrganizationResult | null> {
  const [existing] = await db
    .select({
      organizationId: itsmOrganizationLink.organizationId,
      simUserId: itsmOrganizationLink.simUserId,
      customerId: itsmOrganizationLink.customerId,
    })
    .from(itsmOrganizationLink)
    .where(eq(itsmOrganizationLink.customerId, customerId))
    .limit(1)
  if (!existing) return null

  return {
    organizationId: existing.organizationId,
    simUserId: existing.simUserId,
    customerId: existing.customerId,
    created: false,
  }
}

async function acquireItsmProvisioningLock(tx: DbOrTx, customerId: string): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${ITSM_PROVISION_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`itsm-provision:${customerId}`}, 0))`
  )
}

/**
 * Provisions (or idempotently returns) the Sim organization + headless owner
 * user for one ITSM tenant.
 *
 * The headless user is created via Better Auth's admin `createUser` API with
 * no `account`/password row — the same pattern SCIM provisioning uses — so it
 * can only ever sign in through the ITSM token-exchange handoff
 * (`@/lib/auth/itsm-handoff`), never with a password.
 */
export async function provisionItsmOrganization(
  input: ProvisionItsmOrganizationInput
): Promise<ProvisionItsmOrganizationResult> {
  const { customerId, email, organizationName, webhookUrl, webhookSigningSecret } = input

  const fastPath = await findLinkByCustomerId(customerId)
  if (fastPath) return fastPath

  let userId: string
  try {
    const created = await auth.api.createUser({
      body: { email, name: organizationName, data: { emailVerified: false } },
    })
    userId = created.user.id
  } catch (error) {
    // Better Auth's unique constraint on `user.email` is the arbiter for a
    // races-past-the-check duplicate; the caller must resolve it, not retry.
    if (error instanceof APIError && error.statusCode === 422) {
      throw new ItsmEmailConflictError(email)
    }
    throw error
  }

  let createdAccount = true
  try {
    const result = await db.transaction(async (tx) => {
      await acquireItsmProvisioningLock(tx, customerId)

      // Re-check under the lock: a concurrent call for the same customerId may
      // have already committed between the fast-path read above and this lock.
      const [existing] = await tx
        .select({
          organizationId: itsmOrganizationLink.organizationId,
          simUserId: itsmOrganizationLink.simUserId,
          customerId: itsmOrganizationLink.customerId,
        })
        .from(itsmOrganizationLink)
        .where(eq(itsmOrganizationLink.customerId, customerId))
        .limit(1)
      if (existing) {
        return { ...existing, created: false, alreadyExisted: true as const }
      }

      const slug = `itsm-${customerId}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      const { organizationId } = await createOrganizationWithOwnerTx(tx, {
        ownerUserId: userId,
        name: organizationName,
        slug,
        metadata: {},
      })

      const webhookSigningSecretEncrypted = webhookSigningSecret
        ? await encryptItsmWebhookSecret(webhookSigningSecret)
        : null

      await tx.insert(itsmOrganizationLink).values({
        id: generateId(),
        organizationId,
        customerId,
        simUserId: userId,
        webhookUrl: webhookUrl ?? null,
        webhookSigningSecretEncrypted,
      })

      return {
        organizationId,
        simUserId: userId,
        customerId,
        created: true,
        alreadyExisted: false as const,
      }
    })

    if (result.alreadyExisted) {
      // Another concurrent call already won — the user created above is an
      // orphan (no organization, no link row). The winner's row is the one to
      // return, including its own (possibly self-healed) API key.
      createdAccount = false
      await deleteUserAccount(userId).catch((cleanupError) =>
        logger.error('Failed to remove an orphaned ITSM-provisioned account', {
          userId,
          cleanupError,
        })
      )
      const winner = await findLinkByCustomerId(customerId)
      if (!winner) throw new Error('Concurrent ITSM provisioning row disappeared after commit')
      return winner
    }

    // The transaction committed: organization, membership, and link row all
    // exist now. A failure past this point (audit) must not trigger the
    // orphan-account cleanup below — the account legitimately owns a real
    // organization.
    createdAccount = false

    await recordAuditOnce(`itsm-provision:${customerId}`, {
      actorId: null,
      actorName: 'ITSM Integration',
      action: AuditAction.ITSM_ORGANIZATION_PROVISIONED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: result.organizationId,
      description: `Provisioned Sim organization for ITSM customer ${customerId}`,
      metadata: { customerId, simUserId: userId },
    })

    return {
      organizationId: result.organizationId,
      simUserId: result.simUserId,
      customerId,
      created: result.created,
    }
  } catch (error) {
    // Any failure after the account was created and before the transaction
    // committed would otherwise leave an orphan with no organization — a
    // retry from ITSM must start from a clean slate, not collide with a
    // half-provisioned account.
    if (createdAccount) {
      await deleteUserAccount(userId).catch((cleanupError) =>
        logger.error('Failed to remove an account after ITSM provisioning was refused', {
          userId,
          cleanupError,
        })
      )
    }
    if (error instanceof OrganizationSlugTakenError) {
      // customerId-derived slugs are expected to be unique; a collision here
      // means the same customerId is being (re-)provisioned concurrently in a
      // way the lock above did not catch, or a slug was reused out of band.
      logger.error('ITSM organization slug collision', { customerId, error })
    }
    throw error
  }
}
