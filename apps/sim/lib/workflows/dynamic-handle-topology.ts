import {
  ITSM_CONDITION_BLOCK_TYPE,
  ITSM_CONDITION_SUBBLOCK_ID,
  ITSM_CONDITION_SUBBLOCK_TYPE,
  parseItsmConditionBranches,
  summarizeItsmConditionBranch,
} from '@/lib/itsm/rules/condition-branches'
import type { BlockState } from '@/stores/workflows/workflow/types'

export interface ConditionRow {
  id: string
  title: string
  value: string
}

export interface RouterRow {
  id: string
  value: string
}

function parseStructuredValue(value: unknown): unknown[] | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  return Array.isArray(value) ? value : null
}

/**
 * Whether a block renders one `condition-${row.id}` output handle per branch row —
 * the Condition block and the ITSM Condition block share this layout.
 */
export function isConditionBranchBlockType(blockType: string | undefined): boolean {
  return blockType === 'condition' || blockType === ITSM_CONDITION_BLOCK_TYPE
}

export function getDynamicHandleSubblockId(
  blockType: string | undefined
): 'conditions' | 'routes' | typeof ITSM_CONDITION_SUBBLOCK_ID | null {
  if (blockType === 'condition') return 'conditions'
  if (blockType === ITSM_CONDITION_BLOCK_TYPE) return ITSM_CONDITION_SUBBLOCK_ID
  if (blockType === 'router_v2') return 'routes'
  return null
}

export function getDynamicHandleSubblockType(
  blockType: string | undefined
): 'condition-input' | 'router-input' | typeof ITSM_CONDITION_SUBBLOCK_TYPE | null {
  if (blockType === 'condition') return 'condition-input'
  if (blockType === ITSM_CONDITION_BLOCK_TYPE) return ITSM_CONDITION_SUBBLOCK_TYPE
  if (blockType === 'router_v2') return 'router-input'
  return null
}

export function isDynamicHandleSubblock(
  blockType: string | undefined,
  subblockId: string
): boolean {
  return getDynamicHandleSubblockId(blockType) === subblockId
}

export function getConditionRows(blockId: string, value: unknown): ConditionRow[] {
  const parsed = parseStructuredValue(value)

  if (parsed) {
    const rows = parsed.map((item, index) => {
      const conditionItem = item as { id?: string; value?: unknown }
      const title = index === 0 ? 'if' : index === parsed.length - 1 ? 'else' : 'else if'
      return {
        id: conditionItem?.id ?? `${blockId}-cond-${index}`,
        title,
        value: typeof conditionItem?.value === 'string' ? conditionItem.value : '',
      }
    })

    if (rows.length > 0) {
      return rows
    }
  }

  return [
    { id: `${blockId}-if`, title: 'if', value: '' },
    { id: `${blockId}-else`, title: 'else', value: '' },
  ]
}

/** Branch rows of an ITSM Condition block: one per branch, the trailing one is `else`. */
export function getItsmConditionRows(blockId: string, value: unknown): ConditionRow[] {
  const branches = parseItsmConditionBranches(blockId, value)
  return branches.map((branch, index) => ({
    id: branch.id,
    title: branch.kind === 'else' ? 'else' : index === 0 ? 'if' : 'else if',
    value: summarizeItsmConditionBranch(branch),
  }))
}

/** Branch rows for any block with the condition handle layout. */
export function getBranchConditionRows(
  blockType: string | undefined,
  blockId: string,
  subBlocks: BlockState['subBlocks'] | undefined
): ConditionRow[] {
  if (blockType === ITSM_CONDITION_BLOCK_TYPE) {
    return getItsmConditionRows(blockId, subBlocks?.[ITSM_CONDITION_SUBBLOCK_ID]?.value)
  }
  return getConditionRows(blockId, subBlocks?.conditions?.value)
}

export function getRouterRows(blockId: string, value: unknown): RouterRow[] {
  const parsed = parseStructuredValue(value)

  if (parsed) {
    const rows = parsed.map((item, index) => {
      const routeItem = item as { id?: string; value?: string }
      return {
        id: routeItem?.id ?? `${blockId}-route${index + 1}`,
        value: routeItem?.value ?? '',
      }
    })

    if (rows.length > 0) {
      return rows
    }
  }

  return [{ id: `${blockId}-route1`, value: '' }]
}

export function getDynamicHandleTopologySignature(block: BlockState): string | null {
  if (isConditionBranchBlockType(block.type)) {
    const rows = getBranchConditionRows(block.type, block.id, block.subBlocks)
    return `condition:${rows.map((row) => row.id).join('|')}`
  }

  if (block.type === 'router_v2') {
    const rows = getRouterRows(block.id, block.subBlocks?.routes?.value)
    return `router:${rows.map((row) => row.id).join('|')}`
  }

  return null
}

export function collectDynamicHandleTopologySignatures(
  blocks: Record<string, BlockState>
): Map<string, string> {
  const signatures = new Map<string, string>()

  for (const [blockId, block] of Object.entries(blocks)) {
    const signature = getDynamicHandleTopologySignature(block)
    if (signature) {
      signatures.set(blockId, signature)
    }
  }

  return signatures
}

export function getChangedDynamicHandleBlockIds(
  previous: Map<string, string>,
  next: Map<string, string>
): string[] {
  const changedIds: string[] = []

  for (const [blockId, signature] of next) {
    if (previous.get(blockId) !== signature) {
      changedIds.push(blockId)
    }
  }

  return changedIds
}
