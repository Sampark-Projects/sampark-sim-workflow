/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SidebarVersion } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-version/sidebar-version'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SidebarVersion', () => {
  it('shows the release version', () => {
    act(() => root.render(<SidebarVersion />))

    expect(container).toHaveTextContent('v1.0.0')
  })

  it('renders the label outside a span so the collapsed rail keeps it visible', () => {
    act(() => root.render(<SidebarVersion />))

    expect(container.querySelector('span')).toBeNull()
    expect(container.querySelector('p')).toHaveTextContent('v1.0.0')
  })
})
