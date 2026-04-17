import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { getAnthropic } from '@/lib/ai/client'
import { modelFor } from '@/lib/ai/models'
import { buildSystemParam } from '@/lib/ai/systemPrompt'
import { withRetry } from '@/lib/ai/withRetry'
import { CostTracker } from '@/lib/ai/costTrack'
import { styleProfileSchema, themeMetaSchema, type StyleProfile } from '@/lib/style/profile'

/**
 * The Planner — step 1 of every theme generation. Takes a user prompt
 * ("minimalist photography portfolio") and produces a complete
 * ThemePlan: a locked style profile, theme metadata, a list of
 * templates/parts/patterns to generate, and the pattern categories to
 * register.
 *
 * Design decisions (per presearch §2.7, §1.5 I1, I6):
 * - Sonnet 4.6 — one call per theme. Deep-reasoning needed for coherent
 *   design decisions; cheap enough to run three in parallel for
 *   multi-direction mode.
 * - Structured Outputs via Zod for guaranteed schema shape. If the SDK
 *   can't strip a Zod constraint to JSON-Schema-for-SO-API shape, it
 *   falls through to client-side Zod parsing.
 * - The LLM never hits any file from Phase 2 directly — it returns data,
 *   we turn that data into files via `assembleTheme()` downstream.
 */

// -----------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------

/**
 * Slugs have two profiles.
 *
 * - `slugLenient`: allowed for templates (WordPress template hierarchy
 *   uses numeric filenames like `404.html`, `500.html`, `search.html`;
 *   rejecting a leading digit would lose the 404 template). Used for
 *   templates, parts, patterns, and pattern categories.
 * - The strict no-leading-digit form is enforced by `themeMetaSchema.slug`
 *   in `profile.ts` for the theme folder name itself.
 */
const slugLenient = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric + hyphens')
  .min(1)
  .max(60)

/** Template file plan — index, single, page, archive, 404, etc. */
export const templatePlanSchema = z.object({
  slug: slugLenient,
  purpose: z.string().min(3).max(280),
  /** Short placeholder copy directives (headings, paragraph, button labels)
   * the template generator will use verbatim. Prevents lorem ipsum. */
  placeholderCopy: z.string().min(3).max(500).optional(),
})

/** Template part file plan — header, footer, etc. */
export const partPlanSchema = z.object({
  slug: slugLenient,
  purpose: z.string().min(3).max(280),
})

/** Pattern file plan — a reusable block composition. */
export const patternPlanSchema = z.object({
  slug: slugLenient,
  title: z.string().min(3).max(120),
  categories: z.array(slugLenient).min(1).max(4),
  purpose: z.string().min(3).max(280),
})

/** Pattern category registered in functions.php. */
export const patternCategoryPlanSchema = z.object({
  slug: slugLenient,
  label: z.string().min(1).max(60),
})

/**
 * The full plan produced by a single Planner call. Everything the
 * downstream generators need is here.
 */
export const themePlanSchema = z.object({
  meta: themeMetaSchema,
  styleProfile: styleProfileSchema,
  templates: z.array(templatePlanSchema).min(5).max(15),
  parts: z.array(partPlanSchema).min(2).max(8),
  patterns: z.array(patternPlanSchema).min(5).max(30),
  patternCategories: z.array(patternCategoryPlanSchema).min(1).max(12),
})

export type TemplatePlan = z.infer<typeof templatePlanSchema>
export type PartPlan = z.infer<typeof partPlanSchema>
export type PatternPlan = z.infer<typeof patternPlanSchema>
export type PatternCategoryPlan = z.infer<typeof patternCategoryPlanSchema>
export type ThemePlan = z.infer<typeof themePlanSchema>

// -----------------------------------------------------------------------
// Prompt construction
// -----------------------------------------------------------------------

const REQUIRED_TEMPLATE_SLUGS = ['index', 'single', 'page', 'archive', '404'] as const
const REQUIRED_PART_SLUGS = ['header', 'footer'] as const

/**
 * Build the user-turn message that feeds the Planner. Goes _after_ the
 * cached system prompt — so volatile content doesn't invalidate the cache.
 */
