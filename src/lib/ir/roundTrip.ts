import { parse } from '@/lib/ir/parse'
import { serialize } from '@/lib/ir/serialize'
import type { IRStream, IRToken } from '@/lib/ir/schema'

/**
 * Check that an IR stream survives a serialize → parse → serialize cycle
 * without losing structural information. Returns `{ok: true}` if stable,
 * otherwise `{ok: false, reason, first, second}`.
 *
 * We compare IR streams (not raw markup strings) because whitespace in
 * markup is not load-bearing — what matters is that the block tree
 * reconstructs identically.
 */
export function roundTrip(tokens: IRStream):
  | { ok: true }
  | {
      ok: false
      reason: string
      first: IRStream
      second: IRStream
    } {
  let markup: string
  try {
    markup = serialize(tokens)
  } catch (e) {
    return {
      ok: false,
      reason: `serialize threw: ${(e as Error).message}`,
      first: tokens,
      second: [],
    }
  }

  const parsed = parse(markup)
  const remarkup = serialize(parsed)
  const reparsed = parse(remarkup)

  if (!irEqual(parsed, reparsed)) {
    return {
      ok: false,
      reason: 'serialize(parse(serialize(ir))) diverges from parse(serialize(ir))',
      first: parsed,
      second: reparsed,
    }
  }
  return { ok: true }
}

/**
 * Structural equality for IR streams: same length, same kinds, same block
 * names, same attrs (JSON-equal), same text content.
 */
export function irEqual(a: IRStream, b: IRStream): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!tokenEqual(a[i]!, b[i]!)) return false
  }
  return true
}

function tokenEqual(a: IRToken, b: IRToken): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'close' || b.kind === 'close') return a.kind === b.kind
  if (a.kind === 'text' && b.kind === 'text') return a.content === b.content
  if ((a.kind === 'open' || a.kind === 'void') && (b.kind === 'open' || b.kind === 'void')) {
    if (a.block !== b.block) return false
    return attrsEqual(a.attrs ?? {}, b.attrs ?? {})
  }
  return false
}

function attrsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

function sortKeys(o: unknown): unknown {
  if (o === null || typeof o !== 'object') return o
  if (Array.isArray(o)) return o.map(sortKeys)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o).sort()) {
    out[k] = sortKeys((o as Record<string, unknown>)[k])
  }
  return out
}
