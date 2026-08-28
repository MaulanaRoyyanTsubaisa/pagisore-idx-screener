import { readFile } from 'node:fs/promises'

const input = process.env.BACKTEST_INPUT || '../deep-hourly-research.json'
const payload = JSON.parse(await readFile(new URL(input, import.meta.url), 'utf8'))
const minValues = (process.env.BACKTEST_MIN_VALUES || '100000000,500000000,1000000000,5000000000')
  .split(',').map(Number)
const minPrices = (process.env.BACKTEST_MIN_PRICES || '0,200,500').split(',').map(Number)
const dates = [...new Set(payload.trades.map(trade => trade.date))].sort()
const trainEnd = dates[Math.floor(dates.length * .6)]
const validationEnd = dates[Math.floor(dates.length * .8)]
const profileNames = Object.keys(payload.trades[0]?.profiles || {}).filter(name => name.startsWith('lim'))

const stats = (trades, profile) => {
  const outcomes = trades.map(trade => trade.profiles[profile]).filter(outcome => outcome.filled !== false)
  const wins = outcomes.filter(outcome => outcome.netReturn > 0)
  const gains = wins.reduce((sum, outcome) => sum + outcome.netReturn, 0)
  const losses = Math.abs(outcomes.filter(outcome => outcome.netReturn <= 0)
    .reduce((sum, outcome) => sum + outcome.netReturn, 0))
  return {
    offered: trades.length,
    filled: outcomes.length,
    fillRate: 100 * outcomes.length / Math.max(1, trades.length),
    winRate: 100 * wins.length / Math.max(1, outcomes.length),
    avgNet: outcomes.reduce((sum, outcome) => sum + outcome.netReturn, 0) / Math.max(1, outcomes.length),
    profitFactor: gains / Math.max(.0001, losses),
  }
}

const rows = []
for (const minValue of minValues) {
  for (const minPrice of minPrices) {
    const eligible = payload.trades.filter(trade =>
      (trade.metrics?.value || 0) >= minValue && trade.entry >= minPrice)
    const train = eligible.filter(trade => trade.date < trainEnd)
    const validation = eligible.filter(trade => trade.date >= trainEnd && trade.date < validationEnd)
    for (const profile of profileNames) {
      const trainStats = stats(train, profile)
      const validationStats = stats(validation, profile)
      rows.push({
        profile, minValue, minPrice, train: trainStats, validation: validationStats,
        robustAvg: Math.min(trainStats.avgNet, validationStats.avgNet),
      })
    }
  }
}

console.log(JSON.stringify({
  input, split: { trainEnd, validationEnd },
  candidates: rows
    .filter(row => row.train.filled >= 30 && row.validation.filled >= 10)
    .toSorted((a, b) => b.robustAvg - a.robustAvg)
    .slice(0, 40),
}, null, 2))
