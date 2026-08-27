import type { BacktestStats, MarketRow, ScreenerSettings, Signal, TradeRecord } from '../types'
import { roundToTick, roundUpToTick, tickSize } from './format'

export const evaluateRow = (row: MarketRow, settings: ScreenerSettings): Signal | null => {
  const ratio = row.bidOfferRatio ?? ((row.allBidVolume !== undefined && row.allOfferVolume !== undefined)
    ? row.allBidVolume / Math.max(1, row.allOfferVolume) : undefined)
  const exact = row.allBidVolume !== undefined && row.allOfferVolume !== undefined
  const baseChecks = [
    Math.abs(row.open - row.low) < 0.0001,
    exact ? (row.allBidVolume ?? 0) > (row.allOfferVolume ?? 0) : !settings.requireExactOrderBook,
    row.high > row.prevHigh,
    row.low > row.prevLow,
    row.value > settings.minValue,
    exact ? (ratio ?? 0) >= settings.minBidOfferRatio : !settings.requireExactOrderBook,
  ]
  if (!baseChecks.every(Boolean)) return null

  const range = Math.max(tickSize(row.price), row.high - row.low)
  const bodyRatio = Math.abs(row.price - row.open) / range
  const closeLocation = (row.price - row.low) / range
  const upperWickRatio = (row.high - row.price) / range
  const buyFlow = row.buyerInitiatedVolume !== undefined && row.sellerInitiatedVolume !== undefined
    ? row.buyerInitiatedVolume / Math.max(1, row.buyerInitiatedVolume + row.sellerInitiatedVolume) : undefined
  const confirmations = [
    { pass: row.emaFast !== undefined && row.emaMid !== undefined && row.emaSlow !== undefined && row.emaFast > row.emaMid && row.emaMid > row.emaSlow, label: 'EMA 10 > EMA 20 > EMA 50' },
    { pass: row.vwap !== undefined && row.price > row.vwap, label: 'Harga di atas VWAP' },
    { pass: row.rsi14 !== undefined && row.rsi14 >= settings.rsiMin && row.rsi14 <= settings.rsiMax, label: `RSI ${settings.rsiMin}–${settings.rsiMax}` },
    { pass: row.relativeVolume !== undefined && row.relativeVolume >= settings.minRelativeVolume, label: `Relative volume ≥ ${settings.minRelativeVolume}×` },
    { pass: bodyRatio >= settings.minCandleBodyRatio && closeLocation >= settings.minCloseLocation && upperWickRatio <= .3, label: 'Candle kuat, close dekat high' },
    { pass: buyFlow !== undefined && buyFlow >= settings.minBuyFlow, label: `Buyer flow ≥ ${Math.round(settings.minBuyFlow * 100)}%` },
    { pass: row.spreadTicks !== undefined && row.spreadTicks <= settings.maxSpreadTicks, label: `Spread ≤ ${settings.maxSpreadTicks} tick` },
    { pass: row.orderBookPersistence !== undefined && row.orderBookPersistence >= settings.minOrderBookPersistence, label: `Order book bertahan ${settings.minOrderBookPersistence} snapshot` },
  ]
  const available = confirmations.filter(c => c.pass || (c.label.startsWith('Candle') ? true :
    c.label.startsWith('EMA') ? row.emaFast !== undefined : c.label.includes('VWAP') ? row.vwap !== undefined :
    c.label.startsWith('RSI') ? row.rsi14 !== undefined : c.label.startsWith('Relative') ? row.relativeVolume !== undefined :
    c.label.startsWith('Buyer') ? buyFlow !== undefined : c.label.startsWith('Spread') ? row.spreadTicks !== undefined : row.orderBookPersistence !== undefined))
  const passed = confirmations.filter(c => c.pass)
  if (settings.strategyMode === 'balanced' && passed.length < Math.min(6, Math.max(3, available.length - 1))) return null
  if (settings.strategyMode === 'strict' && (available.length < confirmations.length || passed.length !== confirmations.length)) return null

  const imbalance = ratio === undefined ? 0 : (ratio - 1) / Math.max(.01, ratio + 1)
  const score = Math.min(99, Math.round(40 + Math.min(15, imbalance * 55) +
    Math.min(8, row.value / settings.minValue * 2) + passed.length * 4 + (exact ? 5 : 0)))
  const entryLow = row.price
  return {
    ...row,
    bidOfferRatio: ratio,
    entryLow,
    entryHigh: roundToTick(entryLow + tickSize(entryLow) * 2),
    target: roundUpToTick(entryLow * (1 + settings.targetPct / 100)),
    stop: roundToTick(entryLow * (1 - settings.stopPct / 100)),
    score,
    exact,
    reasons: [exact ? 'Rumus inti + order book exact terpenuhi' : 'Price-core terpenuhi; data order book belum tersedia', ...passed.map(c => c.label)],
    confirmations: passed.length,
    confirmationTotal: available.length,
    setupLabel: settings.strategyMode === 'strict' ? 'Ketat' : settings.strategyMode === 'balanced' ? 'Terkonfirmasi' : 'Inti',
  }
}

