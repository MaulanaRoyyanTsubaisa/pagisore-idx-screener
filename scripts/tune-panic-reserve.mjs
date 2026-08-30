import { readFile } from 'node:fs/promises'

const cachePath = process.env.PANIC_CACHE_IN || 'C:/Users/royzz/AppData/Local/Temp/pagisore-tuning-cache-broad.json'
const { trades } = JSON.parse(await readFile(cachePath, 'utf8'))
const COST_PCT = 0.3
const SLOTS = 10
const MIN_SIGNALS = 5

function tick(price) { return price < 200 ? 1 : price < 500 ? 2 : price < 2000 ? 5 : price < 5000 ? 10 : 25 }
function entryFrom(open, discountPct) { const raw = open * (1 - discountPct / 100); return Math.floor(raw / tick(raw)) * tick(raw) }
function reprice(row, discountPct) {
  const entry = entryFrom(row.open, discountPct)
  const filled = row.eligibleLow <= entry
  return { ...row, entry, filled, netPct: filled ? (row.close / entry - 1) * 100 - COST_PCT : null, discountPct }
}

const productionBand = row =>
  (row.changePct >= -15 && row.changePct <= -12) ||
  (row.changePct >= -6 && row.changePct <= -5)
const primarySort = (a, b) => {
  const aTier = a.changePct <= -12 ? 0 : 1
  const bTier = b.changePct <= -12 ? 0 : 1
  return aTier - bTier || a.changePct - b.changePct || b.avgValue10 - a.avgValue10
}
const reserveSort = (a, b) => a.changePct - b.changePct || b.avgValue10 - a.avgValue10
const byDate = Map.groupBy(trades, row => row.tradeDate)

function selectDay(rows, reserveAccept, reserveDiscount, maxPrice) {
  rows = rows.filter(row => row.open < maxPrice)
  const primary = rows.filter(productionBand).sort(primarySort).slice(0, SLOTS).map(row => reprice(row, 3))
  if (primary.length >= MIN_SIGNALS) return primary
  const used = new Set(primary.map(row => row.ticker))
  const reserve = rows.filter(row => !productionBand(row) && reserveAccept(row) && !used.has(row.ticker))
    .sort(reserveSort).slice(0, MIN_SIGNALS - primary.length).map(row => reprice(row, reserveDiscount))
  return [...primary, ...reserve]
}

function fillStats(rows) {
  const fills = rows.filter(row => row.filled)
  const values = fills.map(row => row.netPct)
  const wins = values.filter(value => value > 0)
  const grossWin = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = Math.abs(values.filter(value => value <= 0).reduce((sum, value) => sum + value, 0))
  return {
    signals: rows.length,
    fills: fills.length,
    fillRate: fills.length / Math.max(1, rows.length) * 100,
    winRate: wins.length / Math.max(1, fills.length) * 100,
    avg: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    pf: grossLoss ? grossWin / grossLoss : null,
  }
}

function portfolio(selectedByDate, year) {
  const days = [...selectedByDate].filter(([date]) => date.startsWith(`${year}-`)).sort(([a], [b]) => a.localeCompare(b))
  let equity = 1, peak = 1, maxDrawdownPct = 0
  for (const [, rows] of days) {
    const dailyReturn = rows.filter(row => row.filled).reduce((sum, row) => sum + row.netPct, 0) / SLOTS
    equity *= 1 + dailyReturn / 100
    peak = Math.max(peak, equity)
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100)
  }
  return { returnPct: (equity - 1) * 100, maxDrawdownPct }
}

function evaluate(profile) {
  const selectedByDate = new Map([...byDate].map(([date, rows]) => [date, selectDay(rows, profile.accept, profile.discount, profile.maxPrice ?? 2000)]))
  const selected = [...selectedByDate.values()].flat()
  const reserve = selected.filter(row => !productionBand(row))
  const coverageDays = [...selectedByDate.values()]
  const annual = Object.fromEntries([2024, 2025, 2026].map(year => [year, portfolio(selectedByDate, year)]))
  const reserveAnnual = Object.fromEntries([2024, 2025, 2026].map(year => [year, fillStats(reserve.filter(row => row.tradeDate.startsWith(`${year}-`)))]))
  return {
    ...profile,
    coverage5: coverageDays.filter(rows => rows.length >= MIN_SIGNALS).length / Math.max(1, coverageDays.length) * 100,
    avgSignals: selected.length / Math.max(1, coverageDays.length),
    avgFills: selected.filter(row => row.filled).length / Math.max(1, coverageDays.length),
    annual,
    reserveAnnual,
    selectedByDate,
    selected,
  }
}

const bands = [
  ['deep -20..-15', -20, -15],
  ['middle -12..-6', -12, -6],
  ['shallow -5..-1', -5, -1],
  ['middle+shallow -12..-1', -12, -1],
  ['deep+middle -20..-6', -20, -6],
  ['all reserve', -20, -1],
]
for (let low = -12; low <= -3; low += 1) {
  for (let high = low + 1; high <= -1; high += 1) bands.push([`${low}..${high}`, low, high])
}

const results = []
for (const [name, low, high] of bands) {
  for (const discount of [2.5, 3, 3.5, 4, 4.5, 5]) {
    results.push(evaluate({ name, low, high, discount, maxPrice: 2000, accept: row => row.changePct >= low && row.changePct <= high }))
  }
}

