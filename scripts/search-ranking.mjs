import { readFile } from 'node:fs/promises'

const payload = JSON.parse(await readFile(new URL(process.env.BACKTEST_INPUT || '../public/data/real-backtest.json', import.meta.url), 'utf8'))
const profile = process.env.BACKTEST_PROFILE
const evaluationProfile = process.env.BACKTEST_EVAL_PROFILE
const minValue = Number(process.env.BACKTEST_MIN_VALUE || 0)
const minPrice = Number(process.env.BACKTEST_MIN_PRICE || 0)
const orderCount = Number(process.env.BACKTEST_ORDER_COUNT || 5)
const rankIterations = Number(process.env.BACKTEST_RANK_ITERATIONS || 30000)
if (profile && !payload.trades[0]?.profiles?.[profile]) throw new Error(`Profil ${profile} tidak tersedia. Buat data riset dengan BACKTEST_INCLUDE_PROFILES=true.`)
if (evaluationProfile && !payload.trades[0]?.profiles?.[evaluationProfile]) throw new Error(`Profil evaluasi ${evaluationProfile} tidak tersedia.`)
const profiledTrades = profile ? payload.trades.map(trade => {
  const outcome = trade.profiles[profile]
  return { ...trade, ...outcome, filled: outcome.filled !== false }
}) : payload.trades.map(trade => ({ ...trade, filled: true }))
const sourceTrades = profiledTrades.filter(trade =>
  (trade.metrics?.value || 0) >= minValue && trade.entry >= minPrice)
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

const select = (days, weights, count = orderCount) => days.flatMap(day => day
  .map(row => ({ ...row, score: row.features.reduce((sum, value, index) => sum + value * weights[index], 0) }))
  .toSorted((a, b) => b.score - a.score)
  .slice(0, count)
  .map(row => row.trade))

const stats = trades => {
  const offered = trades.length
  const filled = trades.filter(trade => trade.filled !== false)
  const wins = filled.filter(trade => trade.netReturn > 0)
  const gains = wins.reduce((sum, trade) => sum + trade.netReturn, 0)
  const losses = Math.abs(filled.filter(trade => trade.netReturn <= 0).reduce((sum, trade) => sum + trade.netReturn, 0))
  return {
    offered,
    trades: filled.length,
    fillRate: 100 * filled.length / Math.max(1, offered),
    winRate: 100 * wins.length / Math.max(1, filled.length),
    avgNet: filled.reduce((sum, trade) => sum + trade.netReturn, 0) / Math.max(1, filled.length),
    profitFactor: gains / Math.max(.0001, losses),
  }
}
const evaluateTrades = trades => evaluationProfile ? trades.map(trade => {
  const outcome = trade.profiles[evaluationProfile]
  return { ...trade, ...outcome, filled: outcome.filled !== false }
}) : trades
const evaluatedStats = trades => stats(evaluateTrades(trades))

let seed = 20260828
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

const candidates = []
const weightValues = [-2, -1, -.5, 0, .5, 1, 2]
for (let iteration = 0; iteration < rankIterations; iteration += 1) {
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
const ensembleResults = [10, 50, 100, 500].flatMap(size => {
  const members = eligible.slice(0, size)
  if (!members.length) return []
  const weights = means.map((_, index) => members.reduce((sum, member) => sum + member.weights[index], 0) / members.length)
  const testSelection = select(testDays, weights)
  return [{
    size: members.length, weights,
    train: evaluatedStats(select(trainDays, weights)), validation: evaluatedStats(select(validationDays, weights)), test: evaluatedStats(testSelection),
    ...(process.env.BACKTEST_DETAIL === 'true' ? { testDetails: testSelection.map(trade => ({
      date: trade.date, ticker: trade.ticker, filled: trade.filled, entry: trade.entry,
      exit: trade.exit, exitMethod: trade.exitMethod, netReturn: trade.netReturn,
    })) } : {}),
  }]
})
console.log(JSON.stringify({
  data: process.env.BACKTEST_INPUT || '../public/data/real-backtest.json',
  profile: profile || 'primary',
  evaluationProfile: evaluationProfile || profile || 'primary',
  filters: { minValue, minPrice, orderCount, rankIterations },
  featureNames: ['logValue', 'logRvol', 'flow', 'vwapGap', 'rsiNear58', 'confirmationRatio', 'logPrice'],
  calibration: { means, deviations },
  split: { trainEnd, validationEnd, trainDates: trainDays.length, validationDates: validationDays.length, testDates: testDays.length },
  positiveOnTrainAndValidation: eligible.length,
  selected: { ...best, test: stats(select(testDays, best.weights)) },
  ensembles: ensembleResults,
  topCandidates: eligible.slice(0, 10),
}, null, 2))
