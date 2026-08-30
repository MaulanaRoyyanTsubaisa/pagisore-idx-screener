import { mkdir, writeFile } from 'node:fs/promises'

const CONCURRENCY = Number(process.env.PANIC_CONCURRENCY || 12)
const COST_PCT = 0.3
const ENTRY_DISCOUNT_PCT = Number(process.env.PANIC_ENTRY_DISCOUNT_PCT || 5)
const MAX_POSITIONS = Number(process.env.PANIC_MAX_POSITIONS || 5)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const completedSessionDates = new Set()

async function fetchJson(url, options, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) { lastError = error; await sleep(300 * attempt) }
  }
  throw lastError
}

async function getUniverse() {
  const json = await fetchJson('https://scanner.tradingview.com/indonesia/scan', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filter: [{ left: 'exchange', operation: 'equal', right: 'IDX' }], markets: ['indonesia'], symbols: { query: { types: ['stock'] }, tickers: [] }, columns: ['name', 'description'], range: [0, 1400] }),
  })
  return (json.data || []).map(row => ({ ticker: String(row.d?.[0] || row.s?.split(':').pop()), company: String(row.d?.[1] || '') })).filter(row => /^[A-Z0-9]{4,6}$/.test(row.ticker))
}

function local(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp * 1000))
  const take = type => parts.find(part => part.type === type)?.value
  return { date: `${take('year')}-${take('month')}-${take('day')}`, time: `${take('hour')}:${take('minute')}` }
}

