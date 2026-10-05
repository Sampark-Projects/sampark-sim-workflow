import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import type { ItsmRuleSavedEvent } from '@/lib/api/contracts/itsm-rules'
import { resolveItsmGatewayUrl } from '@/lib/itsm/master-data/gateway.server'

const logger = createLogger('ItsmRuleDelivery')

/** ITSM's process engine endpoint that stores a workflow's rule. */
const RULE_DELIVERY_PATH = '/ticket-management/api/process-engine/workflows'
const DELIVERY_TIMEOUT_MS = 15_000

/**
 * ITSM's error envelope. A refusal carries `status: false`, a generic
 * `message`, and the actual reason in `error` (e.g. "source.customerId is
 * required") — sent with HTTP 500 even when the payload is at fault.
 */
const deliveryErrorSchema = z.object({
  status: z.literal(false),
  message: z.string().nullish(),
  error: z.string().nullish(),
})

/** ITSM could not be reached, or answered with a server error. */
export class ItsmRuleDeliveryUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ItsmRuleDeliveryUnavailableError'
  }
}

/** ITSM received the rule and refused it; `message` is ITSM's own reason. */
export class ItsmRuleRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ItsmRuleRejectedError'
  }
}

/**
 * Sends a saved rule to ITSM's process engine. The request body is the whole
 * saved-rule event (source, schema version, and the rule itself). Resolves
 * once ITSM accepts it; throws when ITSM is unreachable or refuses it.
 */
export async function deliverItsmRuleSavedEvent(event: ItsmRuleSavedEvent): Promise<void> {
  const url = `${resolveItsmGatewayUrl()}${RULE_DELIVERY_PATH}`
  const context = {
    workflowId: event.source.workflowId,
    customerId: event.source.customerId,
    nodeCount: event.rule.nodes.length,
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      redirect: 'error',
    })
  } catch (error) {
    logger.error('Could not reach ITSM to deliver the rule', {
      ...context,
      error: getErrorMessage(error),
    })
    throw new ItsmRuleDeliveryUnavailableError(getErrorMessage(error))
  }

  const text = await response.text().catch(() => '')
  let parsedBody: unknown = null
  try {
    parsedBody = text ? JSON.parse(text) : null
  } catch {
    parsedBody = null
  }
  const refusal = deliveryErrorSchema.safeParse(parsedBody)

  if (refusal.success) {
    const reason =
      refusal.data.error?.trim() ||
      refusal.data.message?.trim() ||
      `ITSM responded with HTTP ${response.status}`
    logger.warn('ITSM refused the rule', {
      ...context,
      httpStatus: response.status,
      body: text.slice(0, 500),
    })
    throw new ItsmRuleRejectedError(reason)
  }
  if (!response.ok) {
    logger.error('ITSM failed while storing the rule', {
      ...context,
      httpStatus: response.status,
      body: text.slice(0, 500),
    })
    throw new ItsmRuleDeliveryUnavailableError(`ITSM responded with HTTP ${response.status}`)
  }

  logger.info('Rule delivered to ITSM', { ...context, httpStatus: response.status })
}
