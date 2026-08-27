import { describe, expect, it } from 'vitest'
import { backtestRows, calculateStats, evaluateRow, parseCsv } from './strategy'
import { demoMarket, demoTrades } from '../data/demo'

const settings = { minValue: 100_000_000, minBidOfferRatio: 1.3, transactionCost: .3, targetPct: 1, stopPct: .9, requireExactOrderBook: true, strategyMode: 'balanced' as const, rsiMin: 55, rsiMax: 72, minRelativeVolume: 1.5, minCandleBodyRatio: .45, minCloseLocation: .65, minBuyFlow: .55, maxSpreadTicks: 2, minOrderBookPersistence: 3 }

describe('strategy engine', () => {
  it('accepts a row that satisfies the exact formula', () => expect(evaluateRow(demoMarket[0], settings)?.exact).toBe(true))
  it('rounds the target up so the requested gross target is not understated', () => {
    const signal = evaluateRow(demoMarket[3], settings)!
    expect(((signal.target / signal.price) - 1) * 100).toBeGreaterThanOrEqual(settings.targetPct)
  })

  it('uses one exact buy-limit price so the entry can never overtake the target', () => {
    const signal = evaluateRow(demoMarket[3], settings)!
    expect(signal.entryHigh).toBe(signal.entryLow)
    expect(signal.entryHigh).toBeLessThan(signal.target)
  })
  it('rejects proxy data when exact book is required', () => expect(evaluateRow({ ...demoMarket[0], allBidVolume: undefined, allOfferVolume: undefined }, settings)).toBeNull())
  it('accepts price-core proxy data without inventing a bid/offer ratio', () => {
    const proxy = { ...demoMarket[0], allBidVolume: undefined, allOfferVolume: undefined, bidOfferRatio: undefined, source: 'proxy' as const }
    const result = evaluateRow(proxy, { ...settings, requireExactOrderBook: false, strategyMode: 'original' })
    expect(result?.exact).toBe(false)
    expect(result?.bidOfferRatio).toBeUndefined()
  })
  it('rejects an overheated RSI in balanced mode when confirmations become insufficient', () => {
    const weak = { ...demoMarket[0], rsi14: 84, relativeVolume: .7, vwap: demoMarket[0].price * 1.01 }
    expect(evaluateRow(weak, settings)).toBeNull()
  })
  it('computes finite backtest stats', () => expect(Number.isFinite(calculateStats(demoTrades).maxDrawdown)).toBe(true))
  it('uses a conservative stop when both target and stop are touched', () => {
    const row = { ...demoMarket[0], close: 4800, futureHigh: 5000, futureLow: 4600 }
    expect(backtestRows([row], settings)[0].exitMethod).toBe('Stop')
  })
  it('validates CSV headers', () => expect(() => parseCsv('ticker,open\nBBRI,10')).toThrow(/Kolom wajib/))
})
