import { useMemo } from 'react'
import { ITSM_PROCESS_BLOCK_TYPE, ITSM_PROCESS_SUBBLOCK_ID } from '@/lib/itsm/rules/block-types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const NONE: ReadonlySet<string> = new Set()

/**
 * The ticket processes other Process blocks in this workflow already hold, so
 * a Process block's picker can leave them out: each process runs at most once.
 * Empty for every other field. Selectors return joined strings so unrelated
 * store updates do not re-render the picker.
 */
export function useItsmProcessesTaken(blockId: string, subBlockId: string): ReadonlySet<string> {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const isProcessPicker = useWorkflowStore(
    (state) =>
      state.blocks[blockId]?.type === ITSM_PROCESS_BLOCK_TYPE &&
      subBlockId === ITSM_PROCESS_SUBBLOCK_ID
  )
  const otherBlockIds = useWorkflowStore((state) =>
    isProcessPicker
      ? Object.values(state.blocks)
          .filter((block) => block.type === ITSM_PROCESS_BLOCK_TYPE && block.id !== blockId)
          .map((block) => block.id)
          .join('\n')
      : ''
  )
  const takenKey = useSubBlockStore((state) => {
    if (!otherBlockIds || !activeWorkflowId) return ''
    const values = state.workflowValues[activeWorkflowId]
    return otherBlockIds
      .split('\n')
      .map((id) => values?.[id]?.[ITSM_PROCESS_SUBBLOCK_ID])
      .filter((value): value is string => typeof value === 'string' && value !== '')
      .join('\n')
  })
  return useMemo(() => (takenKey ? new Set(takenKey.split('\n')) : NONE), [takenKey])
}
