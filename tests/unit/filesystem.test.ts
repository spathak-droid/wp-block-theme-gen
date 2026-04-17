import { describe, it, expect } from 'vitest'
import { defaultStyleProfile, themeMetaSchema } from '@/lib/style/profile'
import { assembleTheme } from '@/lib/theme/filesystem'

function makeMeta() {
  return themeMetaSchema.parse({
    name: 'Aurora',
    slug: 'aurora',
    description: 'A minimalist editorial theme.',
    author: 'Test Author',
  })
}

function minimalInput() {
  return {
    meta: makeMeta(),
    profile: defaultStyleProfile(),
    templates: [{ slug: 'index', content: '<!-- wp:site-title /-->' }],
    parts: [{ slug: 'header', content: '<!-- wp:site-title /-->' }],
    patterns: [
      {
        slug: 'hero-centered',
        title: 'Hero (Centered)',
        categories: ['hero'],
        content: '<!-- wp:heading --><h2 class="wp-block-heading">Hi</h2><!-- /wp:heading -->',
      },
    ],
    patternCategories: [
      { slug: 'hero', label: 'Hero' },
      { slug: 'cta', label: 'Call to Action' },
    ],
  }
}

describe('theme/filesystem: assembleTheme', () => {
  it('produces the minimum required file set', () => {
    const { files } = assembleTheme(minimalInput())
    const paths = [...files.keys()].sort()
    expect(paths).toContain('style.css')
    expect(paths).toContain('theme.json')
    expect(paths).toContain('functions.php')
    expect(paths).toContain('templates/index.html')
    expect(paths).toContain('parts/header.html')
    expect(paths).toContain('patterns/hero-centered.php')
    expect(paths).toContain('screenshot.svg')
  })

  it('style.css contains the required WordPress header fields', () => {
    const { files } = assembleTheme(minimalInput())
    const css = files.get('style.css')!
    for (const key of [
      'Theme Name:',
      'Author:',
      'Description:',
      'Version:',
      'Requires at least:',
      'Tested up to:',
      'Requires PHP:',
      'License:',
      'License URI:',
      'Text Domain:',
    ]) {
      expect(css).toContain(key)
    }
  })

  it('theme.json is valid JSON and has version 3', () => {
    const { files } = assembleTheme(minimalInput())
    const doc = JSON.parse(files.get('theme.json')!)
    expect(doc.version).toBe(3)
    expect(doc.$schema).toMatch(/schemas\.wp\.org/)
  })

  it('functions.php registers the expected pattern categories', () => {
    const { files } = assembleTheme(minimalInput())
    const php = files.get('functions.php')!
    expect(php).toContain(`register_block_pattern_category( 'aurora/hero'`)
    expect(php).toContain(`register_block_pattern_category( 'aurora/cta'`)
  })

  it('pattern .php has a valid header comment with namespaced slug + categories', () => {
    const { files } = assembleTheme(minimalInput())
    const php = files.get('patterns/hero-centered.php')!
    expect(php).toContain('Title: Hero (Centered)')
    expect(php).toContain('Slug: aurora/hero-centered')
    expect(php).toContain('Categories: aurora/hero')
  })

  it('drops unregistered categories from pattern files and warns', () => {
    const input = minimalInput()
    input.patterns[0]!.categories = ['hero', 'unregistered-xyz']
    const { files, warnings } = assembleTheme(input)
    const php = files.get('patterns/hero-centered.php')!
    expect(php).toContain('Categories: aurora/hero')
    expect(php).not.toContain('unregistered-xyz')
    expect(warnings.some((w) => w.includes('unregistered-xyz'))).toBe(true)
  })

  it('throws if templates/index.html is missing', () => {
    const input = minimalInput()
    input.templates = [{ slug: 'single', content: '<!-- wp:post-title /-->' }]
    expect(() => assembleTheme(input)).toThrow(/index\.html is required/)
  })

  it('sanitizes template slugs (lowercase + hyphens)', () => {
    const input = minimalInput()
    input.templates.push({ slug: 'Archive Post', content: '<!-- wp:post-title /-->' })
    const { files } = assembleTheme(input)
    expect(files.has('templates/archive-post.html')).toBe(true)
  })
})
