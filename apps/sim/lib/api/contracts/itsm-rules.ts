import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'

/**
 * The ITSM rule JSON: the contract between Sim (which designs a rule) and the
 * ITSM backend (which evaluates it). The backend maps a workflow id to the ITSM
 * process it governs, starts at `startNodeId`, and follows `next` /
 * `branches[].next` / `elseNext`; `null` ends the rule and the process
 * continues. `schemaVersion` changes on any breaking change to this shape.
 */
export const ITSM_RULE_SCHEMA_VERSION = '2.0'

/** A master-data reference. `id` is ITSM's id; `name` is informational. */
const itsmRefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
})

const nodeIdSchema = z.string().min(1)
const nextNodeSchema = nodeIdSchema.nullable()

export const itsmRuleConditionFieldSchema = z.enum([
  'category',
  'subcategory',
  'department',
  'bin',
  'organization',
  'status',
  'severity',
])

const itsmRuleConditionRowSchema = z.object({
  field: itsmRuleConditionFieldSchema,
  /** `in`: the ticket's value is one of `values`; `not_in`: it is none of them. */
  operator: z.enum(['in', 'not_in']),
  values: z.array(itsmRefSchema).min(1),
})

const itsmRuleConditionBranchSchema = z.object({
  id: nodeIdSchema,
  label: z.string(),
  /** OR across `any`; AND across each group's `all`. */
  when: z.object({
    any: z.array(z.object({ all: z.array(itsmRuleConditionRowSchema).min(1) })).min(1),
  }),
  next: nextNodeSchema,
})

const itsmRuleConditionNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('condition'),
  label: z.string(),
  /** Evaluated in order; the first matching branch wins. */
  branches: z.array(itsmRuleConditionBranchSchema).min(1),
  elseNext: nextNodeSchema,
})

/**
 * One approver entry: approved when any one of `anyOf` approves. A bin
 * approves when any one of its members does.
 */
const itsmRuleApproverSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('users'), anyOf: z.array(itsmRefSchema).min(1) }),
  z.object({
    kind: z.literal('bins'),
    anyOf: z
      .array(
        itsmRefSchema.extend({
          /** The bin's department, or null when ITSM listed the bin without one. */
          department: itsmRefSchema.nullable(),
        })
      )
      .min(1),
  }),
])

/**
 * A timed step: when the ticket has waited `after` `unit` here without moving
 * on, ITSM escalates it to `level` and `users` (if any) and continues to `next`.
 */
const itsmRuleEscalationNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('escalation'),
  label: z.string(),
  /** The escalation level (L1, L2, ...); ITSM identifies a level by its name. */
  level: itsmRefSchema,
  after: z.number().positive(),
  unit: z.enum(['minutes', 'hours', 'days']),
  /** Users the ticket is escalated to. May be empty. */
  users: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  next: nextNodeSchema,
})

const itsmRuleApprovalNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('approval'),
  label: z.string(),
  /**
   * Approved when any group in `any` is approved; a group is approved when
   * every entry in its `all` is. The order of Approval nodes along the rule
   * is the order of approval levels.
   */
  approvers: z.object({
    any: z.array(z.object({ all: z.array(itsmRuleApproverSchema).min(1) })).min(1),
  }),
  /** Where an approved ticket goes. Rejection is handled by ITSM. */
  next: nextNodeSchema,
})

const itsmRuleAssigneeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    id: z.string().min(1),
    name: z.string(),
    /** The user list the user was picked from: creators, resolvers, or both. */
    userType: z.enum(['creator', 'resolver', 'both']),
  }),
  z.object({
    kind: z.literal('bin'),
    id: z.string().min(1),
    name: z.string(),
    /** The bin's department, or null when ITSM listed the bin without one. */
    department: itsmRefSchema.nullable(),
    /**
     * How the bin distributes the ticket: Bin Owner, Round Robin, or Roster.
     * `null` leaves it to the bin's own configuration in ITSM.
     */
    assignmentRule: itsmRefSchema.nullable(),
  }),
  z.object({ kind: z.literal('category'), id: z.string().min(1), name: z.string() }),
  z.object({
    kind: z.literal('subcategory'),
    id: z.string().min(1),
    name: z.string(),
    category: itsmRefSchema,
  }),
])

const itsmRuleAssignNodeSchema = z.object({
  id: nodeIdSchema,
  type: z.literal('assign'),
  label: z.string(),
  /**
   * Groups in `any` are alternatives (OR); the assignees in a group's `all`
   * apply together (AND). ITSM decides how to act on each combination.
   */
  assignees: z.object({
    any: z.array(z.object({ all: z.array(itsmRuleAssigneeSchema).min(1) })).min(1),
  }),
  next: nextNodeSchema,
})

export const itsmRuleNodeSchema = z.discriminatedUnion('type', [
  itsmRuleConditionNodeSchema,
  itsmRuleApprovalNodeSchema,
  itsmRuleEscalationNodeSchema,
  itsmRuleAssignNodeSchema,
])

export const itsmRuleSchema = z.object({
  /** The Sim workflow id, which ITSM maps to the process this rule governs. */
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  /** `null` with no nodes: the process continues without any rule. */
  startNodeId: nextNodeSchema,
  nodes: z.array(itsmRuleNodeSchema),
})

export const itsmRuleSavedEventSchema = z.object({
  event: z.literal('itsm.rule.saved'),
  schemaVersion: z.literal(ITSM_RULE_SCHEMA_VERSION),
  savedAt: z.string(),
  source: z.object({
    /** The ITSM customer id the workspace's organization is linked to. */
    customerId: z.string().nullable(),
    workspaceId: z.string(),
    workflowId: z.string(),
    savedBySimUserId: z.string(),
  }),
  rule: itsmRuleSchema,
})

const itsmRuleIssueSchema = z.object({
  blockId: z.string().nullable(),
  blockName: z.string().nullable(),
  message: z.string(),
})

const publishItsmRuleResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('published'),
    event: itsmRuleSavedEventSchema,
    warnings: z.array(itsmRuleIssueSchema),
  }),
  z.object({
    status: z.literal('invalid'),
    errors: z.array(itsmRuleIssueSchema).min(1),
    warnings: z.array(itsmRuleIssueSchema),
  }),
])

export const publishItsmRuleContract = defineRouteContract({
  method: 'POST',
  path: '/api/itsm/workflows/[id]/publish',
  params: workflowIdParamsSchema,
  response: { mode: 'json', schema: publishItsmRuleResponseSchema },
})

export type ItsmRule = z.output<typeof itsmRuleSchema>
export type ItsmRuleNode = z.output<typeof itsmRuleNodeSchema>
export type ItsmRuleConditionNode = z.output<typeof itsmRuleConditionNodeSchema>
export type ItsmRuleApprovalNode = z.output<typeof itsmRuleApprovalNodeSchema>
export type ItsmRuleEscalationNode = z.output<typeof itsmRuleEscalationNodeSchema>
export type ItsmRuleAssignNode = z.output<typeof itsmRuleAssignNodeSchema>
export type ItsmRuleApprover = z.output<typeof itsmRuleApproverSchema>
export type ItsmRuleAssignee = z.output<typeof itsmRuleAssigneeSchema>
export type ItsmRuleConditionRow = z.output<typeof itsmRuleConditionRowSchema>
export type ItsmRuleRef = z.output<typeof itsmRefSchema>
export type ItsmRuleSavedEvent = z.output<typeof itsmRuleSavedEventSchema>
export type ItsmRuleIssue = z.output<typeof itsmRuleIssueSchema>
export type PublishItsmRuleResponse = z.output<typeof publishItsmRuleResponseSchema>
