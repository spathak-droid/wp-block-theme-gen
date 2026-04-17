import type Anthropic from '@anthropic-ai/sdk'
import { PRICING, type ModelId, type Task } from '@/lib/ai/models'

/**
 * Cost tracker for a single theme-generation session. Every LLM call
 * registers its usage (input/output/cache hits) here; we sum to a
 * dollar total and per-model breakdown, and log if the session blows
 * past the <$0.30/theme ceiling from the PRD.
 *
 * Intentionally not a global singleton — one instance per session so
 * concurrent generations don't bleed into each other's totals.
 */

export type CallRecord = {
  /** Task type that routed this call. */
  task: Task
  /** Model that actually handled the call. */
  model: ModelId
  /** Fresh (uncached) input tokens billed at full input price. */
  inputTokens: number
  /** Output tokens. */
  outputTokens: number
  /** Tokens served from cache at ~10% of input cost. */
  cacheReadTokens: number
  /** Tokens written to cache at 125% of input cost (5m TTL). */
  cacheWriteTokens: number
  /** Unix ms timestamp of when the call completed. */
  timestamp: number
  /** Dollar cost of this call. */
  costUsd: number
}

export type Totals = {
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

/** Derive a CallRecord from an Anthropic Message's usage block. */
export function recordFromUsage(args: {
  task: Task
  model: ModelId
  usage: Anthropic.Usage
}): CallRecord {
  const { task, model, usage } = args
  const price = PRICING[model]
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0

  const costUsd =
    (inputTokens * price.input +
      outputTokens * price.output +
      cacheReadTokens * price.cacheRead +
      cacheWriteTokens * price.cacheWrite5m) /
    1_000_000

  return {
    task,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    timestamp: Date.now(),
    costUsd,
  }
}

export class CostTracker {
  private readonly records: CallRecord[] = []

  /** Add a completed call record. */
  record(rec: CallRecord): void {
    this.records.push(rec)
  }

  /** Convenience: take the raw Anthropic usage and derive + record. */
  recordUsage(args: { task: Task; model: ModelId; usage: Anthropic.Usage }): CallRecord {
    const rec = recordFromUsage(args)
    this.records.push(rec)
    return rec
  }

  /** Running totals across all recorded calls. */
  totals(): Totals {
    return this.records.reduce<Totals>(
      (acc, r) => ({
        calls: acc.calls + 1,
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
        cacheWriteTokens: acc.cacheWriteTokens + r.cacheWriteTokens,
        costUsd: acc.costUsd + r.costUsd,
      }),
      {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
    )
  }

  /** Per-model breakdown. Useful for understanding where budget went. */
  byModel(): Record<ModelId, Totals> {
    const out: Partial<Record<ModelId, Totals>> = {}
    for (const r of this.records) {
      const t = out[r.model] ?? {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      }
      out[r.model] = {
        calls: t.calls + 1,
        inputTokens: t.inputTokens + r.inputTokens,
        outputTokens: t.outputTokens + r.outputTokens,
        cacheReadTokens: t.cacheReadTokens + r.cacheReadTokens,
        cacheWriteTokens: t.cacheWriteTokens + r.cacheWriteTokens,
        costUsd: t.costUsd + r.costUsd,
      }
    }
    return out as Record<ModelId, Totals>
  }

  /** All records in chronological order. */
  all(): readonly CallRecord[] {
    return this.records
  }

  /** True if the session has exceeded the given USD ceiling. */
  exceeds(ceilingUsd: number): boolean {
    return this.totals().costUsd > ceilingUsd
  }
}
