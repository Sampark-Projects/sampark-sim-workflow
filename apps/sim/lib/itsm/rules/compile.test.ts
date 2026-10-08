/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ItsmRule } from '@/lib/api/contracts/itsm-rules'
import type {
  ItsmBinOption,
  ItsmMasterDataOption,
  ItsmUserOption,
} from '@/lib/itsm/master-data/types'
import type { ItsmApproverField, ItsmApproverRow } from '@/lib/itsm/rules/approver-groups'
import type { ItsmAssigneeRow } from '@/lib/itsm/rules/assignee-groups'
import {
  collectItsmMasterDataNeeds,
  collectReferencedCategoryIds,
  compileItsmRule,
  type ItsmMasterDataListName,
  type ItsmMasterDataLookup,
  type ItsmRuleGraph,
  type ItsmRuleGraphBlock,
  type ItsmRuleGraphEdge,
} from '@/lib/itsm/rules/compile'
import type { ItsmConditionBranch } from '@/lib/itsm/rules/condition-branches'

function byId<T extends ItsmMasterDataOption>(options: T[]): Map<string, T> {
  return new Map(options.map((option) => [String(option.id), option]))
}

const pathology = { id: '279', name: 'Pathology' }
const it_ = { id: '275', name: 'IT' }

const lookup: ItsmMasterDataLookup = {
  categories: byId([
    { id: 'OR000500021', name: 'Customer Service' },
    { id: 'OR000500024', name: 'CRM-Sales' },
  ]),
  subcategories: byId([{ id: 'OR00050002131', name: 'Page not loading' }]),
  departments: byId([pathology, it_]),
  bins: byId<ItsmBinOption>([
    { id: '2793', name: 'Service CRM', department: pathology },
    { id: '2796', name: 'IL-SL', department: pathology },
    { id: '2800', name: 'IT Desk', department: it_ },
  ]),
  organizations: byId([{ id: 'O250682287', name: 'Sampark' }]),
  users: byId<ItsmUserOption>([
    { id: '4010001', name: 'User One', roleType: 'Resolver' },
    { id: '4010002', name: 'User Two', roleType: 'Both' },
  ]),
  statuses: byId([{ id: 'REOPEN', name: 'Reopen' }]),
  severities: byId([
    { id: 'SEV-0', name: 'SEV-0' },
    { id: 'SEV-1', name: 'SEV-1' },
  ]),
  processes: byId([
    { id: 'BIN_ASSIGNMENT', name: 'Bin Assignment' },
    { id: 'USER_ASSIGNMENT', name: 'User Assignment' },
    { id: 'TICKET_APPROVAL', name: 'Ticket Approval' },
  ]),
  levels: byId([
    { id: 'L1', name: 'L1' },
    { id: 'L2', name: 'L2' },
  ]),
  assignmentRules: byId([{ id: 'Round Robin', name: 'Round Robin' }]),
  departmentBins: new Map([
    ['279', new Set(['2793', '2796'])],
    ['275', new Set(['2800'])],
  ]),
  categorySubcategories: new Map([['OR000500021', new Set(['OR00050002131'])]]),
}

function block(
  id: string,
  type: string,
  subBlocks: Record<string, unknown> = {},
  overrides: Partial<ItsmRuleGraphBlock> = {}
): ItsmRuleGraphBlock {
  return {
    id,
    type,
    name: id,
    enabled: true,
    subBlocks: Object.fromEntries(
      Object.entries(subBlocks).map(([key, value]) => [key, { value }])
    ),
    ...overrides,
  }
}

/** A value as the editor stores it; the label is what was shown when it was picked. */
function value(id: string, label = id) {
  return { id, label }
}

let rowCounter = 0

function approverRow(field: ItsmApproverField | null, ...ids: string[]): ItsmApproverRow {
  rowCounter += 1
  return { id: `ar${rowCounter}`, field, values: ids.map((id) => value(id)), departments: [] }
}

/** A bins approver row narrowed to `departments`. */
function binsRow(departments: string[], ...ids: string[]): ItsmApproverRow {
  return { ...approverRow('bins', ...ids), departments: departments.map((id) => value(id)) }
}

/** The Approval subblock value: each argument is one OR group of AND-ed rows. */
function approvers(...groups: ItsmApproverRow[][]) {
  return { approvers: JSON.stringify(groups.map((rows, index) => ({ id: `ag${index}`, rows }))) }
}