function buildUserMessage(userPrompt: string, opts: { voiceHint?: string } = {}): string {
  const extraVoice = opts.voiceHint
    ? `\n\n**Stylistic direction for this variation**: ${opts.voiceHint}`
    : ''
  return `# Theme generation request

User prompt:
> ${userPrompt.trim()}${extraVoice}

Produce a complete ThemePlan that:

1. **meta** — Theme name (3-5 words), slug (kebab-case from name, no "wordpress"/"gutenberg"), 1-2 sentence description, author "Anonymous", version "0.1.0", \`requiresAtLeast: "6.6"\`, \`testedUpTo: "7.0"\`, \`requiresPhp: "7.4"\`, license GPL v2.

2. **styleProfile** — Commit to ONE coherent design voice. Pick a \`style\` archetype (editorial/minimal/bold/playful/corporate). Pick typography: two complementary families with proper CSS font-family stacks and lowercase slugs. Pick an 8-color palette (base/contrast/accent-1/accent-2/accent-3/neutral-1/neutral-2/neutral-3) — all as valid CSS color values (hex or named, the palette stores raw colors; templates reference them by slug). 5 fluid font sizes with monotonically increasing min/max. 7 spacing presets (slugs 20, 30, 40, 50, 60, 70, 80, all clamp-based). 3 section-style variations using preset variables only (never hex).

3. **templates** — 6-10 template files. MUST include: index, single, page, archive, 404. For each: slug + 1-sentence purpose + optional \`placeholderCopy\` with a heading/paragraph/button-label the generator will use (prevents lorem ipsum).

4. **parts** — At least header and footer. Add more variations (e.g. "header-minimal", "footer-with-nav") if the style calls for it.

5. **patterns** — 15-25 reusable patterns organized into categories. Aim for at least: hero, cta, gallery, testimonials, footer, header. Each with a kebab-case slug, display title, category list (subset of \`patternCategories\` slugs below), and 1-sentence purpose.

6. **patternCategories** — 3-6 category slugs (without theme-slug prefix) with human-readable labels. The pattern files reference these.

Keep styleProfile internally consistent: if voice.style is "minimal" the palette should be muted and neutrals should dominate; if "bold" palette should have high contrast.

Constraints:
- Slug charset: lowercase alphanumeric + hyphens, no leading digit.
- No trademarks ("wordpress", "gutenberg") in meta.name or meta.slug.
- All color values in palette: hex format (e.g. "#111111") or named (e.g. "white").
- All sectionStyles.background and .text: preset variables like "var:preset|color|base".
- All spacing sizes: clamp() expressions (e.g. "clamp(0.5rem, 1vw, 0.75rem)").
- No raw px values anywhere except inside clamp().
- Fluid font scale MUST be monotonically increasing from small to xx-large.

Return ONLY the ThemePlan JSON. No preamble, no commentary.`
}

// -----------------------------------------------------------------------
// Planner entry point
// -----------------------------------------------------------------------

export type PlannerOptions = {
  /** Hand a session-scoped CostTracker to accumulate usage. */
  costTracker?: CostTracker
  /** Extra direction hint for multi-direction mode. */
  voiceHint?: string
  /** Retry policy override. */
  maxAttempts?: number
  /** Inject a specific Anthropic client (unit tests). */
  client?: Anthropic
}

/**
 * Run the planner and return a validated ThemePlan. Throws on
 * non-retryable errors, SDK validation failures, or if the LLM produces
 * output that doesn't conform to the schema after retries.
 */
export async function buildPlan(userPrompt: string, opts: PlannerOptions = {}): Promise<ThemePlan> {
  const client = opts.client ?? getAnthropic()
  const model = modelFor('plan')

  const response = await withRetry(
    () =>
      client.messages.parse({
        model,
        max_tokens: 16_000,
        system: buildSystemParam(),
        messages: [
          {
            role: 'user',
            content: buildUserMessage(userPrompt, { voiceHint: opts.voiceHint }),
          },
        ],
        output_config: { format: zodOutputFormat(themePlanSchema) },
      }),
    { maxAttempts: opts.maxAttempts ?? 3 },
  )

  if (opts.costTracker && response.usage) {
    opts.costTracker.recordUsage({ task: 'plan', model, usage: response.usage })
  }

  const parsed = response.parsed_output
  if (!parsed) {
    throw new PlannerError(
      'Planner returned no parsed_output. The LLM produced output that did not validate against themePlanSchema.',
      response,
    )
  }

  return normalizePlan(parsed)
}

// -----------------------------------------------------------------------
// Multi-direction
// -----------------------------------------------------------------------

const DIRECTION_HINTS: ReadonlyArray<{ label: string; hint: string }> = [
  {
    label: 'Clean & Editorial',
    hint: 'Lean minimalist. Serif display headings (e.g. DM Serif Display / Fraunces / Playfair). Muted neutral palette with a single restrained accent. Generous whitespace. Feels like a well-designed magazine.',
  },
  {
    label: 'Warm & Inviting',
    hint: 'Warm, approachable tone. Geometric sans headings with humanist body (e.g. Manrope + Inter). Warm cream/beige neutrals, terracotta/olive accents. Rounded corners feel natural. Welcoming rather than austere.',
  },
  {
    label: 'Bold & Dramatic',
    hint: 'High-contrast, editorial-poster sensibility. Variable-weight sans for display (e.g. Inter Variable, Space Grotesk). Near-black + near-white + one saturated accent. Oversized clamp headings on heroes. Confident, cinematic.',
  },
]

/**
 * Generate 3 parallel ThemePlans from the same prompt with different
 * style directions. User picks one; the chosen plan drives template
 * generation. Innovation I6.
 */
