import { readFile } from 'node:fs/promises'

const payload = JSON.parse(await readFile(new URL(process.env.BACKTEST_INPUT || '../public/data/real-backtest.json', import.meta.url), 'utf8'))
const dates = [...new Set(payload.trades.map(trade => trade.date))].sort()
const cutoff = dates[Math.floor(dates.length * .7)]
const train = payload.trades.filter(trade => trade.date < cutoff)
const test = payload.trades.filter(trade => trade.date >= cutoff)

const rawFeatures = trade => {
  const metrics = trade.metrics || {}
  const rvol = Number.isFinite(metrics.relativeVolume) ? Math.min(20, metrics.relativeVolume) : 0
  const flow = Number.isFinite(metrics.flowProxy) ? metrics.flowProxy : .5
  const vwapGap = Number.isFinite(metrics.vwap) ? Math.max(-.1, Math.min(.1, trade.entry / metrics.vwap - 1)) : 0
  const rsi = Number.isFinite(metrics.rsi14) ? metrics.rsi14 : 55
  return [
    Math.log10(Math.max(100_000_000, metrics.value || 100_000_000)),
    Math.log1p(rvol), flow, vwapGap, rsi / 100,
    (trade.confirmations || 0) / Math.max(1, trade.confirmationTotal || 6),
  ]
}

const means = rawFeatures(train[0]).map((_, index) => train.reduce((sum, trade) => sum + rawFeatures(trade)[index], 0) / train.length)
const deviations = means.map((mean, index) => Math.sqrt(train.reduce((sum, trade) => sum + (rawFeatures(trade)[index] - mean) ** 2, 0) / train.length) || 1)
const features = trade => [1, ...rawFeatures(trade).map((value, index) => (value - means[index]) / deviations[index])]
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, value))))
const weights = Array(features(train[0]).length).fill(0)

for (let epoch = 0; epoch < 4000; epoch += 1) {
  const gradient = Array(weights.length).fill(0)
  for (const trade of train) {
    const x = features(trade)
    const prediction = sigmoid(x.reduce((sum, value, index) => sum + value * weights[index], 0))
    const error = prediction - Number(trade.netReturn > 0)
    x.forEach((value, index) => { gradient[index] += error * value })
  }
  weights.forEach((weight, index) => {
    const penalty = index ? .015 * weight : 0
    weights[index] -= .08 * (gradient[index] / train.length + penalty)
  })
}

const score = trade => sigmoid(features(trade).reduce((sum, value, index) => sum + value * weights[index], 0))
const shortlist = (trades, count) => {
  const byDate = new Map()
  for (const trade of trades) {
    if (!byDate.has(trade.date)) byDate.set(trade.date, [])
    byDate.get(trade.date).push(trade)
  }
  return [...byDate.values()].flatMap(day => day.toSorted((a, b) => score(b) - score(a)).slice(0, count))
}

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

const profileTrades = (trades, profileId) => trades.flatMap(trade => {
  const outcome = trade.profiles[profileId]
  return outcome.filled === false ? [] : [{ ...trade, entry: outcome.entry, netReturn: outcome.netReturn }]
})
const profileStats = (trades, profileId) => stats(profileTrades(trades, profileId))
const profileIds = Object.keys(train[0]?.profiles || {})

console.log(JSON.stringify({
  cutoff,
  weights,
  baseline: { train: stats(train), test: stats(test) },
  exits: profileIds.map(profile => ({ profile, train: profileStats(train, profile), test: profileStats(test, profile) })),
  top5: { train: stats(shortlist(train, 5)), test: stats(shortlist(test, 5)) },
  top3: { train: stats(shortlist(train, 3)), test: stats(shortlist(test, 3)) },
  testByDay: [...new Set(test.map(trade => trade.date))].map(date => ({
    date,
    available: test.filter(trade => trade.date === date).length,
    selected: shortlist(test.filter(trade => trade.date === date), 5).map(trade => ({ ticker: trade.ticker, score: score(trade), net: trade.netReturn })),
  })),
}, null, 2))