function assigneeRow(fields: Partial<Omit<ItsmAssigneeRow, 'id'>>): ItsmAssigneeRow {
  rowCounter += 1
  return {
    id: `sr${rowCounter}`,
    assignTo: 'bin',
    department: null,
    bin: null,
    assignmentRule: null,
    userType: 'resolver',
    user: null,
    category: null,
    subcategory: null,
    ...fields,
  }
}

/** The Assign subblock value: each argument is one OR group of AND-ed rows. */
function assignees(...groups: ItsmAssigneeRow[][]) {
  return { assignees: JSON.stringify(groups.map((rows, index) => ({ id: `sg${index}`, rows }))) }
}

function userRow(userType: ItsmAssigneeRow['userType'], id: string) {
  return assigneeRow({ assignTo: 'user', userType, user: value(id) })
}

function categoryRow(category: string | null, subcategory: string | null = null) {
  return assigneeRow({
    assignTo: 'category',
    category: category ? value(category) : null,
    subcategory: subcategory ? value(subcategory) : null,
  })
}

function rawGraph(blocks: ItsmRuleGraphBlock[], edges: ItsmRuleGraphEdge[]): ItsmRuleGraph {
  return {
    workflowId: 'wf-1',
    name: 'Service Request routing',
    description: '',
    blocks: Object.fromEntries(blocks.map((candidate) => [candidate.id, candidate])),
    edges,
  }
}

/**
 * A graph whose Start block leads into one Ticket Approval process block
 * (`proc`), which then leads wherever the edges from `start` pointed.
 */
function graph(blocks: ItsmRuleGraphBlock[], edges: ItsmRuleGraphEdge[]): ItsmRuleGraph {
  if (!edges.some((edge) => edge.source === 'start')) return rawGraph(blocks, edges)
  return rawGraph(
    [...blocks, block('proc', 'itsm_process', { process: 'TICKET_APPROVAL' })],
    [
      { source: 'start', sourceHandle: 'source', target: 'proc' },
      ...edges.map((edge) => (edge.source === 'start' ? { ...edge, source: 'proc' } : edge)),
    ]
  )
}

/** Every node of every process, in process order. */
function nodesOf(rule: ItsmRule | null | undefined) {
  return rule?.processes.flatMap((process) => process.nodes) ?? []
}

const branches: ItsmConditionBranch[] = [
  {
    id: 'cond-a',
    kind: 'branch',
    label: 'Customer Service',
    groups: [
      {
        id: 'g1',
        rows: [
          {
            id: 'r1',
            field: 'category',
            operator: 'in',
            values: [{ id: 'OR000500021', label: 'Customer Service' }],
          },
          {
            id: 'r2',
            field: 'subcategory',
            operator: 'in',
            values: [{ id: 'OR00050002131', label: 'Page not loading' }],
          },
        ],
      },
    ],
  },
  {
    id: 'cond-b',
    kind: 'branch',
    label: '',
    groups: [
      {
        id: 'g2',
        rows: [
          {
            id: 'r3',
            field: 'severity',
            operator: 'in',
            values: [{ id: 'SEV-0', label: 'SEV-0' }],
          },
        ],
      },
      {
        id: 'g3',
        rows: [
          {
            id: 'r4',
            field: 'department',
            operator: 'not_in',
            values: [{ id: '275', label: 'IT' }],
          },
        ],
      },
    ],
  },
  { id: 'cond-else', kind: 'else', label: 'Else', groups: [] },
]

function validGraph(): ItsmRuleGraph {
  return graph(
    [
      block('start', 'itsm_start'),
      block('cond', 'itsm_condition', { branches: JSON.stringify(branches) }),
      block('appr-1', 'itsm_approval', approvers([approverRow('users', '4010001')])),
      block('esc', 'itsm_escalation', {
        level: 'L1',
        escalateAfter: '4',
        escalateUnit: 'hours',
        escalateToUsers: ['4010002'],
      }),
      block(
        'appr-2',
        'itsm_approval',
        approvers(
          [binsRow(['279'], '2796'), approverRow('bins', '2800')],
          [approverRow('users', '4010001', '4010002')]
        )
      ),
      block(
        'assign',
        'itsm_assign',
        assignees([
          assigneeRow({
            department: value('279'),
            bin: value('2793'),
            assignmentRule: value('Round Robin'),
          }),
        ])
      ),
    ],
    [
      { source: 'start', sourceHandle: 'source', target: 'cond' },
      { source: 'cond', sourceHandle: 'condition-cond-a', target: 'appr-1' },
      { source: 'cond', sourceHandle: 'condition-cond-b', target: 'assign' },
      { source: 'appr-1', sourceHandle: 'source', target: 'esc' },
      { source: 'esc', sourceHandle: 'source', target: 'appr-2' },
      { source: 'appr-2', sourceHandle: 'source', target: 'assign' },
    ]
  )
}

