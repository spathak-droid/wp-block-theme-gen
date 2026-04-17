import { describe, it, expect } from 'vitest'
import {
  BLOCKS,
  CORE_BLOCK_NAMES,
  EXPECTED_BLOCK_COUNT,
  fullName,
  getBlockDef,
  isKnownBlock,
  shortName,
} from '@/lib/blocks/taxonomy'

describe('blocks/taxonomy', () => {
  it('ships exactly 35 core blocks', () => {
    expect(CORE_BLOCK_NAMES).toHaveLength(EXPECTED_BLOCK_COUNT)
    expect(CORE_BLOCK_NAMES).toHaveLength(35)
  })

  it('NEVER includes core/html — this is the defining project rule', () => {
    expect(CORE_BLOCK_NAMES).not.toContain('core/html')
    expect(isKnownBlock('core/html')).toBe(false)
    expect(getBlockDef('core/html')).toBeUndefined()
  })

  it('every block name starts with "core/"', () => {
    for (const name of CORE_BLOCK_NAMES) {
      expect(name.startsWith('core/')).toBe(true)
    }
  })

  it('every block has a coherent definition (flags, category, wrap, schema)', () => {
    for (const [name, def] of Object.entries(BLOCKS)) {
      expect(def.name, `${name}.name`).toBe(name)
      expect(typeof def.isVoid, `${name}.isVoid`).toBe('boolean')
      expect(typeof def.acceptsInnerBlocks, `${name}.acceptsInnerBlocks`).toBe('boolean')
      expect(typeof def.acceptsText, `${name}.acceptsText`).toBe('boolean')
      expect(typeof def.wrap, `${name}.wrap`).toBe('function')
      expect(def.category, `${name}.category`).toBeDefined()
      // Void blocks cannot accept inner blocks or text.
      if (def.isVoid) {
        expect(def.acceptsInnerBlocks, `${name} void+innerBlocks`).toBe(false)
        expect(def.acceptsText, `${name} void+text`).toBe(false)
      }
    }
  })

  it('shortName / fullName round-trip for all blocks', () => {
    for (const name of CORE_BLOCK_NAMES) {
      expect(fullName(shortName(name))).toBe(name)
    }
    expect(shortName('core/group')).toBe('group')
    expect(shortName('core/post-title')).toBe('post-title')
    expect(fullName('group')).toBe('core/group')
  })

  it('covers every planned category', () => {
    const seen = new Set(Object.values(BLOCKS).map((b) => b.category))
    const expected = [
      'structure',
      'spacing',
      'reusability',
      'typography',
      'quote',
      'media',
      'cta',
      'query',
      'post-binding',
      'site-binding',
      'navigation',
    ]
    for (const cat of expected) expect(seen).toContain(cat)
  })

  it('known text-accepting blocks match the expected list', () => {
    const textBlocks = Object.entries(BLOCKS)
      .filter(([, def]) => def.acceptsText)
      .map(([name]) => name)
      .sort()
    expect(textBlocks).toEqual(
      ['core/button', 'core/heading', 'core/list-item', 'core/paragraph'].sort(),
    )
  })
})
