'use client'

import type { ComponentProps } from 'react'
import type { Workspace } from '@/lib/api/contracts/workspaces'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'

interface WorkspaceContextMenuProps
  extends Omit<
    ComponentProps<typeof ContextMenu>,
    | 'onRename'
    | 'renameInputRef'
    | 'onDelete'
    | 'disableRename'
    | 'disableDelete'
    | 'disableUploadLogo'
    | 'showLeave'
    | 'showUploadLogo'
    | 'showPin'
    | 'showRename'
    | 'showDelete'
  > {
  workspace?: Workspace | null
  sessionUserId?: string
}

/**
 * Uses the same workspace role policy in the switcher and organization sidebar.
 * Workspaces are provisioned and named by ITSM, so they cannot be renamed or
 * deleted from Sim.
 */
export function WorkspaceContextMenu({
  workspace,
  sessionUserId,
  ...props
}: WorkspaceContextMenuProps) {
  const canAdmin = workspace?.permissions === 'admin'
  const canLeave = Boolean(
    workspace && sessionUserId && sessionUserId !== workspace.ownerId && !workspace.isOrgAdmin
  )

  return (
    <ContextMenu
      {...props}
      showPin
      showRename={false}
      showDelete={false}
      showUploadLogo={Boolean(props.onUploadLogo)}
      showLeave={canLeave && Boolean(props.onLeave)}
      disableUploadLogo={!canAdmin}
    />
  )
}
