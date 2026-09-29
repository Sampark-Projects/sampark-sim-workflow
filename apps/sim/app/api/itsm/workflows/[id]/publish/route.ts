import { publishItsmRuleContract } from '@/lib/api/contracts/itsm-rules'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { itsmRuleOperations } from '@/lib/itsm/rules/application/operations'
import { publishItsmRule } from '@/lib/itsm/rules/application/publish-rule'
import { createInternalWorkflowErrorPolicy } from '@/lib/workflows/api'

export const POST = defineInternalJsonRoute({
  contract: publishItsmRuleContract,
  auth: internalSessionAuth,
  operation: itsmRuleOperations.publish,
  rateLimit: internalRateLimits.none({
    reason: 'Saving an ITSM rule is an explicit editor action by an authenticated member.',
  }),
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to save the ITSM rule'),
  mapInput: ({ params }) => ({ workflowId: params.id }),
  useCase: publishItsmRule,
  present: (result) => result,
})
