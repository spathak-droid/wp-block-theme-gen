import { describe, it, expect } from 'vitest'
import {
  irStreamSchema,
  parseAndValidateIR,
  validateIRStream,
  IRValidationError,
} from '@/lib/ir/schema'
import type { IRStream } from '@/lib/ir/schema'
import { serialize } from '@/lib/ir/serialize'
import { parse } from '@/lib/ir/parse'
import { irEqual, roundTrip } from '@/lib/ir/roundTrip'

describe('ir/schema', () => {
  it('accepts a minimal valid stream', () => {
    const ir: IRStream = [
      { kind: 'open', block: 'core/heading', attrs: { level: 2 } },
      { kind: 'text', content: 'Hello' },
      { kind: 'close' },
    ]
    expect(() => irStreamSchema.parse(ir)).not.toThrow()
    expect(validateIRStream(ir)).toEqual([])
  })

  it('rejects unknown block names at the semantic layer', () => {
    const ir: IRStream = [{ kind: 'open', block: 'core/html', attrs: {} }, { kind: 'close' }]
    const errors = validateIRStream(ir)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(' ')).toContain('core/html')
  })

  it('flags open used for a void block', () => {
    const ir: IRStream = [{ kind: 'open', block: 'core/site-title' }, { kind: 'close' }]
    const errors = validateIRStream(ir)
    expect(errors.join(' ')).toMatch(/void/i)
  })

  it('flags void used for a non-void block', () => {
    const ir: IRStream = [{ kind: 'void', block: 'core/group' }]
    const errors = validateIRStream(ir)
    expect(errors.join(' ')).toMatch(/not a void/i)
  })

  it('catches unbalanced open/close', () => {
    const ir: IRStream = [{ kind: 'open', block: 'core/group' }]
    expect(validateIRStream(ir).join(' ')).toMatch(/unclosed/i)

    const ir2: IRStream = [{ kind: 'close' }]
    expect(validateIRStream(ir2).join(' ')).toMatch(/without matching open/i)
  })

  it('rejects text tokens at top level', () => {
    const ir: IRStream = [{ kind: 'text', content: 'orphan' }]
    expect(validateIRStream(ir).join(' ')).toMatch(/top level/i)
  })

  it('rejects text inside a non-text-accepting block', () => {
    const ir: IRStream = [
      { kind: 'open', block: 'core/group' },
      { kind: 'text', content: 'nope' },
      { kind: 'close' },
    ]
    expect(validateIRStream(ir).join(' ')).toMatch(/does not accept text/)
  })

  it('parseAndValidateIR throws IRValidationError with details', () => {
    try {
      parseAndValidateIR([{ kind: 'close' }])
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(IRValidationError)
      expect((e as IRValidationError).errors.length).toBeGreaterThan(0)
    }
  })
})

