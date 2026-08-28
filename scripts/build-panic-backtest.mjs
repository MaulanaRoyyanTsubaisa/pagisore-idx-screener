import { writeFile } from 'node:fs/promises'

const OUT = new URL(process.env.PANIC_OUT || '../panic-research.json', import.meta.url)
const CONCURRENCY = Number(process.env.PANIC_CONCURRENCY || 12)
const COST_PCT = Number(process.env.PANIC_COST_PCT || 0.3)
const START = process.env.PANIC_START || '2020-01-01'
const END = process.env.PANIC_END || new Date().toISOString().slice(0, 10)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function fetchJson(url, options, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      await sleep(300 * attempt)
    }
  }
  throw lastError
}

async function getUniverse() {
  const json = await fetchJson('https://scanner.tradingview.com/indonesia/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'PagiSore-Research/1.0' },
    body: JSON.stringify({
      filter: [{ left: 'exchange', operation: 'equal', right: 'IDX' }],
      markets: ['indonesia'],
      symbols: { query: { types: ['stock'] }, tickers: [] },
      columns: ['name', 'description'],
      sort: { sortBy: 'name', sortOrder: 'asc' },
      range: [0, 1400],
    }),
  })
  return (json.data || []).map(row => ({
    ticker: String(row.d?.[0] || row.s?.split(':').pop()),
    company: String(row.d?.[1] || row.d?.[0] || ''),
  })).filter(row => /^[A-Z0-9]{4,6}$/.test(row.ticker))
}

function idxTick(price) {
  if (price < 200) return 1
  if (price < 500) return 2
  if (price < 2000) return 5
  if (price < 5000) return 10
  return 25
}

function roundLimitDown(price) {
  const tick = idxTick(price)
  return Math.floor(price / tick) * tick
}

function analyzeTicker(meta, json) {
  const result = json?.chart?.result?.[0]
  const quote = result?.indicators?.quote?.[0]
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose
  if (!result?.timestamp?.length || !quote) return []

  const rows = result.timestamp.map((timestamp, index) => {
    const rawClose = quote.close?.[index]
    const factor = Number.isFinite(adjusted?.[index]) && Number.isFinite(rawClose) && rawClose > 0
      ? adjusted[index] / rawClose : 1
    const open = quote.open?.[index]
    const high = quote.high?.[index]
    const low = quote.low?.[index]
    const close = rawClose
    const volume = quote.volume?.[index]
    if (![open, high, low, close, volume].every(Number.isFinite) || close <= 0) return null
    return {
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open, high, low, close, volume,
      adjustedOpen: open * factor,
      adjustedHigh: high * factor,
      adjustedLow: low * factor,
      adjustedClose: close * factor,
    }
  }).filter(Boolean)

  const trades = []
  for (let index = 90; index < rows.length - 1; index += 1) {
    const signal = rows[index]
    const previous = rows[index - 1]
    const tradeDay = rows[index + 1]
    if (signal.date < START || signal.date > END) continue
    const changePct = (signal.adjustedClose / previous.adjustedClose - 1) * 100
    if (changePct > -5 || signal.close < 100) continue

    const prior20 = rows.slice(index - 19, index + 1)
    const avgValue20 = prior20.reduce((sum, row) => sum + row.close * row.volume, 0) / prior20.length
    const prior90High = Math.max(...rows.slice(index - 89, index + 1).map(row => row.adjustedHigh))
    const drawdown90 = (signal.adjustedClose / prior90High - 1) * 100
    const rawEntry = tradeDay.open * 0.95
    const tickEntry = roundLimitDown(rawEntry)
    const evaluate = entry => {
      const filled = tradeDay.low <= entry
      const grossPct = filled ? (tradeDay.close / entry - 1) * 100 : null
      return { filled, entry, grossPct, netPct: filled ? grossPct - COST_PCT : null }
    }
    trades.push({
      ticker: meta.ticker,
      company: meta.company,
      signalDate: signal.date,
      tradeDate: tradeDay.date,
      signalClose: signal.close,
      changePct,
      avgValue20,
      drawdown90,
      nextOpen: tradeDay.open,
      nextLow: tradeDay.low,
      nextClose: tradeDay.close,
      decimal: evaluate(rawEntry),
      tick: evaluate(tickEntry),
    })
  }
  return trades
}