describe('compileItsmRule', () => {
  it('compiles a multi-branch, multi-step rule into the ITSM JSON', () => {
    const { rule, errors, warnings } = compileItsmRule(validGraph(), lookup)

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(rule?.processes.map((process) => process.process)).toEqual([
      { id: 'TICKET_APPROVAL', name: 'Ticket Approval' },
    ])
    expect(rule?.processes[0]?.processStartNodeId).toBe('cond')
    expect(nodesOf(rule).map((node) => node.id)).toEqual([
      'cond',
      'appr-1',
      'assign',
      'esc',
      'appr-2',
    ])

    expect(nodesOf(rule).find((node) => node.id === 'cond')).toEqual({
      id: 'cond',
      type: 'condition',
      label: 'cond',
      branches: [
        {
          id: 'cond-a',
          label: 'Customer Service',
          when: {
            any: [
              {
                all: [
                  {
                    field: 'category',
                    operator: 'in',
                    values: [{ id: 'OR000500021', name: 'Customer Service' }],
                  },
                  {
                    field: 'subcategory',
                    operator: 'in',
                    values: [{ id: 'OR00050002131', name: 'Page not loading' }],
                  },
                ],
              },
            ],
          },
          next: 'appr-1',
        },
        {
          id: 'cond-b',
          label: '',
          when: {
            any: [
              {
                all: [
                  { field: 'severity', operator: 'in', values: [{ id: 'SEV-0', name: 'SEV-0' }] },
                ],
              },
              {
                all: [
                  { field: 'department', operator: 'not_in', values: [{ id: '275', name: 'IT' }] },
                ],
              },
            ],
          },
          next: 'assign',
        },
      ],
      elseNext: null,
    })

    expect(nodesOf(rule).find((node) => node.id === 'appr-1')).toEqual({
      id: 'appr-1',
      type: 'approval',
      label: 'appr-1',
      approvers: {
        any: [{ all: [{ kind: 'users', anyOf: [{ id: '4010001', name: 'User One' }] }] }],
      },
      next: 'esc',
    })
    expect(nodesOf(rule).find((node) => node.id === 'esc')).toEqual({
      id: 'esc',
      type: 'escalation',
      label: 'esc',
      level: { id: 'L1', name: 'L1' },
      after: 4,
      unit: 'hours',
      users: [{ id: '4010002', name: 'User Two' }],
      next: 'appr-2',
    })
    expect(nodesOf(rule).find((node) => node.id === 'appr-2')).toMatchObject({
      approvers: {
        any: [
          {
            all: [
              {
                kind: 'bins',
                anyOf: [{ id: '2796', name: 'IL-SL', department: pathology }],
              },
              { kind: 'bins', anyOf: [{ id: '2800', name: 'IT Desk', department: it_ }] },
            ],
          },
          {
            all: [
              {
                kind: 'users',
                anyOf: [
                  { id: '4010001', name: 'User One' },
                  { id: '4010002', name: 'User Two' },
                ],
              },
            ],
          },
        ],
      },
    })
    expect(nodesOf(rule).find((node) => node.id === 'assign')).toEqual({
      id: 'assign',
      type: 'assign',
      label: 'assign',
      assignees: {
        any: [
          {
            all: [
              {
                kind: 'bin',
                id: '2793',
                name: 'Service CRM',
                department: pathology,
                assignmentRule: { id: 'Round Robin', name: 'Round Robin' },
              },
            ],
          },
        ],
      },
      next: null,
    })
  })

  it('saves a rule with no processes', () => {
    const { rule, errors } = compileItsmRule(graph([block('start', 'itsm_start')], []), lookup)
    expect(errors).toEqual([])
    expect(rule?.processes).toEqual([])
  })

  it('compiles each process into its own flow, in ITSM order', () => {
    const input = rawGraph(
      [
        block('start', 'itsm_start'),
        block('p-user', 'itsm_process', { process: 'USER_ASSIGNMENT' }),
        block('p-bin', 'itsm_process', { process: 'BIN_ASSIGNMENT' }),
        block('a-user', 'itsm_assign', assignees([userRow('resolver', '4010001')])),
        block('a-bin', 'itsm_assign', assignees([assigneeRow({ bin: value('2793') })])),
      ],
      [
        { source: 'start', sourceHandle: 'source', target: 'p-user' },
        { source: 'start', sourceHandle: 'source', target: 'p-bin' },
        { source: 'p-user', sourceHandle: 'source', target: 'a-user' },
        { source: 'p-bin', sourceHandle: 'source', target: 'a-bin' },
      ]
    )
    const { rule, errors } = compileItsmRule(input, lookup)
    expect(errors).toEqual([])
    expect(
      rule?.processes.map((process) => [
        process.process.id,
        process.processStartNodeId,
        process.nodes.map((node) => node.id),
      ])
    ).toEqual([
      ['BIN_ASSIGNMENT', 'a-bin', ['a-bin']],
      ['USER_ASSIGNMENT', 'a-user', ['a-user']],
    ])
  })

  it('checks how processes are wired', () => {
    const input = rawGraph(
      [
        block('start', 'itsm_start'),
        block('p1', 'itsm_process', { process: 'BIN_ASSIGNMENT' }),
        block('p2', 'itsm_process', { process: 'BIN_ASSIGNMENT' }),
        block('p3', 'itsm_process'),
        block('p4', 'itsm_process', { process: 'GONE' }),
        block('p5', 'itsm_process', { process: 'TICKET_APPROVAL' }),
        block('shared', 'itsm_assign', assignees([assigneeRow({ bin: value('2793') })])),
        block('loose-process', 'itsm_process', { process: 'USER_ASSIGNMENT' }),
        block('direct', 'itsm_assign', assignees([assigneeRow({ bin: value('2793') })])),
      ],
      [
        { source: 'start', sourceHandle: 'source', target: 'p1' },
        { source: 'start', sourceHandle: 'source', target: 'p2' },
        { source: 'start', sourceHandle: 'source', target: 'p3' },
        { source: 'start', sourceHandle: 'source', target: 'p4' },
        { source: 'start', sourceHandle: 'source', target: 'p5' },
        { source: 'start', sourceHandle: 'source', target: 'direct' },
        { source: 'p1', sourceHandle: 'source', target: 'shared' },
        { source: 'p2', sourceHandle: 'source', target: 'shared' },
        { source: 'shared', sourceHandle: 'source', target: 'loose-process' },
      ]
    )
    const issues = compileItsmRule(input, lookup).errors.map((issue) => [
      issue.blockId,
      issue.message,
    ])
    expect(issues).toEqual(
      expect.arrayContaining([
        ['p2', 'Bin Assignment is already used by "p1".'],
        [
          'shared',
          'This block is reached from more than one process. Each block can belong to only one process.',
        ],
        ['p3', 'Choose a process.'],
        ['p4', 'Process "GONE" no longer exists in ITSM.'],
        ['p5', 'Connect at least one block after this process.'],
        ['direct', 'Only Process blocks can connect to the Start block.'],
        ['loose-process', 'A Process block can only follow the Start block.'],
      ])
    )
  })

  it('requires exactly one start block', () => {
    expect(compileItsmRule(graph([], []), lookup).errors[0]?.message).toMatch(/Add a Start block/)
    const twoStarts = graph([block('a', 'itsm_start'), block('b', 'itsm_start')], [])
    expect(compileItsmRule(twoStarts, lookup).errors[0]?.message).toMatch(/exactly one start/)
  })

  it('allows an escalation anywhere and checks its level and time', () => {
    const input = validGraph()
    input.blocks.stray = block('stray', 'itsm_escalation', { level: 'L2', escalateAfter: '2' })
    input.edges = input.edges.map((edge) =>
      edge.source === 'cond' && edge.target === 'assign' ? { ...edge, target: 'stray' } : edge
    )
    input.edges.push({ source: 'stray', sourceHandle: 'source', target: 'assign' })
    const placed = compileItsmRule(input, lookup)
    expect(placed.errors).toEqual([])
    expect(nodesOf(placed.rule).find((node) => node.id === 'stray')).toMatchObject({
      type: 'escalation',
      level: { id: 'L2', name: 'L2' },
      after: 2,
      unit: 'hours',
      users: [],
      next: 'assign',
    })

    input.blocks.esc = block('esc', 'itsm_escalation', { level: 'L1', escalateAfter: '0' })
    const messages = compileItsmRule(input, lookup).errors.map((issue) => issue.message)
    expect(messages).toEqual(['Escalate after must be a number greater than 0.'])

    input.blocks.esc = block('esc', 'itsm_escalation', { escalateAfter: '4' })
    expect(compileItsmRule(input, lookup).errors.map((issue) => issue.message)).toEqual([
      'Choose a level.',
    ])
    input.blocks.esc = block('esc', 'itsm_escalation', { level: 'L9', escalateAfter: '4' })
    expect(compileItsmRule(input, lookup).errors.map((issue) => issue.message)).toEqual([
      'Level "L9" no longer exists in ITSM.',
    ])
  })

  it('reports master data that no longer exists and incomplete rows', () => {
    const input = validGraph()
    input.blocks['appr-1'] = block('appr-1', 'itsm_approval', approvers([approverRow('users')]))
    input.blocks['appr-2'] = block(
      'appr-2',
      'itsm_approval',
      approvers(
        [approverRow('users', '4010001')],
        [approverRow('bins', '9999')],
        [binsRow(['275'], '2796')],
        [binsRow(['999', '275'], '2800')]
      )
    )
    input.blocks.assign = block(
      'assign',
      'itsm_assign',
      assignees([assigneeRow({ department: value('275'), bin: value('2793', 'Service CRM') })])
    )
    const messages = compileItsmRule(input, lookup).errors.map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'Pick at least one value in Users.',
        'Group 2: Bins: "9999" no longer exists in ITSM.',
        'Group 3: Bin "IL-SL" does not belong to IT.',
        'Group 4: Department "999" no longer exists in ITSM.',
        'Bin "Service CRM" does not belong to IT.',
      ])
    )
  })

  it('requires an approver and an assignee in a block that was never filled in', () => {
    const input = validGraph()
    input.blocks['appr-1'] = block('appr-1', 'itsm_approval')
    input.blocks.assign = block('assign', 'itsm_assign')
    const messages = compileItsmRule(input, lookup).errors.map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining(['Choose Bins or Users for every row.', 'Choose a bin.'])
    )
  })

  it('requires a category beside every subcategory condition', () => {
    const orphan: ItsmConditionBranch[] = [
      {
        id: 'cond-a',
        kind: 'branch',
        label: '',
        groups: [
          {
            id: 'g1',
            rows: [
              {
                id: 'r1',
                field: 'subcategory',
                operator: 'in',
                values: [{ id: 'OR00050002131', label: 'Page not loading' }],
              },
            ],
          },
        ],
      },
    ]
    const input = graph(
      [
        block('start', 'itsm_start'),
        block('cond', 'itsm_condition', { branches: JSON.stringify(orphan) }),
      ],
      [{ source: 'start', sourceHandle: 'source', target: 'cond' }]
    )
    expect(compileItsmRule(input, lookup).errors[0]?.message).toMatch(
      /Subcategory row needs a Category row/
    )
  })

  it('rejects one output wired to several blocks, loops, and foreign blocks', () => {
    const input = validGraph()
    input.edges.push({ source: 'proc', sourceHandle: 'source', target: 'assign' })
    input.edges.push({ source: 'assign', sourceHandle: 'source', target: 'appr-1' })
    input.blocks.agent = block('agent', 'agent')
    input.edges.push({ source: 'cond', sourceHandle: 'condition-cond-else', target: 'agent' })
    const messages = compileItsmRule(input, lookup).errors.map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'The process block connects to 2 blocks. Connect it to only one.',
        'This process loops back on itself. Remove the connection that forms the loop.',
        'Only Condition, Approval, Escalation, and Assign blocks can be part of a rule.',
      ])
    )
  })

  it('warns about unconnected blocks', () => {
    const input = validGraph()
    input.blocks.loose = block('loose', 'itsm_assign')
    const { rule, warnings } = compileItsmRule(input, lookup)
    expect(rule).not.toBeNull()
    expect(warnings.map((issue) => issue.message)).toEqual([
      'Not connected to the start block, so it is not sent to ITSM.',
    ])
  })
})

