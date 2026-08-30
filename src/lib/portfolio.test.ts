import { describe, expect, it } from 'vitest'
import { simulateFixedSlots } from './portfolio'
import type { PanicHistoryDay } from '../types'

const day = (date: string, returns: Array<number | null>): PanicHistoryDay => ({
  date, source: 'test', finalized: true,
  candidates: returns.map((netPct, index) => ({
    rank: index + 1, ticker: `T${index}`, company: 'Test', signalDate: null, tradeDate: date,
    changePct: -12, avgValue10: 20e9, open: 100, low: 95, close: 100, entry: 97,
    filled: netPct !== null, status: netPct === null ? 'TIDAK TERISI' : 'TERISI', netPct,
  })),
})

describe('simulateFixedSlots', () => {
  it('keeps unfilled order slots as cash instead of reallocating after the fact', () => {
    const result = simulateFixedSlots([day('2026-01-01', [10, null])], 2)
    expect(result.returnPct).toBeCloseTo(5)
  })

  it('compounds daily slot returns and calculates drawdown', () => {
    const result = simulateFixedSlots([day('2026-01-01', [10]), day('2026-01-02', [-10])], 1)
    expect(result.returnPct).toBeCloseTo(-1)
    expect(result.maxDrawdownPct).toBeCloseTo(-10)
  })
})
