/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { SearchModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/search-modal'

const { mockPush, mockSearchState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSearchState: {
    data: {
      blocks: [] as unknown[],
      tools: [] as unknown[],
      triggers: [] as unknown[],
      toolOperations: [] as unknown[],
      isInitialized: true,
    },
  },
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1', workflowId: 'workflow-1' }),
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({}),
}))

vi.mock('@/lib/posthog/client', () => ({
  captureEvent: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/global-commands-provider', () => ({
  useInvokeGlobalCommand: () => vi.fn(),
}))

vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  hasTriggerCapability: () => false,
}))

vi.mock('@/stores/modals/search/store', () => ({
  useSearchModalStore: Object.assign(
    (selector: (state: typeof mockSearchState) => unknown) => selector(mockSearchState),
    { getState: () => mockSearchState }
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/sidebar', () => ({
  SIDEBAR_SCROLL_EVENT: 'sidebar-scroll-to-item',
}))

vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    config: {
      hideIntegrationsTab: false,
      hideTablesTab: false,
      hideFilesTab: false,
      hideKnowledgeBaseTab: false,
    },
  }),
}))

/**
 * The palette owns these reads now — it mounts only while open, so the queries exist only then.
 * `mockTables` lets a test drive the Tables section the way the `tables` prop used to.
 */
const mockTables = vi.hoisted(() => ({ current: [] as unknown[] }))

vi.mock('@/hooks/queries/tables', () => ({
  useTablesList: () => ({ data: mockTables.current }),
}))
vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFiles: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useKnowledgeBasesQuery: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/folders', () => ({
  useFolderMap: () => ({ data: {} }),
}))

vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ navigateToSettings: vi.fn() }),
}))

