import Anthropic from '@anthropic-ai/sdk'
import { env } from '@/lib/env'

/**
 * The global Anthropic client. Lazily instantiated on first use so that
 * modules importing from `@/lib/ai/client` in a context where the env
 * hasn't been validated yet (e.g. unit tests) don't immediately throw.
 *
 * The client is server-side only — `ANTHROPIC_API_KEY` is never exposed
 * to the browser. Downstream callers should always go through the
 * session-scoped wrappers (planner, templateGen, etc.) rather than
 * hitting the client directly, so we can attach cost tracking + retry.
 */
let cached: Anthropic | null = null

export function getAnthropic(): Anthropic {
  if (cached) return cached
  cached = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY })
  return cached
}

/**
 * Inject a test double — used only by vitest. Calling this from app code
 * bypasses env validation and is a bug.
 */
export function __setAnthropicForTest(instance: Anthropic | null): void {
  cached = instance
}

export type { Anthropic }
