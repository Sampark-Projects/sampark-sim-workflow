/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type {
  ItsmBinOption,
  ItsmMasterDataOption,
  ItsmUserOption,
} from '@/lib/itsm/master-data/types'
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
  levels: byId([
    { id: 'L1', name: 'L1' },
    { id: 'L2', name: 'L2' },
  ]),
  assignmentRules: byId([{ id: 'Round Robin', name: 'Round Robin' }]),
  departmentBins: new Map([['279', new Set(['2793', '2796'])]]),
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

function graph(blocks: ItsmRuleGraphBlock[], edges: ItsmRuleGraphEdge[]): ItsmRuleGraph {
  return {
    workflowId: 'wf-1',
    name: 'Service Request routing',
    description: '',
    blocks: Object.fromEntries(blocks.map((candidate) => [candidate.id, candidate])),
    edges,
  }
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
      block('appr-1', 'itsm_approval', {
        level: 'L1',
        approverUsers: ['4010001'],
        approvalMode: 'any',
      }),
      block('esc', 'itsm_escalation', {
        escalateAfter: '4',
        escalateUnit: 'hours',
        escalateToUsers: ['4010002'],
      }),
      block('appr-2', 'itsm_approval', {
        level: 'L2',
        approverBins: ['2796'],
        approverDepartments: ['275'],
        approvalMode: 'all',
      }),
      block('assign', 'itsm_assign', {
        assignTo: 'bin',
        assignDepartment: '279',
        assignBin: '2793',
        assignmentRule: 'Round Robin',
      }),
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
  it('compiles a multi-branch, multi-level rule into the ITSM JSON', () => {
    const { rule, errors, warnings } = compileItsmRule(validGraph(), lookup)

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(rule?.startNodeId).toBe('cond')
    expect(rule?.nodes.map((node) => node.id)).toEqual([
      'cond',
      'appr-1',
      'assign',
      'esc',
      'appr-2',
    ])

    const condition = rule?.nodes.find((node) => node.id === 'cond')
    expect(condition).toEqual({
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

    expect(rule?.nodes.find((node) => node.id === 'appr-1')).toMatchObject({
      type: 'approval',
      level: { id: 'L1', name: 'L1' },
      approvers: [{ kind: 'user', id: '4010001', name: 'User One' }],
      mode: 'any',
      next: 'esc',
    })
    expect(rule?.nodes.find((node) => node.id === 'esc')).toEqual({
      id: 'esc',
      type: 'escalation',
      label: 'esc',
      after: 4,
      unit: 'hours',
      users: [{ id: '4010002', name: 'User Two' }],
      next: 'appr-2',
    })
    expect(rule?.nodes.find((node) => node.id === 'appr-2')).toMatchObject({
      approvers: [
        { kind: 'department', id: '275', name: 'IT' },
        { kind: 'bin', id: '2796', name: 'IL-SL', department: { id: '279', name: 'Pathology' } },
      ],
      mode: 'all',
    })
    expect(rule?.nodes.find((node) => node.id === 'assign')).toMatchObject({
      assignee: {
        kind: 'bin',
        id: '2793',
        department: { id: '279', name: 'Pathology' },
        assignmentRule: { id: 'Round Robin', name: 'Round Robin' },
      },
      next: null,
    })
  })

  it('sends an empty rule when nothing follows the start block', () => {
    const { rule, errors } = compileItsmRule(graph([block('start', 'itsm_start')], []), lookup)
    expect(errors).toEqual([])
    expect(rule).toMatchObject({ startNodeId: null, nodes: [] })
  })

  it('requires exactly one start block', () => {
    expect(compileItsmRule(graph([], []), lookup).errors[0]?.message).toMatch(/Add a Start block/)
    const twoStarts = graph([block('a', 'itsm_start'), block('b', 'itsm_start')], [])
    expect(compileItsmRule(twoStarts, lookup).errors[0]?.message).toMatch(/exactly one start/)
  })

  it('allows an escalation anywhere and checks its time', () => {
    const input = validGraph()
    input.blocks.stray = block('stray', 'itsm_escalation', { escalateAfter: '2' })
    input.edges = input.edges.map((edge) =>
      edge.source === 'cond' && edge.target === 'assign' ? { ...edge, target: 'stray' } : edge
    )
    input.edges.push({ source: 'stray', sourceHandle: 'source', target: 'assign' })
    const placed = compileItsmRule(input, lookup)
    expect(placed.errors).toEqual([])
    expect(placed.rule?.nodes.find((node) => node.id === 'stray')).toMatchObject({
      type: 'escalation',
      after: 2,
      unit: 'hours',
      users: [],
      next: 'assign',
    })

    input.blocks.esc = block('esc', 'itsm_escalation', { escalateAfter: '0' })
    const messages = compileItsmRule(input, lookup).errors.map((issue) => issue.message)
    expect(messages).toEqual(['Escalate after must be a number greater than 0.'])
  })

  it('reports master data that no longer exists and incomplete blocks', () => {
    const input = validGraph()
    input.blocks['appr-1'] = block('appr-1', 'itsm_approval', { level: 'L9', approverUsers: [] })
    input.blocks.assign = block('assign', 'itsm_assign', {
      assignTo: 'bin',
      assignDepartment: '275',
      assignBin: '2793',
    })
    const messages = compileItsmRule(input, lookup).errors.map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'Level "L9" no longer exists in ITSM.',
        'Add at least one approver.',
        'Bin "Service CRM" does not belong to IT.',
      ])
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
      /Subcategory condition needs a Category condition/
    )
  })

  it('rejects one output wired to several blocks, loops, and foreign blocks', () => {
    const input = validGraph()
    input.edges.push({ source: 'start', sourceHandle: 'source', target: 'assign' })
    input.edges.push({ source: 'assign', sourceHandle: 'source', target: 'appr-1' })
    input.blocks.agent = block('agent', 'agent')
    input.edges.push({ source: 'cond', sourceHandle: 'condition-cond-else', target: 'agent' })
    const messages = compileItsmRule(input, lookup).errors.map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'The start block connects to 2 blocks. Connect it to only one.',
        'The rule loops back on itself. Remove the connection that forms the loop.',
        'Only Condition, Approval, Escalation, and Assign blocks can be part of a rule.',
      ])
    )
  })

  it('warns about unconnected blocks and descending approval levels', () => {
    const input = validGraph()
    input.blocks['appr-2'] = block('appr-2', 'itsm_approval', {
      level: 'L1',
      approverUsers: ['4010002'],
    })
    input.blocks.loose = block('loose', 'itsm_assign')
    const { rule, warnings } = compileItsmRule(input, lookup)
    expect(rule).not.toBeNull()
    expect(warnings.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'Level L1 follows level L1. Approval levels usually go up.',
        'Not connected to the start block, so it is not sent to ITSM.',
      ])
    )
  })
})

