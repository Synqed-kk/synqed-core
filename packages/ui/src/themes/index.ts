export const themes = ['amber', 'obsidian', 'sage', 'slate'] as const

export type ThemeName = (typeof themes)[number]

export const themeLabels: Record<ThemeName, string> = {
  amber: 'Amber',
  obsidian: 'Obsidian',
  sage: 'Sage',
  slate: 'Slate',
}

export const themeAccents: Record<ThemeName, string> = {
  amber: '#c8873e',
  obsidian: '#f97316',
  sage: '#5a7a5a',
  slate: '#6366f1',
}
