import { ConditionalIcon } from '@/components/icons'
import {
  ITSM_CONDITION_BLOCK_TYPE,
  ITSM_CONDITION_SUBBLOCK_ID,
  ITSM_CONDITION_SUBBLOCK_TYPE,
} from '@/lib/itsm/rules/condition-branches'
import type { BlockConfig } from '@/blocks/types'

/**
 * Branches an ITSM rule on ticket master data. Each branch owns an output
 * handle; the first branch that matches wins and `else` catches the rest.
 */
export const ItsmConditionBlock: BlockConfig = {
  type: ITSM_CONDITION_BLOCK_TYPE,
  name: 'Condition',
  description: 'Branch on category, department, bin, or severity',
  longDescription:
    'Route a ticket down the first branch whose conditions match. Rows in a group must all match; any matching group matches the branch.',
  category: 'blocks',
  errorOutput: false,
  bgColor: '#FF752F',
  icon: ConditionalIcon,
  subBlocks: [
    {
      id: ITSM_CONDITION_SUBBLOCK_ID,
      type: ITSM_CONDITION_SUBBLOCK_TYPE,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