describe('compileItsmRule assignments', () => {
  function assignGraph(...groups: ItsmAssigneeRow[][]) {
    return graph(
      [block('start', 'itsm_start'), block('assign', 'itsm_assign', assignees(...groups))],
      [{ source: 'start', sourceHandle: 'source', target: 'assign' }]
    )
  }

  it('assigns to a user of the chosen type', () => {
    const resolver = compileItsmRule(assignGraph([userRow('resolver', '4010001')]), lookup)
    expect(resolver.errors).toEqual([])
    expect(nodesOf(resolver.rule)[0]).toMatchObject({
      assignees: {
        any: [{ all: [{ kind: 'user', id: '4010001', name: 'User One', userType: 'resolver' }] }],
      },
    })

    const creator = compileItsmRule(assignGraph([userRow('creator', '4010001')]), lookup)
    expect(creator.errors.map((issue) => issue.message)).toEqual([
      'User One is not a creator in ITSM.',
    ])

    const both = compileItsmRule(assignGraph([userRow('both', '4010001')]), lookup)
    expect(both.errors).toEqual([])
  })

  it('assigns to a category when no subcategory is picked', () => {
    const { rule, errors } = compileItsmRule(assignGraph([categoryRow('OR000500024')]), lookup)
    expect(errors).toEqual([])
    expect(nodesOf(rule)[0]).toMatchObject({
      assignees: { any: [{ all: [{ kind: 'category', id: 'OR000500024', name: 'CRM-Sales' }] }] },
    })
  })

  it('assigns to a subcategory of the chosen category', () => {
    const { rule, errors } = compileItsmRule(
      assignGraph([categoryRow('OR000500021', 'OR00050002131')]),
      lookup
    )
    expect(errors).toEqual([])
    expect(nodesOf(rule)[0]).toMatchObject({
      assignees: {
        any: [
          {
            all: [
              {
                kind: 'subcategory',
                id: 'OR00050002131',
                name: 'Page not loading',
                category: { id: 'OR000500021', name: 'Customer Service' },
              },
            ],
          },
        ],
      },
    })
  })

  it('rejects a subcategory outside the chosen category, and a missing category', () => {
    const mismatch = compileItsmRule(
      assignGraph([categoryRow('OR000500024', 'OR00050002131')]),
      lookup
    )
    expect(mismatch.errors.map((issue) => issue.message)).toEqual([
      'Subcategory "OR00050002131" is not in CRM-Sales.',
    ])
    const empty = compileItsmRule(assignGraph([categoryRow(null)]), lookup)
    expect(empty.errors.map((issue) => issue.message)).toEqual(['Choose a category.'])
  })

  it('combines assignees with AND inside a group and OR across groups', () => {
    const { rule, errors } = compileItsmRule(
      assignGraph(
        [assigneeRow({ bin: value('2796') }), userRow('both', '4010002')],
        [categoryRow('OR000500024')]
      ),
      lookup
    )
    expect(errors).toEqual([])
    expect(nodesOf(rule)[0]).toMatchObject({
      assignees: {
        any: [
          {
            all: [
              { kind: 'bin', id: '2796', department: pathology, assignmentRule: null },
              { kind: 'user', id: '4010002', userType: 'both' },
            ],
          },
          { all: [{ kind: 'category', id: 'OR000500024' }] },
        ],
      },
    })
  })

  it('loads subcategories only when a subcategory is picked', () => {
    expect(
      collectReferencedCategoryIds(assignGraph([categoryRow('OR000500024', 'OR00050002131')]))
    ).toEqual(['OR000500024'])
    expect(collectReferencedCategoryIds(assignGraph([categoryRow('OR000500024')]))).toEqual([])
  })
})

