import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import {
  buildPlan,
  checkPlanConsistency,
  generateDirections,
  normalizePlan,
  profilesFromDirections,
  themePlanSchema,
  type ThemePlan,
} from '@/lib/ai/planner'
import { CostTracker } from '@/lib/ai/costTrack'
import { defaultStyleProfile, themeMetaSchema } from '@/lib/style/profile'

// -----------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------

function fixturePlan(overrides: Partial<ThemePlan> = {}): ThemePlan {
  return themePlanSchema.parse({
    meta: themeMetaSchema.parse({
      name: 'Aurora',
      slug: 'aurora',
      description: 'A minimal editorial theme for photography portfolios.',
    }),
    styleProfile: defaultStyleProfile(),
    templates: [
      { slug: 'index', purpose: 'Home with hero and recent posts.' },
      { slug: 'single', purpose: 'Single post view.' },
      { slug: 'page', purpose: 'Static page.' },
      { slug: 'archive', purpose: 'Post archive.' },
      { slug: '404', purpose: 'Not found.' },
    ],
    parts: [
      { slug: 'header', purpose: 'Site header with nav.' },
      { slug: 'footer', purpose: 'Site footer.' },
    ],
    patterns: Array.from({ length: 6 }).map((_, i) => ({
      slug: `pattern-${i + 1}`,
      title: `Pattern ${i + 1}`,
      categories: ['hero'],
      purpose: `Pattern ${i + 1} purpose.`,
    })),
    patternCategories: [
      { slug: 'hero', label: 'Hero' },
      { slug: 'cta', label: 'Call to Action' },
    ],
    ...overrides,
  })
}

function fakeUsage(): Anthropic.Usage {
  return {
    input_tokens: 2000,
    output_tokens: 1000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    server_tool_use: null,
    service_tier: null,
  } as unknown as Anthropic.Usage
}

/**
 * Build a fake Anthropic client whose `messages.parse()` returns a
 * deterministic canned plan. Used to exercise the planner without
 * hitting the real API.
 */
function fakeClient(
  plan: ThemePlan | null = fixturePlan(),
  opts: { throwOnFirst?: boolean; usage?: Anthropic.Usage } = {},
): Anthropic {
  let calls = 0
  const parse = vi.fn().mockImplementation(async () => {
    calls++
    if (opts.throwOnFirst && calls === 1) {
      const err = new Error('simulated 500')
      // Make it look like a retryable error via message (withRetry looks at SDK classes;
      // for this test we're checking it bubbles the final error after retries, not retry behavior).
      throw err
    }
    return {
      id: 'msg_fake',
      type: 'message',
      model: 'claude-sonnet-4-6',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [],
      usage: opts.usage ?? fakeUsage(),
      parsed_output: plan,
    }
  })
  const client = {
    messages: { parse },
  } as unknown as Anthropic
  return client
}

// -----------------------------------------------------------------------
// Schema tests
// -----------------------------------------------------------------------

describe('ai/planner: themePlanSchema', () => {
  it('accepts the fixture plan', () => {
    expect(() => themePlanSchema.parse(fixturePlan())).not.toThrow()
  })

  it('rejects a plan with fewer than 5 templates', () => {
    const bad = {
      ...fixturePlan(),
      templates: [{ slug: 'index', purpose: 'just one' }],
    }
    expect(() => themePlanSchema.parse(bad)).toThrow()
  })

  it('rejects a plan with invalid slugs (uppercase)', () => {
    const plan = fixturePlan()
    const bad = {
      ...plan,
      templates: [...plan.templates, { slug: 'Archive', purpose: 'bad' }],
    }
    expect(() => themePlanSchema.parse(bad)).toThrow()
  })

  it('accepts WordPress-convention numeric template slugs like 404', () => {
    const plan = fixturePlan()
    const withNumeric = {
      ...plan,
      templates: [...plan.templates, { slug: '500', purpose: 'Server error page.' }],
    }
    expect(() => themePlanSchema.parse(withNumeric)).not.toThrow()
  })
})

// -----------------------------------------------------------------------
// buildPlan tests
// -----------------------------------------------------------------------

describe('ai/planner: buildPlan', () => {
  it('returns a validated plan from a mock client', async () => {
    const client = fakeClient()
    const plan = await buildPlan('a minimal photography portfolio', { client })
    expect(plan.meta.slug).toBe('aurora')
    expect(plan.templates.map((t) => t.slug)).toContain('index')
  })

  it('records usage on the provided cost tracker', async () => {
    const client = fakeClient()
    const tracker = new CostTracker()
    await buildPlan('prompt', { client, costTracker: tracker })
    const totals = tracker.totals()
    expect(totals.calls).toBe(1)
    expect(totals.inputTokens).toBeGreaterThan(0)
    expect(totals.outputTokens).toBeGreaterThan(0)
  })

  it('throws PlannerError when the LLM returns no parsed_output', async () => {
    const client = fakeClient(null)
    await expect(buildPlan('prompt', { client })).rejects.toMatchObject({
      name: 'PlannerError',
    })
  })

  it('calls messages.parse with the planner model and system prompt', async () => {
    const client = fakeClient()
    const parse = client.messages.parse as ReturnType<typeof vi.fn>
    await buildPlan('prompt', { client })
    expect(parse).toHaveBeenCalledTimes(1)
    const arg = parse.mock.calls[0]![0]!
    expect(arg.model).toBe('claude-sonnet-4-6')
    expect(Array.isArray(arg.system)).toBe(true)
    expect(arg.system[0]!.cache_control).toEqual({ type: 'ephemeral' })
    expect(arg.output_config).toBeDefined()
  })
})

