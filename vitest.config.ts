import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/smoke/**', 'tests/e2e/**', 'node_modules/**'],
    globals: false,
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['**/*.test.ts', '**/*.config.*', 'node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
