import { describe, expect, it } from 'vitest'
import { backtestRows, calculateStats, evaluateRow, parseCsv } from './strategy'
import { demoMarket, demoTrades } from '../data/demo'

const settings = { minValue: 100_000_000, minBidOfferRatio: 1, transactionCost: .3, targetPct: 2, stopPct: 1.5, requireExactOrderBook: true }

describe('strategy engine', () => {
  it('accepts a row that satisfies the exact formula', () => expect(evaluateRow(demoMarket[0], settings)?.exact).toBe(true))
  it('rejects proxy data when exact book is required', () => expect(evaluateRow({ ...demoMarket[0], allBidVolume: undefined, allOfferVolume: undefined }, settings)).toBeNull())
  it('computes finite backtest stats', () => expect(Number.isFinite(calculateStats(demoTrades).maxDrawdown)).toBe(true))
  it('uses a conservative stop when both target and stop are touched', () => {
    const row = { ...demoMarket[0], close: 4800, futureHigh: 5000, futureLow: 4600 }
    expect(backtestRows([row], settings)[0].exitMethod).toBe('Stop')
  })
  it('validates CSV headers', () => expect(() => parseCsv('ticker,open\nBBRI,10')).toThrow(/Kolom wajib/))
})
