/**
 * @vitest-environment jsdom
 */
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceContextMenu } from '@/components/workspaces/workspace-context-menu'
import type { Workspace } from '@/lib/api/contracts/workspaces'

const workspace: Workspace = {
  id: 'workspace',
  name: 'Workspace',
  organizationId: 'org',
  workspaceMode: 'organization',
  ownerId: 'owner',
  permissions: 'admin',
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function menuItem(name: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent === name
  )
}

function showMenu(overrides: Partial<Workspace> = {}, sessionUserId = 'member') {
  act(() =>
    root.render(
      <WorkspaceContextMenu
        workspace={{ ...workspace, ...overrides }}
        sessionUserId={sessionUserId}
        isOpen
        position={{ x: 0, y: 0 }}
        menuRef={createRef<HTMLDivElement>()}
        onClose={vi.fn()}
        onTogglePin={vi.fn()}
        onLeave={vi.fn()}
        onUploadLogo={vi.fn()}
      />
    )
  )
}

describe('WorkspaceContextMenu', () => {
  it.each(['read', 'write'] as const)(
    'keeps personal pinning available for %s access but disables admin actions',
    (permissions) => {
      showMenu({ permissions })
      expect(menuItem('Pin')).not.toHaveAttribute('aria-disabled', 'true')
      expect(menuItem('Upload logo')).toHaveAttribute('aria-disabled', 'true')
    }
  )

  it('never offers renaming or deleting a workspace, even to an admin', () => {
    showMenu()
    expect(menuItem('Rename')).toBeUndefined()
    expect(menuItem('Delete')).toBeUndefined()
    expect(menuItem('Leave')).toBeDefined()
  })

  it('does not offer leaving access inherited from the organization role', () => {
    showMenu({ isOrgAdmin: true })
    expect(menuItem('Leave')).toBeUndefined()
  })

  it('does not offer leaving the owned workspace', () => {
    showMenu({}, 'owner')
    expect(menuItem('Leave')).toBeUndefined()
  })

  it('omits unavailable actions even when the viewer has admin permissions', () => {
    act(() =>
      root.render(
        <WorkspaceContextMenu
          workspace={workspace}
          sessionUserId='member'
          isOpen
          position={{ x: 0, y: 0 }}
          menuRef={createRef<HTMLDivElement>()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    )
    expect(menuItem('Upload logo')).toBeUndefined()
    expect(menuItem('Leave')).toBeUndefined()
  })
})
