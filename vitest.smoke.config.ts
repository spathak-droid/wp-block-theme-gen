import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Smoke-test config. Separated from the main vitest config because
 * Playground cold-boot is slow (~60s on CI) and we don't want it gating
 * every PR — this runs in its own CI job + on-demand locally.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/smoke/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    globals: false,
    // Serial — only one Playground WASM at a time.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
