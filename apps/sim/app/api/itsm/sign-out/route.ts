import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { itsmSignOutContract } from '@/lib/api/contracts/itsm-session'
import { parseRequest } from '@/lib/api/server'
import { auth } from '@/lib/auth'
import { ITSM_SESSION_USER_AGENT } from '@/lib/auth/itsm-handoff'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ItsmSignOutAPI')

/**
 * Ends the ITSM-embedded Sim session in this browser. ITSM calls it when its user
 * logs out, so the next person to sign in to ITSM on the same browser never
 * inherits the previous customer's Sim session.
 *
 * Only a session minted by the ITSM handoff (`@/lib/auth/itsm-handoff`) is ended;
 * someone signed in to Sim directly keeps their session.
 *
 * ITSM calls this cross-origin as a credentialed `no-cors` POST. Sim and ITSM
 * share a registrable domain, so the browser sends the `SameSite=Lax` session
 * cookie and applies the cleared cookies from the opaque response.
 *
 * Raw `withRouteHandler` (not a JSON route builder): a session-lifecycle route,
 * the same documented exception class as the `/api/itsm/redeem` handoff.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const parsed = await parseRequest(itsmSignOutContract, request, {})
  if (!parsed.success) return parsed.response

  // Database-backed read: the cookie cache can outlive a session row that was
  // already revoked, and only a live ITSM session needs ending.
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  })
  if (session?.session.userAgent !== ITSM_SESSION_USER_AGENT) {
    return NextResponse.json({ signedOut: false })
  }

  const signOutResponse = await auth.api.signOut({
    headers: request.headers,
    asResponse: true,
  })
  const response = NextResponse.json({ signedOut: signOutResponse.ok })
  for (const cookie of signOutResponse.headers.getSetCookie()) {
    response.headers.append('set-cookie', cookie)
  }

  logger.info('Ended ITSM-embedded Sim session', {
    userId: session.user.id,
    sessionId: session.session.id,
    signedOut: signOutResponse.ok,
  })
  return response
})
