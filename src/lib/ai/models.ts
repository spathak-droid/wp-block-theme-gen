/**
 * Model selection policy for every AI task in the pipeline.
 *
 * Per presearch §2.7 and dev-docs/research-brief.md F5:
 * - Planner (once per theme): Sonnet 4.6 — deeper reasoning for coherent
 *   style profile + template plan.
 * - Template/Pattern/Repair (5-25 calls per theme): Haiku 4.5 — 5× cheaper
 *   than Sonnet, good at schema-constrained output.
 * - Chat refinement: Sonnet 4.6 — needs to understand intent + target minimal
 *   edit.
 * - Escalation (2× Haiku fail on same template): Sonnet 4.6 — safety net.
 *
 * Default overall budget: <$0.30/theme, targeting ~$0.09.
 *
 * NOTE: The Claude API skill defaults recommend Opus 4.7 for most tasks.
 * We explicitly down-select to Sonnet 4.6 / Haiku 4.5 here because:
 * 1. Planning quality has proven adequate with Sonnet at 5× lower cost.
 * 2. Per-template generation is highly schema-constrained (Structured
 *    Outputs + flat IR); Haiku is sufficient.
 * 3. We escalate to Sonnet automatically on validation failure.
 */

export type Task = 'plan' | 'template' | 'pattern' | 'repair' | 'refine' | 'escalate'

export type ModelId = 'claude-sonnet-4-6' | 'claude-haiku-4-5' | 'claude-opus-4-7'

const ROUTE: Record<Task, ModelId> = {
  plan: 'claude-sonnet-4-6',
  template: 'claude-haiku-4-5',
  pattern: 'claude-haiku-4-5',
  repair: 'claude-haiku-4-5',
  refine: 'claude-sonnet-4-6',
  escalate: 'claude-sonnet-4-6',
}

/**
 * Look up the model to use for a task. Deterministic; no fallback.
 */
export function modelFor(task: Task): ModelId {
  return ROUTE[task]
}

/**
 * Pricing per 1M tokens, USD. Source: dev-docs/research-brief.md F5
 * (Anthropic public pricing as of April 2026). Cache-read price is 10%
 * of base input; 5m-write is 125%; 1h-write is 200%.
 */
export const PRICING: Record<
  ModelId,
  {
    input: number
    output: number
    cacheRead: number
    cacheWrite5m: number
    cacheWrite1h: number
  }
> = {
  'claude-opus-4-7': {
    input: 5.0,
    output: 25.0,
    cacheRead: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
  },
  'claude-sonnet-4-6': {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
  },
  'claude-haiku-4-5': {
    input: 1.0,
    output: 5.0,
    cacheRead: 0.1,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
  },
}
