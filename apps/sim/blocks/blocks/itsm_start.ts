import { StartIcon } from '@/components/icons'
import { ITSM_START_BLOCK_TYPE } from '@/lib/itsm/rules/block-types'
import type { BlockConfig } from '@/blocks/types'

/**
 * Entry point of an ITSM rule. The ITSM backend knows which flow a workflow
 * governs by its id, so the start node carries no trigger and no settings.
 */
export const ItsmStartBlock: BlockConfig = {
  type: ITSM_START_BLOCK_TYPE,
  name: 'Start',
  description: 'Where the ITSM rule begins',
  longDescription:
    'Marks where ITSM evaluates this rule. Connect it to Process blocks, one for each ticket process the workflow runs. A workflow with nothing connected lets ITSM continue directly.',
  category: 'triggers',
  bgColor: '#34B5FF',
  icon: StartIcon,
  singleInstance: true,
  subBlocks: [],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
