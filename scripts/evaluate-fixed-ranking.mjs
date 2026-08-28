import { readFile } from 'node:fs/promises'

const payload = JSON.parse(await readFile(new URL(process.env.BACKTEST_INPUT || '../hourly-research.json', import.meta.url), 'utf8'))

// Dibekukan dari ensemble 100 konfigurasi pada data 5-menit train+validasi.
const means = [8.88780940935329, 1.25373363764675, .735687355510453, -.0484580208322813, -.283849836169406, .443862710878418, 2.72686008245804]
const deviations = [.664966886462442, .850914537581692, .329264095537989, .0121262300647465, .290350858461007, .228177158684766, .646179990153381]
const weights = [1.37, .47, .255, -.3, .335, -.075, 1.305]

const raw = trade => {
  const metrics = trade.metrics || {}
  const rvol = Math.min(20, Math.max(0, metrics.relativeVolume || 0))
  const rsi = Number.isFinite(metrics.rsi14) ? metrics.rsi14 : 55
  const vwapGap = Number.isFinite(metrics.vwap) ? Math.max(-.1, Math.min(.1, trade.entry / metrics.vwap - 1)) : 0
  return [
    Math.log10(Math.max(100_000_000, metrics.value || 100_000_000)),
    Math.log1p(rvol), metrics.flowProxy ?? .5, vwapGap,
    -Math.abs(rsi - 58) / 30,
    (trade.confirmations || 0) / Math.max(1, trade.confirmationTotal || 6),
    Math.log10(Math.max(50, trade.entry)),
  ]
}

const score = trade => raw(trade).reduce((sum, value, index) =>
  sum + ((value - means[index]) / deviations[index]) * weights[index], 0)

const byDate = new Map()
for (const trade of payload.trades) {
  if (!byDate.has(trade.date)) byDate.set(trade.date, [])
  byDate.get(trade.date).push(trade)
}
const dates = [...byDate.keys()].sort()
const selected = dates.flatMap(date => byDate.get(date).toSorted((a, b) => score(b) - score(a)).slice(0, 5))
const cutoff = dates[Math.floor(dates.length * .7)]

const stats = (orders, profile) => {
  const outcomes = orders.map(order => order.profiles[profile]).filter(outcome => outcome.filled !== false)
  const wins = outcomes.filter(outcome => outcome.netReturn > 0)
  const gains = wins.reduce((sum, outcome) => sum + outcome.netReturn, 0)
  const losses = Math.abs(outcomes.filter(outcome => outcome.netReturn <= 0).reduce((sum, outcome) => sum + outcome.netReturn, 0))
  return {
    offered: orders.length,
    filled: outcomes.length,
    fillRate: 100 * outcomes.length / Math.max(1, orders.length),
    winRate: 100 * wins.length / Math.max(1, outcomes.length),
    avgNet: outcomes.reduce((sum, outcome) => sum + outcome.netReturn, 0) / Math.max(1, outcomes.length),
    profitFactor: gains / Math.max(.0001, losses),
    worst: Math.min(...outcomes.map(outcome => outcome.netReturn)),
  }
}

const profiles = (process.env.BACKTEST_PROFILES || 'lim5_tp1.5_sl5,lim5_tp1.5_sl7,lim5_tp1.5_sl10,lim5_tp1.5_close').split(',')
console.log(JSON.stringify({
  source: payload.meta,
  model: { means, deviations, weights },
  dates: dates.length,
  cutoff,
  results: profiles.map(profile => ({
    profile,
    all: stats(selected, profile),
    trainPeriod: stats(selected.filter(trade => trade.date < cutoff), profile),
    testPeriod: stats(selected.filter(trade => trade.date >= cutoff), profile),
    yearly: [...new Set(dates.map(date => date.slice(0, 4)))].map(year => ({
      year,
      ...stats(selected.filter(trade => trade.date.startsWith(year)), profile),
    })),
  })),
}, null, 2))
