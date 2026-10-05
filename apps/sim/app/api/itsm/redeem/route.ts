import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
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

  // A relative `Location` (valid per RFC 9110) is resolved by the browser against the origin it
  // actually requested — the public domain, or the embedding app's dev proxy. Absolute URLs built
  // from `request.nextUrl.origin` or `NEXT_PUBLIC_APP_URL` both break here: behind a reverse proxy
  // the former is the container bind address (https://0.0.0.0:3000) and the latter is only as
  // correct as the deployment's build/runtime config.
  const response = new NextResponse(null, { status: 303, headers: { location: redirectParam } })
  const verifyHeaders = verifyResponse.headers as Headers & { getSetCookie?: () => string[] }
  for (const cookie of verifyHeaders.getSetCookie?.() ?? []) {
    response.headers.append('set-cookie', cookie)
  }
  return response
})
