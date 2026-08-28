import { readFile } from 'node:fs/promises'

const research = JSON.parse(await readFile(new URL('../panic-research.json', import.meta.url)))
const periods = {
  train: ['2020-01-01', '2023-12-31'],
  validation: ['2024-01-01', '2025-12-31'],
  holdout: ['2026-01-01', '9999-12-31'],
}

const rankings = {
  leastDrop: (a, b) => b.changePct - a.changePct,
  mostDrop: (a, b) => a.changePct - b.changePct,
  highestLiquidity: (a, b) => b.avgValue20 - a.avgValue20,
  shallowDrawdown: (a, b) => b.drawdown90 - a.drawdown90,
  deepDrawdown: (a, b) => a.drawdown90 - b.drawdown90,
  highestPrice: (a, b) => b.signalClose - a.signalClose,
}

function choose(rows, ranking, maxPerDay) {
  const groups = Map.groupBy(rows, row => row.tradeDate)
  return [...groups.values()].flatMap(day => [...day].sort(ranking).slice(0, maxPerDay))
}

function stats(rows) {
  const fills = rows.filter(row => row.tick.filled)
  const returns = fills.map(row => row.tick.netPct).sort((a, b) => a - b)
  const wins = returns.filter(value => value > 0)
  const grossWin = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(returns.filter(value => value <= 0).reduce((sum, value) => sum + value, 0))
  return {
    signals: rows.length,
    fills: fills.length,
    fillRate: rows.length ? fills.length / rows.length * 100 : 0,
    winRate: fills.length ? wins.length / fills.length * 100 : 0,
    avg: fills.length ? returns.reduce((sum, value) => sum + value, 0) / fills.length : 0,
    median: returns.length ? returns[Math.floor((returns.length - 1) / 2)] : 0,
    pf: grossLoss ? grossWin / grossLoss : null,
  }
}

for (const minValue of [1e9, 5e9, 10e9, 20e9]) {
  for (const [rankingName, ranking] of Object.entries(rankings)) {
    const base = research.trades.filter(row => row.avgValue20 >= minValue)
    const result = Object.fromEntries(Object.entries(periods).map(([name, [from, to]]) => {
      const periodRows = base.filter(row => row.signalDate >= from && row.signalDate <= to)
      return [name, stats(choose(periodRows, ranking, 3))]
    }))
    console.log(JSON.stringify({ minValue, ranking: rankingName, result }))
  }
}
