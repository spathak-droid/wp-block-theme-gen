import { getBlockDef, shortName } from '@/lib/blocks/taxonomy'
import type { IRStream, IRToken } from '@/lib/ir/schema'

/**
 * Serialize a flat IR stream into WordPress block markup.
 *
 * Output example:
 *   <!-- wp:group {"layout":{"type":"constrained"}} -->
 *   <div class="wp-block-group">
 *     <!-- wp:heading --><h2 class="wp-block-heading">Hello</h2><!-- /wp:heading -->
 *   </div>
 *   <!-- /wp:group -->
 *
 * Attribute JSON is placed between the block name and `-->`. If attrs are
 * empty (`{}` or `undefined`), the JSON object is omitted entirely, matching
 * WordPress canonical output.
 */
export function serialize(tokens: IRStream): string {
  type Frame = {
    block: string
    attrs: Record<string, unknown>
    parts: string[]
  }

  const stack: Frame[] = []
  const out: string[] = []

  const pushOutput = (s: string) => {
    if (stack.length === 0) out.push(s)
    else stack[stack.length - 1]!.parts.push(s)
  }

  for (const t of tokens) {
    if (t.kind === 'open') {
      stack.push({ block: t.block, attrs: t.attrs ?? {}, parts: [] })
    } else if (t.kind === 'close') {
      const frame = stack.pop()
      if (!frame) {
        throw new Error(`serialize: close without matching open`)
      }
      const def = getBlockDef(frame.block)
      if (!def) {
        throw new Error(`serialize: unknown block "${frame.block}"`)
      }
      const innerContent = frame.parts.join('')
      const wrapper = def.wrap(frame.attrs, innerContent)
      const attrsJson = serializeAttrs(frame.attrs)
      const short = shortName(frame.block)
      const open = attrsJson ? `<!-- wp:${short} ${attrsJson} -->` : `<!-- wp:${short} -->`
      const close = `<!-- /wp:${short} -->`
      pushOutput(`${open}\n${wrapper}\n${close}`)
    } else if (t.kind === 'void') {
      const def = getBlockDef(t.block)
      if (!def) {
        throw new Error(`serialize: unknown block "${t.block}"`)
      }
      const attrsJson = serializeAttrs(t.attrs ?? {})
      const short = shortName(t.block)
      const marker = attrsJson ? `<!-- wp:${short} ${attrsJson} /-->` : `<!-- wp:${short} /-->`
      pushOutput(marker)
    } else if (t.kind === 'text') {
      pushOutput(escapeHtml(t.content))
    }
  }

  if (stack.length > 0) {
    throw new Error(
      `serialize: ${stack.length} unclosed block(s): ${stack.map((f) => f.block).join(', ')}`,
    )
  }

  return out.join('\n\n')
}

/**
 * Serialize a single token in isolation (mainly for testing).
 */
export function serializeToken(token: IRToken): string {
  if (token.kind === 'close') return `<!-- /wp:??? -->` // not meaningful alone
  return serialize([token, ...(token.kind === 'open' ? [{ kind: 'close' as const }] : [])])
}

/**
 * Produce a compact JSON string for block attrs, with consistent key order.
 * Returns an empty string if attrs is empty (`{}`). WordPress omits the JSON
 * blob entirely for empty-attr blocks, and parser round-trip depends on this.
 */
function serializeAttrs(attrs: Record<string, unknown>): string {
  if (!attrs || Object.keys(attrs).length === 0) return ''
  return JSON.stringify(attrs)
}

/**
 * Minimal HTML escape for text content inside block markup. We only escape
 * characters that have semantic meaning inside the innerHTML wrapper:
 * `<`, `>`, and `&`. Quotes aren't escaped because text tokens can't land
 * inside attribute values in our serializer.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
