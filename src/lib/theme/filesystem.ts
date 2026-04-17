import { buildFunctionsPhp, buildPlaceholderScreenshot, buildStyleCss } from '@/lib/style/css'
import { buildThemeJson, validateThemeJson } from '@/lib/style/themeJson'
import type { StyleProfile, ThemeMeta } from '@/lib/style/profile'

/**
 * A generated theme is represented as an in-memory `Map<path, content>`
 * keyed by POSIX path relative to the theme root. The actual on-disk
 * write (or ZIP pack) happens downstream in Phase 7.
 *
 * Why a Map rather than a nested object? Preserves insertion order, cheap
 * lookup by path, trivial to enumerate during packaging, and survives
 * being stringified for session snapshots.
 */
export type ThemeFileMap = Map<string, string>

export type TemplateFile = {
  /** Slug without `.html` (e.g. `index`, `single`, `archive`, `404`). */
  slug: string
  /** Full WordPress block markup (starts with `<!-- wp:... -->`). */
  content: string
}

export type PartFile = {
  /** Slug without `.html` (e.g. `header`, `footer`). */
  slug: string
  /** Full WordPress block markup. */
  content: string
}

export type PatternFile = {
  /** Slug without `.php` and without the theme-slug prefix. */
  slug: string
  /** Human-readable title used in the inserter. */
  title: string
  /** Category slugs (without the theme-slug prefix) — must match functionsPhp registrations. */
  categories: string[]
  /** Full WordPress block markup (body of the PHP file). */
  content: string
  /** Optional viewportWidth for preview sizing. */
  viewportWidth?: number
}

export type PatternCategory = { slug: string; label: string }

export type AssembleThemeInput = {
  meta: ThemeMeta
  profile: StyleProfile
  templates: TemplateFile[]
  parts: PartFile[]
  patterns: PatternFile[]
  /** Categories registered in functions.php. Pattern files reference these. */
  patternCategories: PatternCategory[]
}

export type AssembleThemeResult = {
  files: ThemeFileMap
  warnings: string[]
}

/**
 * Assemble a complete theme directory in memory. The returned Map is
 * ready to be serialized to disk (Phase 7) or packed into a ZIP for
 * download.
 *
 * Invariants enforced here:
 * - templates/index.html is required (WordPress won't classify the theme
 *   as a block theme without it)
 * - theme.json validates against the bundled WordPress v3 schema
 * - pattern files reference only registered pattern categories
 * - every `core/template-part` referenced in templates has a matching
 *   file in parts/ (this check is the caller's responsibility — see
 *   Phase 1 lint rule `template-part-slug`)
 */
export function assembleTheme(input: AssembleThemeInput): AssembleThemeResult {
  const { meta, profile, templates, parts, patterns, patternCategories } = input
  const files: ThemeFileMap = new Map()
  const warnings: string[] = []

  if (!templates.some((t) => t.slug === 'index')) {
    throw new Error(
      'assembleTheme: templates/index.html is required — without it the theme is not recognized as a block theme',
    )
  }

  // ---------- style.css ----------
  files.set('style.css', buildStyleCss(meta))

  // ---------- theme.json ----------
  const themeJson = buildThemeJson(profile)
  const validation = validateThemeJson(themeJson)
  if (!validation.valid) {
    throw new Error(
      `assembleTheme: generated theme.json failed AJV validation:\n  - ${validation.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join('\n  - ')}`,
    )
  }
  files.set('theme.json', JSON.stringify(themeJson, null, '\t') + '\n')

  // ---------- functions.php ----------
  files.set('functions.php', buildFunctionsPhp(meta, patternCategories))

  // ---------- templates/*.html ----------
  for (const t of templates) {
    const slug = sanitizeSlug(t.slug)
    if (!slug) {
      warnings.push(`template with empty slug skipped`)
      continue
    }
    files.set(`templates/${slug}.html`, t.content.endsWith('\n') ? t.content : t.content + '\n')
  }

  // ---------- parts/*.html ----------
  for (const p of parts) {
    const slug = sanitizeSlug(p.slug)
    if (!slug) {
      warnings.push(`part with empty slug skipped`)
      continue
    }
    files.set(`parts/${slug}.html`, p.content.endsWith('\n') ? p.content : p.content + '\n')
  }

  // ---------- patterns/*.php ----------
  const registeredCategorySlugs = new Set(patternCategories.map((c) => c.slug))
  for (const p of patterns) {
    const slug = sanitizeSlug(p.slug)
    if (!slug) {
      warnings.push(`pattern with empty slug skipped`)
      continue
    }
    const validCats = p.categories.filter((c) => {
      if (registeredCategorySlugs.has(c)) return true
      warnings.push(
        `pattern "${slug}" references unregistered category "${c}" — dropping from Categories header`,
      )
      return false
    })
    files.set(
      `patterns/${slug}.php`,
      buildPatternPhp(meta.slug, slug, p.title, validCats, p.content, p.viewportWidth),
    )
  }

  // ---------- screenshot placeholder ----------
  // We emit SVG. Packaging (Phase 7) will rasterize to PNG; for direct
  // install, the SVG works for modern WP installs.
  const accent = profile.palette['accent-1']
  files.set('screenshot.svg', buildPlaceholderScreenshot(meta, accent))

  return { files, warnings }
}

/**
 * Build the PHP file contents for a pattern. The header comment is parsed
 * by WordPress to populate the Pattern Inserter entry. Body is the raw
 * block markup.
 */
function buildPatternPhp(
  themeSlug: string,
  patternSlug: string,
  title: string,
  categories: string[],
  markup: string,
  viewportWidth?: number,
): string {
  const namespacedSlug = `${themeSlug}/${patternSlug}`
  const namespacedCategories = categories.map((c) => `${themeSlug}/${c}`).join(', ')
  const header = [
    `<?php`,
    `/**`,
    ` * Title: ${title}`,
    ` * Slug: ${namespacedSlug}`,
    categories.length > 0 ? ` * Categories: ${namespacedCategories}` : '',
    viewportWidth ? ` * Viewport Width: ${viewportWidth}` : '',
    ` */`,
    `?>`,
  ]
    .filter(Boolean)
    .join('\n')
  return `${header}\n${markup}${markup.endsWith('\n') ? '' : '\n'}`
}

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
