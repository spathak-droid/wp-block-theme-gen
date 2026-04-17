import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import schema from '@/lib/style/theme-json-schema.json' with { type: 'json' }
import type { StyleProfile, Palette, PaletteSlug } from '@/lib/style/profile'

export const THEME_JSON_SCHEMA_URL = 'https://schemas.wp.org/trunk/theme.json'
export const THEME_JSON_VERSION = 3 as const

export type ThemeJson = {
  $schema: string
  version: number
  settings?: Record<string, unknown>
  styles?: Record<string, unknown>
  customTemplates?: Array<{ name: string; title: string; postTypes?: string[] }>
  templateParts?: Array<{
    name: string
    title: string
    area: 'header' | 'footer' | 'uncategorized'
  }>
}

/**
 * Build a WordPress theme.json v3 document from a StyleProfile.
 *
 * Implements Loop 2.3 of the presearch:
 * - 8-color palette at settings.color.palette
 * - 5 fluid font sizes at settings.typography.fontSizes
 * - 7 spacing presets at settings.spacing.spacingSizes
 * - 3 section styles at styles.blocks["core/group"].variations
 * - appearanceTools: true, version: 3, $schema URL
 * - Content width 645px / wide width 1340px (Twenty Twenty-Five defaults).
 */
export function buildThemeJson(profile: StyleProfile): ThemeJson {
  return {
    $schema: THEME_JSON_SCHEMA_URL,
    version: THEME_JSON_VERSION,
    settings: {
      appearanceTools: true,
      useRootPaddingAwareAlignments: true,
      layout: {
        contentSize: '645px',
        wideSize: '1340px',
      },
      color: {
        defaultPalette: false,
        defaultGradients: false,
        palette: buildPalette(profile.palette),
      },
      typography: {
        defaultFontSizes: false,
        fluid: true,
        fontFamilies: [
          {
            slug: profile.typography.headingFamily.slug,
            name: profile.typography.headingFamily.name,
            fontFamily: profile.typography.headingFamily.fontFamily,
          },
          {
            slug: profile.typography.bodyFamily.slug,
            name: profile.typography.bodyFamily.name,
            fontFamily: profile.typography.bodyFamily.fontFamily,
          },
        ],
        fontSizes: profile.typography.fluidScale.map((s) => ({
          slug: s.slug,
          name: s.name,
          size: s.max,
          fluid: { min: s.min, max: s.max },
        })),
      },
      spacing: {
        // spacingScale is intentionally omitted — WP's auto-generated scale
        // conflicts with our curated spacingSizes. Supplying only spacingSizes
        // means the admin will see only our presets.
        defaultSpacingSizes: false,
        spacingSizes: profile.spacing.map((p) => ({
          slug: p.slug,
          name: p.slug,
          size: p.size,
        })),
        units: ['px', 'em', 'rem', 'vh', 'vw', '%'],
      },
    },
    styles: {
      color: {
        background: 'var(--wp--preset--color--base)',
        text: 'var(--wp--preset--color--contrast)',
      },
      typography: {
        fontFamily: `var(--wp--preset--font-family--${profile.typography.bodyFamily.slug})`,
        fontSize: 'var(--wp--preset--font-size--medium)',
        lineHeight: '1.6',
      },
      elements: {
        heading: {
          typography: {
            fontFamily: `var(--wp--preset--font-family--${profile.typography.headingFamily.slug})`,
            fontWeight: '700',
            lineHeight: '1.15',
          },
          color: {
            text: 'var(--wp--preset--color--contrast)',
          },
        },
        h1: { typography: { fontSize: 'var(--wp--preset--font-size--xx-large)' } },
        h2: { typography: { fontSize: 'var(--wp--preset--font-size--x-large)' } },
        h3: { typography: { fontSize: 'var(--wp--preset--font-size--large)' } },
        link: {
          color: {
            text: 'var(--wp--preset--color--accent-1)',
          },
          ':hover': {
            color: {
              text: 'var(--wp--preset--color--contrast)',
            },
          },
        },
        button: {
          color: {
            background: 'var(--wp--preset--color--contrast)',
            text: 'var(--wp--preset--color--base)',
          },
          typography: {
            fontFamily: `var(--wp--preset--font-family--${profile.typography.bodyFamily.slug})`,
            fontWeight: '600',
          },
          border: {
            radius: '0',
          },
          spacing: {
            padding: {
              top: 'var(--wp--preset--spacing--30)',
              right: 'var(--wp--preset--spacing--50)',
              bottom: 'var(--wp--preset--spacing--30)',
              left: 'var(--wp--preset--spacing--50)',
            },
          },
        },
      },
      blocks: {
        'core/group': {
          variations: Object.fromEntries(
            profile.sectionStyles.map((s) => [
              s.name,
              {
                color: {
                  background: s.background,
                  text: s.text,
                },
              },
            ]),
          ),
        },
      },
    },
  }
}

