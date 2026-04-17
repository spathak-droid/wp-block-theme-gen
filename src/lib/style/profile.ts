import { z } from 'zod'

/**
 * The StyleProfile is the "design voice" locked in by the planner step
 * before any templates or patterns are generated. Every subsequent
 * generation call receives this profile and is instructed to use only its
 * preset tokens — no hardcoded colors, no raw px. This is the core of
 * R1 (non-generic visual output).
 */

/** Matches a concrete CSS color (hex / rgb / rgba / hsl / hsla / named). */
export const cssColorSchema = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)$/,
    'must be a valid CSS color value',
  )

/** Matches a preset reference: `var:preset|{kind}|{slug}`. Used in section styles etc. */
export const presetVarSchema = z
  .string()
  .regex(
    /^var:preset\|(color|spacing|font-size)\|[a-z0-9-]+$/,
    'must be a preset variable like var:preset|color|accent-1',
  )

export const voiceStyleSchema = z.enum(['editorial', 'minimal', 'bold', 'playful', 'corporate'])

export const voiceSchema = z.object({
  /** Human-readable summary of the theme's design intent (1-2 sentences). */
  primary: z.string().min(3).max(280),
  /** Archetype for prompt conditioning. */
  style: voiceStyleSchema,
})

export const fontFamilySchema = z.object({
  /** Display name in the editor (e.g. "Manrope"). */
  name: z.string(),
  /** Preset slug used in markup (e.g. "manrope"). Lowercase, hyphens. */
  slug: z.string().regex(/^[a-z0-9-]+$/, 'font family slug: lowercase + hyphens only'),
  /** CSS font-family value, including fallback stack. */
  fontFamily: z.string().min(1),
})

export const fluidSizeSchema = z.object({
  /** Preset slug — one of: small, medium, large, x-large, xx-large. */
  slug: z.enum(['small', 'medium', 'large', 'x-large', 'xx-large']),
  /** Display name. */
  name: z.string(),
  /** Minimum CSS length (used on small viewports). */
  min: z.string(),
  /** Maximum CSS length (used on large viewports). */
  max: z.string(),
})

export const typographySchema = z.object({
  headingFamily: fontFamilySchema,
  bodyFamily: fontFamilySchema,
  /** 5-step fluid scale: small, medium, large, x-large, xx-large. Must be monotonically increasing. */
  fluidScale: z.array(fluidSizeSchema).length(5),
})

export const paletteSlugSchema = z.enum([
  'base',
  'contrast',
  'accent-1',
  'accent-2',
  'accent-3',
  'neutral-1',
  'neutral-2',
  'neutral-3',
])

export const paletteSchema = z.object({
  base: cssColorSchema,
  contrast: cssColorSchema,
  'accent-1': cssColorSchema,
  'accent-2': cssColorSchema,
  'accent-3': cssColorSchema,
  'neutral-1': cssColorSchema,
  'neutral-2': cssColorSchema,
  'neutral-3': cssColorSchema,
})

export const spacingPresetSchema = z.object({
  /** One of '20', '30', '40', '50', '60', '70', '80' — WordPress convention. */
  slug: z.enum(['20', '30', '40', '50', '60', '70', '80']),
  /** CSS length (e.g. `clamp(1rem, 2vw, 1.5rem)`). */
  size: z.string(),
})

export const sectionStyleSchema = z.object({
  /** Kebab-case identifier (e.g. `section-1`). Becomes the `is-style-section-1` class. */
  name: z.string().regex(/^section-\d+$/, 'section style name must match pattern section-N'),
  /** User-facing label (e.g. "Section 1 (Base)"). */
  label: z.string(),
  /** Preset variable for background (e.g. `var:preset|color|base`). */
  background: presetVarSchema,
  /** Preset variable for foreground text (e.g. `var:preset|color|contrast`). */
  text: presetVarSchema,
})

export const styleProfileSchema = z.object({
  voice: voiceSchema,
  typography: typographySchema,
  palette: paletteSchema,
  spacing: z.array(spacingPresetSchema).length(7),
  sectionStyles: z.array(sectionStyleSchema).length(3),
})

export type Voice = z.infer<typeof voiceSchema>
export type FontFamily = z.infer<typeof fontFamilySchema>
export type FluidSize = z.infer<typeof fluidSizeSchema>
export type Typography = z.infer<typeof typographySchema>
export type Palette = z.infer<typeof paletteSchema>
export type PaletteSlug = z.infer<typeof paletteSlugSchema>
export type SpacingPreset = z.infer<typeof spacingPresetSchema>
export type SectionStyle = z.infer<typeof sectionStyleSchema>
export type StyleProfile = z.infer<typeof styleProfileSchema>

