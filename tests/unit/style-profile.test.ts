import { describe, it, expect } from 'vitest'
import {
  defaultStyleProfile,
  isFluidScaleMonotonic,
  styleProfileSchema,
  themeMetaSchema,
} from '@/lib/style/profile'

describe('style/profile: StyleProfile', () => {
  it('defaultStyleProfile passes its own Zod schema', () => {
    const p = defaultStyleProfile()
    expect(() => styleProfileSchema.parse(p)).not.toThrow()
  })

  it('defaultStyleProfile has exactly 8 palette slugs, 5 font sizes, 7 spacing, 3 sections', () => {
    const p = defaultStyleProfile()
    expect(Object.keys(p.palette)).toHaveLength(8)
    expect(p.typography.fluidScale).toHaveLength(5)
    expect(p.spacing).toHaveLength(7)
    expect(p.sectionStyles).toHaveLength(3)
  })

  it('defaults have a monotonically increasing fluid type scale', () => {
    expect(isFluidScaleMonotonic(defaultStyleProfile().typography.fluidScale)).toBe(true)
  })

  it('detects non-monotonic fluid scales', () => {
    const p = defaultStyleProfile()
    const broken = [...p.typography.fluidScale]
    broken[2] = { ...broken[2]!, min: '0.5rem' } // smaller than predecessor
    expect(isFluidScaleMonotonic(broken)).toBe(false)
  })

  it('rejects section style names that do not match `section-N` pattern', () => {
    const p = defaultStyleProfile()
    const broken = { ...p, sectionStyles: [...p.sectionStyles] }
    broken.sectionStyles[0] = { ...broken.sectionStyles[0]!, name: 'hero-section' }
    expect(() => styleProfileSchema.parse(broken)).toThrow()
  })

  it('rejects hex color inside a preset variable field', () => {
    const p = defaultStyleProfile()
    const broken = { ...p, sectionStyles: [...p.sectionStyles] }
    broken.sectionStyles[0] = { ...broken.sectionStyles[0]!, background: '#FF5733' }
    expect(() => styleProfileSchema.parse(broken)).toThrow()
  })
})

describe('style/profile: ThemeMeta', () => {
  it('accepts a minimal valid theme meta with defaults', () => {
    const meta = themeMetaSchema.parse({
      name: 'Aurora',
      slug: 'aurora',
      description: 'A minimalist editorial theme.',
    })
    expect(meta.version).toBe('0.1.0')
    expect(meta.requiresAtLeast).toBe('6.6')
    expect(meta.author).toBe('Anonymous')
  })

  it('rejects slugs that contain trademark terms', () => {
    expect(() =>
      themeMetaSchema.parse({
        name: 'WP Pro',
        slug: 'wordpress-pro',
        description: 'nope',
      }),
    ).toThrow(/trademark/i)
    expect(() =>
      themeMetaSchema.parse({
        name: 'Gut Theme',
        slug: 'gutenberg-theme',
        description: 'nope',
      }),
    ).toThrow(/trademark/i)
  })

  it('rejects slugs with uppercase, leading digit, or invalid chars', () => {
    expect(() =>
      themeMetaSchema.parse({ name: 'X', slug: 'AuroraTheme', description: 'd' }),
    ).toThrow()
    expect(() =>
      themeMetaSchema.parse({ name: 'X', slug: '2nd-theme', description: 'd' }),
    ).toThrow()
    expect(() => themeMetaSchema.parse({ name: 'X', slug: 'my theme', description: 'd' })).toThrow()
  })
})
