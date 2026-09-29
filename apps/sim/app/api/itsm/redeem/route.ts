import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ItsmRedeemAPI')

/**
 * Only a same-origin path into the workspace app is a legitimate redeem target.
 * Bare `/workspace` (Sim's workspace picker — `WORKSPACES_PATH` in
 * `@/lib/navigation/paths`) is allowed alongside a specific
 * `/workspace/{id}/w/{id}` deep link: an ITSM tenant is not guaranteed to have
 * a known workspace/workflow yet, and landing on the picker lets Sim's own
 * "no workspaces yet" bootstrap (`GET /api/workspaces`) create their first one.
 */
function isSafeWorkspaceRedirect(value: string): boolean {
  if (value !== '/workspace' && !value.startsWith('/workspace/')) return false
  // Reject protocol-relative ("//host/...") and backslash tricks a browser can
  // still resolve as an absolute/external URL.
  if (value.startsWith('//') || value.includes('\\')) return false
  try {
    // A relative path parses against any base; anything that resolves to a
    // different origin than the base is not actually relative.
    const resolved = new URL(value, 'https://redeem.invalid')
    return resolved.origin === 'https://redeem.invalid'
  } catch {
    return false
  }
}

/**
 * Redeems a short-lived ITSM handoff token (minted by
 * `POST /api/v1/itsm/auth/login-token`) for a real Sim session, then redirects
 * into the workspace. Exists as a plain GET wrapper around Better Auth's
 * `/one-time-token/verify` endpoint so a top-level iframe navigation — which
 * cannot easily POST a JSON body — can complete the handoff in one request.
 *
 * Raw `withRouteHandler` (not a JSON route builder): this is a redirect-mode
 * auth handoff, the same documented exception class as the OAuth callback
 * routes.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const token = request.nextUrl.searchParams.get('token')
  const redirectParam = request.nextUrl.searchParams.get('redirect')

  if (!token || !redirectParam || !isSafeWorkspaceRedirect(redirectParam)) {
    return NextResponse.json(
      { error: 'Invalid or missing token/redirect parameter' },
      { status: 400 }
    )
  }

  const verifyResponse = await auth.api.verifyOneTimeToken({
    body: { token },
    headers: request.headers,
    asResponse: true,
  })

  if (!verifyResponse.ok) {
    logger.warn('ITSM handoff token redemption failed', { status: verifyResponse.status })
    return NextResponse.json(
      { error: 'This login link is invalid or has expired' },
      { status: 400 }
    )
  }

  // Built from the app's own configured public origin, not `request.nextUrl.origin` —
  // behind a reverse proxy that doesn't forward the original Host header, the request's
  // own origin resolves to the container's bind address (e.g. http://0.0.0.0:3000)
  // instead of the public domain, sending the browser to an unreachable URL.
  const redirectUrl = new URL(redirectParam, env.NEXT_PUBLIC_APP_URL)
  const response = NextResponse.redirect(redirectUrl, 303)
  const verifyHeaders = verifyResponse.headers as Headers & { getSetCookie?: () => string[] }
  for (const cookie of verifyHeaders.getSetCookie?.() ?? []) {
    response.headers.append('set-cookie', cookie)
  }
  return response
})