describe('duplicate picks', () => {
  function messagesFor(blockId: string, subBlocks: Record<string, unknown>, type: string) {
    const input = validGraph()
    input.blocks[blockId] = block(blockId, type, subBlocks)
    return compileItsmRule(input, lookup).errors.map((issue) => issue.message)
  }

  it('rejects an approver picked in two rows of one group, and identical groups', () => {
    expect(
      messagesFor(
        'appr-1',
        approvers(
          [approverRow('users', '4010001'), approverRow('users', '4010001', '4010002')],
          [approverRow('bins', '2796')],
          [approverRow('bins', '2796')]
        ),
        'itsm_approval'
      )
    ).toEqual([
      'Group 1: Users "4010001" is used in more than one row.',
      'Group 3 is the same as Group 2.',
    ])
  })

  it('rejects the same assignment twice in one group, and identical groups', () => {
    expect(
      messagesFor(
        'assign',
        assignees(
          [userRow('resolver', '4010001'), userRow('both', '4010001')],
          [categoryRow('OR000500024')],
          [categoryRow('OR000500024')]
        ),
        'itsm_assign'
      )
    ).toEqual([
      'Group 1: User 4010001 is used in more than one row.',
      'Group 3 is the same as Group 2.',
    ])
  })

  it('rejects a condition value in two rows, identical groups, and identical conditions', () => {
    const row = (id: string, valueId: string) => ({
      id,
      field: 'severity' as const,
      operator: 'in' as const,
      values: [{ id: valueId, label: valueId }],
    })
    const duplicated: ItsmConditionBranch[] = [
      {
        id: 'cond-a',
        kind: 'branch',
        label: 'A',
        groups: [
          { id: 'g1', rows: [row('r1', 'SEV-0'), row('r2', 'SEV-0')] },
          { id: 'g2', rows: [row('r3', 'SEV-1')] },
          { id: 'g3', rows: [row('r4', 'SEV-1')] },
        ],
      },
      {
        id: 'cond-b',
        kind: 'branch',
        label: 'B',
        groups: [{ id: 'g4', rows: [row('r5', 'SEV-1')] }],
      },
      {
        id: 'cond-c',
        kind: 'branch',
        label: 'C',
        groups: [{ id: 'g5', rows: [row('r6', 'SEV-1')] }],
      },
      { id: 'cond-else', kind: 'else', label: 'Else', groups: [] },
    ]
    expect(messagesFor('cond', { branches: JSON.stringify(duplicated) }, 'itsm_condition')).toEqual(
      expect.arrayContaining([
        'Condition "A": Group 1: Severity "SEV-0" is used in more than one row.',
        'Condition "A": Group 3 is the same as Group 2.',
        'Condition "C" is the same as condition "B".',
      ])
    )
  })
})

