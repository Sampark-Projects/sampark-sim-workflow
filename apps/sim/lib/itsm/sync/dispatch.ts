import { createHmac } from 'node:crypto'
import { createLogger } from '@sim/logger'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { ItsmSyncLink } from '@/lib/itsm/sync/link'
import type { ItsmSyncPayload } from '@/lib/itsm/sync/payload'

const logger = createLogger('ItsmSyncDispatch')

const SIGNATURE_VERSION = 'v1'
const USER_AGENT = 'Sim-ITSM-Sync/1.0'
const REQUEST_TIMEOUT_MS = 30_000
/** Cap responder reply so a misbehaving receiver can't OOM the caller. */
const MAX_RESPONSE_BYTES = 256 * 1024

/**
 * Stripe-style signature: HMAC-SHA256 over `${unixSeconds}.${body}` rendered
 * as `t=<unixSeconds>,v1=<hex>`. Mirrors `@/lib/data-drains/destinations/webhook`.
 */
function sign(body: Buffer, secret: string, timestamp: number): string {
  const hmac = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')
  return `t=${timestamp},${SIGNATURE_VERSION}=${hmac}`
}

class ItsmSyncDeliveryError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ItsmSyncDeliveryError'
  }
}

/**
 * Delivers one ITSM sync event, single attempt. Retries are the caller's
 * responsibility — the outbox worker for creation events, the poll cron's
 * next tick for edit sync — so this never loops internally.
 */
export async function deliverItsmSyncEvent(
  link: ItsmSyncLink,
  payload: ItsmSyncPayload
): Promise<void> {
  const resolved = await validateUrlWithDNS(link.webhookUrl, 'webhookUrl', 'configuredEndpoint')
  if (!resolved.isValid) {
    throw new ItsmSyncDeliveryError(resolved.error ?? 'Invalid ITSM webhook URL')
  }

  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const timestamp = Math.floor(Date.now() / 1000)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
    'X-Sim-Timestamp': timestamp.toString(),
    'X-Sim-Signature-Version': SIGNATURE_VERSION,
    'X-Sim-Signature': sign(body, link.webhookSigningSecret, timestamp),
  }

  const response = await secureFetchWithPinnedIP(link.webhookUrl, resolved.resolvedIP, {
    profile: 'configuredEndpoint',
    method: 'POST',
    body: new Uint8Array(body),
    headers,
    timeout: REQUEST_TIMEOUT_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
  })

  if (!response.ok) {
    throw new ItsmSyncDeliveryError(
      `ITSM webhook responded with HTTP ${response.status}`,
      response.status
    )
  }

  logger.debug('ITSM sync event delivered', {
    event: payload.event,
    workflowId: payload.workflowId,
  })
}
