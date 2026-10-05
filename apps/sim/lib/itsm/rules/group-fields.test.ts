/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  parseItsmApproverGroups,
  serializeItsmApproverGroups,
  summarizeItsmApproverGroups,
} from '@/lib/itsm/rules/approver-groups'
import {
  parseItsmAssigneeGroups,
  resetItsmAssigneeRow,
  summarizeItsmAssigneeGroups,
} from '@/lib/itsm/rules/assignee-groups'

describe('ITSM approver groups', () => {
  it('starts an unwritten or malformed value with one empty group, stable across reads', () => {
    for (const raw of [undefined, '', 'not json', '[]', '{}']) {
      const groups = parseItsmApproverGroups(raw)
      expect(groups).toEqual([
        {
          id: 'approvers-group',
          rows: [{ id: 'approvers-row', field: null, values: [], departments: [] }],
        },
      ])
    }
  })

  it('round-trips and drops unknown fields and malformed values', () => {
    const stored = JSON.stringify([
      {
        id: 'g1',
        rows: [
          { id: 'r1', field: 'users', values: [{ id: '1', label: 'Rahul' }, { label: 'no id' }] },
          { id: 'r2', field: 'departments', values: [{ id: '2', label: 'ITSM' }] },
          {
            id: 'r3',
            field: 'bins',
            values: [{ id: '3', label: 'Testing' }],
            departments: [{ id: '2', label: 'ITSM' }],
          },
        ],
      },
    ])
    const groups = parseItsmApproverGroups(stored)
    expect(groups[0].rows).toEqual([
      { id: 'r1', field: 'users', values: [{ id: '1', label: 'Rahul' }], departments: [] },
      { id: 'r2', field: null, values: [], departments: [] },
      {
        id: 'r3',
        field: 'bins',
        values: [{ id: '3', label: 'Testing' }],
        departments: [{ id: '2', label: 'ITSM' }],
      },
    ])
    expect(parseItsmApproverGroups(serializeItsmApproverGroups(groups))).toEqual(groups)
  })

  it('reads as one line for the canvas', () => {
    const groups = parseItsmApproverGroups([
      {
        id: 'g1',
        rows: [
          { id: 'r1', field: 'users', values: [{ id: '1', label: 'Rahul' }] },
          { id: 'r2', field: 'bins', values: [{ id: '2', label: 'Desk' }] },
        ],
      },
      { id: 'g2', rows: [{ id: 'r3', field: 'bins', values: [{ id: '3', label: 'Testing' }] }] },
    ])
    expect(summarizeItsmApproverGroups(groups)).toBe(
      '(Users: Rahul and Bins: Desk) or (Bins: Testing)'
    )
  })
})

describe('ITSM assignee groups', () => {
  it('starts an unwritten value with one empty bin row', () => {
    expect(parseItsmAssigneeGroups(undefined)[0].rows[0]).toMatchObject({
      id: 'assignees-row',
      assignTo: 'bin',
      userType: 'resolver',
      bin: null,
    })
  })

  it('clears the previous target’s picks when the row switches target', () => {
    const [row] = parseItsmAssigneeGroups([
      {
        id: 'g1',
        rows: [{ id: 'r1', assignTo: 'bin', bin: { id: '1675', label: 'Test Bin SR' } }],
      },
    ])[0].rows
    expect(resetItsmAssigneeRow(row, 'user')).toEqual({
      ...parseItsmAssigneeGroups(undefined)[0].rows[0],
      id: 'r1',
      assignTo: 'user',
    })
  })

  it('reads as one line for the canvas', () => {
    const groups = parseItsmAssigneeGroups([
      {
        id: 'g1',
        rows: [
          {
            id: 'r1',
            assignTo: 'bin',
            bin: { id: '1675', label: 'Test Bin SR' },
            assignmentRule: { id: 'Roster', label: 'Roster' },
          },
          { id: 'r2', assignTo: 'user', user: { id: '9', label: 'Rahul' } },
        ],
      },
      {
        id: 'g2',
        rows: [
          {
            id: 'r3',
            assignTo: 'category',
            category: { id: 'c', label: 'Design' },
            subcategory: { id: 's', label: 'UI' },
          },
        ],
      },
    ])
    expect(summarizeItsmAssigneeGroups(groups)).toBe(
      '(Bin Test Bin SR (Roster) and User Rahul) or (Category Design / UI)'
    )
  })
})
