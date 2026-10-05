'use client'

import { type ReactNode, useCallback, useMemo } from 'react'
import { Button, ChipTag, Combobox, type ComboboxOption, Input, Tooltip } from '@sim/emcn'
import { ChevronDown, ChevronUp, Plus, Trash } from '@sim/emcn/icons'
import {
  createItsmConditionBranch,
  createItsmConditionGroup,
  createItsmConditionRow,
  getAvailableItsmConditionFields,
  ITSM_CONDITION_FIELDS,
  ITSM_CONDITION_OPERATOR_LABELS,
  type ItsmConditionBranch,
  type ItsmConditionField,
  type ItsmConditionGroup,
  type ItsmConditionOperator,
  type ItsmConditionRow,
  type ItsmConditionValue,
  parseItsmConditionBranches,
  serializeItsmConditionBranches,
} from '@/lib/itsm/rules/condition-branches'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { EDGE } from '@/executor/constants'
import type { SelectorClientContext } from '@/hooks/queries/selectors'
import { useSelectorOptions } from '@/hooks/queries/selectors'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const MAX_VISIBLE_VALUE_TAGS = 2

const OPERATOR_OPTIONS: ComboboxOption[] = (
  Object.entries(ITSM_CONDITION_OPERATOR_LABELS) as [ItsmConditionOperator, string][]
).map(([value, label]) => ({ value, label }))

interface ItsmConditionInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

type BranchUpdater = (branch: ItsmConditionBranch) => ItsmConditionBranch
type GroupUpdater = (group: ItsmConditionGroup) => ItsmConditionGroup

function updateGroup(branch: ItsmConditionBranch, groupId: string, update: GroupUpdater) {
  return {
    ...branch,
    groups: branch.groups.map((group) => (group.id === groupId ? update(group) : group)),
  }
}

function updateRow(
  group: ItsmConditionGroup,
  rowId: string,
  update: (row: ItsmConditionRow) => ItsmConditionRow
): ItsmConditionGroup {
  return { ...group, rows: group.rows.map((row) => (row.id === rowId ? update(row) : row)) }
}

/**
 * Clears child rows in the same group whose picks a parent change invalidates.
 * A required parent (category) only invalidates on removal — a new category
 * keeps every chosen subcategory valid. A filtering parent (department)
 * invalidates on any change, since the child list switches from every bin to
 * the chosen departments' bins.
 */
function clearDependentChildren(
  group: ItsmConditionGroup,
  changedRow: ItsmConditionRow,
  previousValues: ItsmConditionValue[]
): ItsmConditionGroup {
  if (!changedRow.field) return group
  const nextIds = new Set(changedRow.values.map((value) => value.id))
  const removed = previousValues.some((value) => !nextIds.has(value.id))
  const changed = removed || changedRow.values.length !== previousValues.length
  if (!changed) return group
  const parentField = changedRow.field
  return {
    ...group,
    rows: group.rows.map((row) => {
      const parent = row.field ? ITSM_CONDITION_FIELDS[row.field].parent : undefined
      if (parent?.field !== parentField) return row
      return parent.mode === 'filter' || removed ? { ...row, values: [] } : row
    }),
  }
}

/**
 * Editor for the ITSM Condition block. Each branch is a list of OR-ed groups,
 * each group a list of AND-ed rows (`field` · `is` · values). Values are
 * ITSM master data loaded through the `itsm.*` selectors.
 */