function tick(price) { return price < 200 ? 1 : price < 500 ? 2 : price < 2000 ? 5 : price < 5000 ? 10 : 25 }
function entryFrom(open, discountPct = ENTRY_DISCOUNT_PCT) { const candidate = open * (1 - discountPct / 100); return Math.floor(candidate / tick(candidate)) * tick(candidate) }
function plusHour(time) { const [hour, minute] = time.split(':').map(Number); return `${String(Math.min(23, hour + 1)).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }

function analyze(meta, json) {
  const result = json?.chart?.result?.[0]
  const quote = result?.indicators?.quote?.[0]
  if (!result?.timestamp?.length || !quote) return []
  const groups = new Map()
  result.timestamp.forEach((timestamp, index) => {
    const open = quote.open?.[index], high = quote.high?.[index], low = quote.low?.[index], close = quote.close?.[index], volume = quote.volume?.[index]
    if (![open, high, low, close, volume].every(Number.isFinite)) return
    const when = local(timestamp)
    const bar = { ...when, timestamp, open, high, low, close, volume }
    if (!groups.has(when.date)) groups.set(when.date, [])
    groups.get(when.date).push(bar)
  })
  const daily = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, bars]) => {
    bars.sort((a, b) => a.timestamp - b.timestamp)
    return { date, bars, open: bars[0].open, high: Math.max(...bars.map(b => b.high)), low: Math.min(...bars.map(b => b.low)), close: bars.at(-1).close, volume: bars.reduce((sum, b) => sum + b.volume, 0) }
  })
  const rows = []
  const formulaRows = []
  for (let i = 1; i < daily.length; i += 1) {
    const previous = daily[i - 1], current = daily[i]
    let runningHigh = -Infinity, runningLow = Infinity, cumulativeValue = 0
    for (const bar of current.bars) {
      runningHigh = Math.max(runningHigh, bar.high)
      runningLow = Math.min(runningLow, bar.low)
      cumulativeValue += bar.close * bar.volume
      if (current.open === runningLow && runningHigh > previous.high && runningLow > previous.low && cumulativeValue > 100e6) {
        const entry = bar.close
        formulaRows.push({ ticker: meta.ticker, company: meta.company, tradeDate: current.date, triggerBar: bar.time, availableAfter: plusHour(bar.time), open: current.open, runningLow, runningHigh, previousLow: previous.low, previousHigh: previous.high, cumulativeValue, entry, close: current.close, netPct: (current.close / entry - 1) * 100 - COST_PCT })
        break
      }
    }
  }
  for (let i = 20; i < daily.length - 1; i += 1) {
    const signal = daily[i], previous = daily[i - 1], next = daily[i + 1]
    const completeSession = next.bars.some(bar => bar.time >= '15:00')
    if (completeSession) completedSessionDates.add(next.date)
    const changePct = (signal.close / previous.close - 1) * 100
    const avgValue10 = daily.slice(i - 9, i + 1).reduce((sum, day) => sum + day.close * day.volume, 0) / 10
    // Batasi penurunan ekstrem untuk mengurangi corporate-action artefacts dan
    // saham yang sudah menyentuh batas bawah beruntun (falling knife/ARB).
    if (changePct > -5 || changePct < -15 || signal.close < 100 || avgValue10 < 20e9) continue
    if (!completeSession) continue
    const eligibleBars = next.bars.filter(bar => bar.time < '15:00')
    const eligibleLow = Math.min(...eligibleBars.map(bar => bar.low))
    const entry = entryFrom(next.open)
    const filled = eligibleLow <= entry
    rows.push({ ticker: meta.ticker, company: meta.company, signalDate: signal.date, tradeDate: next.date, changePct, avgValue10, signalClose: signal.close, open: next.open, openGapPct: (next.open / signal.close - 1) * 100, low: next.low, eligibleLow, close: next.close, entry, filled, netPct: filled ? (next.close / entry - 1) * 100 - COST_PCT : null, intraday: eligibleBars.map(bar => ({ time: bar.time, high: bar.high, low: bar.low })) })
  }
  return { panicRows: rows, formulaRows }
}

function reprice(rows, discountPct) {
  return rows.map(row => {
    const entry = entryFrom(row.open, discountPct)
    const filled = row.eligibleLow <= entry
    return { ...row, entry, filled, netPct: filled ? (row.close / entry - 1) * 100 - COST_PCT : null }
  })
}

function stats(rows, discountPct = ENTRY_DISCOUNT_PCT) {
  const fills = reprice(rows, discountPct).filter(row => row.filled)
  const values = fills.map(row => row.netPct).sort((a, b) => a - b)
  const wins = values.filter(value => value > 0)
  const loss = Math.abs(values.filter(value => value <= 0).reduce((sum, value) => sum + value, 0))
  return { signals: rows.length, fills: fills.length, fillRate: fills.length / Math.max(1, rows.length) * 100, winRate: wins.length / Math.max(1, fills.length) * 100, avg: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), median: values[Math.floor((values.length - 1) / 2)] || 0, pf: loss ? wins.reduce((sum, value) => sum + value, 0) / loss : null }
}

function bracketStats(rows, { targetNetPct, stopGrossPct, discountPct = 3 }) {
  const repriced = reprice(rows, discountPct)
  const outcomes = []
  for (const row of repriced) {
    if (!row.filled) continue
    const fillIndex = row.intraday.findIndex(bar => bar.low <= row.entry)
    const target = row.entry * (1 + (targetNetPct + COST_PCT) / 100)
    const stop = row.entry * (1 - stopGrossPct / 100)
    let netPct = (row.close / row.entry - 1) * 100 - COST_PCT
    for (let index = fillIndex; index < row.intraday.length; index += 1) {
      const bar = row.intraday[index]
      const stopped = bar.low <= stop
      // Konservatif: bila target dan stop ada pada candle 60m yang sama,
      // anggap stop terjadi lebih dulu. Target pada candle fill juga diabaikan
      // karena high bisa terbentuk sebelum buy limit tersentuh.
      const targeted = index > fillIndex && bar.high >= target
      if (stopped) { netPct = -stopGrossPct - COST_PCT; break }
      if (targeted) { netPct = targetNetPct; break }
    }
    outcomes.push(netPct)
  }
  const wins = outcomes.filter(value => value > 0)
  const grossWin = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(outcomes.filter(value => value <= 0).reduce((sum, value) => sum + value, 0))
  return { fills: outcomes.length, winRate: wins.length / Math.max(1, outcomes.length) * 100, avg: outcomes.reduce((sum, value) => sum + value, 0) / Math.max(1, outcomes.length), pf: grossLoss ? grossWin / grossLoss : null }
}

function simpleStats(rows) {
  const values = rows.map(row => row.netPct)
  const wins = values.filter(value => value > 0)
  const grossWin = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(values.filter(value => value <= 0).reduce((sum, value) => sum + value, 0))
  const sorted = [...values].sort((a, b) => a - b)
  return { signals: rows.length, winRate: wins.length / Math.max(1, rows.length) * 100, avg: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), median: sorted[Math.floor((sorted.length - 1) / 2)] ?? 0, pf: grossLoss ? grossWin / grossLoss : null }
}

const universe = await getUniverse()
let cursor = 0, failed = 0
const trades = []
const formulaTrades = []
async function worker() {
  while (cursor < universe.length) {
    const meta = universe[cursor++]
    try {
      const json = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${meta.ticker}.JK?range=730d&interval=60m&includePrePost=false&events=div%2Csplits`)
      const analyzed = analyze(meta, json)
      trades.push(...analyzed.panicRows)
      formulaTrades.push(...analyzed.formulaRows)
    } catch { failed += 1 }
    if (cursor % 100 === 0) process.stdout.write(`\r${cursor}/${universe.length}`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

function top(rows, count) {
  return [...Map.groupBy(rows, row => row.tradeDate).values()].flatMap(day => [...day].sort((a, b) => a.changePct - b.changePct).slice(0, count))
}

function topWithRank(rows, count) {
  return [...Map.groupBy(rows, row => row.tradeDate).values()].flatMap(day => [...day].sort((a, b) => a.changePct - b.changePct).slice(0, count).map((row, index) => ({ ...row, rank: index + 1 })))
}

const acceptedProductionDrop = row => row.changePct <= -12 || row.changePct >= -6

console.log(`\ncoverage ${universe.length} tickers, failed ${failed}`)
for (const [name, from, to] of [['validation', '2024-01-01', '2025-12-31'], ['holdout', '2026-01-01', '9999-12-31'], ['full', '0000-01-01', '9999-12-31']]) {
  const period = trades.filter(row => row.tradeDate >= from && row.tradeDate <= to)
  console.log(name, 'all', stats(period), 'top3', stats(top(period, 3)), 'top5', stats(top(period, 5)))
}

console.log('\nentry sweep · top 10')
for (const discountPct of [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
  const validation = top(trades.filter(row => row.tradeDate >= '2024-01-01' && row.tradeDate <= '2025-12-31'), 10)
  const holdout = top(trades.filter(row => row.tradeDate >= '2026-01-01'), 10)
  console.log(JSON.stringify({ discountPct, validation: stats(validation, discountPct), holdout: stats(holdout, discountPct) }))
}

console.log('\ndrop-band validation · top 10 · entry -3%')
for (const [profile, accept] of [
  ['all -15..-5', row => row.changePct >= -15 && row.changePct <= -5],
  ['extremes <=-12 or >=-6', row => row.changePct <= -12 || row.changePct >= -6],
  ['extremes <=-12.5 or >=-6', row => row.changePct <= -12.5 || row.changePct >= -6],
  ['extremes <=-11.5 or >=-6', row => row.changePct <= -11.5 || row.changePct >= -6],
]) {
  const validation = top(trades.filter(row => row.tradeDate >= '2024-01-01' && row.tradeDate <= '2025-12-31' && accept(row)), 10)
  const holdout = top(trades.filter(row => row.tradeDate >= '2026-01-01' && accept(row)), 10)
  console.log(JSON.stringify({ profile, validation: stats(validation, 3), holdout: stats(holdout, 3) }))
}

console.log('\nTP net +1% / stop sweep · quality bands · conservative 60m path')
for (const stopGrossPct of [1, 1.5, 2, 2.5, 3, 4, 5, 7]) {
  const validation = top(trades.filter(row => row.tradeDate >= '2024-01-01' && row.tradeDate <= '2025-12-31' && acceptedProductionDrop(row)), 10)
  const holdout = top(trades.filter(row => row.tradeDate >= '2026-01-01' && acceptedProductionDrop(row)), 10)
  console.log(JSON.stringify({ stopGrossPct, validation: bracketStats(validation, { targetNetPct: 1, stopGrossPct }), holdout: bracketStats(holdout, { targetNetPct: 1, stopGrossPct }) }))
}

console.log('\noriginal formula price-core · no order book · no look-ahead · entry after hourly confirmation')
for (const [name, from, to] of [['validation', '2024-01-01', '2025-12-31'], ['holdout', '2026-01-01', '9999-12-31']]) {
  const period = formulaTrades.filter(row => row.tradeDate >= from && row.tradeDate <= to)
  const top10 = [...Map.groupBy(period, row => row.tradeDate).values()].flatMap(day => [...day].sort((a, b) => a.availableAfter.localeCompare(b.availableAfter) || b.cumulativeValue - a.cumulativeValue).slice(0, 10))
  console.log(name, 'all', simpleStats(period), 'top10', simpleStats(top10))
}

console.log('\nloss anatomy · quality top 10 · entry -3% · signal-time features only')
const segments = [
  ['drop deep <=-12', row => row.changePct <= -12],
  ['drop mild >=-6', row => row.changePct >= -6],
  ['gap <-3%', row => row.openGapPct < -3],
  ['gap -3..0%', row => row.openGapPct >= -3 && row.openGapPct < 0],
  ['gap 0..3%', row => row.openGapPct >= 0 && row.openGapPct < 3],
  ['gap >=3%', row => row.openGapPct >= 3],
  ['price <200', row => row.open < 200],
  ['price 200..499', row => row.open >= 200 && row.open < 500],
  ['price 500..1999', row => row.open >= 500 && row.open < 2000],
  ['price >=2000', row => row.open >= 2000],
  ['liq 20..50B', row => row.avgValue10 >= 20e9 && row.avgValue10 < 50e9],
  ['liq 50..100B', row => row.avgValue10 >= 50e9 && row.avgValue10 < 100e9],
  ['liq 100..200B', row => row.avgValue10 >= 100e9 && row.avgValue10 < 200e9],
  ['liq >=200B', row => row.avgValue10 >= 200e9],
  ['rank 1..3', row => row.rank <= 3],
  ['rank 4..6', row => row.rank >= 4 && row.rank <= 6],
  ['rank 7..10', row => row.rank >= 7],
]
for (const [periodName, from, to] of [['validation', '2024-01-01', '2025-12-31'], ['holdout', '2026-01-01', '9999-12-31']]) {
  const period = topWithRank(trades.filter(row => row.tradeDate >= from && row.tradeDate <= to && acceptedProductionDrop(row)), 10)
  console.log(periodName)
  for (const [name, accept] of segments) console.log(JSON.stringify({ segment: name, ...stats(period.filter(accept), 3) }))
}

if (process.env.PANIC_CACHE_OUT) {
  await writeFile(process.env.PANIC_CACHE_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), trades, formulaTrades }))
  console.log(`saved tuning cache ${process.env.PANIC_CACHE_OUT}`)
}

const selected = reprice(top(trades.filter(acceptedProductionDrop), MAX_POSITIONS), ENTRY_DISCOUNT_PCT)
const selectedByDate = Map.groupBy(selected, row => row.tradeDate)
const historyDays = [...completedSessionDates].sort((a, b) => b.localeCompare(a)).slice(0, 90).map(date => ({
  date,
  source: 'Yahoo Finance delayed/public · candle 60 menit',
  finalized: true,
  candidates: (selectedByDate.get(date) ?? []).sort((a, b) => a.changePct - b.changePct).map((row, index) => {
    const historyRow = { ...row }
    delete historyRow.intraday
    return { ...historyRow, rank: index + 1, status: row.filled ? 'TERISI' : 'TIDAK TERISI' }
  }),
}))
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true })
await writeFile(new URL('../public/data/panic-history.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), days: historyDays }))
console.log(`saved ${historyDays.length} history days · top ${MAX_POSITIONS} · entry -${ENTRY_DISCOUNT_PCT}%`)
