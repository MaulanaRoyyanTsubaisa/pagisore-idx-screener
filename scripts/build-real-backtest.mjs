import { mkdir, writeFile } from 'node:fs/promises'

const OUT = new URL(process.env.BACKTEST_OUT || '../public/data/real-backtest.json', import.meta.url)
const RANGE = process.env.BACKTEST_RANGE || '60d'
const INTERVAL = process.env.BACKTEST_INTERVAL || '5m'
const BAR_MINUTES = Number(INTERVAL.match(/^\d+/)?.[0] || 5)
const SIGNAL_END = process.env.BACKTEST_SIGNAL_END || '09:10'
const LIMIT_CANCEL_TIME = process.env.BACKTEST_LIMIT_CANCEL || '10:30'
const CONCURRENCY = Number(process.env.BACKTEST_CONCURRENCY || 12)
const INCLUDE_PROFILES = process.env.BACKTEST_INCLUDE_PROFILES === 'true'
const PROFILE_SET = process.env.BACKTEST_PROFILE_SET || 'all'
const COST_PCT = 0.3
const TARGET_PCT = 1
const STOP_PCT = 0.9
const EXIT_PROFILES = [1, 1.5, 2, 2.5, 3].flatMap(targetPct => [
  .9, 1.2, 1.5, 2, 3, null,
].map(stopPct => ({
  id: `tp${targetPct}_${stopPct === null ? 'close' : `sl${stopPct}`}`,
  targetPct,
  stopPct,
}))).concat({ id: 'close_only', targetPct: null, stopPct: null })
const LIMIT_PROFILES = [.25, .5, .75, 1, 1.5, 2, 3, 5].flatMap(entryDiscountPct =>
  [1, 1.5, 2, 3].flatMap(targetPct => [.9, 1.5, 2, 3, 5, 7, 10, null].map(stopPct => ({
    id: `lim${entryDiscountPct}_tp${targetPct}_${stopPct === null ? 'close' : `sl${stopPct}`}`,
    entryDiscountPct,
    targetPct,
    stopPct,
  }))))
const MORNING_PROFILES = ['11:00', '11:30', '12:00'].flatMap(cancelTime =>
  [7, 10, null].map(stopPct => ({
    id: `lim5_tp1.5_${stopPct === null ? 'close' : `sl${stopPct}`}_c${cancelTime.replace(':', '')}`,
    entryDiscountPct: 5,
    targetPct: 1.5,
    stopPct,
    cancelTime,
  })))
const DEEP_LIMIT_PROFILES = [7, 10, 12, 15].flatMap(entryDiscountPct =>
  [1.5, 2, 3, 4].flatMap(targetPct => [5, 7, 10, null].map(stopPct => ({
    id: `lim${entryDiscountPct}_tp${targetPct}_${stopPct === null ? 'close' : `sl${stopPct}`}_c1100`,
    entryDiscountPct,
    targetPct,
    stopPct,
    cancelTime: '11:00',
  }))))
const PRIMARY_PROFILE = EXIT_PROFILES.find(profile => profile.id === `tp${TARGET_PCT}_sl${STOP_PCT}`)
const RESEARCH_PROFILES = PROFILE_SET === 'deep'
  ? [PRIMARY_PROFILE, ...DEEP_LIMIT_PROFILES]
  : EXIT_PROFILES.concat(LIMIT_PROFILES, MORNING_PROFILES, DEEP_LIMIT_PROFILES)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const addMinutes = (time, minutes) => {
  const [hour, minute] = time.split(':').map(Number)
  const total = hour * 60 + minute + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

async function fetchJson(url, options, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      await sleep(250 * attempt)
    }
  }
  throw lastError
}

async function getUniverse() {
  const json = await fetchJson('https://scanner.tradingview.com/indonesia/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'PagiSore-Backtest/1.0' },
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

const jakartaParts = timestamp => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp * 1000))
  const take = type => parts.find(part => part.type === type)?.value
  return { date: `${take('year')}-${take('month')}-${take('day')}`, time: `${take('hour')}:${take('minute')}` }
}

function ema(values, period) {
  if (values.length < period) return undefined
  const k = 2 / (period + 1)
  return values.reduce((current, value, index) => index ? value * k + current * (1 - k) : value, values[0])
}

function rsi(values, period = 14) {
  if (values.length <= period) return undefined
  const slice = values.slice(-(period + 1))
  let gains = 0, losses = 0
  for (let index = 1; index < slice.length; index += 1) {
    const change = slice[index] - slice[index - 1]
    if (change > 0) gains += change
    else losses -= change
  }
  if (!losses) return 100
  const rs = (gains / period) / (losses / period)
  return 100 - 100 / (1 + rs)
}

