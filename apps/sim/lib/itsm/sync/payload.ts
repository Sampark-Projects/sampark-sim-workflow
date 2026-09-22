export type ItsmSyncEvent = 'workspace.created' | 'workflow.created' | 'workflow.updated'

export interface ItsmSyncPayload {
  event: ItsmSyncEvent
  customerId: string
  simUserId: string
  organizationId: string
  workspaceId: string
  workflowId: string | null
  workflowJson: unknown | null
  occurredAt: string
}

export function buildItsmSyncPayload(input: {
  event: ItsmSyncEvent
  customerId: string
  simUserId: string
  organizationId: string
  workspaceId: string
  workflowId?: string | null
  workflowJson?: unknown | null
}): ItsmSyncPayload {
  return {
    event: input.event,
    customerId: input.customerId,
    simUserId: input.simUserId,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    workflowId: input.workflowId ?? null,
    workflowJson: input.workflowJson ?? null,
    occurredAt: new Date().toISOString(),
  }
}