async function enterSearchQuery(query: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
  if (!input) throw new Error('Search input not found')

  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SearchModal', () => {
  let container: HTMLDivElement
  let root: Root
  let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    mockPush.mockClear()
    window.history.replaceState({}, '', '/workspace/workspace-1/w/workflow-1')
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('[role="dialog"]').forEach((dialog) => dialog.remove())
    if (originalScrollIntoView) {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
    vi.unstubAllGlobals()
  })

  it('shows an empty state when search has no results', async () => {
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} />)
    })

    await enterSearchQuery('explain quantum rainbows')

    expect(document.querySelectorAll('[cmdk-item]')).toHaveLength(0)
    expect(document.querySelector('[cmdk-empty]')?.textContent).toBe('No results found.')
  })

  it('browses every section uncapped', async () => {
    const Icon = () => null
    const workflows = Array.from({ length: 10 }, (_, index) => ({
      id: `workflow-${index}`,
      name: `Zeta ${index}`,
      href: `/workspace/workspace-1/w/workflow-${index}`,
    }))
    const integrations = Array.from({ length: 30 }, (_, index) => ({
      id: `catalog-${index}`,
      name: `Acme ${index}`,
      href: `/workspace/workspace-1/integrations/catalog-${index}`,
      icon: Icon,
      bgColor: '#111',
    }))

    await act(async () => {
      root.render(
        <SearchModal
          open
          onOpenChange={vi.fn()}
          integrations={integrations}
          workflows={workflows}
        />
      )
    })

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
      (el) => el.textContent ?? ''
    )
    expect(rows.filter((row) => /Zeta \d/.test(row))).toHaveLength(10)
    expect(rows.filter((row) => /Acme \d/.test(row))).toHaveLength(30)
  })

  it('offers only the ITSM rule blocks and the workflow link on the canvas', async () => {
    const Icon = () => null
    const block = (type: string, name: string) => ({
      id: type,
      name,
      icon: Icon,
      bgColor: '#111',
      type,
    })
    const original = { ...mockSearchState.data }
    mockSearchState.data = {
      ...mockSearchState.data,
      blocks: [
        block('agent', 'Agent'),
        block('itsm_assign', 'Assign'),
        block('itsm_start', 'Start'),
        block('itsm_condition', 'Condition'),
        block('itsm_escalation', 'Escalation'),
        block('itsm_approval', 'Approval'),
      ],
      triggers: [block('schedule', 'Schedule')],
      tools: [block('slack', 'Slack')],
    }

    try {
      await act(async () => {
        root.render(
          <SearchModal
            open
            onOpenChange={vi.fn()}
            pageContext='workflow'
            workflows={[
              {
                id: 'workflow-a',
                name: 'Alpha workflow',
                href: '/workspace/workspace-1/w/workflow-a',
              },
            ]}
          />
        )
      })

      const headings = Array.from(
        document.querySelectorAll<HTMLElement>('[cmdk-group-heading]')
      ).map((el) => el.textContent)
      expect(headings).toEqual(['Actions', 'Blocks', 'Workflows'])

      const groupRows = (heading: string) =>
        Array.from(
          [...document.querySelectorAll<HTMLElement>('[cmdk-group]')]
            .find((group) => group.querySelector('[cmdk-group-heading]')?.textContent === heading)
            ?.querySelectorAll('[cmdk-item]') ?? []
        ).map((row) => row.textContent)
      expect(groupRows('Actions')).toEqual(['Copy workflow link'])
      expect(groupRows('Blocks')).toEqual(['Condition', 'Approval', 'Escalation', 'Assign'])
      expect(document.body.textContent).not.toContain('Ask Sim')
    } finally {
      mockSearchState.data = original
    }
  })

  it('browses the integrations catalog from every page', async () => {
    const Icon = () => null
    const integrations = [
      { id: 'slack', name: 'Slack', href: '/integrations/slack', icon: Icon, bgColor: '#611f69' },
    ]
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} integrations={integrations} />)
    })

    const headings = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-group-heading]')).map(
      (el) => el.textContent
    )
    expect(headings).toContain('Integrations')

    await enterSearchQuery('slack')
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map(
      (el) => el.textContent
    )
    expect(rows.some((text) => text?.includes('Slack'))).toBe(true)
  })

  it('re-anchors selection to the first row on every open', async () => {
    const workflows = [
      { id: 'workflow-a', name: 'Alpha workflow', href: '/workspace/workspace-1/w/workflow-a' },
      { id: 'workflow-b', name: 'Beta workflow', href: '/workspace/workspace-1/w/workflow-b' },
    ]
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} workflows={workflows} />)
    })

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      )
    })
    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]'))
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('true')

    await act(async () => {
      root.render(<SearchModal open={false} onOpenChange={vi.fn()} workflows={workflows} />)
    })
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} workflows={workflows} />)
    })

    expect(rows()[0]?.getAttribute('aria-selected')).toBe('true')
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('false')
  })

  it('re-anchors selection to the first row after the re-ranked results commit', async () => {
    const workflows = [
      { id: 'workflow-1', name: 'Funnel', href: '/workspace/workspace-1/w/workflow-1' },
      { id: 'workflow-2', name: 'Funnel two', href: '/workspace/workspace-1/w/workflow-2' },
      { id: 'workflow-3', name: 'Function alpha', href: '/workspace/workspace-1/w/workflow-3' },
    ]
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} workflows={workflows} />)
    })

    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]'))

    await enterSearchQuery('fun')
    expect(rows()[0]?.textContent).toContain('Funnel')
    expect(rows()[0]?.getAttribute('aria-selected')).toBe('true')

    await enterSearchQuery('func')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]?.textContent).toContain('Function alpha')
    expect(rows()[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('unmounts while closed and reopens with a blank query', async () => {
    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} />)
    })
    await enterSearchQuery('previous search')

    await act(async () => {
      root.render(<SearchModal open={false} onOpenChange={vi.fn()} />)
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelectorAll('[cmdk-item]')).toHaveLength(0)

    await act(async () => {
      root.render(<SearchModal open onOpenChange={vi.fn()} />)
    })
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
    expect(input?.value).toBe('')
  })

  it('keeps the palette open when the query handoff cannot be persisted', async () => {
    const onOpenChange = vi.fn()
    const storeSpy = vi.spyOn(MothershipHandoffStorage, 'store').mockReturnValue(false)

    try {
      await act(async () => {
        root.render(<SearchModal open onOpenChange={onOpenChange} />)
      })
      await enterSearchQuery('draft a launch plan')
      act(() => {
        document
          .querySelector<HTMLInputElement>('input[aria-label="Search anything"]')
          ?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
          )
      })

      act(() => {
        document.querySelector<HTMLElement>('[cmdk-item]')?.click()
      })

      expect(onOpenChange).not.toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
    } finally {
      storeSpy.mockRestore()
    }
  })
})
