'use client'

import { useTheme } from '../provider/theme-provider.js'
import { themes, themeLabels, themeAccents } from '../themes/index.js'

interface ThemeSwitcherProps {
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
}

export function ThemeSwitcher({ position = 'bottom-right' }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme()

  const positionStyles: Record<string, React.CSSProperties> = {
    'bottom-right': { bottom: 20, right: 20 },
    'bottom-left': { bottom: 20, left: 20 },
    'top-right': { top: 20, right: 20 },
    'top-left': { top: 20, left: 20 },
  }

  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyles[position],
        zIndex: 9999,
        display: 'flex',
        gap: 6,
        padding: 6,
        borderRadius: 14,
        background: 'var(--color-chrome)',
        border: '1px solid var(--color-chrome-border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}
    >
      {themes.map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          title={themeLabels[t]}
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: themeAccents[t],
            border: theme === t ? '2px solid #fff' : '2px solid transparent',
            cursor: 'pointer',
            transition: 'border-color 0.15s',
            opacity: theme === t ? 1 : 0.5,
          }}
        />
      ))}
    </div>
  )
}
