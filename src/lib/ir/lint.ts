import { getBlockDef } from '@/lib/blocks/taxonomy'
import type { IRStream } from '@/lib/ir/schema'

export type LintSeverity = 'error' | 'warn'

export type LintIssue = {
  rule: string
  severity: LintSeverity
  message: string
  tokenIndex?: number
  block?: string
}

export type LintContext = {
  /**
   * Known template-part slugs available in the current theme. Used to verify
   * every `core/template-part {slug:"X"}` refers to an existing file in
   * /parts/. Leave undefined to skip this check.
   */
  knownPartSlugs?: Set<string>
}

const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/
const RAW_PX_RE = /(?<![\w-])\d+px\b/

/**
 * Run semantic lint rules over an IR stream. These rules enforce project
 * invariants that the Zod schema can't express on its own (cross-token
 * relationships, string content inspection, forbidden values).
 *
 * Returns all issues — severity is informational. Filter on severity if you
 * want a strict pass/fail gate.
 */
export function lint(tokens: IRStream, ctx: LintContext = {}): LintIssue[] {
  const issues: LintIssue[] = []
  const openStack: { block: string; index: number; sawPostTemplate?: boolean }[] = []

  const push = (i: Omit<LintIssue, 'severity'> & { severity?: LintSeverity }) => {
    issues.push({ severity: i.severity ?? 'error', ...i })
  }

  tokens.forEach((t, i) => {
    if (t.kind === 'open' || t.kind === 'void') {
      // Rule: no core/html (defense-in-depth — taxonomy also excludes it).
      if (t.block === 'core/html') {
        push({
          rule: 'no-core-html',
          message: `core/html is never allowed in generated themes`,
          tokenIndex: i,
          block: t.block,
        })
      }

      const def = getBlockDef(t.block)
      if (!def) {
        push({
          rule: 'unknown-block',
          message: `"${t.block}" is not in the taxonomy — if this is a real core block, add it; otherwise remove`,
          tokenIndex: i,
          block: t.block,
        })
      }

      // Rule: void/open shape matches block definition.
      if (def) {
        if (t.kind === 'void' && !def.isVoid) {
          push({
            rule: 'void-mismatch',
            message: `"${t.block}" is not void — emit as open+close, not void`,
            tokenIndex: i,
            block: t.block,
          })
        }
        if (t.kind === 'open' && def.isVoid) {
          push({
            rule: 'void-mismatch',
            message: `"${t.block}" is void — emit as {kind:"void"}, not open+close`,
            tokenIndex: i,
            block: t.block,
          })
        }
      }

      // Rule: no hardcoded hex or raw px in attrs.
      for (const [k, v] of Object.entries(t.attrs ?? {})) {
        const violations = scanForForbiddenValues(v)
        for (const viol of violations) {
          push({
            rule: viol.rule,
            message: `attr "${k}" on ${t.block}: ${viol.message}`,
            tokenIndex: i,
            block: t.block,
          })
        }
      }

      // Rule: template-part slug must resolve.
      if (t.block === 'core/template-part' && ctx.knownPartSlugs) {
        const slug = (t.attrs ?? {})['slug']
        if (typeof slug !== 'string') {
          push({
            rule: 'template-part-slug',
            message: `core/template-part missing required "slug" attr`,
            tokenIndex: i,
            block: t.block,
          })
        } else if (!ctx.knownPartSlugs.has(slug)) {
          push({
            rule: 'template-part-slug',
            message: `core/template-part slug "${slug}" has no matching file in /parts/`,
            tokenIndex: i,
            block: t.block,
          })
        }
      }

      if (t.kind === 'open') {
        openStack.push({ block: t.block, index: i })
      }
    } else if (t.kind === 'close') {
      const frame = openStack.pop()
      if (!frame) return

      // Rule: core/query must contain a core/post-template child.
      if (frame.block === 'core/query' && !frame.sawPostTemplate) {
        push({
          rule: 'query-needs-post-template',
          message: `core/query has no core/post-template child — empty query will render nothing`,
          tokenIndex: i,
          block: frame.block,
        })
      }

      // Rule: core/columns should have at least one core/column child.
      // We approximate: count inner-block opens between this close and the matching open.
      if (frame.block === 'core/columns') {
        const hasColumn = hasDirectChild(tokens, frame.index, i, 'core/column')
        if (!hasColumn) {
          push({
            rule: 'columns-needs-column',
            message: `core/columns has no core/column children — layout will be empty`,
            tokenIndex: i,
            block: frame.block,
          })
        }
      }

      // Rule: core/buttons should contain at least one core/button.
      if (frame.block === 'core/buttons') {
        const hasButton = hasDirectChild(tokens, frame.index, i, 'core/button')
        if (!hasButton) {
          push({
            rule: 'buttons-needs-button',
            message: `core/buttons has no core/button children`,
            tokenIndex: i,
            block: frame.block,
          })
        }
      }

      // Rule: core/list should contain at least one core/list-item.
      if (frame.block === 'core/list') {
        const hasItem = hasDirectChild(tokens, frame.index, i, 'core/list-item')
        if (!hasItem) {
          push({
            rule: 'list-needs-item',
            message: `core/list has no core/list-item children`,
            tokenIndex: i,
            block: frame.block,
          })
        }
      }
    }

    // Track post-template within a query frame for the query-needs-post-template rule.
    // For `open`, the current frame was just pushed to the top of openStack, so the
    // actual parent (the query we care about) is one level deeper.
    if ((t.kind === 'open' || t.kind === 'void') && t.block === 'core/post-template') {
      const parentIdx = t.kind === 'open' ? openStack.length - 2 : openStack.length - 1
      const parent = openStack[parentIdx]
      if (parent && parent.block === 'core/query') parent.sawPostTemplate = true
    }
  })

  return issues
}

