/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyOneTimeToken } = vi.hoisted(() => ({
  mockVerifyOneTimeToken: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { verifyOneTimeToken: mockVerifyOneTimeToken } },
  getSession: vi.fn(),
}))

import { GET } from '@/app/api/itsm/redeem/route'

const WORKFLOW_PATH =
  '/workspace/c3f19b81-70b2-44d4-bbc7-a12e5440615f/w/83b356f7-d206-4663-86b2-e57fca612283'

/** The origin Next sees behind a reverse proxy that does not forward the public Host header. */
const CONTAINER_BIND_ORIGIN = 'https://0.0.0.0:3000'

function redeemRequest(params: Record<string, string>): NextRequest {
  const url = new URL('/api/itsm/redeem', CONTAINER_BIND_ORIGIN)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

function verifyResponse(status: number, cookies: string[] = []): Response {
  const headers = new Headers()
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status, headers })
}

describe('GET /api/itsm/redeem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects with a relative Location so the browser keeps its own origin', async () => {
    mockVerifyOneTimeToken.mockResolvedValue(verifyResponse(200, ['session=abc; Path=/; HttpOnly']))

    const response = await GET(redeemRequest({ token: 'good', redirect: WORKFLOW_PATH }), {
      params: Promise.resolve({}),
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(WORKFLOW_PATH)
    expect(response.headers.get('location')).not.toContain('0.0.0.0')
  })

  it('forwards the session cookie minted by the one-time-token verification', async () => {
    mockVerifyOneTimeToken.mockResolvedValue(verifyResponse(200, ['session=abc; Path=/; HttpOnly']))

    const response = await GET(redeemRequest({ token: 'good', redirect: '/workspace' }), {
      params: Promise.resolve({}),
    })

    expect(response.headers.get('location')).toBe('/workspace')
    expect(response.headers.getSetCookie()).toEqual(['session=abc; Path=/; HttpOnly'])
  })

  it('rejects an expired or already-used token without redirecting', async () => {
    mockVerifyOneTimeToken.mockResolvedValue(verifyResponse(400))

    const response = await GET(redeemRequest({ token: 'used', redirect: WORKFLOW_PATH }), {
      params: Promise.resolve({}),
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })

  it.each([
    ['an absolute external URL', 'https://evil.example/workspace'],
    ['a protocol-relative URL', '//evil.example/workspace/x'],
    ['a backslash trick', '/workspace/\\evil.example'],
    ['a path outside the workspace app', '/api/auth/sign-out'],
  ])('rejects %s as a redirect target', async (_label, redirect) => {
    const response = await GET(redeemRequest({ token: 'good', redirect }), {
      params: Promise.resolve({}),
    })

    expect(response.status).toBe(400)
    expect(mockVerifyOneTimeToken).not.toHaveBeenCalled()
  })

  it('rejects a request missing the token', async () => {
    const response = await GET(redeemRequest({ redirect: '/workspace' }), {
      params: Promise.resolve({}),
    })

    expect(response.status).toBe(400)
    expect(mockVerifyOneTimeToken).not.toHaveBeenCalled()
  })
})
