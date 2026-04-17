import { z } from 'zod'
import { BLOCKS, getBlockDef, isKnownBlock } from '@/lib/blocks/taxonomy'

/**
 * Flat IR token stream. Represents a block tree as a linear sequence of
 * tokens — this intentionally avoids a recursive schema because Anthropic
 * Structured Outputs does not support recursion.
 *
 * - `open` / `close` pairs wrap a container block with inner content.
 * - `void` is a self-closing block (e.g. core/site-title, core/post-date).
 * - `text` is inline text content inside a text-accepting block (heading,
 *    paragraph, list-item, button, quote citation).
 */

const attrs = z.record(z.string(), z.unknown()).optional()

export const irOpenSchema = z.object({
  kind: z.literal('open'),
  block: z.string(),
  attrs,
})

export const irCloseSchema = z.object({
  kind: z.literal('close'),
})

export const irVoidSchema = z.object({
  kind: z.literal('void'),
  block: z.string(),
  attrs,
})

export const irTextSchema = z.object({
  kind: z.literal('text'),
  content: z.string(),
})

export const irTokenSchema = z.discriminatedUnion('kind', [
  irOpenSchema,
  irCloseSchema,
  irVoidSchema,
  irTextSchema,
])

export const irStreamSchema = z.array(irTokenSchema)

export type IROpen = z.infer<typeof irOpenSchema>
export type IRClose = z.infer<typeof irCloseSchema>
export type IRVoid = z.infer<typeof irVoidSchema>
export type IRText = z.infer<typeof irTextSchema>
export type IRToken = z.infer<typeof irTokenSchema>
export type IRStream = IRToken[]

/**
 * Extended validation beyond the basic Zod schema. Verifies:
 * - every block name is in the taxonomy (no `core/html`, no unknowns)
 * - open/close balance correctly
 * - void tokens target void blocks; open tokens target non-void blocks
 * - text tokens only appear inside text-accepting blocks
 * - attrs pass the per-block `knownAttrs` Zod schema
 *
 * Returns an array of error messages (empty = valid).
 */
export function validateIRStream(tokens: IRStream): string[] {
  const errors: string[] = []
  const stack: { block: string; index: number }[] = []

  tokens.forEach((t, i) => {
    if (t.kind === 'open') {
      if (!isKnownBlock(t.block)) {
        errors.push(`[token ${i}] unknown block "${t.block}" (not in taxonomy)`)
        return
      }
      const def = getBlockDef(t.block)!
      if (def.isVoid) {
        errors.push(
          `[token ${i}] "${t.block}" is a void block — use {kind:"void"} not {kind:"open"}`,
        )
      }
      const attrResult = def.knownAttrs.safeParse(t.attrs ?? {})
      if (!attrResult.success) {
        errors.push(
          `[token ${i}] attrs for "${t.block}" failed schema: ${attrResult.error.message}`,
        )
      }
      stack.push({ block: t.block, index: i })
    } else if (t.kind === 'close') {
      if (stack.length === 0) {
        errors.push(`[token ${i}] close without matching open`)
      } else {
        stack.pop()
      }
    } else if (t.kind === 'void') {
      if (!isKnownBlock(t.block)) {
        errors.push(`[token ${i}] unknown block "${t.block}"`)
        return
      }
      const def = getBlockDef(t.block)!
      if (!def.isVoid) {
        errors.push(
          `[token ${i}] "${t.block}" is not a void block — use {kind:"open"}/{kind:"close"}`,
        )
      }
      const attrResult = def.knownAttrs.safeParse(t.attrs ?? {})
      if (!attrResult.success) {
        errors.push(
          `[token ${i}] attrs for "${t.block}" failed schema: ${attrResult.error.message}`,
        )
      }
    } else if (t.kind === 'text') {
      const parent = stack[stack.length - 1]
      if (!parent) {
        errors.push(`[token ${i}] text token at top level (must be inside a block)`)
        return
      }
      const def = BLOCKS[parent.block]
      if (!def?.acceptsText) {
        errors.push(`[token ${i}] text inside "${parent.block}" which does not accept text`)
      }
    }
  })

  if (stack.length > 0) {
    const unclosed = stack.map((f) => `${f.block}@${f.index}`).join(', ')
    errors.push(`${stack.length} unclosed block(s): ${unclosed}`)
  }

  return errors
}

export class IRValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`IR stream invalid:\n  - ${errors.join('\n  - ')}`)
    this.name = 'IRValidationError'
  }
}

/**
 * Parse + structural validate in one call. Throws IRValidationError on
 * any failure.
 */
export function parseAndValidateIR(input: unknown): IRStream {
  const parsed = irStreamSchema.parse(input)
  const errors = validateIRStream(parsed)
  if (errors.length > 0) throw new IRValidationError(errors)
  return parsed
}
