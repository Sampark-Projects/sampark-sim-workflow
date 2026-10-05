import { User } from '@sim/emcn/icons'
import {
  ITSM_ASSIGNEES_SUBBLOCK_ID,
  ITSM_ASSIGNEES_SUBBLOCK_TYPE,
} from '@/lib/itsm/rules/assignee-groups'
import { ITSM_ASSIGN_BLOCK_TYPE } from '@/lib/itsm/rules/block-types'
import type { BlockConfig } from '@/blocks/types'

/**
 * Assigns the ticket. Assignees are OR-ed groups of AND-ed rows; each row is
 * a bin (with its department and rule type), a user of a type, or a category
 * (optionally one of its subcategories).
 */
export const ItsmAssignBlock: BlockConfig = {
  type: ITSM_ASSIGN_BLOCK_TYPE,
  name: 'Assign',
  description: 'Assign the ticket to bins, users, or categories',
  longDescription:
    'Assign the ticket to a bin, choosing how the bin distributes it (Bin Owner, Round Robin, or Roster), to a creator or resolver, or to a category and optionally one of its subcategories. Combine them: rows in a group apply together, and groups are alternatives.',
  category: 'blocks',
  errorOutput: false,
  bgColor: '#6366F1',
  icon: User,
  subBlocks: [
    {
      id: ITSM_ASSIGNEES_SUBBLOCK_ID,
      title: 'Assign to',
      type: ITSM_ASSIGNEES_SUBBLOCK_TYPE,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
