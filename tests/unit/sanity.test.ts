import { describe, it, expect } from 'vitest'

describe('sanity', () => {
  it('runs a test', () => {
    expect(1 + 1).toBe(2)
  })

  it('supports async', async () => {
    const v = await Promise.resolve(42)
    expect(v).toBe(42)
  })
})