describe('collectReferencedCategoryIds', () => {
  it('collects every category a condition uses', () => {
    expect(collectReferencedCategoryIds(validGraph())).toEqual(['OR000500021'])
  })
})

describe('collectItsmMasterDataNeeds', () => {
  /** The lookup a save builds: lists the rule does not need stay empty. */
  function trimmedLookup(input: ItsmRuleGraph): ItsmMasterDataLookup {
    const { lists } = collectItsmMasterDataNeeds(input)
    const trimmed: Record<string, unknown> = { ...lookup }
    for (const name of Object.keys(lookup) as (keyof ItsmMasterDataLookup)[]) {
      if (name === 'departmentBins' || name === 'categorySubcategories') continue
      if (!lists.has(name as ItsmMasterDataListName)) trimmed[name] = new Map()
    }
    return trimmed as unknown as ItsmMasterDataLookup
  }

  it('compiles the same rule from only the lists the rule references', () => {
    const input = validGraph()
    expect(compileItsmRule(input, trimmedLookup(input))).toEqual(compileItsmRule(input, lookup))
  })

  it('loads what each kind of Assign row picks', () => {
    const rowSets = [
      [
        assigneeRow({
          department: value('279'),
          bin: value('2793'),
          assignmentRule: value('Round Robin'),
        }),
      ],
      [assigneeRow({ bin: value('2793') })],
      [userRow('resolver', '4010002')],
      [categoryRow('OR000500021', 'OR00050002131')],
    ]
    for (const rows of rowSets) {
      const input = graph(
        [block('start', 'itsm_start'), block('assign', 'itsm_assign', assignees(rows))],
        [{ source: 'start', sourceHandle: 'source', target: 'assign' }]
      )
      const full = compileItsmRule(input, lookup)
      expect(full.errors).toEqual([])
      expect(compileItsmRule(input, trimmedLookup(input))).toEqual(full)
    }
  })

  it('skips the lists no block references', () => {
    const { lists } = collectItsmMasterDataNeeds(validGraph())
    expect(lists.has('organizations')).toBe(false)
    expect(lists.has('statuses')).toBe(false)
    expect(collectItsmMasterDataNeeds(graph([block('start', 'itsm_start')], [])).lists.size).toBe(0)
  })
})
