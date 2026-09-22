import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { auth } from '@/lib/auth'

const logger = createLogger('ItsmHandoff')

/**
 * Identifier namespace Better Auth's one-time-token plugin reads in
 * `/one-time-token/verify`. See `@/lib/auth/desktop-handoff` — this module
 * copies that mechanism, swapping its caller gate (a live Sim session for the
 * same user) for a trusted ITSM service credential resolved to a `simUserId`.
 */
const ONE_TIME_TOKEN_IDENTIFIER_PREFIX = 'one-time-token:'

/** Matches the token length Better Auth generates for its own one-time tokens. */
const HANDOFF_TOKEN_LENGTH = 32

/**
 * The ITSM iframe navigates to the redeem route within seconds of the mint
 * call, so a redeem lands almost immediately. Kept short since this token is
 * a bearer credential that grants a session — matches the desktop-handoff TTL.
 */
const ITSM_HANDOFF_TOKEN_TTL_MS = 3 * 60 * 1000

/**
 * Recorded as the session's user agent so an ITSM-embedded session is
 * distinguishable from an ordinary browser session in listings/audit trails.
 */
const ITSM_SESSION_USER_AGENT = 'Sim ITSM Embed'

/**
 * Mints a one-time token that signs the embedded iframe in as `userId` on a
 * session of its own — see `createDesktopHandoffToken` for the full rationale
 * (a session per embedding surface, not shared with any other session the
 * user holds).
 */
export async function createItsmLoginToken(userId: string): Promise<string> {
  const ctx = await auth.$context
  const itsmSession = await ctx.internalAdapter.createSession(userId, false, {
    userAgent: ITSM_SESSION_USER_AGENT,
  })

  const token = generateShortId(HANDOFF_TOKEN_LENGTH)
  await ctx.internalAdapter.createVerificationValue({
    value: itsmSession.token,
    identifier: `${ONE_TIME_TOKEN_IDENTIFIER_PREFIX}${token}`,
    expiresAt: new Date(Date.now() + ITSM_HANDOFF_TOKEN_TTL_MS),
  })

  logger.info('Minted ITSM handoff token', { userId, sessionId: itsmSession.id })
  return token
}

export { ITSM_HANDOFF_TOKEN_TTL_MS }
