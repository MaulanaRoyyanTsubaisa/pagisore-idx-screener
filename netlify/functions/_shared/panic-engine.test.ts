import { describe, expect, it } from 'vitest'
import { classifyPanicTier } from './panic-engine'

describe('classifyPanicTier', () => {
  it('keeps the validated primary bands as Tier A and B', () => {
    expect(classifyPanicTier(-13, 1)).toBe('A')
    expect(classifyPanicTier(-5.5, 1)).toBe('B')
    expect(classifyPanicTier(-10, 1)).toBeNull()
  })

  it('allows the middle Tier C reserve but never promotes it above primary', () => {
    expect(classifyPanicTier(-7, 1)).toBe('C')
    expect(classifyPanicTier(-4, 1)).toBe('C')
  })

  it('requires a negative opening gap for very shallow pullbacks', () => {
    expect(classifyPanicTier(-2, -1)).toBe('C')
    expect(classifyPanicTier(-2, 0)).toBeNull()
    expect(classifyPanicTier(-2, -3.1)).toBeNull()
  })
})