describe('compileItsmRule assignments to a user, category, or subcategory', () => {
  function assignGraph(subBlocks: Record<string, unknown>) {
    return graph(
      [block('start', 'itsm_start'), block('assign', 'itsm_assign', subBlocks)],
      [{ source: 'start', sourceHandle: 'source', target: 'assign' }]
    )
  }

  it('assigns to a user of the chosen type', () => {
    const resolver = compileItsmRule(
      assignGraph({ assignTo: 'user', assignUserType: 'resolver', assignUser: '4010001' }),
      lookup
    )
    expect(resolver.errors).toEqual([])
    expect(resolver.rule?.nodes[0]).toMatchObject({
      assignee: { kind: 'user', id: '4010001', name: 'User One', userType: 'resolver' },
    })

    const creator = compileItsmRule(
      assignGraph({ assignTo: 'user', assignUserType: 'creator', assignUser: '4010001' }),
      lookup
    )
    expect(creator.errors.map((issue) => issue.message)).toEqual([
      'User One is not a creator in ITSM.',
    ])

    const both = compileItsmRule(
      assignGraph({ assignTo: 'user', assignUserType: 'both', assignUser: '4010001' }),
      lookup
    )
    expect(both.errors).toEqual([])
  })

  it('assigns to a category when no subcategory is picked', () => {
    const { rule, errors } = compileItsmRule(
      assignGraph({ assignTo: 'category', assignCategory: 'OR000500024' }),
      lookup
    )
    expect(errors).toEqual([])
    expect(rule?.nodes[0]).toMatchObject({
      assignee: { kind: 'category', id: 'OR000500024', name: 'CRM-Sales' },
    })
  })

  it('assigns to a subcategory of the chosen category', () => {
    const { rule, errors } = compileItsmRule(
      assignGraph({
        assignTo: 'category',
        assignCategory: 'OR000500021',
        assignSubcategory: 'OR00050002131',
      }),
      lookup
    )
    expect(errors).toEqual([])
    expect(rule?.nodes[0]).toMatchObject({
      assignee: {
        kind: 'subcategory',
        id: 'OR00050002131',
        name: 'Page not loading',
        category: { id: 'OR000500021', name: 'Customer Service' },
      },
    })
  })

  it('rejects a subcategory outside the chosen category, and a missing category', () => {
    const mismatch = compileItsmRule(
      assignGraph({
        assignTo: 'category',
        assignCategory: 'OR000500024',
        assignSubcategory: 'OR00050002131',
      }),
      lookup
    )
    expect(mismatch.errors.map((issue) => issue.message)).toEqual([
      'Subcategory OR00050002131 is not in CRM-Sales.',
    ])
    const empty = compileItsmRule(assignGraph({ assignTo: 'category' }), lookup)
    expect(empty.errors.map((issue) => issue.message)).toEqual(['Choose a category.'])
  })

  it('loads subcategories only when a subcategory is picked', () => {
    expect(
      collectReferencedCategoryIds(
        assignGraph({
          assignTo: 'category',
          assignCategory: 'OR000500024',
          assignSubcategory: 'OR00050002131',
        })
      )
    ).toEqual(['OR000500024'])
    expect(
      collectReferencedCategoryIds(
        assignGraph({ assignTo: 'category', assignCategory: 'OR000500024' })
      )
    ).toEqual([])
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

  it('loads the single bin, user, or category an Assign block picks', () => {
    const assignments = [
      {
        assignTo: 'bin',
        assignDepartment: '279',
        assignBin: '2793',
        assignmentRule: 'Round Robin',
      },
      { assignTo: 'bin', assignBin: '2793' },
      { assignTo: 'user', assignUserType: 'resolver', assignUser: '4010002' },
      { assignTo: 'category', assignCategory: 'OR000500021', assignSubcategory: 'OR00050002131' },
    ]
    for (const subBlocks of assignments) {
      const input = graph(
        [block('start', 'itsm_start'), block('assign', 'itsm_assign', subBlocks)],
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
