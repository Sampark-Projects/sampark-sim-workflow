/**
 * ITSM Integration API Authentication
 *
 * Authenticates requests from the ITSM `user-management` backend using the
 * dedicated `ITSM_API_KEY` shared secret. Deliberately separate from
 * `ADMIN_API_KEY` (`@/app/api/v1/admin/auth`) — a leaked ITSM key must not
 * also grant self-hosted dashboard admin access, and vice versa.
 *
 * Usage:
 *   curl -H "x-itsm-key: your_itsm_key" https://your-instance/api/v1/itsm/...
 */

import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'

const logger = createLogger('ItsmAuth')

interface ItsmAuthSuccess {
  authenticated: true
}

interface ItsmAuthFailure {
  authenticated: false
  error: string
  notConfigured?: boolean
}

export type ItsmAuthResult = ItsmAuthSuccess | ItsmAuthFailure

/**
 * Authenticate a request from the ITSM backend.
 *
 * @param request - The incoming Next.js request
 * @returns Authentication result with success status and optional error
 */
export function authenticateItsmRequest(request: NextRequest): ItsmAuthResult {
  const itsmKey = env.ITSM_API_KEY

  if (!itsmKey) {
    logger.warn('ITSM_API_KEY environment variable is not set')
    return {
      authenticated: false,
      error: 'ITSM integration API is not configured. Set ITSM_API_KEY environment variable.',
      notConfigured: true,
    }
  }

  const providedKey = request.headers.get('x-itsm-key')

  if (!providedKey) {
    return {
      authenticated: false,
      error: 'ITSM API key required. Provide x-itsm-key header.',
    }
  }

  if (!safeCompare(providedKey, itsmKey)) {
    logger.warn('Invalid ITSM API key attempted', { keyPrefix: providedKey.slice(0, 8) })
    return {
      authenticated: false,
      error: 'Invalid ITSM API key',
    }
  }

  return { authenticated: true }
}
