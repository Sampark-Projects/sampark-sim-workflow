import { StartIcon } from '@/components/icons'
import { ITSM_DEFAULT_REQUEST_TYPE } from '@/lib/itsm/master-data/types'
import { ITSM_START_BLOCK_TYPE } from '@/lib/itsm/rules/block-types'
import type { BlockConfig } from '@/blocks/types'

/**
 * Entry point of an ITSM rule. The ITSM backend knows which process a workflow
 * governs by its id, so the start node carries no trigger — only the request
 * type the master-data dropdowns are read for.
 */
export const ItsmStartBlock: BlockConfig = {
  type: ITSM_START_BLOCK_TYPE,
  name: 'Start',
  description: 'Where the ITSM rule begins',
  longDescription:
    'Marks where ITSM evaluates this rule. Connect it to a condition, an approval, or an assignment. A workflow with nothing connected lets ITSM continue its process directly.',
  category: 'triggers',
  bgColor: '#34B5FF',
  icon: StartIcon,
  singleInstance: true,
  subBlocks: [
    {
      id: 'requestType',
      title: 'Request type',
      type: 'short-input',
      readOnly: true,
      value: () => ITSM_DEFAULT_REQUEST_TYPE,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
