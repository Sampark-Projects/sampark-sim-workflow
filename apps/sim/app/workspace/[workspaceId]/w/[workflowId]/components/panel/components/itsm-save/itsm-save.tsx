'use client'

import { useState } from 'react'
import { Chip, Popover, PopoverAnchor, PopoverContent, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { ItsmRuleIssue } from '@/lib/api/contracts/itsm-rules'
import { useDeployReadiness } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-readiness'
import { usePublishItsmRule } from '@/hooks/queries/itsm-rules'
import { usePanelEditorStore } from '@/stores/panel'

interface ItsmSaveProps {
  workflowId: string | null
  disabled?: boolean
}

interface IssueReport {
  errors: ItsmRuleIssue[]
  warnings: ItsmRuleIssue[]
}

/**
 * Saves the workflow as an ITSM rule: waits for pending edits to persist, then
 * compiles the saved graph and sends the rule JSON to ITSM. Validation errors
 * and warnings open in a popover; each one selects the block it is about.
 */
export function ItsmSave({ workflowId, disabled = false }: ItsmSaveProps) {
  const { waitUntilReady } = useDeployReadiness(workflowId)
  const publish = usePublishItsmRule()
  const [report, setReport] = useState<IssueReport | null>(null)
  const [isWaiting, setIsWaiting] = useState(false)

  const isSaving = isWaiting || publish.isPending

  const handleSave = async () => {
    if (!workflowId || isSaving) return
    setReport(null)
    setIsWaiting(true)
    const ready = await waitUntilReady()
    setIsWaiting(false)
    if (!ready) {
      toast.error('Your latest changes have not synced yet. Try saving again in a moment.')
      return
    }

    try {
      const result = await publish.mutateAsync({ workflowId })
      if (result.status === 'invalid') {
        setReport({ errors: result.errors, warnings: result.warnings })
        return
      }
      if (result.warnings.length > 0) setReport({ errors: [], warnings: result.warnings })
      toast.success('Saved and sent to ITSM')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save the rule'))
    }
  }

  const selectBlock = (blockId: string | null) => {
    if (!blockId) return
    usePanelEditorStore.getState().setCurrentBlockId(blockId)
    setReport(null)
  }

  return (
    <Popover open={report !== null} onOpenChange={(open) => !open && setReport(null)}>
      <PopoverAnchor asChild>
        <div>
          <Chip
            variant='primary'
            onClick={handleSave}
            disabled={disabled || !workflowId || isSaving}
            aria-label='Save'
          >
            {isSaving ? 'Saving' : 'Save'}
          </Chip>
        </div>
      </PopoverAnchor>
      <PopoverContent align='end' side='bottom' sideOffset={8} className='w-[360px] p-0'>
        {report && (
          <div className='flex max-h-[360px] flex-col gap-3 overflow-y-auto p-3'>
            {report.errors.length > 0 && (
              <IssueList
                title={`Fix ${report.errors.length} ${report.errors.length === 1 ? 'issue' : 'issues'} to save`}
                issues={report.errors}
                tone='error'
                onSelect={selectBlock}
              />
            )}
            {report.warnings.length > 0 && (
              <IssueList
                title={report.errors.length > 0 ? 'Warnings' : 'Saved with warnings'}
                issues={report.warnings}
                tone='warning'
                onSelect={selectBlock}
              />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface IssueListProps {
  title: string
  issues: ItsmRuleIssue[]
  tone: 'error' | 'warning'
  onSelect: (blockId: string | null) => void
}

function IssueList({ title, issues, tone, onSelect }: IssueListProps) {
  return (
    <div className='flex flex-col gap-1.5'>
      <span
        className={
          tone === 'error'
            ? 'font-medium text-[var(--text-error)] text-small'
            : 'font-medium text-[var(--text-body)] text-small'
        }
      >
        {title}
      </span>
      <ul className='flex flex-col gap-1'>
        {issues.map((issue) => (
          <li key={`${issue.blockId ?? 'workflow'}:${issue.message}`}>
            <button
              type='button'
              disabled={!issue.blockId}
              onClick={() => onSelect(issue.blockId)}
              className='w-full rounded-md px-2 py-1 text-left transition-colors enabled:hover:bg-[var(--surface-5)]'
            >
              {issue.blockName && (
                <span className='block text-[var(--text-muted)] text-caption'>
                  {issue.blockName}
                </span>
              )}
              <span className='block text-[var(--text-body)] text-small'>{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