function analyzeTicker(meta, chart) {
  const result = chart?.chart?.result?.[0]
  if (!result?.timestamp?.length) return { trades: [], days: 0 }
  const quote = result.indicators?.quote?.[0]
  if (!quote) return { trades: [], days: 0 }
  const groups = new Map()
  result.timestamp.forEach((timestamp, index) => {
    const open = quote.open?.[index], high = quote.high?.[index], low = quote.low?.[index]
    const close = quote.close?.[index], volume = quote.volume?.[index]
    if (![open, high, low, close, volume].every(Number.isFinite)) return
    const local = jakartaParts(timestamp)
    const bar = { ...local, timestamp, open, high, low, close, volume }
    if (!groups.has(local.date)) groups.set(local.date, [])
    groups.get(local.date).push(bar)
  })

  const dates = [...groups.keys()].sort()
  const daily = []
  const trades = []
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index]
    const bars = groups.get(date).sort((a, b) => a.timestamp - b.timestamp)
    const full = {
      date,
      open: bars[0].open,
      high: Math.max(...bars.map(bar => bar.high)),
      low: Math.min(...bars.map(bar => bar.low)),
      close: bars.at(-1).close,
      volume: bars.reduce((sum, bar) => sum + bar.volume, 0),
      firstWindowVolume: bars.filter(bar => bar.time <= SIGNAL_END).reduce((sum, bar) => sum + bar.volume, 0),
    }
    const previous = daily.at(-1)
    const signalBars = bars.filter(bar => bar.time <= SIGNAL_END)
    const afterSignal = bars.filter(bar => bar.time > SIGNAL_END)
    if (previous && signalBars.length >= 1 && afterSignal.length) {
      const signalOpen = signalBars[0].open
      const signalLow = Math.min(...signalBars.map(bar => bar.low))
      const signalHigh = Math.max(...signalBars.map(bar => bar.high))
      const entry = signalBars.at(-1).close
      const value = signalBars.reduce((sum, bar) => sum + bar.close * bar.volume, 0)
      const tickTolerance = signalOpen < 200 ? 1 : signalOpen < 500 ? 2 : signalOpen < 2000 ? 5 : signalOpen < 5000 ? 10 : 25
      const openIsLow = Math.abs(signalOpen - signalLow) < tickTolerance / 2
      const priceCore = openIsLow && signalHigh > previous.high && signalLow > previous.low && value > 100_000_000

      if (priceCore) {
        const closes = daily.map(day => day.close)
        const ema10 = ema(closes, 10), ema20 = ema(closes, 20), ema50 = ema(closes, 50)
        const rsi14 = rsi(closes)
        const typicalValue = signalBars.reduce((sum, bar) => sum + ((bar.high + bar.low + bar.close) / 3) * bar.volume, 0)
        const windowVolume = signalBars.reduce((sum, bar) => sum + bar.volume, 0)
        const vwap = typicalValue / Math.max(1, windowVolume)
        const avgWindow = daily.slice(-20).reduce((sum, day) => sum + day.firstWindowVolume, 0) / Math.max(1, daily.slice(-20).length)
        const relativeVolume = windowVolume / Math.max(1, avgWindow)
        const range = Math.max(tickTolerance, signalHigh - signalLow)
        const bodyRatio = Math.abs(entry - signalOpen) / range
        const closeLocation = (entry - signalLow) / range
        const upVolume = signalBars.filter(bar => bar.close >= bar.open).reduce((sum, bar) => sum + bar.volume, 0)
        const flowProxy = upVolume / Math.max(1, windowVolume)
        const confirmations = [
          ema10 !== undefined && ema20 !== undefined && ema50 !== undefined && ema10 > ema20 && ema20 > ema50,
          entry > vwap,
          rsi14 !== undefined && rsi14 >= 50 && rsi14 <= 75,
          relativeVolume >= 1.5,
          bodyRatio >= 0.35 && closeLocation >= 0.6,
          flowProxy >= 0.55,
        ].filter(Boolean).length

        const evaluateExit = profile => {
          const entryDiscountPct = profile.entryDiscountPct || 0
          const profileEntry = entry * (1 - entryDiscountPct / 100)
          const cancelTime = profile.cancelTime || LIMIT_CANCEL_TIME
          const fillIndex = entryDiscountPct
            ? afterSignal.findIndex(bar => bar.time < cancelTime && bar.low <= profileEntry)
            : 0
          if (fillIndex < 0) return {
            filled: false,
            entry: Math.round(profileEntry * 100) / 100,
            exit: null,
            target: profile.targetPct === null ? null : Math.round(profileEntry * (1 + profile.targetPct / 100) * 100) / 100,
            stop: profile.stopPct === null ? null : Math.round(profileEntry * (1 - profile.stopPct / 100) * 100) / 100,
            exitMethod: 'Not filled', grossReturn: 0, netReturn: 0,
          }
          const target = profile.targetPct === null ? null : profileEntry * (1 + profile.targetPct / 100)
          const stop = profile.stopPct === null ? null : profileEntry * (1 - profile.stopPct / 100)
          let exit = afterSignal.at(-1).close
          let exitMethod = 'Close'
          for (let barIndex = fillIndex; barIndex < afterSignal.length; barIndex += 1) {
            const bar = afterSignal[barIndex]
            const stopHit = stop !== null && bar.low <= stop
            // Pada candle pengisian limit, high mungkin terjadi sebelum harga turun
            // menyentuh limit. Abaikan TP di candle itu untuk mencegah optimistic bias.
            const targetHit = target !== null && !(entryDiscountPct && barIndex === fillIndex) && bar.high >= target
            if (stopHit) { exit = stop; exitMethod = 'Stop'; break }
            if (targetHit) { exit = target; exitMethod = 'Target'; break }
          }
          const grossReturn = (exit / profileEntry - 1) * 100
          return {
            filled: true,
            entry: Math.round(profileEntry * 100) / 100,
            exit: Math.round(exit * 100) / 100,
            target: target === null ? null : Math.round(target * 100) / 100,
            stop: stop === null ? null : Math.round(stop * 100) / 100,
            exitMethod,
            grossReturn: Math.round(grossReturn * 1000) / 1000,
            netReturn: Math.round((grossReturn - COST_PCT) * 1000) / 1000,
          }
        }
        const profiles = Object.fromEntries(RESEARCH_PROFILES.map(profile => [profile.id, evaluateExit(profile)]))
        const primary = profiles[`tp${TARGET_PCT}_sl${STOP_PCT}`]
        trades.push({
          date, ticker: meta.ticker, company: meta.company, signalTime: addMinutes(SIGNAL_END, BAR_MINUTES),
          entry: Math.round(entry * 100) / 100, ...primary,
          exact: false, confirmations, confirmationTotal: 6,
          metrics: { value, rsi14, relativeVolume, vwap, flowProxy },
          ...(INCLUDE_PROFILES ? { profiles } : {}),
        })
      }
    }
    daily.push(full)
  }
  return { trades, days: dates.length }
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length)
  let cursor = 0
  async function runner() {
    while (cursor < items.length) {
      const index = cursor++
      try { results[index] = await worker(items[index], index) }
      catch (error) { results[index] = { error: String(error), trades: [], days: 0 } }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runner))
  return results
}

