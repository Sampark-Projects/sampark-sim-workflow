import { db } from '@sim/db'
import { itsmOrganizationLink, itsmWorkflowSyncState, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deliverItsmSyncEvent } from '@/lib/itsm/sync/dispatch'
import { findItsmLinkByOrganizationId } from '@/lib/itsm/sync/link'
import { buildItsmSyncPayload } from '@/lib/itsm/sync/payload'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('CronItsmSync')

/**
 * A workflow must be untouched for this long before it's synced — collapses
 * a burst of edits (live canvas, API, Copilot) into one delivery. Matches the
 * outbox/cron cadence of ~1 minute, so a burst lands ~30-90s after the last
 * edit regardless of which write path produced it.
 */
const DEBOUNCE_MS = 30_000
const MAX_WORKFLOWS_PER_RUN = 200
const MAX_ERROR_LENGTH = 500

/**
 * Polls for ITSM-linked workflows whose content changed since the last sync,
 * debounced. Polling (rather than a write-path hook) is deliberate: live
 * canvas edits are persisted entirely inside `apps/realtime`, which cannot
 * call this app's webhook/outbox code, but every write path — realtime and
 * apps/sim alike — bumps `workflow.updatedAt`, so diffing against that column
 * covers all of them uniformly with no changes to `apps/realtime`.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'ITSM edit sync')
  if (authError) return authError

  const quietBefore = new Date(Date.now() - DEBOUNCE_MS)

  const candidates = await db
    .select({
      workflowId: workflow.id,
      workspaceId: workflow.workspaceId,
      organizationId: workspace.organizationId,
      updatedAt: workflow.updatedAt,
    })
    .from(workflow)
    .innerJoin(workspace, eq(workflow.workspaceId, workspace.id))
    .innerJoin(
      itsmOrganizationLink,
      and(
        eq(itsmOrganizationLink.organizationId, workspace.organizationId),
        eq(itsmOrganizationLink.status, 'active')
      )
    )
    .leftJoin(itsmWorkflowSyncState, eq(itsmWorkflowSyncState.workflowId, workflow.id))
    .where(
      and(
        lt(workflow.updatedAt, quietBefore),
        or(
          isNull(itsmWorkflowSyncState.lastSyncedUpdatedAt),
          lt(itsmWorkflowSyncState.lastSyncedUpdatedAt, workflow.updatedAt)
        )
      )
    )
    .limit(MAX_WORKFLOWS_PER_RUN)

  let delivered = 0
  let failed = 0

  for (const candidate of candidates) {
    if (!candidate.organizationId || !candidate.workspaceId) continue
    try {
      // Re-resolved per candidate (cached) rather than reused from the join,
      // since it also decrypts the signing secret and reflects a link
      // disabled/removed after the join matched.
      const link = await findItsmLinkByOrganizationId(candidate.organizationId)
      if (!link) continue

      const normalizedState = await loadWorkflowFromNormalizedTables(candidate.workflowId)
      await deliverItsmSyncEvent(
        link,
        buildItsmSyncPayload({
          event: 'workflow.updated',
          customerId: link.customerId,
          simUserId: link.simUserId,
          organizationId: link.organizationId,
          workspaceId: candidate.workspaceId,
          workflowId: candidate.workflowId,
          workflowJson: normalizedState,
        })
      )

      await db
        .insert(itsmWorkflowSyncState)
        .values({
          workflowId: candidate.workflowId,
          lastSyncedAt: new Date(),
          lastSyncedUpdatedAt: candidate.updatedAt,
          lastAttemptAt: new Date(),
          lastError: null,
        })
        .onConflictDoUpdate({
          target: itsmWorkflowSyncState.workflowId,
          set: {
            lastSyncedAt: new Date(),
            lastSyncedUpdatedAt: candidate.updatedAt,
            lastAttemptAt: new Date(),
            lastError: null,
          },
        })
      delivered++
    } catch (error) {
      failed++
      const errorMessage = toError(error).message.slice(0, MAX_ERROR_LENGTH)
      logger.warn('ITSM workflow sync delivery failed; will retry next tick', {
        workflowId: candidate.workflowId,
        error: errorMessage,
      })
      // Deliberately does not advance lastSyncedUpdatedAt — the next run's
      // debounce window will pick this workflow up again unchanged.
      await db
        .insert(itsmWorkflowSyncState)
        .values({
          workflowId: candidate.workflowId,
          lastAttemptAt: new Date(),
          lastError: errorMessage,
        })
        .onConflictDoUpdate({
          target: itsmWorkflowSyncState.workflowId,
          set: { lastAttemptAt: new Date(), lastError: errorMessage },
        })
        .catch(() => {})
    }
  }

  logger.info('ITSM edit sync run complete', { candidates: candidates.length, delivered, failed })
  return NextResponse.json({ success: true, candidates: candidates.length, delivered, failed })
})
