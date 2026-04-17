import { serialize } from '@/lib/ir/serialize'
import type { IRStream } from '@/lib/ir/schema'
import { defaultStyleProfile, themeMetaSchema } from '@/lib/style/profile'
import { assembleTheme, type AssembleThemeInput } from '@/lib/theme/filesystem'

/**
 * Produce a complete fixture theme that exercises the full pipeline:
 * taxonomy → IR → serialize → theme.json → assembleTheme. This is the
 * artifact we hand to the WordPress Playground smoke test.
 *
 * Intentionally exercises a wide range of block types so the smoke test
 * doubles as a coverage check: headings, groups, buttons, navigation,
 * Query Loop, post bindings, template parts, site bindings.
 */
export function buildFixtureTheme(): AssembleThemeInput {
  const meta = themeMetaSchema.parse({
    name: 'Aurora Smoke',
    slug: 'aurora-smoke',
    description: 'Smoke test fixture for the Block Theme Generator pipeline.',
    author: 'WP Block Theme Gen',
  })

  const profile = defaultStyleProfile()

  // ---------- parts ----------
  const headerIR: IRStream = [
    {
      kind: 'open',
      block: 'core/group',
      attrs: { tagName: 'header', layout: { type: 'flex', justifyContent: 'space-between' } },
    },
    { kind: 'void', block: 'core/site-title', attrs: { level: 1, isLink: true } },
    { kind: 'open', block: 'core/navigation', attrs: { overlayMenu: 'mobile' } },
    { kind: 'void', block: 'core/navigation-link', attrs: { label: 'Home', url: '/' } },
    { kind: 'void', block: 'core/navigation-link', attrs: { label: 'About', url: '/about' } },
    { kind: 'close' },
    { kind: 'close' },
  ]
  const footerIR: IRStream = [
    {
      kind: 'open',
      block: 'core/group',
      attrs: { tagName: 'footer', layout: { type: 'constrained' } },
    },
    { kind: 'open', block: 'core/paragraph', attrs: { align: 'center' } },
    { kind: 'text', content: '© 2026 Aurora Smoke. Built with core blocks.' },
    { kind: 'close' },
    { kind: 'close' },
  ]

  // ---------- templates ----------
  const indexIR: IRStream = [
    { kind: 'void', block: 'core/template-part', attrs: { slug: 'header', area: 'header' } },
    {
      kind: 'open',
      block: 'core/group',
      attrs: { tagName: 'main', layout: { type: 'constrained' } },
    },
    { kind: 'open', block: 'core/heading', attrs: { level: 1, textAlign: 'center' } },
    { kind: 'text', content: 'Welcome to Aurora Smoke' },
    { kind: 'close' },
    { kind: 'open', block: 'core/paragraph', attrs: { align: 'center' } },
    {
      kind: 'text',
      content: 'A minimal block theme composed entirely of core blocks. No core/html anywhere.',
    },
    { kind: 'close' },
    {
      kind: 'open',
      block: 'core/query',
      attrs: {
        query: { perPage: 5, postType: 'post', inherit: true, order: 'desc', orderBy: 'date' },
      },
    },
    { kind: 'open', block: 'core/post-template' },
    { kind: 'void', block: 'core/post-title', attrs: { isLink: true, level: 2 } },
    { kind: 'void', block: 'core/post-date', attrs: { format: 'F j, Y' } },
    { kind: 'void', block: 'core/post-excerpt' },
    { kind: 'close' },
    { kind: 'open', block: 'core/query-pagination' },
    { kind: 'void', block: 'core/query-pagination-previous' },
    { kind: 'void', block: 'core/query-pagination-numbers' },
    { kind: 'void', block: 'core/query-pagination-next' },
    { kind: 'close' },
    { kind: 'close' },
    { kind: 'close' },
    { kind: 'void', block: 'core/template-part', attrs: { slug: 'footer', area: 'footer' } },
  ]

  const singleIR: IRStream = [
    { kind: 'void', block: 'core/template-part', attrs: { slug: 'header', area: 'header' } },
    {
      kind: 'open',
      block: 'core/group',
      attrs: { tagName: 'main', layout: { type: 'constrained' } },
    },
    { kind: 'void', block: 'core/post-title', attrs: { level: 1 } },
    { kind: 'void', block: 'core/post-date' },
    {
      kind: 'open',
      block: 'core/post-content',
      attrs: { layout: { type: 'constrained' } },
    },
    { kind: 'close' },
    { kind: 'close' },
    { kind: 'void', block: 'core/template-part', attrs: { slug: 'footer', area: 'footer' } },
  ]

  const notFoundIR: IRStream = [
    { kind: 'void', block: 'core/template-part', attrs: { slug: 'header', area: 'header' } },
    {
      kind: 'open',
      block: 'core/group',
      attrs: { tagName: 'main', layout: { type: 'constrained' } },
    },
    { kind: 'open', block: 'core/heading', attrs: { level: 1, textAlign: 'center' } },
    { kind: 'text', content: 'Not Found' },
    { kind: 'close' },
    { kind: 'close' },
    { kind: 'void', block: 'core/template-part', attrs: { slug: 'footer', area: 'footer' } },
  ]

  // ---------- patterns ----------
  const heroPatternIR: IRStream = [
    {
      kind: 'open',
      block: 'core/group',
      attrs: {
        align: 'full',
        className: 'is-style-section-3',
        layout: { type: 'constrained' },
      },
    },
    { kind: 'open', block: 'core/heading', attrs: { level: 2, textAlign: 'center' } },
    { kind: 'text', content: 'Built without core/html' },
    { kind: 'close' },
    { kind: 'open', block: 'core/paragraph', attrs: { align: 'center' } },
    { kind: 'text', content: 'Every block in this theme is a standard core block.' },
    { kind: 'close' },
    {
      kind: 'open',
      block: 'core/buttons',
      attrs: { layout: { type: 'flex', justifyContent: 'center' } },
    },
    { kind: 'open', block: 'core/button' },
    { kind: 'text', content: 'Learn more' },
    { kind: 'close' },
    { kind: 'close' },
    { kind: 'close' },
  ]

  return {
    meta,
    profile,
    templates: [
      { slug: 'index', content: serialize(indexIR) },
      { slug: 'single', content: serialize(singleIR) },
      { slug: '404', content: serialize(notFoundIR) },
    ],
    parts: [
      { slug: 'header', content: serialize(headerIR) },
      { slug: 'footer', content: serialize(footerIR) },
    ],
    patterns: [
      {
        slug: 'hero-centered',
        title: 'Hero (Centered)',
        categories: ['hero'],
        content: serialize(heroPatternIR),
      },
    ],
    patternCategories: [
      { slug: 'hero', label: 'Hero' },
      { slug: 'cta', label: 'Call to Action' },
      { slug: 'footer', label: 'Footer' },
    ],
  }
}

/**
 * Write a ThemeFileMap to a directory on disk (recursively creating any
 * needed subdirs). Returns the absolute path of the directory.
 */
export async function writeThemeToDisk(files: Map<string, string>, baseDir: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const path = await import('node:path')
  for (const [rel, content] of files) {
    const full = path.join(baseDir, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content, 'utf8')
  }
}

export function makeFixtureTheme() {
  const input = buildFixtureTheme()
  const { files, warnings } = assembleTheme(input)
  return { input, files, warnings }
}
