import { User } from '@sim/emcn/icons'
import { ITSM_USER_TYPE_OPTIONS } from '@/lib/itsm/master-data/types'
import { ITSM_ASSIGN_BLOCK_TYPE } from '@/lib/itsm/rules/block-types'
import type { BlockConfig } from '@/blocks/types'

const ASSIGN_TO_BIN = { field: 'assignTo', value: 'bin' } as const
const ASSIGN_TO_USER = { field: 'assignTo', value: 'user' } as const
const ASSIGN_TO_CATEGORY = { field: 'assignTo', value: 'category' } as const
/** The subcategory appears once a category is picked. */
const ASSIGN_TO_CATEGORY_CHOSEN = {
  ...ASSIGN_TO_CATEGORY,
  and: { field: 'assignCategory', value: [''], not: true },
}

/**
 * Assigns the ticket to a bin (distributed by the bin's assignment rule), to
 * one user, or to a category and optionally one of its subcategories.
 */
export const ItsmAssignBlock: BlockConfig = {
  type: ITSM_ASSIGN_BLOCK_TYPE,
  name: 'Assign',
  description: 'Assign the ticket to a bin, a user, or a category',
  longDescription:
    'Assign the ticket to a bin, choosing how the bin distributes it (Bin Owner, Round Robin, or Roster), directly to one creator or resolver, or to a category and optionally one of its subcategories.',
  category: 'blocks',
  errorOutput: false,
  bgColor: '#6366F1',
  icon: User,
  subBlocks: [
    {
      id: 'assignTo',
      title: 'Assign to',
      type: 'dropdown',
      options: [
        { label: 'Bin', id: 'bin' },
        { label: 'User', id: 'user' },
        { label: 'Category', id: 'category' },
      ],
      value: () => 'bin',
    },
    {
      id: 'assignDepartment',
      title: 'Department',
      type: 'dropdown',
      selectorKey: 'itsm.departments',
      preserveLabelCase: true,
      clearable: true,
      searchable: true,
      placeholder: 'Select a department',
      value: () => '',
      condition: ASSIGN_TO_BIN,
      required: false,
    },
    {
      id: 'assignBin',
      /**
       * Lists every bin until a department is chosen, then that department's
       * bins. `assignTo` always holds a value while this field shows, so the
       * `any` gate never disables it; naming `assignDepartment` clears the bin
       * whenever the department changes.
       */
      dependsOn: { any: ['assignTo', 'assignDepartment'] },
      title: 'Bin',
      type: 'dropdown',
      selectorKey: 'itsm.bins',
      preserveLabelCase: true,
      clearable: true,
      searchable: true,
      placeholder: 'Select a bin',
      value: () => '',
      condition: ASSIGN_TO_BIN,
      required: true,
    },
    {
      id: 'assignmentRule',
      title: 'Rule type',
      type: 'dropdown',
      selectorKey: 'itsm.assignmentRules',
      preserveLabelCase: true,
      clearable: true,
      placeholder: 'Select a rule type',
      value: () => '',
      condition: ASSIGN_TO_BIN,
      required: false,
    },
    {
      id: 'assignUserType',
      title: 'User type',
      type: 'dropdown',
      options: [...ITSM_USER_TYPE_OPTIONS],
      value: () => 'resolver',
      condition: ASSIGN_TO_USER,
    },
    {
      id: 'assignUser',
      title: 'User',
      type: 'dropdown',
      selectorKey: 'itsm.usersByType',
      dependsOn: ['assignUserType'],
      preserveLabelCase: true,
      clearable: true,
      searchable: true,
      placeholder: 'Select a user',
      value: () => '',
      condition: ASSIGN_TO_USER,
      required: true,
    },
    {
      id: 'assignCategory',
      title: 'Category',
      type: 'dropdown',
      selectorKey: 'itsm.categories',
      preserveLabelCase: true,
      clearable: true,
      searchable: true,
      placeholder: 'Select a category',
      value: () => '',
      condition: ASSIGN_TO_CATEGORY,
      required: true,
    },
    {
      id: 'assignSubcategory',
      title: 'Subcategory',
      type: 'dropdown',
      selectorKey: 'itsm.subcategories',
      dependsOn: ['assignCategory'],
      preserveLabelCase: true,
      clearable: true,
      searchable: true,
      placeholder: 'Select a subcategory',
      value: () => '',
      condition: ASSIGN_TO_CATEGORY_CHOSEN,
      required: false,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
}
