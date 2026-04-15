import type { Preview } from '@storybook/react'
import { withThemeByDataAttribute } from '@storybook/addon-themes'

import './storybook.css'
import '../src/themes/tokens.css'

const preview: Preview = {
  decorators: [
    withThemeByDataAttribute({
      themes: {
        Amber: 'amber',
        Obsidian: 'obsidian',
        Sage: 'sage',
        Slate: 'slate',
      },
      defaultTheme: 'obsidian',
      attributeName: 'data-theme',
    }),
  ],
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true },
  },
}

export default preview
