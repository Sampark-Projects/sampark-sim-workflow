import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  ITSM_RULE_SCHEMA_VERSION,
  type ItsmRuleSavedEvent,
  type PublishItsmRuleResponse,
} from '@/lib/api/contracts/itsm-rules'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ItsmGatewayRequestError } from '@/lib/itsm/master-data/gateway.server'
import { itsmRuleOperations } from '@/lib/itsm/rules/application/operations'
import {
  collectItsmMasterDataNeeds,
  compileItsmRule,
  type ItsmRuleGraph,
} from '@/lib/itsm/rules/compile'
import { deliverItsmRuleSavedEvent } from '@/lib/itsm/rules/deliver'
import { loadItsmMasterDataLookup } from '@/lib/itsm/rules/master-data-lookup.server'
import { findItsmCustomerIdByOrganizationId } from '@/lib/itsm/sync/link'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('PublishItsmRule')

export interface PublishItsmRuleInput {
  workflowId: string
  assertedWorkspaceId?: string
}

function resolveContext({
  principal,
  input,
}: {
  principal: Principal
  input: PublishItsmRuleInput
}) {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
}

/**
 * Compiles the saved workflow into the ITSM rule JSON and hands it to ITSM.
 * Reads the persisted graph, so the caller waits for pending edits to save
 * first. A rule with errors is returned as `invalid` and never delivered.
 */
export const publishItsmRule = defineAuthorizedWorkflowUseCase({
  operation: itsmRuleOperations.publish,
  resolveContext,
  async execute({ principal, context }): Promise<PublishItsmRuleResponse> {
    const state = await loadWorkflowFromNormalizedTables(context.workflowId)
    if (!state) throw new OrchestrationError('not_found', 'Workflow not found')

    const graph: ItsmRuleGraph = {
      workflowId: context.workflowId,
      name: context.workflow.name,
      description: context.workflow.description ?? '',
      blocks: Object.fromEntries(
        Object.entries(state.blocks).map(([id, block]) => [
          id,
          {
            id,
            type: block.type,
            name: block.name,
            enabled: block.enabled !== false,
            subBlocks: block.subBlocks ?? {},
          },
        ])
      ),
      edges: state.edges.map((edge) => ({
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
      })),
    }

    const customerId = context.workspaceOrganizationId
      ? await findItsmCustomerIdByOrganizationId(context.workspaceOrganizationId)
      : null
    if (!customerId) {
      throw new OrchestrationError(
        'validation',
        'This workspace is not linked to an ITSM customer, so its rule cannot be saved to ITSM.'
      )
    }

    let lookup: Awaited<ReturnType<typeof loadItsmMasterDataLookup>>
    try {
      lookup = await loadItsmMasterDataLookup(customerId, collectItsmMasterDataNeeds(graph))
    } catch (error) {
      if (error instanceof ItsmGatewayRequestError) {
        logger.error('Could not load ITSM master data for rule publish', {
          workflowId: context.workflowId,
          error: error.message,
        })
        throw new OrchestrationError(
          'internal',
          'Could not reach ITSM to check the rule. Try again in a moment.'
        )
      }
      throw error
    }

    const { rule, errors, warnings } = compileItsmRule(graph, lookup)
    if (!rule) return { status: 'invalid', errors, warnings }

    const event: ItsmRuleSavedEvent = {
      event: 'itsm.rule.saved',
      schemaVersion: ITSM_RULE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      source: {
        customerId,
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        savedBySimUserId: principal.userId,
      },
      rule,
    }
    await deliverItsmRuleSavedEvent(event)
    return { status: 'published', event, warnings }
  },
})