export const screenRows = (rows: MarketRow[], settings: ScreenerSettings) =>
  rows.map(row => evaluateRow(row, settings)).filter((row): row is Signal => Boolean(row))

export const calculateStats = (trades: TradeRecord[]): BacktestStats => {
  if (!trades.length) return { trades: 0, wins: 0, losses: 0, winRate: 0, avgNetReturn: 0, totalReturn: 0, maxDrawdown: 0, profitFactor: 0, equity: [100] }
  let equity = 100
  let peak = equity
  let maxDrawdown = 0
  let gains = 0
  let lossesValue = 0
  const curve = [equity]
  trades.forEach(t => {
    equity *= (1 + t.netReturn / 100)
    curve.push(equity)
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, ((equity - peak) / peak) * 100)
    if (t.netReturn > 0) gains += t.netReturn
    else lossesValue += Math.abs(t.netReturn)
  })
  const wins = trades.filter(t => t.netReturn > 0).length
  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: wins / trades.length * 100,
    avgNetReturn: trades.reduce((s, t) => s + t.netReturn, 0) / trades.length,
    totalReturn: equity - 100,
    maxDrawdown,
    profitFactor: lossesValue ? gains / lossesValue : gains,
    equity: curve,
  }
}

export const backtestRows = (rows: MarketRow[], settings: ScreenerSettings): TradeRecord[] =>
  screenRows(rows, settings).flatMap(signal => {
    if (!signal.close || !signal.futureHigh || !signal.futureLow) return []
    // Bila target dan stop sama-sama tersentuh tetapi tidak ada tick sequence,
    // gunakan stop terlebih dahulu (asumsi konservatif, menghindari optimistic bias).
    const targetHit = signal.futureHigh >= signal.target
    const stopHit = signal.futureLow <= signal.stop
    let exit = signal.close
    let exitMethod: TradeRecord['exitMethod'] = 'Close'
    if (stopHit) { exit = signal.stop; exitMethod = 'Stop' }
    else if (targetHit) { exit = signal.target; exitMethod = 'Target' }
    const grossReturn = ((exit / signal.price) - 1) * 100
    return [{
      date: signal.date || '—', ticker: signal.ticker, company: signal.company,
      signalTime: signal.signalTime, entry: signal.price, exit, target: signal.target, stop: signal.stop,
      exitMethod, grossReturn, netReturn: grossReturn - settings.transactionCost, exact: signal.exact,
    }]
  })

export const parseCsv = (text: string): MarketRow[] => {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim())
  const required = ['ticker', 'open', 'low', 'high', 'prevLow', 'prevHigh', 'price', 'close', 'futureHigh', 'futureLow', 'volume', 'value']
  if (!required.every(k => headers.includes(k))) throw new Error(`Kolom wajib: ${required.join(', ')}`)
  return lines.slice(1).map((line, index) => {
    const cells = line.split(',').map(x => x.trim())
    const get = (key: string) => cells[headers.indexOf(key)]
    const num = (key: string) => Number(get(key) || 0)
    return {
      ticker: get('ticker'), company: get('company') || get('ticker'),
      open: num('open'), low: num('low'), high: num('high'), close: num('close'),
      futureHigh: num('futureHigh'), futureLow: num('futureLow'), date: get('date'),
      emaFast: num('emaFast') || undefined, emaMid: num('emaMid') || undefined, emaSlow: num('emaSlow') || undefined,
      rsi14: num('rsi14') || undefined, vwap: num('vwap') || undefined, relativeVolume: num('relativeVolume') || undefined,
      buyerInitiatedVolume: num('buyerInitiatedVolume') || undefined, sellerInitiatedVolume: num('sellerInitiatedVolume') || undefined,
      spreadTicks: num('spreadTicks') || undefined, orderBookPersistence: num('orderBookPersistence') || undefined,
      price: num('price') || num('close') || num('open'), prevLow: num('prevLow'), prevHigh: num('prevHigh'),
      volume: num('volume'), value: num('value'), allBidVolume: num('allBidVolume') || undefined,
      allOfferVolume: num('allOfferVolume') || undefined, bidOfferRatio: num('bidOfferRatio') || undefined,
      signalTime: get('signalTime') || `Bar ${index + 1}`, source: 'import' as const,
    }
  }).filter(row => row.ticker && Number.isFinite(row.open))
}
