'use client'

import type { ReactNode } from 'react'
import { Button, Tooltip } from '@sim/emcn'
import { Plus, Trash } from '@sim/emcn/icons'

interface GroupActionProps {
  label: string
  onClick: () => void
  disabled: boolean
  children: ReactNode
}

/** An icon-only destructive action with its label as tooltip, matching the condition editor. */
export function ItsmGroupRemoveAction({ label, onClick, disabled, children }: GroupActionProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='ghost'
          onClick={onClick}
          disabled={disabled}
          className='h-auto p-0 text-[var(--text-error)] hover-hover:text-[var(--text-error)]'
        >
          {children}
          <span className='sr-only'>{label}</span>
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}

interface AddButtonProps {
  label: string
  onClick: () => void
  disabled: boolean
}

function AddButton({ label, onClick, disabled }: AddButtonProps) {
  return (
    <Button
      variant='ghost'
      className='h-auto gap-1 p-0 text-[var(--text-secondary)] text-sm'
      disabled={disabled}
      onClick={onClick}
    >
      <Plus className='size-[14px]' />
      {label}
    </Button>
  )
}

interface Identified {
  id: string
}

interface GroupShape<TRow extends Identified> extends Identified {
  rows: TRow[]
}

interface ItsmGroupListProps<TRow extends Identified, TGroup extends GroupShape<TRow>> {
  groups: TGroup[]
  readOnly: boolean
  /** Heading of each group, e.g. "All must approve". */
  groupHeading: string
  addRowLabel: string
  removeRowLabel: string
  createRow: () => TRow
  createGroup: () => TGroup
  onChange: (groups: TGroup[]) => void
  renderRow: (args: {
    row: TRow
    group: TGroup
    /** Replaces the whole group, so a row change can also reset its siblings. */
    updateGroup: (update: (group: TGroup) => TGroup) => void
    removeAction: ReactNode
  }) => ReactNode
}

/**
 * OR-ed groups of AND-ed rows: the layout shared by the ITSM Approval and Assign
 * editors. Rows and groups can be added and removed; a group or row is removable
 * only while another one remains.
 */
export function ItsmGroupList<TRow extends Identified, TGroup extends GroupShape<TRow>>({
  groups,
  readOnly,
  groupHeading,
  addRowLabel,
  removeRowLabel,
  createRow,
  createGroup,
  onChange,
  renderRow,
}: ItsmGroupListProps<TRow, TGroup>) {
  const updateGroup = (groupId: string, update: (group: TGroup) => TGroup) =>
    onChange(groups.map((group) => (group.id === groupId ? update(group) : group)))

  return (
    <div className='space-y-2'>
      {groups.map((group, groupIndex) => (
        <div key={group.id} className='space-y-2'>
          {groupIndex > 0 && (
            <div className='flex items-center gap-2 text-[var(--text-muted)] text-xs'>
              <span className='h-px flex-1 bg-[var(--border-1)]' />
              OR
              <span className='h-px flex-1 bg-[var(--border-1)]' />
            </div>
          )}
          <div className='space-y-2 rounded-sm border border-[var(--border-1)] bg-[var(--surface-3)] p-2 dark:bg-[var(--code-bg)]'>
            <div className='flex items-center justify-between'>
              <span className='text-[var(--text-muted)] text-xs'>{groupHeading}</span>
              {groups.length > 1 && (
                <ItsmGroupRemoveAction
                  label='Remove group'
                  onClick={() => onChange(groups.filter((candidate) => candidate.id !== group.id))}
                  disabled={readOnly}
                >
                  <Trash className='size-[14px]' />
                </ItsmGroupRemoveAction>
              )}
            </div>
            {group.rows.map((row, rowIndex) => (
              <div key={row.id} className='space-y-2'>
                {rowIndex > 0 && <div className='text-[var(--text-muted)] text-xs'>AND</div>}
                {renderRow({
                  row,
                  group,
                  updateGroup: (update) => updateGroup(group.id, update),
                  removeAction:
                    group.rows.length > 1 ? (
                      <ItsmGroupRemoveAction
                        label={removeRowLabel}
                        onClick={() =>
                          updateGroup(group.id, (current) => ({
                            ...current,
                            rows: current.rows.filter((candidate) => candidate.id !== row.id),
                          }))
                        }
                        disabled={readOnly}
                      >
                        <Trash className='size-[14px]' />
                      </ItsmGroupRemoveAction>
                    ) : null,
                })}
              </div>
            ))}
            <AddButton
              label={addRowLabel}
              disabled={readOnly}
              onClick={() =>
                updateGroup(group.id, (current) => ({
                  ...current,
                  rows: [...current.rows, createRow()],
                }))
              }
            />
          </div>
        </div>
      ))}
      <AddButton
        label='Add OR group'
        disabled={readOnly}
        onClick={() => onChange([...groups, createGroup()])}
      />
    </div>
  )
}
