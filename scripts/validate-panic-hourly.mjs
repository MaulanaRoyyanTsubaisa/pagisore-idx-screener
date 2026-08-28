const CONCURRENCY = Number(process.env.PANIC_CONCURRENCY || 12)
const COST_PCT = 0.3
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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
function entryFrom(open) { const candidate = open * .95; return Math.floor(candidate / tick(candidate)) * tick(candidate) }

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
  for (let i = 20; i < daily.length - 1; i += 1) {
    const signal = daily[i], previous = daily[i - 1], next = daily[i + 1]
    const changePct = (signal.close / previous.close - 1) * 100
    const avgValue20 = daily.slice(i - 19, i + 1).reduce((sum, day) => sum + day.close * day.volume, 0) / 20
    // Batasi penurunan ekstrem untuk mengurangi corporate-action artefacts dan
    // saham yang sudah menyentuh batas bawah beruntun (falling knife/ARB).
    if (changePct > -5 || changePct < -15 || signal.close < 100 || avgValue20 < 20e9) continue
    const entry = entryFrom(next.open)
    const eligibleBars = next.bars.filter(bar => bar.time < '15:00')
    const filled = eligibleBars.some(bar => bar.low <= entry)
    rows.push({ ticker: meta.ticker, tradeDate: next.date, changePct, avgValue20, filled, netPct: filled ? (next.close / entry - 1) * 100 - COST_PCT : null })
  }
  return rows
}

function stats(rows) {
  const fills = rows.filter(row => row.filled)
  const values = fills.map(row => row.netPct).sort((a, b) => a - b)
  const wins = values.filter(value => value > 0)
  const loss = Math.abs(values.filter(value => value <= 0).reduce((sum, value) => sum + value, 0))
  return { signals: rows.length, fills: fills.length, fillRate: fills.length / Math.max(1, rows.length) * 100, winRate: wins.length / Math.max(1, fills.length) * 100, avg: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), median: values[Math.floor((values.length - 1) / 2)] || 0, pf: loss ? wins.reduce((sum, value) => sum + value, 0) / loss : null }
}

const universe = await getUniverse()
let cursor = 0, failed = 0
const trades = []
async function worker() {
  while (cursor < universe.length) {
    const meta = universe[cursor++]
    try {
      const json = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${meta.ticker}.JK?range=730d&interval=60m&includePrePost=false&events=div%2Csplits`)
      trades.push(...analyze(meta, json))
    } catch { failed += 1 }
    if (cursor % 100 === 0) process.stdout.write(`\r${cursor}/${universe.length}`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

function top(rows, count) {
  return [...Map.groupBy(rows, row => row.tradeDate).values()].flatMap(day => [...day].sort((a, b) => a.changePct - b.changePct).slice(0, count))
}

console.log(`\ncoverage ${universe.length} tickers, failed ${failed}`)
for (const [name, from, to] of [['validation', '2024-01-01', '2025-12-31'], ['holdout', '2026-01-01', '9999-12-31'], ['full', '0000-01-01', '9999-12-31']]) {
  const period = trades.filter(row => row.tradeDate >= from && row.tradeDate <= to)
  console.log(name, 'all', stats(period), 'top3', stats(top(period, 3)), 'top5', stats(top(period, 5)))
}
