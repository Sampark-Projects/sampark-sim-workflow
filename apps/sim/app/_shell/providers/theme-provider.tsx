'use client'

import type { ThemeProviderProps } from 'next-themes'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * Sim renders the light token layer everywhere. `forcedTheme` pins it on `<html>`
 * regardless of any stored `sim-theme`/`sim-landing-theme` value, the account's
 * synced theme setting, or the OS preference, so a visitor who previously chose
 * dark — or whose settings sync writes `dark` or `system` — still sees light.
 * `enableSystem` is off so the OS preference is never consulted.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute='class'
      defaultTheme='light'
      enableSystem={false}
      forcedTheme='light'
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