const passed = results.filter(result =>
  [2024, 2025, 2026].every(year => result.annual[year].returnPct > 0) &&
  [2024, 2025, 2026].every(year => {
    const stats = result.reserveAnnual[year]
    return stats.fills >= 8 && stats.avg > 0 && stats.pf > 1
  })
).sort((a, b) => b.coverage5 - a.coverage5 || Math.min(...[2024, 2025, 2026].map(year => b.annual[year].returnPct)) - Math.min(...[2024, 2025, 2026].map(year => a.annual[year].returnPct)))

console.log(`candidate days in broad cache: ${byDate.size}`)
console.log(`profiles tested: ${results.length}; strict pass: ${passed.length}`)
for (const result of passed.slice(0, 20)) {
  console.log(JSON.stringify({
    band: result.name, discount: result.discount, coverage5: result.coverage5, avgSignals: result.avgSignals, avgFills: result.avgFills,
    annual: result.annual,
    reserveAnnual: result.reserveAnnual,
  }))
}

console.log('predefined band sensitivity')
for (const result of results.filter(item => bands.slice(0, 6).some(([name]) => name === item.name))) {
  console.log(JSON.stringify({ band: result.name, discount: result.discount, coverage5: result.coverage5, avgSignals: result.avgSignals, avgFills: result.avgFills, annual: result.annual, reserveAnnual: result.reserveAnnual }))
}

console.log('price-cap sensitivity · reserve -8..-3 at -5%')
for (const maxPrice of [1000, 1500, 2000, 2500, 3000, 5000, Infinity]) {
  const result = evaluate({ name: '-8..-3', low: -8, high: -3, discount: 5, maxPrice, accept: row => row.changePct >= -8 && row.changePct <= -3 })
  console.log(JSON.stringify({ maxPrice, coverage5: result.coverage5, avgSignals: result.avgSignals, avgFills: result.avgFills, annual: result.annual, reserveAnnual: result.reserveAnnual }))
}

console.log('very-shallow anatomy · raw candidates -3..-1 · price <2500 · entry -5%')
const shallowSegments = [
  ['all', () => true],
  ['drop -3..-2', row => row.changePct >= -3 && row.changePct < -2],
  ['drop -2..-1', row => row.changePct >= -2 && row.changePct <= -1],
  ['gap <-3', row => row.openGapPct < -3],
  ['gap -3..0', row => row.openGapPct >= -3 && row.openGapPct < 0],
  ['gap 0..3', row => row.openGapPct >= 0 && row.openGapPct < 3],
  ['gap >=3', row => row.openGapPct >= 3],
  ['price <500', row => row.open < 500],
  ['price 500..1499', row => row.open >= 500 && row.open < 1500],
  ['price 1500..2499', row => row.open >= 1500 && row.open < 2500],
  ['liq 20..50B', row => row.avgValue10 < 50e9],
  ['liq 50..100B', row => row.avgValue10 >= 50e9 && row.avgValue10 < 100e9],
  ['liq >=100B', row => row.avgValue10 >= 100e9],
]
const shallowRaw = trades.filter(row => row.changePct >= -3 && row.changePct <= -1 && row.open < 2500).map(row => reprice(row, 5))
for (const [name, accept] of shallowSegments) {
  console.log(JSON.stringify({ segment: name, annual: Object.fromEntries([2024, 2025, 2026].map(year => [year, fillStats(shallowRaw.filter(row => row.tradeDate.startsWith(`${year}-`) && accept(row)))])) }))
}

console.log('composite Tier C · -8..-3 plus shallow -3..-1 only on negative opening gap · entry -5%')
const compositeAccept = row =>
  (row.changePct >= -8 && row.changePct <= -3) ||
  (row.changePct > -3 && row.changePct <= -1 && row.openGapPct >= -3 && row.openGapPct < 0)
for (const maxPrice of [1000, 1500, 2000, 2500, 3000]) {
  const result = evaluate({ name: 'composite', discount: 5, maxPrice, accept: compositeAccept })
  console.log(JSON.stringify({ maxPrice, coverage5: result.coverage5, avgSignals: result.avgSignals, avgFills: result.avgFills, annual: result.annual, reserveAnnual: result.reserveAnnual }))
}

const chosen = evaluate({ name: 'composite', discount: 5, maxPrice: 2500, accept: compositeAccept })
console.log('chosen tier proof · price <2500')
for (const [tier, accept] of [
  ['A', row => productionBand(row) && row.changePct <= -12],
  ['B', row => productionBand(row) && row.changePct > -12],
  ['C', row => !productionBand(row)],
]) {
  console.log(JSON.stringify({
    tier,
    validation: fillStats(chosen.selected.filter(row => row.tradeDate >= '2024-01-01' && row.tradeDate <= '2025-12-31' && accept(row))),
    holdout: fillStats(chosen.selected.filter(row => row.tradeDate >= '2026-01-01' && accept(row))),
  }))
}

if (!passed.length) {
  console.log('best portfolio-only profiles')
  for (const result of results.filter(item => [2024, 2025, 2026].every(year => item.annual[year].returnPct > 0)).sort((a, b) => b.coverage5 - a.coverage5).slice(0, 20)) {
    console.log(JSON.stringify({ band: result.name, discount: result.discount, coverage5: result.coverage5, avgSignals: result.avgSignals, avgFills: result.avgFills, annual: result.annual, reserveAnnual: result.reserveAnnual }))
  }
}