export async function generateDirections(
  userPrompt: string,
  opts: PlannerOptions = {},
): Promise<Array<{ label: string; plan: ThemePlan }>> {
  const client = opts.client ?? getAnthropic()
  const results = await Promise.all(
    DIRECTION_HINTS.map(async ({ label, hint }) => {
      const plan = await buildPlan(userPrompt, { ...opts, client, voiceHint: hint })
      return { label, plan }
    }),
  )
  return results
}

/**
 * Extract just the three StyleProfiles from a directions response —
 * useful when you want to show the user a compact card picker before
 * committing to a full plan.
 */
export function profilesFromDirections(
  directions: Array<{ label: string; plan: ThemePlan }>,
): Array<{ label: string; profile: StyleProfile }> {
  return directions.map(({ label, plan }) => ({ label, profile: plan.styleProfile }))
}

// -----------------------------------------------------------------------
// Normalization
// -----------------------------------------------------------------------

/**
 * Ensure the plan has the required templates and parts. If the LLM
 * omitted them, we fill in minimal stubs with a canned purpose rather
 * than failing. This keeps the downstream pipeline from needing its own
 * "required slugs" allowlist.
 */
export function normalizePlan(plan: ThemePlan): ThemePlan {
  const templates = [...plan.templates]
  const templateSlugs = new Set(templates.map((t) => t.slug))
  for (const required of REQUIRED_TEMPLATE_SLUGS) {
    if (!templateSlugs.has(required)) {
      templates.push({ slug: required, purpose: defaultTemplatePurpose(required) })
    }
  }

  const parts = [...plan.parts]
  const partSlugs = new Set(parts.map((p) => p.slug))
  for (const required of REQUIRED_PART_SLUGS) {
    if (!partSlugs.has(required)) {
      parts.push({ slug: required, purpose: defaultPartPurpose(required) })
    }
  }

  return { ...plan, templates, parts }
}

function defaultTemplatePurpose(slug: string): string {
  switch (slug) {
    case 'index':
      return 'Home page with hero, recent posts, and a call to action.'
    case 'single':
      return 'Single post page with post title, meta, content, and navigation.'
    case 'page':
      return 'Static page with title and content area.'
    case 'archive':
      return 'Archive page listing posts by category, tag, or date.'
    case '404':
      return 'Not-found page with a clear message and link back to home.'
    default:
      return 'Generic template.'
  }
}

function defaultPartPurpose(slug: string): string {
  switch (slug) {
    case 'header':
      return 'Site header with logo, site title, and primary navigation.'
    case 'footer':
      return 'Site footer with secondary nav and copyright.'
    default:
      return 'Reusable template part.'
  }
}

// -----------------------------------------------------------------------
// Validation sanity-check on the plan's internal consistency.
// -----------------------------------------------------------------------

export type PlanConsistencyIssue = {
  severity: 'error' | 'warn'
  message: string
}

/**
 * Check the plan's internal consistency beyond what the Zod schema
 * enforces:
 * - pattern categories referenced in patterns must exist in patternCategories
 * - required templates and parts are present
 * - pattern slugs are unique
 * - template slugs are unique
 */
export function checkPlanConsistency(plan: ThemePlan): PlanConsistencyIssue[] {
  const issues: PlanConsistencyIssue[] = []

  const catSlugs = new Set(plan.patternCategories.map((c) => c.slug))
  for (const pattern of plan.patterns) {
    for (const cat of pattern.categories) {
      if (!catSlugs.has(cat)) {
        issues.push({
          severity: 'error',
          message: `Pattern "${pattern.slug}" references undeclared category "${cat}"`,
        })
      }
    }
  }

  const seenTemplates = new Set<string>()
  for (const t of plan.templates) {
    if (seenTemplates.has(t.slug)) {
      issues.push({ severity: 'error', message: `Duplicate template slug "${t.slug}"` })
    }
    seenTemplates.add(t.slug)
  }

  const seenPatterns = new Set<string>()
  for (const p of plan.patterns) {
    if (seenPatterns.has(p.slug)) {
      issues.push({ severity: 'error', message: `Duplicate pattern slug "${p.slug}"` })
    }
    seenPatterns.add(p.slug)
  }

  for (const req of REQUIRED_TEMPLATE_SLUGS) {
    if (!seenTemplates.has(req)) {
      issues.push({ severity: 'error', message: `Required template "${req}" missing` })
    }
  }

  const partSlugs = new Set(plan.parts.map((p) => p.slug))
  for (const req of REQUIRED_PART_SLUGS) {
    if (!partSlugs.has(req)) {
      issues.push({ severity: 'error', message: `Required part "${req}" missing` })
    }
  }

  return issues
}

// -----------------------------------------------------------------------
// Error type
// -----------------------------------------------------------------------

export class PlannerError extends Error {
  constructor(
    message: string,
    public readonly response?: unknown,
  ) {
    super(message)
    this.name = 'PlannerError'
  }
}
