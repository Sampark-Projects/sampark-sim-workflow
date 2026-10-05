'use client'

import { useCallback, useMemo } from 'react'
import { Combobox, type ComboboxOption } from '@sim/emcn'
import {
  createItsmApproverGroup,
  createItsmApproverRow,
  ITSM_APPROVER_FIELD_ORDER,
  ITSM_APPROVER_FIELDS,
  type ItsmApproverField,
  type ItsmApproverGroup,
  type ItsmApproverRow,
  parseItsmApproverGroups,
  serializeItsmApproverGroups,
} from '@/lib/itsm/rules/approver-groups'
import { itsmIdsHeldByOtherRows } from '@/lib/itsm/rules/group-values'
import { ItsmGroupList } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/itsm-group-inputs/itsm-group-list'
import { ItsmMultiPicker } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/itsm-group-inputs/itsm-pickers'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

const FIELD_OPTIONS: ComboboxOption[] = ITSM_APPROVER_FIELD_ORDER.map((field) => ({
  value: field,
  label: ITSM_APPROVER_FIELDS[field].label,
}))

interface ItsmApproverGroupsInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

/**
 * Editor for the ITSM Approval block's approvers: OR-ed groups whose rows must
 * all approve; a row is users or bins, any one of which may approve. A bins row
 * may name departments to narrow its bins; changing them clears the row's bins.
 */
export function ItsmApproverGroupsInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: ItsmApproverGroupsInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const readOnly = isPreview || disabled
  const rawValue = isPreview ? previewValue : storeValue
  const groups = useMemo(() => parseItsmApproverGroups(rawValue), [rawValue])

  const commit = useCallback(
    (next: ItsmApproverGroup[]) => {
      if (!readOnly) setStoreValue(serializeItsmApproverGroups(next))
    },
    [readOnly, setStoreValue]
  )

  return (
    <ItsmGroupList
      groups={groups}
      readOnly={readOnly}
      groupHeading='All must approve'
      addRowLabel='Add approver'
      removeRowLabel='Remove approver'
      createRow={createItsmApproverRow}
      createGroup={createItsmApproverGroup}
      onChange={commit}
      renderRow={({ row, group, updateGroup, removeAction }) => {
        const change = (next: ItsmApproverRow) =>
          updateGroup((current) => ({
            ...current,
            rows: current.rows.map((candidate) => (candidate.id === row.id ? next : candidate)),
          }))
        const departmentIds = row.departments.map((department) => department.id)
        const heldElsewhere = itsmIdsHeldByOtherRows(group.rows, row.id, (other) =>
          other.field === row.field ? other.values.map((value) => value.id) : []
        )
        return (
          <div className='space-y-1.5'>
            <div className='flex items-center gap-1.5'>
              <div className='min-w-0 flex-1'>
                <Combobox
                  options={FIELD_OPTIONS}
                  value={row.field ?? undefined}
                  onChange={(field) =>
                    field !== row.field &&
                    change({
                      ...row,
                      field: field as ItsmApproverField,
                      values: [],
                      departments: [],
                    })
                  }
                  onClear={() => change({ ...row, field: null, values: [], departments: [] })}
                  placeholder='Bins or users'
                  disabled={readOnly}
                  editable={false}
                />
              </div>
              {removeAction}
            </div>
            {row.field === 'bins' && (
              <ItsmMultiPicker
                selectorKey='itsm.departments'
                surfaceId='itsm-approver:departments'
                placeholder='Departments (optional)'
                readOnly={readOnly}
                values={row.departments}
                onChange={(departments) => change({ ...row, departments, values: [] })}
              />
            )}
            {row.field && (
              <ItsmMultiPicker
                selectorKey={ITSM_APPROVER_FIELDS[row.field].selectorKey}
                context={
                  departmentIds.length > 0
                    ? { itsmDepartmentId: departmentIds.join(',') }
                    : undefined
                }
                surfaceId={`itsm-approver:${row.field}`}
                placeholder={`Select ${ITSM_APPROVER_FIELDS[row.field].label.toLowerCase()}`}
                readOnly={readOnly}
                hiddenIds={heldElsewhere}
                values={row.values}
                onChange={(values) => change({ ...row, values })}
              />
            )}
          </div>
        )
      }}
    />
  )
}
