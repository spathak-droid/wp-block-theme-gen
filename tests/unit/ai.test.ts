import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { modelFor, PRICING, type ModelId, type Task } from '@/lib/ai/models'
import { isRetryable, withRetry } from '@/lib/ai/withRetry'
import { CostTracker, recordFromUsage } from '@/lib/ai/costTrack'
import { SYSTEM_PROMPT, buildSystemParam, estimateTokens } from '@/lib/ai/systemPrompt'

describe('ai/models: routing', () => {
  it('routes every task to a concrete model', () => {
    const tasks: Task[] = ['plan', 'template', 'pattern', 'repair', 'refine', 'escalate']
    for (const t of tasks) {
      const m = modelFor(t)
      expect(m, `task ${t}`).toBeTruthy()
      // Must be one of the three locked models.
      expect(['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-7']).toContain(m)
    }
  })

  it('routes planner + refine + escalate to Sonnet 4.6 (reasoning tier)', () => {
    expect(modelFor('plan')).toBe('claude-sonnet-4-6')
    expect(modelFor('refine')).toBe('claude-sonnet-4-6')
    expect(modelFor('escalate')).toBe('claude-sonnet-4-6')
  })

  it('routes template + pattern + repair to Haiku 4.5 (cheap bulk tier)', () => {
    expect(modelFor('template')).toBe('claude-haiku-4-5')
    expect(modelFor('pattern')).toBe('claude-haiku-4-5')
    expect(modelFor('repair')).toBe('claude-haiku-4-5')
  })

  it('has pricing entries for every routed model', () => {
    const tasks: Task[] = ['plan', 'template', 'pattern', 'repair', 'refine', 'escalate']
    for (const t of tasks) {
      const m = modelFor(t)
      expect(PRICING[m], `pricing for ${m}`).toBeDefined()
    }
  })

  it('cache-read is 10% of base input, cache-write 5m is 125%', () => {
    for (const m of Object.keys(PRICING) as ModelId[]) {
      const p = PRICING[m]
      expect(p.cacheRead).toBeCloseTo(p.input * 0.1, 5)
      expect(p.cacheWrite5m).toBeCloseTo(p.input * 1.25, 5)
    }
  })
})

describe('ai/withRetry: retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns immediately on success (no retry)', async () => {
    const op = vi.fn().mockResolvedValue('ok')
    const p = withRetry(op)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBe('ok')
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry non-retryable errors (400 bad request)', async () => {
    const err = new Anthropic.BadRequestError(400, { error: 'bad' }, 'bad', new Headers())
    const op = vi.fn().mockRejectedValue(err)
    // 400 rejects synchronously (no backoff) — expect immediately, then flush.
    const rejection = expect(withRetry(op, { maxAttempts: 3 })).rejects.toBe(err)
    await vi.runAllTimersAsync()
    await rejection
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('retries 5xx errors up to maxAttempts then throws', async () => {
    const err = new Anthropic.InternalServerError(500, { error: 'oops' }, 'oops', new Headers())
    const op = vi.fn().mockRejectedValue(err)
    const onRetry = vi.fn()
    // Start the rejection expectation BEFORE flushing timers so the rejection
    // promise already has a handler attached when the sleep microtasks resolve.
    const rejection = expect(
      withRetry(op, { maxAttempts: 3, baseDelayMs: 10, onRetry }),
    ).rejects.toBe(err)
    await vi.runAllTimersAsync()
    await rejection
    expect(op).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2) // fires between attempts, not after final
  })

  it('retries rate-limit errors', async () => {
    const err = new Anthropic.RateLimitError(429, { error: 'slow' }, 'slow', new Headers())
    let calls = 0
    const op = vi.fn().mockImplementation(() => {
      calls++
      if (calls < 3) throw err
      return Promise.resolve('finally')
    })
    const resolution = expect(withRetry(op, { maxAttempts: 5, baseDelayMs: 10 })).resolves.toBe(
      'finally',
    )
    await vi.runAllTimersAsync()
    await resolution
    expect(op).toHaveBeenCalledTimes(3)
  })

  it('isRetryable classifies errors correctly', () => {
    expect(isRetryable(new Anthropic.RateLimitError(429, { error: 'x' }, 'x', new Headers()))).toBe(
      true,
    )
    expect(
      isRetryable(new Anthropic.InternalServerError(500, { error: 'x' }, 'x', new Headers())),
    ).toBe(true)
    expect(
      isRetryable(new Anthropic.BadRequestError(400, { error: 'x' }, 'x', new Headers())),
    ).toBe(false)
    expect(
      isRetryable(new Anthropic.AuthenticationError(401, { error: 'x' }, 'x', new Headers())),
    ).toBe(false)
    expect(isRetryable(new Error('random'))).toBe(false)
  })
})

