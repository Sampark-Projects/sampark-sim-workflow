import { createLogger } from '@sim/logger'
import type { ItsmRuleSavedEvent } from '@/lib/api/contracts/itsm-rules'

const logger = createLogger('ItsmRuleDelivery')

/**
 * Hands a saved rule to the ITSM backend. The ITSM rule webhook is not
 * available yet, so the event is logged in full; delivery replaces this body
 * once the endpoint and its authentication are known.
 */
export async function deliverItsmRuleSavedEvent(event: ItsmRuleSavedEvent): Promise<void> {
  logger.info('ITSM rule saved (webhook pending; payload logged)', {
    workflowId: event.source.workflowId,
    customerId: event.source.customerId,
    nodeCount: event.rule.nodes.length,
    payload: JSON.stringify(event),
  })
}
