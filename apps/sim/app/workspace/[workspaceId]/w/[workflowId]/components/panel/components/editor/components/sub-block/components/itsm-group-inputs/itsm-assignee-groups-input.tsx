'use client'

import { type ReactNode, useCallback, useMemo } from 'react'
import { Combobox, type ComboboxOption } from '@sim/emcn'
import { ITSM_USER_TYPE_OPTIONS, type ItsmUserType } from '@/lib/itsm/master-data/types'
import {
  createItsmAssigneeGroup,
  createItsmAssigneeRow,
  ITSM_ASSIGN_TARGET_OPTIONS,
  type ItsmAssigneeGroup,
  type ItsmAssigneeRow,
  type ItsmAssignTarget,
  parseItsmAssigneeGroups,
  resetItsmAssigneeRow,
  serializeItsmAssigneeGroups,
} from '@/lib/itsm/rules/assignee-groups'
import { itsmIdsHeldByOtherRows } from '@/lib/itsm/rules/group-values'
import { ItsmGroupList } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/itsm-group-inputs/itsm-group-list'
import { ItsmSinglePicker } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/itsm-group-inputs/itsm-pickers'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

const TARGET_OPTIONS: ComboboxOption[] = ITSM_ASSIGN_TARGET_OPTIONS.map((option) => ({
  value: option.id,
  label: option.label,
}))

const USER_TYPE_OPTIONS: ComboboxOption[] = ITSM_USER_TYPE_OPTIONS.map((option) => ({
  value: option.id,
  label: option.label,
}))

interface ItsmAssigneeGroupsInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

interface AssigneeRowEditorProps {
  row: ItsmAssigneeRow
  group: ItsmAssigneeGroup
  readOnly: boolean
  removeAction: ReactNode
  onChange: (row: ItsmAssigneeRow) => void
}

/**
 * One assignment target. Changing a parent clears what it narrows: the
 * department clears the bin, the user type clears the user, and the category
 * clears the subcategory.
 */
function AssigneeRowEditor({
  row,
  group,
  readOnly,
  removeAction,
  onChange,
}: AssigneeRowEditorProps) {
  const heldElsewhere = (idsOf: (other: ItsmAssigneeRow) => (string | undefined)[]) =>
    itsmIdsHeldByOtherRows(group.rows, row.id, (other) =>
      idsOf(other).filter((id): id is string => id !== undefined)
    )
  return (
    <div className='space-y-1.5'>
      <div className='flex items-center gap-1.5'>
        <div className='min-w-0 flex-1'>
          <Combobox
            options={TARGET_OPTIONS}
            value={row.assignTo}
            onChange={(target) =>
              target !== row.assignTo &&
              onChange(resetItsmAssigneeRow(row, target as ItsmAssignTarget))
            }
            disabled={readOnly}
            editable={false}
          />
        </div>
        {removeAction}
      </div>

      {row.assignTo === 'bin' && (
        <>
          <ItsmSinglePicker
            selectorKey='itsm.departments'
            surfaceId='itsm-assignee:department'
            placeholder='Department (optional)'
            readOnly={readOnly}
            value={row.department}
            onChange={(department) =>
              department?.id !== row.department?.id && onChange({ ...row, department, bin: null })
            }
          />
          <ItsmSinglePicker
            selectorKey='itsm.bins'
            context={row.department ? { itsmDepartmentId: row.department.id } : undefined}
            surfaceId='itsm-assignee:bin'
            hiddenIds={heldElsewhere((other) => [
              other.assignTo === 'bin' ? other.bin?.id : undefined,
            ])}
            placeholder='Select a bin'
            readOnly={readOnly}
            value={row.bin}
            onChange={(bin) => onChange({ ...row, bin })}
          />
          <ItsmSinglePicker
            selectorKey='itsm.assignmentRules'
            surfaceId='itsm-assignee:rule'
            placeholder='Rule type (optional)'
            readOnly={readOnly}
            value={row.assignmentRule}
            onChange={(assignmentRule) => onChange({ ...row, assignmentRule })}
          />
        </>
      )}

      {row.assignTo === 'user' && (
        <>
          <Combobox
            options={USER_TYPE_OPTIONS}
            value={row.userType}
            onChange={(userType) =>
              userType !== row.userType &&
              onChange({ ...row, userType: userType as ItsmUserType, user: null })
            }
            disabled={readOnly}
            editable={false}
          />
          <ItsmSinglePicker
            selectorKey='itsm.usersByType'
            context={{ itsmUserType: row.userType }}
            surfaceId='itsm-assignee:user'
            hiddenIds={heldElsewhere((other) => [
              other.assignTo === 'user' ? other.user?.id : undefined,
            ])}
            placeholder='Select a user'
            readOnly={readOnly}
            value={row.user}
            onChange={(user) => onChange({ ...row, user })}
          />
        </>
      )}

      {row.assignTo === 'category' && (
        <>
          <ItsmSinglePicker
            selectorKey='itsm.categories'
            surfaceId='itsm-assignee:category'
            placeholder='Select a category'
            readOnly={readOnly}
            value={row.category}
            onChange={(category) =>
              category?.id !== row.category?.id && onChange({ ...row, category, subcategory: null })
            }
          />
          {row.category && (
            <ItsmSinglePicker
              selectorKey='itsm.subcategories'
              context={{ itsmCategoryIds: row.category.id }}
              surfaceId='itsm-assignee:subcategory'
              hiddenIds={heldElsewhere((other) => [
                other.assignTo === 'category' && other.category?.id === row.category?.id
                  ? other.subcategory?.id
                  : undefined,
              ])}
              placeholder='Subcategory (optional)'
              readOnly={readOnly}
              value={row.subcategory}
              onChange={(subcategory) => onChange({ ...row, subcategory })}
            />
          )}
        </>
      )}
    </div>
  )
}

/**
 * Editor for the ITSM Assign block's assignees: OR-ed groups whose rows apply
 * together; each row is a bin, a user, or a category.
 */
export function ItsmAssigneeGroupsInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: ItsmAssigneeGroupsInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const readOnly = isPreview || disabled
  const rawValue = isPreview ? previewValue : storeValue
  const groups = useMemo(() => parseItsmAssigneeGroups(rawValue), [rawValue])

  const commit = useCallback(
    (next: ItsmAssigneeGroup[]) => {
      if (!readOnly) setStoreValue(serializeItsmAssigneeGroups(next))
    },
    [readOnly, setStoreValue]
  )

  return (
    <ItsmGroupList
      groups={groups}
      readOnly={readOnly}
      groupHeading='Assign all of'
      addRowLabel='Add assignee'
      removeRowLabel='Remove assignee'
      createRow={createItsmAssigneeRow}
      createGroup={createItsmAssigneeGroup}
      onChange={commit}
      renderRow={({ row, group, updateGroup, removeAction }) => (
        <AssigneeRowEditor
          row={row}
          group={group}
          readOnly={readOnly}
          removeAction={removeAction}
          onChange={(next) =>
            updateGroup((current) => ({
              ...current,
              rows: current.rows.map((candidate) => (candidate.id === row.id ? next : candidate)),
            }))
          }
        />
      )}
    />
  )
}
