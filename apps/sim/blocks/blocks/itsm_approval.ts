import { ShieldCheck } from '@sim/emcn/icons'
import { ITSM_APPROVAL_BLOCK_TYPE } from '@/lib/itsm/rules/block-types'
import type { BlockConfig } from '@/blocks/types'

export const ITSM_APPROVAL_MODES = [
  { label: 'Any one approves', id: 'any' },
  { label: 'All must approve', id: 'all' },
] as const

/**
 * One approval level. Chain approvals for multi-level sign-off; an Escalation
 * block between two approvals sets how long the first level has. Rejection is handled by
 * ITSM, so the block has a single "approved" output.
 */
export const ItsmApprovalBlock: BlockConfig = {
  type: ITSM_APPROVAL_BLOCK_TYPE,
  name: 'Approval',
  description: 'Require approval before the rule continues',
  longDescription:
    'Send the ticket for approval at one level. Approvers can be users, whole departments, or bins; with "Any one approves" the first approval moves the ticket on, with "All must approve" every approver must sign off.',
  category: 'blocks',
  errorOutput: false,
  bgColor: '#10B981',
  icon: ShieldCheck,
  subBlocks: [
    {
      id: 'level',
      title: 'Level',
      type: 'dropdown',
      selectorKey: 'itsm.levels',
      preserveLabelCase: true,
      clearable: true,
      placeholder: 'Select a level',
      value: () => '',
      required: true,
    },
    {
      id: 'approverUsers',
      title: 'Approver users',
      type: 'dropdown',
      selectorKey: 'itsm.users',
      preserveLabelCase: true,
      clearable: true,
      multiSelect: true,
      searchable: true,
      placeholder: 'Select users',
    },
    {
      id: 'approverDepartments',
      title: 'Approver departments',
      type: 'dropdown',
      selectorKey: 'itsm.departments',
      preserveLabelCase: true,
      clearable: true,
      multiSelect: true,
      searchable: true,
      placeholder: 'Select departments',
    },
    {
      id: 'approverBins',
      /**
       * Lists every bin until departments are chosen, then only their bins.
       * `approvalMode` always holds a value, so the `any` gate never disables
       * the field; naming `approverDepartments` clears the bins whenever the
       * departments change.
       */
      dependsOn: { any: ['approverDepartments', 'approvalMode'] },
      title: 'Approver bins',
      type: 'dropdown',
      selectorKey: 'itsm.bins',
      preserveLabelCase: true,
      clearable: true,
      multiSelect: true,
      searchable: true,
      placeholder: 'Select bins',
    },
    {
      id: 'approvalMode',
      title: 'Approval mode',
      type: 'dropdown',
      options: [...ITSM_APPROVAL_MODES],
      value: () => 'any',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
