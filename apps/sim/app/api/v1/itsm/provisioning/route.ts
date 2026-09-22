import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { itsmProvisionOrganizationContract } from '@/lib/api/contracts/v1/itsm'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withItsmAuth } from '@/lib/itsm/middleware'
import { ItsmEmailConflictError, provisionItsmOrganization } from '@/lib/itsm/provisioning'
import {
  itsmConflictResponse,
  itsmInternalErrorResponse,
  itsmInvalidJsonResponse,
  itsmValidationErrorResponse,
  singleResponse,
} from '@/lib/itsm/responses'

const logger = createLogger('ItsmProvisioningAPI')

/**
 * Provisions a Sim organization + headless owner user for an ITSM tenant.
 * Idempotent on `customerId` — a repeat call returns the existing link
 * unchanged rather than erroring.
 */
export const POST = withRouteHandler(
  withItsmAuth(async (request) => {
    const parsed = await parseRequest(
      itsmProvisionOrganizationContract,
      request,
      {},
      {
        validationErrorResponse: itsmValidationErrorResponse,
        invalidJsonResponse: itsmInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response

    try {
      const result = await provisionItsmOrganization(parsed.data.body)
      return singleResponse(result)
    } catch (error) {
      if (error instanceof ItsmEmailConflictError) {
        return itsmConflictResponse(error.message)
      }
      logger.error('Failed to provision ITSM organization', { error })
      return itsmInternalErrorResponse(getErrorMessage(error, 'Failed to provision organization'))
    }
  })
)