/**
 * Scan an arbitrary attribute value (which may be a string, object, array,
 * etc.) for forbidden literal values: hex colors or raw pixel sizes.
 * Recursive — walks nested objects/arrays too.
 */
function scanForForbiddenValues(
  v: unknown,
): Array<{ rule: 'no-hex-color' | 'no-raw-px'; message: string }> {
  const out: Array<{ rule: 'no-hex-color' | 'no-raw-px'; message: string }> = []
  const walk = (val: unknown): void => {
    if (typeof val === 'string') {
      if (HEX_COLOR_RE.test(val)) {
        out.push({
          rule: 'no-hex-color',
          message: `contains hex color "${val}" — use a preset slug like var:preset|color|accent-1`,
        })
      }
      if (RAW_PX_RE.test(val)) {
        out.push({
          rule: 'no-raw-px',
          message: `contains raw px value "${val}" — use a preset slug like var:preset|spacing|50`,
        })
      }
    } else if (Array.isArray(val)) {
      val.forEach(walk)
    } else if (val && typeof val === 'object') {
      for (const k of Object.keys(val as Record<string, unknown>)) {
        walk((val as Record<string, unknown>)[k])
      }
    }
  }
  walk(v)
  return out
}

/**
 * Check whether a direct child of the block opened at `openIndex` and
 * closed at `closeIndex` has the given block name. Direct child means
 * nested depth 1 — grandchildren don't count.
 */
function hasDirectChild(
  tokens: IRStream,
  openIndex: number,
  closeIndex: number,
  childBlock: string,
): boolean {
  let depth = 0
  for (let i = openIndex + 1; i < closeIndex; i++) {
    const t = tokens[i]!
    if (t.kind === 'open') {
      if (depth === 0 && t.block === childBlock) return true
      depth++
    } else if (t.kind === 'close') {
      depth--
    } else if (t.kind === 'void') {
      if (depth === 0 && t.block === childBlock) return true
    }
  }
  return false
}

/**
 * Convenience: lint and return only errors (not warnings). Use as a
 * pass/fail gate in CI.
 */
export function lintErrors(tokens: IRStream, ctx?: LintContext): LintIssue[] {
  return lint(tokens, ctx).filter((x) => x.severity === 'error')
}