const universe = await getUniverse()
console.log(`Universe IDX: ${universe.length} ticker`)
let completed = 0
const results = await runPool(universe, async meta => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(meta.ticker)}.JK?range=${RANGE}&interval=${INTERVAL}&includePrePost=false&events=div%2Csplits`
  const chart = await fetchJson(url)
  const result = analyzeTicker(meta, chart)
  completed += 1
  if (completed % 50 === 0 || completed === universe.length) console.log(`Downloaded ${completed}/${universe.length}`)
  return result
}, CONCURRENCY)

const trades = results.flatMap(result => result.trades || []).sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker))
const successful = results.filter(result => !result.error && result.days > 0).length
const failed = results.filter(result => result.error).length
const dates = trades.map(trade => trade.date)
const payload = {
  meta: {
    generatedAt: new Date().toISOString(), source: 'Yahoo Finance chart (delayed/public)', interval: INTERVAL, range: RANGE,
    universe: universe.length, successful, failed, from: dates[0] || null, to: dates.at(-1) || null,
    signalCutoffWib: SIGNAL_END, targetPct: TARGET_PCT, stopPct: STOP_PCT, transactionCostPct: COST_PCT,
    limitCancelWib: LIMIT_CANCEL_TIME,
    profileSet: PROFILE_SET,
    exactOrderBook: false,
    methodology: `Sinyal memakai bar 09:00–${SIGNAL_END} WIB saja; entry setelah bar terakhir selesai sekitar ${addMinutes(SIGNAL_END, BAR_MINUTES)}; exit target/stop konservatif atau close sesi. Kondisi bid>offer tidak tersedia sehingga hasil adalah price-core, bukan rumus lengkap.`,
  },
  trades,
}
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true })
await writeFile(OUT, JSON.stringify(payload))
console.log(`Saved ${trades.length} trades to ${OUT.pathname}`)
