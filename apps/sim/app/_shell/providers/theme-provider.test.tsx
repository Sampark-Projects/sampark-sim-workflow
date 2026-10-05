/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncThemeToNextThemes } from '@/lib/core/utils/theme'
import { ThemeProvider } from '@/app/_shell/providers/theme-provider'

let root: Root
let host: HTMLDivElement

/** A dark OS, so `system` would resolve to dark if the provider consulted it. */
function stubDarkOs() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
}

function render() {
  act(() => root.render(<ThemeProvider>child</ThemeProvider>))
  return document.documentElement.classList
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  /** The global storage mock is not a native jsdom Storage instance. */
  vi.stubGlobal(
    'StorageEvent',
    class extends window.StorageEvent {
      constructor(type: string, init: StorageEventInit) {
        super(type, { ...init, storageArea: null })
      }
    }
  )
  stubDarkOs()
  localStorage.clear()
  document.documentElement.className = ''
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('ThemeProvider', () => {
  it('renders light with nothing stored on a dark OS', () => {
    const classes = render()

    expect(classes).toContain('light')
    expect(classes).not.toContain('dark')
  })

  it.each(['sim-theme', 'sim-landing-theme'])('ignores a stored dark theme in %s', (key) => {
    localStorage.setItem(key, 'dark')
    const classes = render()

    expect(classes).toContain('light')
    expect(classes).not.toContain('dark')
  })

  it.each(['dark', 'system'] as const)('stays light when account settings sync %s', (theme) => {
    const classes = render()

    act(() => syncThemeToNextThemes(theme))

    expect(classes).toContain('light')
    expect(classes).not.toContain('dark')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
