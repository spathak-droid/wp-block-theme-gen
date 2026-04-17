/**
 * End-to-end smoke test: build a fixture block theme via our full
 * pipeline (taxonomy → IR → serialize → assembleTheme), mount it into a
 * WordPress Playground WASM runtime, activate it, fetch the homepage,
 * and assert no PHP fatal / notice / wp-die marker appears.
 *
 * This is the "does our generated theme actually boot in WordPress?"
 * oracle. It's slow (Playground cold-boot ~30-60s) and runs in a
 * separate CI job — not on every commit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCLI } from '@wp-playground/cli'
import { makeFixtureTheme, writeThemeToDisk } from './fixture'

// `runCLI` has overloads; narrow to the 'server' variant for correct typing.
type ServerResult = Extract<Awaited<ReturnType<typeof runCLI>>, { serverUrl: string }>

// Cold-boot of Playground + WordPress install can take a while on cold CI.
const SMOKE_TIMEOUT_MS = 180_000

describe('smoke/playground: fixture theme activates and renders', () => {
  let server: ServerResult
  let themeDir: string

  beforeAll(async () => {
    const { input, files, warnings } = makeFixtureTheme()
    expect(warnings).toEqual([]) // fixture must not emit warnings

    themeDir = await mkdtemp(join(tmpdir(), 'wp-smoke-theme-'))
    await writeThemeToDisk(files, themeDir)

    server = (await runCLI({
      command: 'server',
      port: 0, // pick a free port
      skipBrowser: true,
      quiet: true,
      mount: [
        {
          hostPath: themeDir,
          vfsPath: `/wordpress/wp-content/themes/${input.meta.slug}`,
        },
      ],
      blueprint: {
        landingPage: '/',
        steps: [
          {
            step: 'activateTheme',
            themeFolderName: input.meta.slug,
          },
        ],
      },
    })) as ServerResult
  }, SMOKE_TIMEOUT_MS)

  afterAll(async () => {
    if (server?.[Symbol.asyncDispose]) {
      await server[Symbol.asyncDispose]()
    }
    if (themeDir) {
      await rm(themeDir, { recursive: true, force: true })
    }
  }, 30_000)

  it(
    'serverUrl is reachable',
    async () => {
      expect(server).toBeDefined()
      expect(server.serverUrl).toMatch(/^https?:\/\//)
    },
    SMOKE_TIMEOUT_MS,
  )

  it(
    'homepage renders without PHP fatal or wp-die',
    async () => {
      const res = await fetch(server.serverUrl + '/')
      expect(res.ok).toBe(true)
      const body = await res.text()

      // Positive signal: WordPress actually rendered something.
      expect(body.length).toBeGreaterThan(100)

      // Negative signals — any of these means the theme broke.
      const forbidden = [
        /Fatal error/i,
        /Parse error/i,
        /wp-die/i,
        /There has been a critical error on this website/i,
        /Uncaught .*Exception/i,
      ]
      for (const pattern of forbidden) {
        expect(body, `response contained forbidden marker: ${pattern}`).not.toMatch(pattern)
      }
    },
    SMOKE_TIMEOUT_MS,
  )

  it(
    'response HTML contains the fixture theme signature',
    async () => {
      const res = await fetch(server.serverUrl + '/')
      const body = await res.text()
      // The index template's <h1> text — proves template rendering worked.
      expect(body).toContain('Welcome to Aurora Smoke')
    },
    SMOKE_TIMEOUT_MS,
  )
})