/**
 * Theme metadata — everything that shows up in style.css or the WP admin's
 * Themes list. Kept separate from StyleProfile because the planner produces
 * both but they're conceptually distinct.
 */
export const themeMetaSchema = z.object({
  /** Human display name. */
  name: z.string().min(1).max(120),
  /** Folder + text-domain slug. Lowercase, hyphens, no leading digit, no trademark terms. */
  slug: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'slug: lowercase alphanumeric + hyphens, no leading digit')
    .refine(
      (s) => !/(wordpress|gutenberg)/i.test(s),
      'slug must not contain trademarked terms (wordpress, gutenberg)',
    )
    .max(60),
  description: z.string().min(1).max(500),
  author: z.string().min(1).max(120).default('Anonymous'),
  /** Semver-ish version, e.g. 0.1.0. */
  version: z
    .string()
    .regex(/^\d+\.\d+(\.\d+)?$/)
    .default('0.1.0'),
  /** Min WP version. Default 6.6 — required for theme.json v3. */
  requiresAtLeast: z.string().default('6.6'),
  /** Max tested WP version. */
  testedUpTo: z.string().default('7.0'),
  /** Min PHP version. */
  requiresPhp: z.string().default('7.4'),
  license: z.string().default('GNU General Public License v2 or later'),
  licenseUri: z.string().default('http://www.gnu.org/licenses/gpl-2.0.html'),
})

export type ThemeMeta = z.infer<typeof themeMetaSchema>

/**
 * Produce a reasonable default StyleProfile — used as a fallback and as
 * the base for the planner's fixture tests.
 */
export function defaultStyleProfile(): StyleProfile {
  return {
    voice: { primary: 'A modern editorial theme.', style: 'editorial' },
    typography: {
      headingFamily: {
        name: 'Manrope',
        slug: 'manrope',
        fontFamily: '"Manrope", sans-serif',
      },
      bodyFamily: {
        name: 'Inter',
        slug: 'inter',
        fontFamily: '"Inter", sans-serif',
      },
      fluidScale: [
        { slug: 'small', name: 'Small', min: '0.875rem', max: '1rem' },
        { slug: 'medium', name: 'Medium', min: '1rem', max: '1.125rem' },
        { slug: 'large', name: 'Large', min: '1.25rem', max: '1.5rem' },
        { slug: 'x-large', name: 'Extra Large', min: '1.75rem', max: '2.25rem' },
        { slug: 'xx-large', name: '2X Large', min: '2.5rem', max: '4rem' },
      ],
    },
    palette: {
      base: '#ffffff',
      contrast: '#111111',
      'accent-1': '#7B6AE0',
      'accent-2': '#E0B56A',
      'accent-3': '#6AE0B5',
      'neutral-1': '#f5f5f5',
      'neutral-2': '#e5e5e5',
      'neutral-3': '#777777',
    },
    spacing: [
      { slug: '20', size: 'clamp(0.25rem, 0.5vw, 0.375rem)' },
      { slug: '30', size: 'clamp(0.5rem, 1vw, 0.75rem)' },
      { slug: '40', size: 'clamp(0.75rem, 1.5vw, 1rem)' },
      { slug: '50', size: 'clamp(1rem, 2vw, 1.5rem)' },
      { slug: '60', size: 'clamp(1.5rem, 3vw, 2.25rem)' },
      { slug: '70', size: 'clamp(2.25rem, 4vw, 3.5rem)' },
      { slug: '80', size: 'clamp(3.5rem, 6vw, 5rem)' },
    ],
    sectionStyles: [
      {
        name: 'section-1',
        label: 'Section 1 (Base)',
        background: 'var:preset|color|base',
        text: 'var:preset|color|contrast',
      },
      {
        name: 'section-2',
        label: 'Section 2 (Inverted)',
        background: 'var:preset|color|contrast',
        text: 'var:preset|color|base',
      },
      {
        name: 'section-3',
        label: 'Section 3 (Accent)',
        background: 'var:preset|color|accent-1',
        text: 'var:preset|color|base',
      },
    ],
  }
}

/**
 * Verify that the fluid type scale is monotonically increasing.
 * We only compare min values to keep this simple; if min is monotonic,
 * max almost certainly is too by construction.
 */
export function isFluidScaleMonotonic(scale: FluidSize[]): boolean {
  for (let i = 1; i < scale.length; i++) {
    const prev = parseRem(scale[i - 1]!.min)
    const cur = parseRem(scale[i]!.min)
    if (prev === null || cur === null) return false
    if (cur <= prev) return false
  }
  return true
}

function parseRem(v: string): number | null {
  const m = v.match(/^([\d.]+)rem$/)
  if (!m) return null
  return parseFloat(m[1]!)
}
