import { Clock } from '@sim/emcn/icons'
import { ITSM_ESCALATION_BLOCK_TYPE } from '@/lib/itsm/rules/block-types'
import type { BlockConfig } from '@/blocks/types'

export const ITSM_ESCALATION_UNITS = [
  { label: 'Minutes', id: 'minutes' },
  { label: 'Hours', id: 'hours' },
  { label: 'Days', id: 'days' },
] as const

/**
 * A timed step that can sit anywhere in the rule: when the ticket has waited
 * this long without moving on, it escalates to the chosen level and users and
 * continues to the block this one leads to.
 */
export const ItsmEscalationBlock: BlockConfig = {
  type: ITSM_ESCALATION_BLOCK_TYPE,
  name: 'Escalation',
  description: 'Escalate the ticket when it waits too long',
  longDescription:
    'If the ticket waits longer than this time at this point in the rule, it escalates to the chosen level and users and continues to the next block.',
  category: 'blocks',
  errorOutput: false,
  bgColor: '#F59E0B',
  icon: Clock,
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
      id: 'escalateAfter',
      title: 'Escalate after',
      type: 'short-input',
      placeholder: 'e.g. 4',
      required: true,
    },
    {
      id: 'escalateUnit',
      title: 'Unit',
      type: 'dropdown',
      options: [...ITSM_ESCALATION_UNITS],
      value: () => 'hours',
    },
    {
      id: 'escalateToUsers',
      title: 'Escalate to users',
      type: 'dropdown',
      selectorKey: 'itsm.users',
      preserveLabelCase: true,
      clearable: true,
      multiSelect: true,
      searchable: true,
      placeholder: 'Select users',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
