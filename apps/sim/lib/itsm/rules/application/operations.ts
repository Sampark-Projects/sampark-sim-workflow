import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const itsmRuleOperations = {
  // permission-group-exempt: publishing sends a workflow's own rule to the ITSM tenant it belongs to; the workspace write role that edits the workflow governs it
  publish: defineWorkspaceOperation({
    id: 'itsm_rules.publish',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
}
