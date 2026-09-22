import type { NextRequest, NextResponse } from 'next/server'
import { authenticateItsmRequest } from '@/lib/itsm/auth'
import { itsmNotConfiguredResponse, itsmUnauthorizedResponse } from '@/lib/itsm/responses'

export type ItsmRouteHandler = (request: NextRequest) => Promise<NextResponse>

/**
 * Wrap a route handler with ITSM integration authentication.
 * Returns early with an error response if authentication fails.
 */
export function withItsmAuth(handler: ItsmRouteHandler): ItsmRouteHandler {
  return async (request: NextRequest) => {
    const auth = authenticateItsmRequest(request)

    if (!auth.authenticated) {
      if (auth.notConfigured) {
        return itsmNotConfiguredResponse()
      }
      return itsmUnauthorizedResponse(auth.error)
    }

    return handler(request)
  }
}
