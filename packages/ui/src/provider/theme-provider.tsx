'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { type ThemeName, themes } from '../themes/index.js'

interface ThemeContextValue {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: ThemeName
  storageKey?: string
}

export function ThemeProvider({
  children,
  defaultTheme = 'obsidian',
  storageKey = 'synqed-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeName>(defaultTheme)

  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored && themes.includes(stored as ThemeName)) {
      setThemeState(stored as ThemeName)
    }
  }, [storageKey])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = (next: ThemeName) => {
    setThemeState(next)
    localStorage.setItem(storageKey, next)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
