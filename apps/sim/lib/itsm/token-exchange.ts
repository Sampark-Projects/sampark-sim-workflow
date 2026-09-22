import { db } from '@sim/db'
import { itsmOrganizationLink } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createItsmLoginToken, ITSM_HANDOFF_TOKEN_TTL_MS } from '@/lib/auth/itsm-handoff'

export class ItsmLinkNotFoundError extends Error {
  constructor(customerId: string) {
    super(`No Sim organization is provisioned for ITSM customer "${customerId}"`)
    this.name = 'ItsmLinkNotFoundError'
  }
}

export class ItsmLinkDisabledError extends Error {
  constructor(customerId: string) {
    super(`The Sim organization for ITSM customer "${customerId}" is disabled`)
    this.name = 'ItsmLinkDisabledError'
  }
}

export interface MintItsmLoginTokenResult {
  token: string
  expiresAt: string
}

/**
 * Mints a short-lived, single-use login token for the Sim user linked to an
 * ITSM `customerId`. The target user is resolved server-side from the
 * provisioning link — a caller can never request a token for an arbitrary
 * `simUserId` directly.
 */
export async function mintItsmLoginToken(input: {
  customerId: string
}): Promise<MintItsmLoginTokenResult> {
  const [link] = await db
    .select({ simUserId: itsmOrganizationLink.simUserId, status: itsmOrganizationLink.status })
    .from(itsmOrganizationLink)
    .where(eq(itsmOrganizationLink.customerId, input.customerId))
    .limit(1)

  if (!link) throw new ItsmLinkNotFoundError(input.customerId)
  if (link.status !== 'active') throw new ItsmLinkDisabledError(input.customerId)

  const token = await createItsmLoginToken(link.simUserId)
  return {
    token,
    expiresAt: new Date(Date.now() + ITSM_HANDOFF_TOKEN_TTL_MS).toISOString(),
  }
}
