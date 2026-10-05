/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockSignOut } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSignOut: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mockGetSession, signOut: mockSignOut } },
  getSession: vi.fn(),
}))

import { POST } from '@/app/api/itsm/sign-out/route'

const CLEARED_COOKIES = [
  'better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
  'better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
]

function signOutRequest(): NextRequest {
  return new NextRequest('https://simqa.samparkme.com/api/itsm/sign-out', {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=abc',
      origin: 'https://itsmqa.samparkme.com',
    },
  })
}

function sessionWithUserAgent(userAgent: string | null) {
  return {
    user: { id: 'user-1' },
    session: { id: 'session-1', token: 'abc', userAgent },
  }
}

function signOutResponse(): Response {
  const headers = new Headers()
  for (const cookie of CLEARED_COOKIES) headers.append('set-cookie', cookie)
  return new Response(JSON.stringify({ success: true }), { status: 200, headers })
}

async function callSignOut() {
  return POST(signOutRequest(), { params: Promise.resolve({}) })
}

describe('POST /api/itsm/sign-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignOut.mockResolvedValue(signOutResponse())
  })

  it('ends an ITSM-embedded session and clears its cookies', async () => {
    mockGetSession.mockResolvedValue(sessionWithUserAgent('Sim ITSM Embed'))

    const response = await callSignOut()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ signedOut: true })
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(response.headers.getSetCookie()).toEqual(CLEARED_COOKIES)
  })

  it('reads the session from the database, not the cookie cache', async () => {
    mockGetSession.mockResolvedValue(sessionWithUserAgent('Sim ITSM Embed'))

    await callSignOut()

    expect(mockGetSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } })
    )
  })

  it('leaves a session signed in to Sim directly untouched', async () => {
    mockGetSession.mockResolvedValue(sessionWithUserAgent('Mozilla/5.0 (Windows NT 10.0)'))

    const response = await callSignOut()

    expect(await response.json()).toEqual({ signedOut: false })
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('does nothing when the browser has no Sim session', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callSignOut()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ signedOut: false })
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})
