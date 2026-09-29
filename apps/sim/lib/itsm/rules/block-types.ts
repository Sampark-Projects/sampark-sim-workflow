import { ITSM_CONDITION_BLOCK_TYPE } from '@/lib/itsm/rules/condition-branches'

export const ITSM_START_BLOCK_TYPE = 'itsm_start'
export const ITSM_APPROVAL_BLOCK_TYPE = 'itsm_approval'
export const ITSM_ESCALATION_BLOCK_TYPE = 'itsm_escalation'
export const ITSM_ASSIGN_BLOCK_TYPE = 'itsm_assign'

/** Rule steps offered in the editor's block list, in the order a rule reads. */
export const ITSM_STEP_BLOCK_TYPES: readonly string[] = [
  ITSM_CONDITION_BLOCK_TYPE,
  ITSM_APPROVAL_BLOCK_TYPE,
  ITSM_ESCALATION_BLOCK_TYPE,
  ITSM_ASSIGN_BLOCK_TYPE,
]
