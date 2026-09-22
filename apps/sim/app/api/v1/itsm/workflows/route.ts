import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { itsmListWorkflowsContract } from '@/lib/api/contracts/v1/itsm'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withItsmAuth } from '@/lib/itsm/middleware'
import {
  itsmBadRequestResponse,
  itsmInternalErrorResponse,
  itsmInvalidJsonResponse,
  itsmValidationErrorResponse,
  singleResponse,
} from '@/lib/itsm/responses'
import { ItsmLinkDisabledError, ItsmLinkNotFoundError } from '@/lib/itsm/token-exchange'
import { listItsmWorkflows } from '@/lib/itsm/workflows'

const logger = createLogger('ItsmWorkflowsAPI')

/** Lists a tenant's Sim workflows across all their workspaces — for ITSM's process-mapping picker. */
export const GET = withRouteHandler(
  withItsmAuth(async (request) => {
    const parsed = await parseRequest(
      itsmListWorkflowsContract,
      request,
      {},
      {
        validationErrorResponse: itsmValidationErrorResponse,
        invalidJsonResponse: itsmInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response

    try {
      const workflows = await listItsmWorkflows(parsed.data.query.customerId)
      return singleResponse({ workflows })
    } catch (error) {
      if (error instanceof ItsmLinkNotFoundError || error instanceof ItsmLinkDisabledError) {
        return itsmBadRequestResponse(error.message)
      }
      logger.error('Failed to list ITSM workflows', { error })
      return itsmInternalErrorResponse(getErrorMessage(error, 'Failed to list workflows'))
    }
  })
)