describe('ir/serialize', () => {
  it('emits an empty string for an empty stream', () => {
    expect(serialize([])).toBe('')
  })

  it('serializes a void block with no attrs using the /--> form', () => {
    const out = serialize([{ kind: 'void', block: 'core/site-title' }])
    expect(out).toBe('<!-- wp:site-title /-->')
  })

  it('serializes a void block with attrs as JSON', () => {
    const out = serialize([
      { kind: 'void', block: 'core/post-title', attrs: { isLink: true, level: 2 } },
    ])
    expect(out).toBe('<!-- wp:post-title {"isLink":true,"level":2} /-->')
  })

  it('omits empty attrs JSON entirely (matches WP canonical output)', () => {
    const out = serialize([
      { kind: 'open', block: 'core/heading' },
      { kind: 'text', content: 'Hi' },
      { kind: 'close' },
    ])
    expect(out).not.toContain('{}')
    expect(out).toContain('<!-- wp:heading -->')
  })

  it('serializes a heading with a dynamic tag based on level attr', () => {
    const h3 = serialize([
      { kind: 'open', block: 'core/heading', attrs: { level: 3 } },
      { kind: 'text', content: 'Section' },
      { kind: 'close' },
    ])
    expect(h3).toContain('<h3 class="wp-block-heading">Section</h3>')
  })

  it('serializes a group containing a heading child', () => {
    const ir: IRStream = [
      { kind: 'open', block: 'core/group', attrs: { layout: { type: 'constrained' } } },
      { kind: 'open', block: 'core/heading', attrs: { level: 2 } },
      { kind: 'text', content: 'Welcome' },
      { kind: 'close' },
      { kind: 'close' },
    ]
    const out = serialize(ir)
    expect(out).toContain('<!-- wp:group {"layout":{"type":"constrained"}} -->')
    expect(out).toContain('<div class="wp-block-group">')
    expect(out).toContain('<h2 class="wp-block-heading">Welcome</h2>')
    expect(out).toContain('<!-- /wp:heading -->')
    expect(out).toContain('<!-- /wp:group -->')
  })

  it('escapes HTML special chars in text content', () => {
    const out = serialize([
      { kind: 'open', block: 'core/paragraph' },
      { kind: 'text', content: 'a < b & c > d' },
      { kind: 'close' },
    ])
    expect(out).toContain('a &lt; b &amp; c &gt; d')
  })

  it('throws on unclosed frames', () => {
    expect(() => serialize([{ kind: 'open', block: 'core/group' }])).toThrow(/unclosed/)
  })
})

describe('ir/parse', () => {
  it('parses a bare void block', () => {
    const ir = parse('<!-- wp:site-title /-->')
    expect(ir).toEqual([{ kind: 'void', block: 'core/site-title', attrs: {} }])
  })

  it('parses a void block with attrs', () => {
    const ir = parse('<!-- wp:post-title {"isLink":true,"level":2} /-->')
    expect(ir).toEqual([
      { kind: 'void', block: 'core/post-title', attrs: { isLink: true, level: 2 } },
    ])
  })

  it('parses a heading + text back to open/text/close', () => {
    const markup = `<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">Hello</h2><!-- /wp:heading -->`
    const ir = parse(markup)
    expect(ir).toEqual([
      { kind: 'open', block: 'core/heading', attrs: { level: 2 } },
      { kind: 'text', content: 'Hello' },
      { kind: 'close' },
    ])
  })

  it('parses a group containing a heading', () => {
    const markup =
      `<!-- wp:group --><div class="wp-block-group">` +
      `<!-- wp:heading --><h2 class="wp-block-heading">H</h2><!-- /wp:heading -->` +
      `</div><!-- /wp:group -->`
    const ir = parse(markup)
    expect(ir[0]).toEqual({ kind: 'open', block: 'core/group', attrs: {} })
    expect(ir[1]).toEqual({ kind: 'open', block: 'core/heading', attrs: {} })
    expect(ir[2]).toEqual({ kind: 'text', content: 'H' })
    expect(ir[3]).toEqual({ kind: 'close' })
    expect(ir[4]).toEqual({ kind: 'close' })
  })
})

