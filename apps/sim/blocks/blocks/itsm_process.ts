import { Workflow } from '@sim/emcn/icons'
import { ITSM_PROCESS_BLOCK_TYPE, ITSM_PROCESS_SUBBLOCK_ID } from '@/lib/itsm/rules/block-types'
import type { BlockConfig } from '@/blocks/types'

/**
 * One ticket process (Bin Assignment, User Assignment, or Ticket Approval),
 * connected straight from the Start block. The blocks after it make up that
 * process's flow; a rule runs each process it has, at most once each.
 */
export const ItsmProcessBlock: BlockConfig = {
  type: ITSM_PROCESS_BLOCK_TYPE,
  name: 'Process',
  description: 'Start the flow of one ticket process',
  longDescription:
    'Choose the ticket process this flow runs: Bin Assignment, User Assignment, or Ticket Approval. Connect it from the Start block and build the process flow after it. Each process can be used once.',
  category: 'blocks',
  errorOutput: false,
  bgColor: '#0EA5E9',
  icon: Workflow,
  subBlocks: [
    {
      id: ITSM_PROCESS_SUBBLOCK_ID,
      title: 'Process',
      type: 'dropdown',
      selectorKey: 'itsm.processes',
      preserveLabelCase: true,
      clearable: true,
      placeholder: 'Select a process',
      value: () => '',
      required: true,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
