import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  enqueueOutboxEvent,
  type OutboxHandler,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'
import { deliverItsmSyncEvent } from '@/lib/itsm/sync/dispatch'
import { findItsmLinkByOrganizationId } from '@/lib/itsm/sync/link'
import { buildItsmSyncPayload } from '@/lib/itsm/sync/payload'

const logger = createLogger('ItsmSyncOutbox')

export const ITSM_OUTBOX_EVENT_TYPES = {
  WORKSPACE_CREATED: 'itsm.workspace-created',
  WORKFLOW_CREATED: 'itsm.workflow-created',
} as const

interface WorkspaceCreatedPayload {
  organizationId: string
  workspaceId: string
}

interface WorkflowCreatedPayload {
  organizationId: string
  workspaceId: string
  workflowId: string
}

/**
 * Enqueues the ITSM workspace-created sync event, best-effort. No-ops (no row
 * written) when the workspace's organization has no active ITSM link — the
 * common case for the vast majority of Sim workspaces.
 */
export async function enqueueItsmWorkspaceCreatedSync(params: {
  organizationId: string | null
  workspaceId: string
}): Promise<void> {
  if (!params.organizationId) return
  try {
    const link = await findItsmLinkByOrganizationId(params.organizationId)
    if (!link) return
    await enqueueOutboxEvent(db, ITSM_OUTBOX_EVENT_TYPES.WORKSPACE_CREATED, {
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
    } satisfies WorkspaceCreatedPayload)
  } catch (error) {
    logger.warn('Failed to enqueue ITSM workspace-created sync', { error: toError(error).message })
  }
}

/** Enqueues the ITSM workflow-created sync event, best-effort. Same no-op gate as above. */
export async function enqueueItsmWorkflowCreatedSync(params: {
  organizationId: string | null
  workspaceId: string
  workflowId: string
}): Promise<void> {
  if (!params.organizationId) return
  try {
    const link = await findItsmLinkByOrganizationId(params.organizationId)
    if (!link) return
    await enqueueOutboxEvent(db, ITSM_OUTBOX_EVENT_TYPES.WORKFLOW_CREATED, {
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      workflowId: params.workflowId,
    } satisfies WorkflowCreatedPayload)
  } catch (error) {
    logger.warn('Failed to enqueue ITSM workflow-created sync', { error: toError(error).message })
  }
}

const handleWorkspaceCreated: OutboxHandler<WorkspaceCreatedPayload> = async (payload) => {
  const link = await findItsmLinkByOrganizationId(payload.organizationId)
  if (!link) return // Link was removed/disabled since enqueue — nothing to deliver.
  await deliverItsmSyncEvent(
    link,
    buildItsmSyncPayload({
      event: 'workspace.created',
      customerId: link.customerId,
      simUserId: link.simUserId,
      organizationId: link.organizationId,
      workspaceId: payload.workspaceId,
    })
  )
}

const handleWorkflowCreated: OutboxHandler<WorkflowCreatedPayload> = async (payload) => {
  const link = await findItsmLinkByOrganizationId(payload.organizationId)
  if (!link) return
  await deliverItsmSyncEvent(
    link,
    buildItsmSyncPayload({
      event: 'workflow.created',
      customerId: link.customerId,
      simUserId: link.simUserId,
      organizationId: link.organizationId,
      workspaceId: payload.workspaceId,
      workflowId: payload.workflowId,
    })
  )
}

export const itsmSyncOutboxHandlers: OutboxHandlerRegistry = {
  [ITSM_OUTBOX_EVENT_TYPES.WORKSPACE_CREATED]: handleWorkspaceCreated as OutboxHandler<unknown>,
  [ITSM_OUTBOX_EVENT_TYPES.WORKFLOW_CREATED]: handleWorkflowCreated as OutboxHandler<unknown>,
}
