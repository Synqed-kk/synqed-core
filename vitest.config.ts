import { defineConfig } from 'vitest/config'
import path from 'path'

process.env.NODE_ENV = 'test'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    exclude: ['**/node_modules/**', '**/.worktrees/**'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
