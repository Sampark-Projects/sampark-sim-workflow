import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type PublishItsmRuleResponse,
  publishItsmRuleContract,
} from '@/lib/api/contracts/itsm-rules'

export const itsmRuleKeys = {
  all: ['itsm-rules'] as const,
  publishes: () => [...itsmRuleKeys.all, 'publish'] as const,
}

interface PublishItsmRuleVariables {
  workflowId: string
}

/** Compiles the saved workflow into the ITSM rule JSON and hands it to ITSM. */
export function usePublishItsmRule() {
  return useMutation({
    mutationKey: itsmRuleKeys.publishes(),
    mutationFn: ({ workflowId }: PublishItsmRuleVariables): Promise<PublishItsmRuleResponse> =>
      requestJson(publishItsmRuleContract, { params: { id: workflowId } }),
  })
}
