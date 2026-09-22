import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { itsmMintLoginTokenContract } from '@/lib/api/contracts/v1/itsm'
import { parseRequest } from '@/lib/api/server'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withItsmAuth } from '@/lib/itsm/middleware'
import {
  itsmBadRequestResponse,
  itsmInternalErrorResponse,
  itsmInvalidJsonResponse,
  itsmValidationErrorResponse,
  singleResponse,
} from '@/lib/itsm/responses'
import {
  ItsmLinkDisabledError,
  ItsmLinkNotFoundError,
  mintItsmLoginToken,
} from '@/lib/itsm/token-exchange'

const logger = createLogger('ItsmLoginTokenAPI')

/**
 * Mints a short-lived, single-use login token for the Sim user linked to an
 * ITSM `customerId`. Called from ITSM's backend only — the returned token is
 * redeemed by the browser at `/api/itsm/redeem`, never by this endpoint's caller.
 */
export const POST = withRouteHandler(
  withItsmAuth(async (request) => {
    // Every mint creates a session row; ITSM calls this once per iframe load,
    // so a generous but still bounded allowance guards against a runaway caller.
    const rateLimited = await enforceIpRateLimit('itsm-auth-login-token', request, {
      maxTokens: 120,
      refillRate: 120,
      refillIntervalMs: 60_000,
    })
    if (rateLimited) return rateLimited

    const parsed = await parseRequest(
      itsmMintLoginTokenContract,
      request,
      {},
      {
        validationErrorResponse: itsmValidationErrorResponse,
        invalidJsonResponse: itsmInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response

    try {
      const result = await mintItsmLoginToken(parsed.data.body)
      return singleResponse(result)
    } catch (error) {
      if (error instanceof ItsmLinkNotFoundError) {
        return itsmBadRequestResponse(error.message)
      }
      if (error instanceof ItsmLinkDisabledError) {
        return itsmBadRequestResponse(error.message)
      }
      logger.error('Failed to mint ITSM login token', { error })
      return itsmInternalErrorResponse(getErrorMessage(error, 'Failed to mint login token'))
    }
  })
)