export function ItsmConditionInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: ItsmConditionInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const { collaborativeBatchRemoveEdges } = useCollaborativeWorkflow()
  const readOnly = isPreview || disabled

  const rawValue = isPreview ? previewValue : storeValue
  const branches = useMemo(() => parseItsmConditionBranches(blockId, rawValue), [blockId, rawValue])
  const fieldOptions = useMemo<ComboboxOption[]>(
    () =>
      getAvailableItsmConditionFields().map((field) => ({
        value: field,
        label: ITSM_CONDITION_FIELDS[field].label,
      })),
    []
  )
  const matchBranches = branches.filter((branch) => branch.kind === 'branch')

  const commit = useCallback(
    (next: ItsmConditionBranch[]) => {
      if (readOnly) return
      setStoreValue(serializeItsmConditionBranches(next))
    },
    [readOnly, setStoreValue]
  )

  const updateBranch = useCallback(
    (branchId: string, update: BranchUpdater) => {
      commit(branches.map((branch) => (branch.id === branchId ? update(branch) : branch)))
    },
    [branches, commit]
  )

  const addBranch = useCallback(
    (afterBranchId: string) => {
      const index = branches.findIndex((branch) => branch.id === afterBranchId)
      const next = [...branches]
      next.splice(index + 1, 0, createItsmConditionBranch(blockId))
      commit(next)
    },
    [blockId, branches, commit]
  )

  const removeBranch = useCallback(
    (branchId: string) => {
      if (matchBranches.length <= 1) return
      const handle = `${EDGE.CONDITION_PREFIX}${branchId}`
      const edgeIds = useWorkflowStore
        .getState()
        .edges.filter((edge) => edge.source === blockId && edge.sourceHandle === handle)
        .map((edge) => edge.id)
      if (edgeIds.length > 0) collaborativeBatchRemoveEdges(edgeIds)
      commit(branches.filter((branch) => branch.id !== branchId))
    },
    [blockId, branches, collaborativeBatchRemoveEdges, commit, matchBranches.length]
  )

  const moveBranch = useCallback(
    (branchId: string, direction: -1 | 1) => {
      const index = branches.findIndex((branch) => branch.id === branchId)
      const target = index + direction
      if (index < 0 || target < 0 || branches[target]?.kind !== 'branch') return
      const next = [...branches]
      ;[next[index], next[target]] = [next[target], next[index]]
      commit(next)
    },
    [branches, commit]
  )

  return (
    <div className='space-y-2'>
      {branches.map((branch, index) => {
        const isElse = branch.kind === 'else'
        const title = isElse ? 'else' : index === 0 ? 'if' : 'else if'
        return (
          <div
            key={branch.id}
            className='overflow-visible rounded-sm border border-[var(--border-1)] bg-[var(--surface-3)] dark:bg-[var(--code-bg)]'
          >
            <div className='flex items-center justify-between gap-2 border-[var(--border-1)] border-b px-2.5 py-[5px] last:border-b-0'>
              <span className='shrink-0 text-[var(--text-tertiary)] text-sm'>{title}</span>
              {isElse ? (
                <span className='truncate text-[var(--text-muted)] text-sm'>
                  No condition above matched
                </span>
              ) : (
                <div className='flex items-center gap-2'>
                  <BranchAction
                    label='Add new condition below'
                    onClick={() => addBranch(branch.id)}
                    disabled={readOnly}
                  >
                    <Plus className='size-[14px]' />
                  </BranchAction>
                  <BranchAction
                    label='Move up'
                    onClick={() => moveBranch(branch.id, -1)}
                    disabled={readOnly || index === 0}
                  >
                    <ChevronUp className='size-[14px]' />
                  </BranchAction>
                  <BranchAction
                    label='Move down'
                    onClick={() => moveBranch(branch.id, 1)}
                    disabled={readOnly || branches[index + 1]?.kind !== 'branch'}
                  >
                    <ChevronDown className='size-[14px]' />
                  </BranchAction>
                  <BranchAction
                    label='Delete branch'
                    onClick={() => removeBranch(branch.id)}
                    disabled={readOnly || matchBranches.length <= 1}
                    destructive
                  >
                    <Trash className='size-[14px]' />
                  </BranchAction>
                </div>
              )}
            </div>
            {!isElse && (
              <BranchEditor
                branch={branch}
                fieldOptions={fieldOptions}
                readOnly={readOnly}
                onChange={(update) => updateBranch(branch.id, update)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

interface BranchActionProps {
  label: string
  onClick: () => void
  disabled: boolean
  destructive?: boolean
  children: ReactNode
}

function BranchAction({
  label,
  onClick,
  disabled,
  destructive = false,
  children,
}: BranchActionProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='ghost'
          onClick={onClick}
          disabled={disabled}
          className={
            destructive
              ? 'h-auto p-0 text-[var(--text-error)] hover-hover:text-[var(--text-error)]'
              : 'h-auto p-0'
          }
        >
          {children}
          <span className='sr-only'>{label}</span>
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}

interface BranchEditorProps {
  branch: ItsmConditionBranch
  fieldOptions: ComboboxOption[]
  readOnly: boolean
  onChange: (update: BranchUpdater) => void
}

function BranchEditor({ branch, fieldOptions, readOnly, onChange }: BranchEditorProps) {
  return (
    <div className='space-y-2 p-2'>
      <Input
        value={branch.label}
        onChange={(event) => {
          const label = event.target.value
          onChange((current) => ({ ...current, label }))
        }}
        placeholder='Condition name (optional)'
        disabled={readOnly}
      />
      {branch.groups.map((group, groupIndex) => (
        <div key={group.id} className='space-y-2'>
          {groupIndex > 0 && (
            <div className='flex items-center gap-2 text-[var(--text-muted)] text-xs'>
              <span className='h-px flex-1 bg-[var(--border-1)]' />
              OR
              <span className='h-px flex-1 bg-[var(--border-1)]' />
            </div>
          )}
          <GroupEditor
            group={group}
            fieldOptions={fieldOptions}
            readOnly={readOnly}
            canRemove={branch.groups.length > 1}
            onChange={(update) => onChange((current) => updateGroup(current, group.id, update))}
            onRemove={() =>
              onChange((current) => ({
                ...current,
                groups: current.groups.filter((candidate) => candidate.id !== group.id),
              }))
            }
          />
        </div>
      ))}
      <Button
        variant='ghost'
        className='h-auto gap-1 p-0 text-[var(--text-secondary)] text-sm'
        disabled={readOnly}
        onClick={() =>
          onChange((current) => ({
            ...current,
            groups: [...current.groups, createItsmConditionGroup()],
          }))
        }
      >
        <Plus className='size-[14px]' />
        Add OR group
      </Button>
    </div>
  )
}

interface GroupEditorProps {
  group: ItsmConditionGroup
  fieldOptions: ComboboxOption[]
  readOnly: boolean
  canRemove: boolean
  onChange: (update: GroupUpdater) => void
  onRemove: () => void
}

function GroupEditor({
  group,
  fieldOptions,
  readOnly,
  canRemove,
  onChange,
  onRemove,
}: GroupEditorProps) {
  return (
    <div className='space-y-2 rounded-sm border border-[var(--border-1)] p-2'>
      <div className='flex items-center justify-between'>
        <span className='text-[var(--text-muted)] text-xs'>Match all of</span>
        {canRemove && (
          <BranchAction label='Remove group' onClick={onRemove} disabled={readOnly} destructive>
            <Trash className='size-[14px]' />
          </BranchAction>
        )}
      </div>
      {group.rows.map((row) => (
        <RowEditor
          key={row.id}
          row={row}
          group={group}
          fieldOptions={fieldOptions}
          readOnly={readOnly}
          canRemove={group.rows.length > 1}
          onChange={(update) =>
            onChange((current) => {
              const previous = current.rows.find((candidate) => candidate.id === row.id)
              const next = updateRow(current, row.id, update)
              const changed = next.rows.find((candidate) => candidate.id === row.id)
              return previous && changed
                ? clearDependentChildren(next, changed, previous.values)
                : next
            })
          }
          onRemove={() =>
            onChange((current) => ({
              ...current,
              rows: current.rows.filter((candidate) => candidate.id !== row.id),
            }))
          }
        />
      ))}
      <Button
        variant='ghost'
        className='h-auto gap-1 p-0 text-[var(--text-secondary)] text-sm'
        disabled={readOnly}
        onClick={() =>
          onChange((current) => ({ ...current, rows: [...current.rows, createItsmConditionRow()] }))
        }
      >
        <Plus className='size-[14px]' />
        Add condition
      </Button>
    </div>
  )
}

interface RowEditorProps {
  row: ItsmConditionRow
  group: ItsmConditionGroup
  fieldOptions: ComboboxOption[]
  readOnly: boolean
  canRemove: boolean
  onChange: (update: (row: ItsmConditionRow) => ItsmConditionRow) => void
  onRemove: () => void
}

function RowEditor({
  row,
  group,
  fieldOptions,
  readOnly,
  canRemove,
  onChange,
  onRemove,
}: RowEditorProps) {
  return (
    <div className='space-y-1.5'>
      <div className='flex items-center gap-1.5'>
        <div className='min-w-0 flex-1'>
          <Combobox
            options={fieldOptions}
            value={row.field ?? undefined}
            onChange={(field) =>
              onChange((current) =>
                current.field === field
                  ? current
                  : { ...current, field: field as ItsmConditionField, values: [] }
              )
            }
            onClear={() => onChange((current) => ({ ...current, field: null, values: [] }))}
            placeholder='Field'
            disabled={readOnly}
            editable={false}
          />
        </div>
        <div className='w-[82px] shrink-0'>
          <Combobox
            options={OPERATOR_OPTIONS}
            value={row.operator}
            onChange={(operator) =>
              onChange((current) => ({ ...current, operator: operator as ItsmConditionOperator }))
            }
            disabled={readOnly}
            editable={false}
          />
        </div>
        {canRemove && (
          <BranchAction label='Remove condition' onClick={onRemove} disabled={readOnly} destructive>
            <Trash className='size-[14px]' />
          </BranchAction>
        )}
      </div>
      {row.field && (
        <ValuesPicker
          rowId={row.id}
          field={row.field}
          group={group}
          values={row.values}
          readOnly={readOnly}
          onChange={(values) => onChange((current) => ({ ...current, values }))}
        />
      )}
    </div>
  )
}

interface ValuesPickerProps {
  rowId: string
  field: ItsmConditionField
  group: ItsmConditionGroup
  values: ItsmConditionValue[]
  readOnly: boolean
  onChange: (values: ItsmConditionValue[]) => void
}

/** Multi-select of one field's master data, narrowed by its parent row in the same group. */
function ValuesPicker({ rowId, field, group, values, readOnly, onChange }: ValuesPickerProps) {
  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const config = ITSM_CONDITION_FIELDS[field]

  const parentIds = useMemo(() => {
    if (!config.parent) return []
    const parentField = config.parent.field
    return [
      ...new Set(
        group.rows
          .filter((row) => row.field === parentField && row.operator === 'in')
          .flatMap((row) => row.values.map((value) => value.id))
      ),
    ]
  }, [config.parent, group.rows])
  const parentReady = config.parent?.mode !== 'required' || parentIds.length > 0

  const context = useMemo<SelectorClientContext>(
    () => ({
      ...(workflowId ? { workflowId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(field === 'subcategory' ? { itsmCategoryIds: parentIds.join(',') } : {}),
      ...(field === 'bin' && parentIds.length > 0 ? { itsmDepartmentId: parentIds.join(',') } : {}),
    }),
    [field, parentIds, workflowId, workspaceId]
  )
  const list = useSelectorOptions(config.selectorKey, {
    context,
    enabled: parentReady && !readOnly,
    surfaceId: `itsm-condition:${field}`,
  })

  /** A value another row of this field already holds is hidden, unless this row holds it too. */
  const options = useMemo<ComboboxOption[]>(() => {
    const held = new Set(values.map((value) => value.id))
    const heldElsewhere = new Set(
      group.rows
        .filter((row) => row.id !== rowId && row.field === field)
        .flatMap((row) => row.values.map((value) => value.id))
    )
    return (list.data ?? [])
      .filter((option) => !heldElsewhere.has(option.id) || held.has(option.id))
      .map((option) => ({ value: option.id, label: option.label }))
  }, [list.data, group.rows, rowId, field, values])

  const labelById = useMemo(() => {
    const labels = new Map(values.map((value) => [value.id, value.label]))
    for (const option of options) labels.set(option.value, option.label)
    return labels
  }, [options, values])

  const overlay =
    values.length > 0 ? (
      <div className='flex items-center gap-1 overflow-hidden whitespace-nowrap'>
        {values.slice(0, MAX_VISIBLE_VALUE_TAGS).map((value) => (
          <ChipTag key={value.id} variant='field' className='min-w-0 shrink'>
            <span className='truncate'>{labelById.get(value.id) ?? value.label}</span>
          </ChipTag>
        ))}
        {values.length > MAX_VISIBLE_VALUE_TAGS && (
          <ChipTag variant='field' className='shrink-0'>
            +{values.length - MAX_VISIBLE_VALUE_TAGS}
          </ChipTag>
        )}
      </div>
    ) : undefined

  const parentLabel = config.parent ? ITSM_CONDITION_FIELDS[config.parent.field].label : ''

  return (
    <Combobox
      options={options}
      multiSelect
      multiSelectValues={values.map((value) => value.id)}
      onMultiSelectChange={(ids) =>
        onChange(ids.map((id) => ({ id, label: labelById.get(id) ?? id })))
      }
      onClear={() => onChange([])}
      overlayContent={overlay}
      placeholder={
        parentReady
          ? `Select ${config.label.toLowerCase()}`
          : `Pick a ${parentLabel.toLowerCase()} in this group first`
      }
      disabled={readOnly || !parentReady}
      editable={false}
      searchable
      searchPlaceholder='Search...'
      isLoading={list.isLoading}
      error={list.error ? 'Failed to load options' : null}
    />
  )
}
