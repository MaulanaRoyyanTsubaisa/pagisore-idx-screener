import { readFile } from 'node:fs/promises'

const payload = JSON.parse(await readFile(new URL(process.env.BACKTEST_INPUT || '../public/data/real-backtest.json', import.meta.url), 'utf8'))
const profile = process.env.BACKTEST_PROFILE
if (profile && !payload.trades[0]?.profiles?.[profile]) throw new Error(`Profil ${profile} tidak tersedia. Buat data riset dengan BACKTEST_INCLUDE_PROFILES=true.`)
const sourceTrades = profile ? payload.trades.map(trade => ({ ...trade, netReturn: trade.profiles[profile].netReturn })) : payload.trades
const dates = [...new Set(sourceTrades.map(trade => trade.date))].sort()
const trainEnd = dates[Math.floor(dates.length * .6)]
const validationEnd = dates[Math.floor(dates.length * .8)]
const train = sourceTrades.filter(trade => trade.date < trainEnd)
const validation = sourceTrades.filter(trade => trade.date >= trainEnd && trade.date < validationEnd)
const test = sourceTrades.filter(trade => trade.date >= validationEnd)

const raw = trade => {
  const metrics = trade.metrics || {}
  const rvol = Math.min(20, Math.max(0, metrics.relativeVolume || 0))
  const rsi = Number.isFinite(metrics.rsi14) ? metrics.rsi14 : 55
  const vwapGap = Number.isFinite(metrics.vwap) ? Math.max(-.1, Math.min(.1, trade.entry / metrics.vwap - 1)) : 0
  return [
    Math.log10(Math.max(100_000_000, metrics.value || 100_000_000)),
    Math.log1p(rvol),
    metrics.flowProxy ?? .5,
    vwapGap,
    -Math.abs(rsi - 58) / 30,
    (trade.confirmations || 0) / Math.max(1, trade.confirmationTotal || 6),
    Math.log10(Math.max(50, trade.entry)),
  ]
}

const means = raw(train[0]).map((_, index) => train.reduce((sum, trade) => sum + raw(trade)[index], 0) / train.length)
const deviations = means.map((mean, index) => Math.sqrt(train.reduce((sum, trade) => sum + (raw(trade)[index] - mean) ** 2, 0) / train.length) || 1)
const features = trade => raw(trade).map((value, index) => (value - means[index]) / deviations[index])
const prepared = trades => trades.map(trade => ({ trade, features: features(trade) }))
const groups = rows => {
  const byDate = new Map()
  for (const row of rows) {
    if (!byDate.has(row.trade.date)) byDate.set(row.trade.date, [])
    byDate.get(row.trade.date).push(row)
  }
  return [...byDate.values()]
}
const trainDays = groups(prepared(train))
const validationDays = groups(prepared(validation))
const testDays = groups(prepared(test))

const select = (days, weights, count = 5) => days.flatMap(day => day
  .map(row => ({ ...row, score: row.features.reduce((sum, value, index) => sum + value * weights[index], 0) }))
  .toSorted((a, b) => b.score - a.score)
  .slice(0, count)
  .map(row => row.trade))

const stats = trades => {
  const wins = trades.filter(trade => trade.netReturn > 0)
  const gains = wins.reduce((sum, trade) => sum + trade.netReturn, 0)
  const losses = Math.abs(trades.filter(trade => trade.netReturn <= 0).reduce((sum, trade) => sum + trade.netReturn, 0))
  return {
    trades: trades.length,
    winRate: 100 * wins.length / Math.max(1, trades.length),
    avgNet: trades.reduce((sum, trade) => sum + trade.netReturn, 0) / Math.max(1, trades.length),
    profitFactor: gains / Math.max(.0001, losses),
  }
}

let seed = 20260828
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

const candidates = []
const weightValues = [-2, -1, -.5, 0, .5, 1, 2]
for (let iteration = 0; iteration < 30000; iteration += 1) {
  const weights = means.map(() => weightValues[Math.floor(random() * weightValues.length)])
  if (weights.every(value => value === 0)) continue
  const trainStats = stats(select(trainDays, weights))
  const validationStats = stats(select(validationDays, weights))
  const robustScore = Math.min(trainStats.avgNet, validationStats.avgNet) + .25 * Math.min(trainStats.avgNet + validationStats.avgNet, 0)
  candidates.push({ weights, train: trainStats, validation: validationStats, robustScore })
}

const eligible = candidates
  .filter(candidate => candidate.train.avgNet > 0 && candidate.validation.avgNet > 0)
  .toSorted((a, b) => b.robustScore - a.robustScore)

const best = eligible[0] || candidates.toSorted((a, b) => b.robustScore - a.robustScore)[0]
console.log(JSON.stringify({
  data: process.env.BACKTEST_INPUT || '../public/data/real-backtest.json',
  profile: profile || 'primary',
  split: { trainEnd, validationEnd, trainDates: trainDays.length, validationDates: validationDays.length, testDates: testDays.length },
  positiveOnTrainAndValidation: eligible.length,
  selected: { ...best, test: stats(select(testDays, best.weights)) },
  topCandidates: eligible.slice(0, 10),
}, null, 2))
