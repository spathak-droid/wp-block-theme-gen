import { parse as wpParse } from '@wordpress/block-serialization-default-parser'
import { getBlockDef } from '@/lib/blocks/taxonomy'
import type { IRStream } from '@/lib/ir/schema'

type ParsedBlock = {
  blockName: string | null
  attrs: Record<string, unknown>
  innerBlocks: ParsedBlock[]
  innerHTML: string
  innerContent: (string | null)[]
}

/**
 * Parse WordPress block markup into the flat IR stream used throughout the
 * generator. Wraps `@wordpress/block-serialization-default-parser` (pure
 * Node, no DOM dependency) and flattens the recursive tree into tokens.
 *
 * Freeform text outside of any block comment is dropped — themes are
 * expected to be all-blocks, all-the-time (enforced by lint).
 */
export function parse(markup: string): IRStream {
  const tree = wpParse(markup) as ParsedBlock[]
  const out: IRStream = []
  for (const block of tree) {
    if (block.blockName === null) continue // freeform text, skip
    flatten(block, out)
  }
  return out
}

function flatten(block: ParsedBlock, out: IRStream): void {
  if (block.blockName === null) return
  const def = getBlockDef(block.blockName)
  const attrs = block.attrs ?? {}

  if (!def) {
    // Unknown block: preserve it as-is so lint can flag it specifically.
    // Use `open` if it has innerBlocks, `void` otherwise.
    if (block.innerBlocks.length > 0) {
      out.push({ kind: 'open', block: block.blockName, attrs })
      for (const child of block.innerBlocks) flatten(child, out)
      out.push({ kind: 'close' })
    } else {
      out.push({ kind: 'void', block: block.blockName, attrs })
    }
    return
  }

  if (def.isVoid) {
    out.push({ kind: 'void', block: block.blockName, attrs })
    return
  }

  out.push({ kind: 'open', block: block.blockName, attrs })

  if (def.acceptsText && block.innerBlocks.length === 0) {
    const text = extractText(block.blockName, block.innerHTML)
    if (text) out.push({ kind: 'text', content: text })
  } else {
    for (const child of block.innerBlocks) flatten(child, out)
  }

  out.push({ kind: 'close' })
}

/**
 * Extract text content from a text-block's innerHTML by stripping the
 * canonical HTML wrapper. Falls back to the raw innerHTML if no pattern
 * matches (which will round-trip lossily but not crash).
 */
function extractText(blockName: string, innerHTML: string): string {
  const PATTERNS: Record<string, RegExp> = {
    'core/heading': /<h[1-6](?:\s[^>]*)?>([\s\S]*?)<\/h[1-6]>/,
    'core/paragraph': /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/,
    'core/list-item': /<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/,
    'core/button': /<a(?:\s[^>]*)?>([\s\S]*?)<\/a>/,
    'core/quote': /<blockquote(?:\s[^>]*)?>([\s\S]*?)<\/blockquote>/,
  }
  const re = PATTERNS[blockName]
  const trimmed = innerHTML.trim()
  if (!re) return trimmed
  const m = trimmed.match(re)
  return m && m[1] ? unescapeHtml(m[1].trim()) : trimmed
}

function unescapeHtml(s: string): string {
  return s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}
