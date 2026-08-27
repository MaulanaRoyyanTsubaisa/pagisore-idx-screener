import type { MarketRow, TradeRecord } from '../types'

const base = [
  ['BBRI', 'Bank Rakyat Indonesia', 4780, 1.68, 512_430_000],
  ['BMRI', 'Bank Mandiri', 6250, 1.55, 487_250_000],
  ['TLKM', 'Telkom Indonesia', 2980, 1.41, 236_410_000],
  ['GOTO', 'GoTo Gojek Tokopedia', 78, 1.82, 142_890_000],
  ['EMTK', 'Elang Mahkota Teknologi', 520, 1.63, 131_420_000],
  ['ASII', 'Astra International', 4920, 1.37, 229_770_000],
  ['UNVR', 'Unilever Indonesia', 2850, 1.26, 118_520_000],
  ['ICBP', 'Indofood CBP Sukses Makmur', 11050, 1.44, 214_160_000],
  ['JPFA', 'Japfa Comfeed Indonesia', 1485, 1.33, 104_110_000],
  ['SMGR', 'Semen Indonesia', 3420, 1.29, 153_600_000],
] as const

export const demoMarket: MarketRow[] = base.map(([ticker, company, price, ratio, value], i) => ({
  ticker, company, price, open: price * .99, low: price * .99, high: price * 1.003, prevLow: price * .98,
  prevHigh: price * .998, volume: Math.round(value / price), value,
  allBidVolume: Math.round(1_000_000 * ratio), allOfferVolume: 1_000_000,
  bidOfferRatio: ratio, signalTime: `09:${String(15 - Math.floor(i / 4)).padStart(2, '0')}:${String(12 + i * 4).padStart(2, '0')}`,
  emaFast: price * .996, emaMid: price * .989, emaSlow: price * .975,
  rsi14: 58 + (i % 6) * 2.1, vwap: price * .992, relativeVolume: 1.55 + (i % 5) * .16,
  buyerInitiatedVolume: 600_000 + i * 17_000, sellerInitiatedVolume: 400_000,
  spreadTicks: i % 3 === 0 ? 2 : 1, orderBookPersistence: 3 + (i % 4),
  source: 'demo',
}))

const tickers = ['BMRI', 'ASII', 'TLKM', 'GOTO', 'ICBP', 'BBRI', 'ANTM', 'JPFA']
export const demoTrades: TradeRecord[] = Array.from({ length: 42 }, (_, i) => {
  const ticker = tickers[i % tickers.length]
  const win = ((i * 7 + 3) % 10) < 6
  const entry = [6150, 4880, 2940, 76, 10900, 4720, 1860, 1460][i % 8]
  const gross = win ? 1.35 + (i % 5) * .24 : -(0.75 + (i % 4) * .31)
  const date = new Date(2026, 7, 26 - Math.floor(i / 2))
  return {
    date: date.toLocaleDateString('id-ID'), ticker, company: demoMarket.find(x => x.ticker === ticker)?.company ?? ticker,
    signalTime: `09:${String(12 + i % 17).padStart(2, '0')}:00`, entry, exit: Math.round(entry * (1 + gross / 100)),
    target: Math.round(entry * 1.02), stop: Math.round(entry * .985), exitMethod: win ? 'Target' : 'Stop',
    grossReturn: gross, netReturn: gross - .3, exact: true,
  }
})
