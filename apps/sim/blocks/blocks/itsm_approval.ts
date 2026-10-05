import { ShieldCheck } from '@sim/emcn/icons'
import {
  ITSM_APPROVERS_SUBBLOCK_ID,
  ITSM_APPROVERS_SUBBLOCK_TYPE,
} from '@/lib/itsm/rules/approver-groups'
import { ITSM_APPROVAL_BLOCK_TYPE } from '@/lib/itsm/rules/block-types'
import type { BlockConfig } from '@/blocks/types'

/**
 * One approval step. Approvers are OR-ed groups of AND-ed rows, each row a
 * set of bins or users of which any one may approve. Rejection is handled by
 * ITSM, so the block has a single output.
 */
export const ItsmApprovalBlock: BlockConfig = {
  type: ITSM_APPROVAL_BLOCK_TYPE,
  name: 'Approval',
  description: 'Require approval before the rule continues',
  longDescription:
    'Send the ticket for approval. Combine bins and users: every row in a group must approve, any one value in a row is enough, and any one group being approved moves the ticket on.',
  category: 'blocks',
  errorOutput: false,
  bgColor: '#10B981',
  icon: ShieldCheck,
  subBlocks: [
    {
      id: ITSM_APPROVERS_SUBBLOCK_ID,
      title: 'Approvers',
      type: ITSM_APPROVERS_SUBBLOCK_TYPE,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