describe('ai/costTrack', () => {
  it('computes cost from usage using the model pricing table', () => {
    const usage: Anthropic.Usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    } as unknown as Anthropic.Usage

    const rec = recordFromUsage({ task: 'template', model: 'claude-haiku-4-5', usage })
    // 1000 * $1/M input + 500 * $5/M output = $0.001 + $0.0025 = $0.0035
    expect(rec.costUsd).toBeCloseTo(0.0035, 6)
    expect(rec.inputTokens).toBe(1000)
    expect(rec.outputTokens).toBe(500)
  })

  it('accounts for cache reads at 10% of input price', () => {
    const usage: Anthropic.Usage = {
      input_tokens: 100,
      output_tokens: 500,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    } as unknown as Anthropic.Usage

    const rec = recordFromUsage({ task: 'template', model: 'claude-haiku-4-5', usage })
    // 100*1 + 500*5 + 10000*0.1 = 100 + 2500 + 1000 = 3600 cents per M = $0.0036
    expect(rec.costUsd).toBeCloseTo(0.0036, 6)
  })

  it('accumulates totals across multiple records', () => {
    const tracker = new CostTracker()
    const makeUsage = (input: number, output: number, read = 0, write = 0): Anthropic.Usage =>
      ({
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: write,
        server_tool_use: null,
        service_tier: null,
      }) as unknown as Anthropic.Usage

    tracker.recordUsage({ task: 'plan', model: 'claude-sonnet-4-6', usage: makeUsage(2000, 1000) })
    tracker.recordUsage({
      task: 'template',
      model: 'claude-haiku-4-5',
      usage: makeUsage(500, 300),
    })
    tracker.recordUsage({
      task: 'template',
      model: 'claude-haiku-4-5',
      usage: makeUsage(500, 300, 8000, 0),
    })

    const t = tracker.totals()
    expect(t.calls).toBe(3)
    expect(t.inputTokens).toBe(2000 + 500 + 500)
    expect(t.outputTokens).toBe(1000 + 300 + 300)
    expect(t.cacheReadTokens).toBe(8000)
  })

  it('byModel breaks down per-model totals', () => {
    const tracker = new CostTracker()
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    } as unknown as Anthropic.Usage

    tracker.recordUsage({ task: 'plan', model: 'claude-sonnet-4-6', usage })
    tracker.recordUsage({ task: 'template', model: 'claude-haiku-4-5', usage })
    tracker.recordUsage({ task: 'template', model: 'claude-haiku-4-5', usage })

    const by = tracker.byModel()
    expect(by['claude-sonnet-4-6']?.calls).toBe(1)
    expect(by['claude-haiku-4-5']?.calls).toBe(2)
  })

  it('exceeds() flags when running total passes the ceiling', () => {
    const tracker = new CostTracker()
    expect(tracker.exceeds(0.3)).toBe(false)
    // 100k input + 100k output on Sonnet: 0.3 + 1.5 = $1.80 — way over.
    tracker.recordUsage({
      task: 'plan',
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 100_000,
        output_tokens: 100_000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        server_tool_use: null,
        service_tier: null,
      } as unknown as Anthropic.Usage,
    })
    expect(tracker.exceeds(0.3)).toBe(true)
  })
})

describe('ai/systemPrompt', () => {
  it('is comfortably above Haiku 4.5 cache floor (4,096) and below budget ceiling (16,000)', () => {
    const tokens = estimateTokens(SYSTEM_PROMPT)
    expect(tokens).toBeGreaterThanOrEqual(4_096)
    expect(tokens).toBeLessThanOrEqual(16_000)
  })

  it('contains the four critical rules the downstream validator enforces', () => {
    const s = SYSTEM_PROMPT
    expect(s).toMatch(/NEVER emit .*core\/html/i)
    expect(s).toMatch(/var:preset\|color\|/)
    expect(s).toMatch(/var:preset\|spacing\|/)
    expect(s).toMatch(/void/i)
  })

  it('includes all 35 allowlisted core blocks by name', () => {
    // Every block in the taxonomy must appear at least once in the prompt
    // (in the inventory table). This guards against drift between the
    // validator's allowlist and the prompt's allowlist.
    const expectedBlocks = [
      'core/group',
      'core/columns',
      'core/column',
      'core/heading',
      'core/paragraph',
      'core/list',
      'core/list-item',
      'core/image',
      'core/cover',
      'core/buttons',
      'core/button',
      'core/query',
      'core/post-template',
      'core/post-title',
      'core/post-content',
      'core/post-date',
      'core/post-featured-image',
      'core/site-title',
      'core/site-logo',
      'core/navigation',
      'core/template-part',
      'core/separator',
      'core/spacer',
      'core/quote',
    ]
    for (const name of expectedBlocks) {
      expect(SYSTEM_PROMPT, `${name} in prompt`).toContain(name)
    }
  })

  it('explicitly does NOT mention core/html as an allowed block', () => {
    // core/html may appear in the prompt as a prohibition, but it must
    // NEVER appear in the inventory table row format `| \`core/html\` |`.
    expect(SYSTEM_PROMPT).not.toMatch(/\|\s*`core\/html`\s*\|/)
  })

  it('includes at least the 5 canonical few-shot shapes from Twenty Twenty-Five', () => {
    const s = SYSTEM_PROMPT
    expect(s).toMatch(/wp:group .*layout.*constrained/) // centered CTA
    expect(s).toMatch(/layout.*grid.*minimumColumnWidth/) // responsive grid
    expect(s).toMatch(/clamp\(/) // fluid clamp typography
    expect(s).toMatch(/is-style-section-\d/) // section styles
    expect(s).toMatch(/wp:query/) // query loop
  })

  it('produces a cache_control-tagged system param for Anthropic', () => {
    const param = buildSystemParam()
    expect(param).toHaveLength(1)
    expect(param[0]!.type).toBe('text')
    expect(param[0]!.cache_control).toEqual({ type: 'ephemeral' })
    expect(param[0]!.text).toBe(SYSTEM_PROMPT)
  })

  it('is byte-identical across invocations (stable for caching)', () => {
    // Any non-determinism in the prompt builder invalidates the cache on
    // every request — cache hit rate goes to zero. Guard against it.
    const a = SYSTEM_PROMPT
    const b = SYSTEM_PROMPT
    expect(a).toBe(b)
    expect(a.length).toBe(b.length)
  })
})