// -----------------------------------------------------------------------
// normalizePlan tests
// -----------------------------------------------------------------------

describe('ai/planner: normalizePlan', () => {
  it('adds missing required templates (index, single, page, archive, 404)', () => {
    const plan = fixturePlan({
      templates: [
        { slug: 'index', purpose: 'Home.' },
        { slug: 'custom-one', purpose: 'Custom.' },
        { slug: 'custom-two', purpose: 'Custom.' },
        { slug: 'custom-three', purpose: 'Custom.' },
        { slug: 'custom-four', purpose: 'Custom.' },
      ],
    })
    const normalized = normalizePlan(plan)
    const slugs = new Set(normalized.templates.map((t) => t.slug))
    expect(slugs).toContain('index')
    expect(slugs).toContain('single')
    expect(slugs).toContain('page')
    expect(slugs).toContain('archive')
    expect(slugs).toContain('404')
  })

  it('adds missing header/footer parts', () => {
    const plan = fixturePlan({
      parts: [
        { slug: 'header', purpose: 'Header.' },
        { slug: 'sidebar', purpose: 'Sidebar.' },
      ],
    })
    const normalized = normalizePlan(plan)
    const slugs = new Set(normalized.parts.map((p) => p.slug))
    expect(slugs).toContain('header')
    expect(slugs).toContain('footer')
  })

  it('is idempotent when required items already present', () => {
    const plan = fixturePlan()
    const once = normalizePlan(plan)
    const twice = normalizePlan(once)
    expect(twice.templates.length).toBe(once.templates.length)
    expect(twice.parts.length).toBe(once.parts.length)
  })
})

// -----------------------------------------------------------------------
// checkPlanConsistency tests
// -----------------------------------------------------------------------

describe('ai/planner: checkPlanConsistency', () => {
  it('passes a consistent fixture plan', () => {
    const issues = checkPlanConsistency(fixturePlan())
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('flags a pattern referencing an undeclared category', () => {
    const plan = fixturePlan()
    plan.patterns[0] = { ...plan.patterns[0]!, categories: ['undeclared-category'] }
    const issues = checkPlanConsistency(plan)
    expect(issues.some((i) => i.message.includes('undeclared-category'))).toBe(true)
  })

  it('flags duplicate template slugs', () => {
    const plan = fixturePlan()
    plan.templates.push({ slug: 'index', purpose: 'dup' })
    const issues = checkPlanConsistency(plan)
    expect(issues.some((i) => i.message.includes('Duplicate template'))).toBe(true)
  })

  it('flags missing required templates (pre-normalize)', () => {
    const plan = fixturePlan({
      templates: [
        { slug: 'index', purpose: 'Home.' },
        { slug: 'custom-one', purpose: 'Custom.' },
        { slug: 'custom-two', purpose: 'Custom.' },
        { slug: 'custom-three', purpose: 'Custom.' },
        { slug: 'custom-four', purpose: 'Custom.' },
      ],
    })
    const issues = checkPlanConsistency(plan)
    expect(issues.some((i) => i.message.includes('Required template "single"'))).toBe(true)
  })
})

// -----------------------------------------------------------------------
// generateDirections tests
// -----------------------------------------------------------------------

describe('ai/planner: generateDirections', () => {
  it('returns exactly 3 directions', async () => {
    const client = fakeClient()
    const directions = await generateDirections('prompt', { client })
    expect(directions).toHaveLength(3)
  })

  it('labels each direction distinctly', async () => {
    const client = fakeClient()
    const directions = await generateDirections('prompt', { client })
    const labels = directions.map((d) => d.label)
    expect(new Set(labels).size).toBe(3) // all distinct
  })

  it('runs the three calls in parallel', async () => {
    let active = 0
    let maxActive = 0
    const parse = vi.fn().mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return {
        id: 'msg_fake',
        type: 'message',
        model: 'claude-sonnet-4-6',
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [],
        usage: fakeUsage(),
        parsed_output: fixturePlan(),
      }
    })
    const client = { messages: { parse } } as unknown as Anthropic

    await generateDirections('prompt', { client })
    expect(maxActive).toBeGreaterThanOrEqual(2)
  })

  it('profilesFromDirections extracts just the StyleProfile per direction', async () => {
    const client = fakeClient()
    const directions = await generateDirections('prompt', { client })
    const profiles = profilesFromDirections(directions)
    expect(profiles).toHaveLength(3)
    for (const p of profiles) {
      expect(p.profile).toBeDefined()
      expect(p.profile.voice.style).toBeDefined()
    }
  })
})
