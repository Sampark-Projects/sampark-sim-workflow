'use client'

import { useMemo } from 'react'
import { ChipTag, Combobox, type ComboboxOption } from '@sim/emcn'
import type { ItsmGroupValue } from '@/lib/itsm/rules/group-values'
import type { SelectorKey } from '@/lib/selectors/manifest'
import type { SelectorClientContext } from '@/hooks/queries/selectors'
import { useSelectorOptions } from '@/hooks/queries/selectors'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const MAX_VISIBLE_VALUE_TAGS = 2

interface ItsmOptionsArgs {
  selectorKey: SelectorKey
  /** Selector context beyond the workflow and workspace, e.g. a parent's ids. */
  context?: SelectorClientContext
  surfaceId: string
  enabled: boolean
  /** Ids other rows of the group already hold; hidden unless this picker holds them too. */
  hiddenIds?: ReadonlySet<string>
  keptIds: readonly string[]
}

function useItsmOptions({
  selectorKey,
  context,
  surfaceId,
  enabled,
  hiddenIds,
  keptIds,
}: ItsmOptionsArgs) {
  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const fullContext = useMemo<SelectorClientContext>(
    () => ({
      ...(workflowId ? { workflowId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...context,
    }),
    [context, workflowId, workspaceId]
  )
  const list = useSelectorOptions(selectorKey, { context: fullContext, enabled, surfaceId })
  const keptKey = keptIds.join(',')
  const options = useMemo<ComboboxOption[]>(() => {
    const kept = new Set(keptKey.split(','))
    return (list.data ?? [])
      .filter((option) => !hiddenIds?.has(option.id) || kept.has(option.id))
      .map((option) => ({ value: option.id, label: option.label }))
  }, [list.data, hiddenIds, keptKey])
  return { options, isLoading: list.isLoading, error: list.error }
}

interface ItsmPickerBaseProps {
  selectorKey: SelectorKey
  context?: SelectorClientContext
  surfaceId: string
  placeholder: string
  readOnly: boolean
  /** False while a required parent is missing; the picker is shown disabled. */
  enabled?: boolean
  /** Values other rows of the same group already hold, left out of the list. */
  hiddenIds?: ReadonlySet<string>
}

interface ItsmMultiPickerProps extends ItsmPickerBaseProps {
  values: ItsmGroupValue[]
  onChange: (values: ItsmGroupValue[]) => void
}

/** Multi-select of ITSM master data; picked values keep their labels while the list loads. */
export function ItsmMultiPicker({
  selectorKey,
  context,
  surfaceId,
  placeholder,
  readOnly,
  enabled = true,
  hiddenIds,
  values,
  onChange,
}: ItsmMultiPickerProps) {
  const { options, isLoading, error } = useItsmOptions({
    selectorKey,
    context,
    surfaceId,
    enabled: enabled && !readOnly,
    hiddenIds,
    keptIds: values.map((value) => value.id),
  })
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
      placeholder={placeholder}
      disabled={readOnly || !enabled}
      editable={false}
      searchable
      searchPlaceholder='Search...'
      isLoading={isLoading}
      error={error ? 'Failed to load options' : null}
    />
  )
}

interface ItsmSinglePickerProps extends ItsmPickerBaseProps {
  value: ItsmGroupValue | null
  onChange: (value: ItsmGroupValue | null) => void
}

/** Single-select of ITSM master data; the picked value keeps its label while the list loads. */
export function ItsmSinglePicker({
  selectorKey,
  context,
  surfaceId,
  placeholder,
  readOnly,
  enabled = true,
  hiddenIds,
  value,
  onChange,
}: ItsmSinglePickerProps) {
  const { options, isLoading, error } = useItsmOptions({
    selectorKey,
    context,
    surfaceId,
    enabled: enabled && !readOnly,
    hiddenIds,
    keptIds: value ? [value.id] : [],
  })
  const withPicked = useMemo<ComboboxOption[]>(
    () =>
      value && !options.some((option) => option.value === value.id)
        ? [{ value: value.id, label: value.label }, ...options]
        : options,
    [options, value]
  )

  return (
    <Combobox
      options={withPicked}
      value={value?.id}
      onChange={(id) => {
        const option = withPicked.find((candidate) => candidate.value === id)
        onChange(option ? { id: option.value, label: String(option.label) } : null)
      }}
      onClear={() => onChange(null)}
      placeholder={placeholder}
      disabled={readOnly || !enabled}
      editable={false}
      searchable
      searchPlaceholder='Search...'
      isLoading={isLoading}
      error={error ? 'Failed to load options' : null}
    />
  )
}
