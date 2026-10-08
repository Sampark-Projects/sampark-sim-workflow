/**
 * @vitest-environment node
 */
import { createEnvMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItsmRuleSavedEvent } from '@/lib/api/contracts/itsm-rules'

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({ NEXT_PUBLIC_APP_URL: 'https://simqa.samparkme.com' })
)

import {
  deliverItsmRuleSavedEvent,
  ItsmRuleDeliveryUnavailableError,
  ItsmRuleRejectedError,
} from '@/lib/itsm/rules/deliver'

const event: ItsmRuleSavedEvent = {
  event: 'itsm.rule.saved',
  schemaVersion: '1.0',
  savedAt: '2026-09-30T00:00:00.000Z',
  source: {
    customerId: 'OR00026',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    savedBySimUserId: 'user-1',
  },
  workflow: {
    workflowId: 'workflow-1',
    workflowName: 'Rule',
    description: '',
    processes: [],
  },
}

const fetchMock = vi.fn()

function respond(status: number, body: string) {
  fetchMock.mockResolvedValueOnce(new Response(body, { status }))
}

describe('deliverItsmRuleSavedEvent', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the whole event to the process engine of the QA gateway', async () => {
    respond(200, JSON.stringify({ id: 'stored-1' }))
    await deliverItsmRuleSavedEvent(event)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://itsmqa.samparkme.com/gateway/ticket-management/api/process-engine/workflows'
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(event)
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('reports ITSM’s reason when it refuses the rule, even with HTTP 500', async () => {
    respond(
      500,
      JSON.stringify({
        statusCode: '500',
        status: false,
        message: 'An unexpected error occurred',
        error: 'Workflow must have a startNodeId and at least one node',
      })
    )
    const failure = deliverItsmRuleSavedEvent(event)
    await expect(failure).rejects.toBeInstanceOf(ItsmRuleRejectedError)
    await expect(failure).rejects.toThrow('Workflow must have a startNodeId and at least one node')
  })

  it('treats a server error without ITSM’s envelope as ITSM being unavailable', async () => {
    respond(502, '<html>Bad Gateway</html>')
    await expect(deliverItsmRuleSavedEvent(event)).rejects.toBeInstanceOf(
      ItsmRuleDeliveryUnavailableError
    )
  })

  it('treats a network failure as ITSM being unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(deliverItsmRuleSavedEvent(event)).rejects.toBeInstanceOf(
      ItsmRuleDeliveryUnavailableError
    )
  })
})
