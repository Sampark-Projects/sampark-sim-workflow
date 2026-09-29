/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getAvailableItsmConditionFields,
  parseItsmConditionBranches,
  serializeItsmConditionBranches,
  summarizeItsmConditionBranch,
} from '@/lib/itsm/rules/condition-branches'

describe('parseItsmConditionBranches', () => {
  it('derives stable default ids from the block id for an unwritten value', () => {
    const first = parseItsmConditionBranches('block-1', null)
    const second = parseItsmConditionBranches('block-1', undefined)
    expect(first.map((branch) => branch.id)).toEqual(['block-1-if', 'block-1-else'])
    expect(second).toEqual(first)
  })

  it('round-trips a serialized value and keeps exactly one trailing else', () => {
    const value = serializeItsmConditionBranches([
      { id: 'b-else', kind: 'else', label: 'Else', groups: [] },
      {
        id: 'b-1',
        kind: 'branch',
        label: 'Sales',
        groups: [
          {
            id: 'g',
            rows: [
              {
                id: 'r',
                field: 'category',
                operator: 'not_in',
                values: [{ id: 'C1', label: 'CRM' }],
              },
            ],
          },
        ],
      },
    ])
    const parsed = parseItsmConditionBranches('b', value)
    expect(parsed.map((branch) => branch.kind)).toEqual(['branch', 'else'])
    expect(parsed[0].groups[0].rows[0]).toEqual({
      id: 'r',
      field: 'category',
      operator: 'not_in',
      values: [{ id: 'C1', label: 'CRM' }],
    })
  })

  it('drops malformed rows and unknown fields instead of throwing', () => {
    const parsed = parseItsmConditionBranches(
      'b',
      JSON.stringify([
        {
          id: 'b-1',
          kind: 'branch',
          groups: [{ id: 'g', rows: [{ id: 'r', field: 'priority' }, 42] }],
        },
      ])
    )
    expect(parsed[0].groups[0].rows).toEqual([{ id: 'r', field: null, operator: 'in', values: [] }])
  })
})

describe('summarizeItsmConditionBranch', () => {
  it('reads groups as OR and rows as AND', () => {
    const [branch] = parseItsmConditionBranches(
      'b',
      JSON.stringify([
        {
          id: 'b-1',
          kind: 'branch',
          label: '',
          groups: [
            {
              id: 'g1',
              rows: [
                { id: 'r1', field: 'category', operator: 'in', values: [{ id: '1', label: 'A' }] },
                {
                  id: 'r2',
                  field: 'severity',
                  operator: 'in',
                  values: [{ id: 'S', label: 'SEV-0' }],
                },
              ],
            },
            {
              id: 'g2',
              rows: [
                {
                  id: 'r3',
                  field: 'bin',
                  operator: 'not_in',
                  values: [{ id: '2', label: 'Infra' }],
                },
              ],
            },
          ],
        },
      ])
    )
    expect(summarizeItsmConditionBranch(branch)).toBe(
      '(Category is A and Severity is SEV-0) or (Bin is not Infra)'
    )
  })
})

describe('getAvailableItsmConditionFields', () => {
  it('hides status for Service Request workflows', () => {
    expect(getAvailableItsmConditionFields('SR')).not.toContain('status')
    expect(getAvailableItsmConditionFields('INCIDENT')).toContain('status')
  })
})