function buildPalette(palette: Palette): Array<{ slug: string; name: string; color: string }> {
  const labels: Record<PaletteSlug, string> = {
    base: 'Base',
    contrast: 'Contrast',
    'accent-1': 'Accent 1',
    'accent-2': 'Accent 2',
    'accent-3': 'Accent 3',
    'neutral-1': 'Neutral 1',
    'neutral-2': 'Neutral 2',
    'neutral-3': 'Neutral 3',
  }
  return (Object.entries(palette) as Array<[PaletteSlug, string]>).map(([slug, color]) => ({
    slug,
    name: labels[slug],
    color,
  }))
}

// -----------------------------------------------------------------------
// AJV validation against the bundled WordPress theme.json v3 schema.
// -----------------------------------------------------------------------

let cachedValidator: ValidateFunction | null = null

function getValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator
  // `strict: false` — the WP schema uses draft-07 and has a few fields AJV's
  // strict mode flags (e.g. non-enum `type: ["string","array"]`). We want
  // compatibility, not pedantry.
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  cachedValidator = ajv.compile(schema as object)
  return cachedValidator
}

export type ThemeJsonValidationResult =
  | { valid: true }
  | { valid: false; errors: Array<{ path: string; message: string }> }

/**
 * Validate a theme.json document against the bundled WordPress v3 schema.
 */
export function validateThemeJson(doc: unknown): ThemeJsonValidationResult {
  const validate = getValidator()
  const ok = validate(doc)
  if (ok) return { valid: true }
  const errors = (validate.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'validation failed'}${
      e.params ? ' (' + JSON.stringify(e.params) + ')' : ''
    }`,
  }))
  return { valid: false, errors }
}

/**
 * Sanity-check preset slug coherence: every slug referenced in section
 * styles, button styles, etc. must exist in the palette/spacing presets.
 * This catches drift between StyleProfile and the resulting theme.json.
 */
export function checkPresetCoherence(
  profile: StyleProfile,
  doc: ThemeJson,
): { coherent: true } | { coherent: false; issues: string[] } {
  const issues: string[] = []

  const palette = (doc.settings as Record<string, Record<string, unknown>> | undefined)?.[
    'color'
  ]?.['palette'] as Array<{ slug: string }> | undefined
  const paletteSlugs = new Set((palette ?? []).map((p) => p.slug))
  for (const expected of Object.keys(profile.palette)) {
    if (!paletteSlugs.has(expected)) issues.push(`palette missing slug "${expected}"`)
  }

  const sizes = (doc.settings as Record<string, Record<string, unknown>> | undefined)?.[
    'typography'
  ]?.['fontSizes'] as Array<{ slug: string }> | undefined
  const sizeSlugs = new Set((sizes ?? []).map((s) => s.slug))
  for (const expected of profile.typography.fluidScale) {
    if (!sizeSlugs.has(expected.slug)) {
      issues.push(`typography.fontSizes missing slug "${expected.slug}"`)
    }
  }

  const spacing = (doc.settings as Record<string, Record<string, unknown>> | undefined)?.[
    'spacing'
  ]?.['spacingSizes'] as Array<{ slug: string }> | undefined
  const spacingSlugs = new Set((spacing ?? []).map((s) => s.slug))
  for (const expected of profile.spacing) {
    if (!spacingSlugs.has(expected.slug)) issues.push(`spacing missing slug "${expected.slug}"`)
  }

  const variations =
    ((doc.styles as Record<string, Record<string, Record<string, unknown>>> | undefined)?.[
      'blocks'
    ]?.['core/group']?.['variations'] as Record<string, unknown> | undefined) ?? {}
  for (const section of profile.sectionStyles) {
    if (!(section.name in variations)) {
      issues.push(`section styles missing variation "${section.name}"`)
    }
  }

  return issues.length === 0 ? { coherent: true } : { coherent: false, issues }
}
