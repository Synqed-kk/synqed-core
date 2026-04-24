import { defineConfig } from 'vitest/config'
import path from 'path'

process.env.NODE_ENV = 'test'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run test files serially to prevent shared test-DB state from
    // causing cross-file interference (all tests share TEST_TENANT_ID).
    fileParallelism: false,
    exclude: ['**/node_modules/**', '**/.worktrees/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