function stats(rows, execution = 'tick') {
  const fills = rows.filter(row => row[execution].filled)
  const returns = fills.map(row => row[execution].netPct)
  const winners = returns.filter(value => value > 0)
  const losers = returns.filter(value => value <= 0)
  const grossWin = winners.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(losers.reduce((sum, value) => sum + value, 0))
  const sorted = [...returns].sort((a, b) => a - b)
  const percentile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0
  const trimmed = returns.filter(value => value >= -20 && value <= 20)
  return {
    signals: rows.length,
    fills: fills.length,
    fillRatePct: rows.length ? fills.length / rows.length * 100 : 0,
    winRatePct: fills.length ? winners.length / fills.length * 100 : 0,
    avgNetPct: fills.length ? returns.reduce((sum, value) => sum + value, 0) / fills.length : 0,
    medianNetPct: percentile(0.5),
    p10NetPct: percentile(0.1),
    p90NetPct: percentile(0.9),
    minNetPct: sorted[0] || 0,
    maxNetPct: sorted.at(-1) || 0,
    trimmedAvgNetPct: trimmed.length ? trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : null,
    cumulativeNetPct: returns.reduce((sum, value) => sum + value, 0),
  }
}

function selectRows(trades, { minValue, maxPerDay = Infinity, drawdown = null }) {
  const filtered = trades.filter(row => row.avgValue20 >= minValue && (drawdown === null || row.drawdown90 <= drawdown))
  if (!Number.isFinite(maxPerDay)) return filtered
  const days = Map.groupBy(filtered, row => row.tradeDate)
  return [...days.values()].flatMap(rows => rows.sort((a, b) => a.changePct - b.changePct).slice(0, maxPerDay))
}

function segment(rows, from, to) {
  return rows.filter(row => row.signalDate >= from && row.signalDate <= to)
}

const universe = await getUniverse()
let cursor = 0
const allTrades = []
let failed = 0

async function worker() {
  while (cursor < universe.length) {
    const meta = universe[cursor++]
    try {
      const period1 = Math.floor(new Date(`${START}T00:00:00Z`).getTime() / 1000) - 86400 * 100
      const period2 = Math.floor(new Date(`${END}T23:59:59Z`).getTime() / 1000) + 86400 * 4
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${meta.ticker}.JK?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`
      const json = await fetchJson(url, { headers: { 'user-agent': 'Mozilla/5.0 PagiSore-Research' } })
      allTrades.push(...analyzeTicker(meta, json))
    } catch {
      failed += 1
    }
    if (cursor % 100 === 0) process.stdout.write(`\r${cursor}/${universe.length} tickers`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
allTrades.sort((a, b) => a.signalDate.localeCompare(b.signalDate) || a.ticker.localeCompare(b.ticker))

const profiles = [
  { id: 'liq1_all', minValue: 1e9 },
  { id: 'liq5_all', minValue: 5e9 },
  { id: 'liq1_top3', minValue: 1e9, maxPerDay: 3 },
  { id: 'liq5_top3', minValue: 5e9, maxPerDay: 3 },
  { id: 'liq1_dd30_all', minValue: 1e9, drawdown: -30 },
  { id: 'liq5_dd30_all', minValue: 5e9, drawdown: -30 },
]

const periods = {
  train: ['2020-01-01', '2023-12-31'],
  validation: ['2024-01-01', '2025-12-31'],
  holdout: ['2026-01-01', END],
  full: [START, END],
}

const results = Object.fromEntries(profiles.map(profile => {
  const selected = selectRows(allTrades, profile)
  return [profile.id, {
    profile,
    periods: Object.fromEntries(Object.entries(periods).map(([name, [from, to]]) => {
      const rows = segment(selected, from, to)
      return [name, { tick: stats(rows, 'tick'), decimal: stats(rows, 'decimal') }]
    })),
    yearly: Object.fromEntries([...new Set(selected.map(row => row.signalDate.slice(0, 4)))].map(year => [year, stats(segment(selected, `${year}-01-01`, `${year}-12-31`), 'tick')])),
  }]
}))

const output = {
  generatedAt: new Date().toISOString(),
  assumptions: { start: START, end: END, costPct: COST_PCT, signalDropPct: -5, entryDiscountPct: 5, exit: 'same-day close', data: 'Yahoo Finance adjusted daily OHLCV', universe: 'current TradingView IDX list' },
  coverage: { universe: universe.length, failed, rawSignals: allTrades.length },
  results,
  trades: allTrades,
}
await writeFile(OUT, JSON.stringify(output, null, 2))
console.log(`\nSaved ${OUT.pathname}`)
for (const [id, result] of Object.entries(results)) console.log(id, JSON.stringify(result.periods))