describe('ir/roundTrip', () => {
  const cases: { name: string; ir: IRStream }[] = [
    {
      name: 'single void (site-title)',
      ir: [{ kind: 'void', block: 'core/site-title' }],
    },
    {
      name: 'void with attrs (post-date)',
      ir: [{ kind: 'void', block: 'core/post-date', attrs: { format: 'F j, Y', isLink: false } }],
    },
    {
      name: 'heading with text',
      ir: [
        { kind: 'open', block: 'core/heading', attrs: { level: 2 } },
        { kind: 'text', content: 'Welcome to the site' },
        { kind: 'close' },
      ],
    },
    {
      name: 'paragraph with align',
      ir: [
        { kind: 'open', block: 'core/paragraph', attrs: { align: 'center' } },
        { kind: 'text', content: 'A centered paragraph.' },
        { kind: 'close' },
      ],
    },
    {
      name: 'group > heading + paragraph',
      ir: [
        { kind: 'open', block: 'core/group', attrs: { layout: { type: 'constrained' } } },
        { kind: 'open', block: 'core/heading', attrs: { level: 2 } },
        { kind: 'text', content: 'Hello' },
        { kind: 'close' },
        { kind: 'open', block: 'core/paragraph' },
        { kind: 'text', content: 'World.' },
        { kind: 'close' },
        { kind: 'close' },
      ],
    },
    {
      name: 'columns > column > heading',
      ir: [
        { kind: 'open', block: 'core/columns' },
        { kind: 'open', block: 'core/column', attrs: { width: '50%' } },
        { kind: 'open', block: 'core/heading', attrs: { level: 3 } },
        { kind: 'text', content: 'Left' },
        { kind: 'close' },
        { kind: 'close' },
        { kind: 'open', block: 'core/column', attrs: { width: '50%' } },
        { kind: 'open', block: 'core/heading', attrs: { level: 3 } },
        { kind: 'text', content: 'Right' },
        { kind: 'close' },
        { kind: 'close' },
        { kind: 'close' },
      ],
    },
    {
      name: 'query > post-template > post-title/date',
      ir: [
        {
          kind: 'open',
          block: 'core/query',
          attrs: { query: { perPage: 8, postType: 'post', inherit: true } },
        },
        { kind: 'open', block: 'core/post-template' },
        { kind: 'void', block: 'core/post-title', attrs: { isLink: true, level: 3 } },
        { kind: 'void', block: 'core/post-date' },
        { kind: 'close' },
        { kind: 'close' },
      ],
    },
    {
      name: 'buttons > button with text',
      ir: [
        { kind: 'open', block: 'core/buttons' },
        { kind: 'open', block: 'core/button' },
        { kind: 'text', content: 'Learn more' },
        { kind: 'close' },
        { kind: 'close' },
      ],
    },
    {
      name: 'cover > heading (nested container)',
      ir: [
        {
          kind: 'open',
          block: 'core/cover',
          attrs: { dimRatio: 50, overlayColor: 'accent-1', isDark: true },
        },
        { kind: 'open', block: 'core/heading', attrs: { level: 1, textAlign: 'center' } },
        { kind: 'text', content: 'Hero' },
        { kind: 'close' },
        { kind: 'close' },
      ],
    },
    {
      name: 'template-part self-closing',
      ir: [
        { kind: 'void', block: 'core/template-part', attrs: { slug: 'header', area: 'header' } },
      ],
    },
  ]

  for (const { name, ir } of cases) {
    it(`round-trips: ${name}`, () => {
      const result = roundTrip(ir)
      if (!result.ok) {
        throw new Error(
          `round-trip failed for ${name}: ${result.reason}\n` +
            `first: ${JSON.stringify(result.first, null, 2)}\n` +
            `second: ${JSON.stringify(result.second, null, 2)}`,
        )
      }
      expect(result.ok).toBe(true)
    })
  }

  it('irEqual detects structural differences', () => {
    expect(
      irEqual(
        [{ kind: 'void', block: 'core/site-title' }],
        [{ kind: 'void', block: 'core/site-logo' }],
      ),
    ).toBe(false)
    expect(
      irEqual(
        [{ kind: 'void', block: 'core/site-title' }],
        [{ kind: 'void', block: 'core/site-title' }],
      ),
    ).toBe(true)
  })

  it('irEqual treats same attrs regardless of key order as equal', () => {
    expect(
      irEqual(
        [{ kind: 'void', block: 'core/post-date', attrs: { isLink: true, format: 'F j, Y' } }],
        [{ kind: 'void', block: 'core/post-date', attrs: { format: 'F j, Y', isLink: true } }],
      ),
    ).toBe(true)
  })
})
