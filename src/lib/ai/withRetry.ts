import Anthropic from '@anthropic-ai/sdk'

/**
 * Retry policy for Anthropic API calls. The SDK itself retries 5xx and
 * 429 twice by default — we wrap with explicit backoff so callers can:
 * - configure attempt count per task (planner gets more patience than
 *   per-template calls)
 * - observe each retry via the onRetry hook (for cost tracking and
 *   structured logs)
 * - short-circuit non-retryable errors (400 bad request, 401 auth) fast
 */

export type RetryOptions = {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number
  /** Base delay in ms for exponential backoff. Default 500ms. */
  baseDelayMs?: number
  /** Max delay in ms. Default 10_000 (10s). */
  maxDelayMs?: number
  /** Called on each retryable failure, before sleeping. */
  onRetry?: (attempt: number, err: unknown, nextDelayMs: number) => void
}

/**
 * Retry an async operation with exponential backoff, but only for
 * retryable API errors (5xx and 429). All other errors bubble
 * immediately. See shared/error-codes.md for the classification.
 */
export async function withRetry<T>(op: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelay = opts.baseDelayMs ?? 500
  const maxDelay = opts.maxDelayMs ?? 10_000

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await op()
    } catch (err) {
      lastErr = err
      if (!isRetryable(err) || attempt === maxAttempts) throw err

      const delay = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1))
      // Honor explicit retry-after header if the SDK surfaces it.
      const retryAfter = getRetryAfterMs(err)
      const sleepFor = retryAfter ?? delay

      opts.onRetry?.(attempt, err, sleepFor)
      await sleep(sleepFor)
    }
  }
  // Unreachable — loop above either returns or throws — but TS needs it.
  throw lastErr
}

/**
 * A 5xx or 429 from Anthropic is retryable. Network errors (no status)
 * are also retryable — the SDK surfaces these as APIError.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true
  if (err instanceof Anthropic.InternalServerError) return true
  if (err instanceof Anthropic.APIConnectionError) return true
  // Generic APIError with 5xx status (covers 502/503/504 which don't
  // have dedicated subclasses in SDK 0.90).
  if (err instanceof Anthropic.APIError && typeof err.status === 'number' && err.status >= 500) {
    return true
  }
  return false
}

function getRetryAfterMs(err: unknown): number | null {
  if (err instanceof Anthropic.APIError) {
    const headers = err.headers as Record<string, string | undefined> | undefined
    const ra = headers?.['retry-after']
    if (ra) {
      const secs = Number(ra)
      if (!Number.isNaN(secs) && secs > 0) return Math.min(secs * 1000, 30_000)
    }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
