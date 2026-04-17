import { describe, it, expect } from 'vitest'
import { lint, lintErrors } from '@/lib/ir/lint'
import type { IRStream } from '@/lib/ir/schema'

describe('ir/lint', () => {
  it('passes clean IR with no issues', () => {
    const ir: IRStream = [
      { kind: 'open', block: 'core/heading', attrs: { level: 2 } },
      { kind: 'text', content: 'Clean heading' },
      { kind: 'close' },
    ]
    expect(lintErrors(ir)).toEqual([])
  })

  it('flags core/html anywhere in the stream', () => {
    // Even though taxonomy excludes it, the lint rule is defense-in-depth.
    const ir: IRStream = [{ kind: 'open', block: 'core/html' }, { kind: 'close' }]
    const issues = lint(ir)
    expect(issues.some((i) => i.rule === 'no-core-html')).toBe(true)
  })

  it('flags hex color values in attrs', () => {
    const ir: IRStream = [
      {
        kind: 'open',
        block: 'core/group',
        attrs: { style: { color: { background: '#FF5733' } } },
      },
      { kind: 'close' },
    ]
    const issues = lintErrors(ir)
    expect(issues.some((i) => i.rule === 'no-hex-color')).toBe(true)
  })

  it('flags raw px values in attrs', () => {
    const ir: IRStream = [
      {
        kind: 'open',
        block: 'core/group',
        attrs: { style: { spacing: { padding: { top: '40px' } } } },
      },
      { kind: 'close' },
    ]
    const issues = lintErrors(ir)
    expect(issues.some((i) => i.rule === 'no-raw-px')).toBe(true)
  })

  it('flags open used for void block', () => {
    const ir: IRStream = [{ kind: 'open', block: 'core/site-title' }, { kind: 'close' }]
    expect(lintErrors(ir).some((i) => i.rule === 'void-mismatch')).toBe(true)
  })

  it('flags void used for a non-void block', () => {
    const ir: IRStream = [{ kind: 'void', block: 'core/group' }]
    expect(lintErrors(ir).some((i) => i.rule === 'void-mismatch')).toBe(true)
  })

  it('flags core/query without a core/post-template child', () => {
    const ir: IRStream = [
      { kind: 'open', block: 'core/query', attrs: { query: { perPage: 5 } } },
      { kind: 'close' },
    ]
    expect(lintErrors(ir).some((i) => i.rule === 'query-needs-post-template')).toBe(true)
  })

  it('passes core/query with a post-template child', () => {
    const ir: IRStream = [
      { kind: 'open', block: 'core/query' },
      { kind: 'open', block: 'core/post-template' },
      { kind: 'void', block: 'core/post-title' },
      { kind: 'close' },
      { kind: 'close' },
    ]
    expect(lintErrors(ir).some((i) => i.rule === 'query-needs-post-template')).toBe(false)
  })

  it('flags empty core/columns (no column child)', () => {
    const ir: IRStream = [{ kind: 'open', block: 'core/columns' }, { kind: 'close' }]
    expect(lintErrors(ir).some((i) => i.rule === 'columns-needs-column')).toBe(true)
  })

  it('flags empty core/buttons and core/list', () => {
    const ir1: IRStream = [{ kind: 'open', block: 'core/buttons' }, { kind: 'close' }]
    expect(lintErrors(ir1).some((i) => i.rule === 'buttons-needs-button')).toBe(true)

    const ir2: IRStream = [{ kind: 'open', block: 'core/list' }, { kind: 'close' }]
    expect(lintErrors(ir2).some((i) => i.rule === 'list-needs-item')).toBe(true)
  })

  it('flags template-part with unresolved slug', () => {
    const ir: IRStream = [{ kind: 'void', block: 'core/template-part', attrs: { slug: 'missing' } }]
    const issues = lintErrors(ir, { knownPartSlugs: new Set(['header', 'footer']) })
    expect(issues.some((i) => i.rule === 'template-part-slug')).toBe(true)
  })

  it('passes template-part with resolved slug', () => {
    const ir: IRStream = [{ kind: 'void', block: 'core/template-part', attrs: { slug: 'header' } }]
    const issues = lintErrors(ir, { knownPartSlugs: new Set(['header', 'footer']) })
    expect(issues.some((i) => i.rule === 'template-part-slug')).toBe(false)
  })

  it('scans nested objects + arrays for forbidden values', () => {
    const ir: IRStream = [
      {
        kind: 'open',
        block: 'core/group',
        attrs: {
          style: {
            border: {
              top: { width: '2px' },
              sides: ['1px', 'var:preset|spacing|30'],
            },
          },
        },
      },
      { kind: 'close' },
    ]
    const issues = lint(ir)
    expect(issues.filter((i) => i.rule === 'no-raw-px').length).toBeGreaterThanOrEqual(2)
  })
})
