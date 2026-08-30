const MIN_AVG_VALUE = 20_000_000_000
const PRIMARY_ENTRY_DISCOUNT_PCT = 3
const RESERVE_ENTRY_DISCOUNT_PCT = 5
const MAX_ENTRY_PRICE = 2500
const MAX_POSITIONS = 10
const MIN_SIGNALS = 5

const tick = (price: number) => price < 200 ? 1 : price < 500 ? 2 : price < 2000 ? 5 : price < 5000 ? 10 : 25
const roundDown = (price: number) => Math.floor(price / tick(price)) * tick(price)
export type PanicQualityTier = 'A' | 'B' | 'C'

export function classifyPanicTier(changePct: number, openGapPct: number | null): PanicQualityTier | null {
  if (changePct >= -15 && changePct <= -12) return 'A'
  if (changePct >= -6 && changePct <= -5) return 'B'
  if (changePct >= -8 && changePct <= -3) return 'C'
  if (openGapPct !== null && changePct > -3 && changePct <= -1 && openGapPct >= -3 && openGapPct < 0) return 'C'
  return null
}

function tierOrder(tier: PanicQualityTier) { return tier === 'A' ? 0 : tier === 'B' ? 1 : 2 }

function selectCandidates<T extends { signalChangePct: number; qualityTier: PanicQualityTier; avgValue10: number }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => tierOrder(a.qualityTier) - tierOrder(b.qualityTier) || a.signalChangePct - b.signalChangePct || b.avgValue10 - a.avgValue10)
  const primary = sorted.filter(row => row.qualityTier !== 'C').slice(0, MAX_POSITIONS)
  if (primary.length >= MIN_SIGNALS) return primary
  return [...primary, ...sorted.filter(row => row.qualityTier === 'C').slice(0, MIN_SIGNALS - primary.length)]
}

function jakartaNow(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const take = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return { date: `${take('year')}-${take('month')}-${take('day')}`, weekday: take('weekday'), hour: Number(take('hour')), minute: Number(take('minute')) }
}

function nextTradingDate(date: string) {
  const next = new Date(`${date}T05:00:00Z`)
  do next.setUTCDate(next.getUTCDate() + 1)
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6)
  return next.toISOString().slice(0, 10)
}

export async function buildPanicSnapshot(now = new Date()) {
  const response = await fetch('https://scanner.tradingview.com/indonesia/scan', {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'PagiSore-Research/1.0' },
    body: JSON.stringify({ filter: [{ left: 'exchange', operation: 'equal', right: 'IDX' }], options: { lang: 'id' }, markets: ['indonesia'], symbols: { query: { types: ['stock'] }, tickers: [] }, columns: ['name', 'description', 'close', 'open', 'low', 'high', 'change', 'Value.Traded', 'average_volume_10d_calc', 'close[1]', 'change[1]', 'average_volume_10d_calc[1]'], sort: { sortBy: 'Value.Traded', sortOrder: 'desc' }, range: [0, 1200] }),
  })
  if (!response.ok) throw new Error(`TradingView HTTP ${response.status}`)
  const payload = await response.json() as { data?: Array<{ s: string; d: Array<string | number | null> }> }
  const local = jakartaNow(now)
  const minutes = local.hour * 60 + local.minute
  const marketDay = !['Sat', 'Sun'].includes(local.weekday)
  const preOpen = marketDay && minutes < 540
  const planning = preOpen || !marketDay
  const actionable = marketDay && minutes >= 540 && minutes < 630
  const monitoring = marketDay && minutes >= 540 && minutes < 900
  const rows = (payload.data ?? []).map(item => {
    const [ticker, company, close, open, low, high, change, value, currentAverageVolume, previousClose, previousChange, previousAverageVolume] = item.d
    const currentClose = Number(close), currentOpen = Number(open), currentLow = Number(low), currentHigh = Number(high)
    const priorClose = Number(previousClose), priorChangePct = Number(previousChange)
    return { ticker: String(ticker || item.s.split(':').pop()), company: String(company || ticker), currentClose, currentOpen, currentLow, currentHigh, currentChangePct: Number(change), currentValue: Number(value), currentAvgValue10: Number(currentAverageVolume) * currentClose, priorClose, priorChangePct, priorAvgValue10: Number(previousAverageVolume) * priorClose }
  }).filter(row => row.ticker && Number.isFinite(row.currentOpen) && Number.isFinite(row.priorChangePct))

  const eligible = rows.flatMap(row => {
    const signalChangePct = planning ? row.currentChangePct : row.priorChangePct
    const referenceOpen = planning ? row.currentClose : row.currentOpen
    const avgValue10 = planning ? row.currentAvgValue10 : row.priorAvgValue10
    const signalClose = planning ? row.currentClose : row.priorClose
    const openGapPct = planning ? null : (row.currentOpen / row.priorClose - 1) * 100
    const qualityTier = classifyPanicTier(signalChangePct, openGapPct)
    if (!qualityTier || signalClose < 100 || referenceOpen >= MAX_ENTRY_PRICE || avgValue10 < MIN_AVG_VALUE) return []
    const entryDiscountPct = qualityTier === 'C' ? RESERVE_ENTRY_DISCOUNT_PCT : PRIMARY_ENTRY_DISCOUNT_PCT
    return [{ ...row, avgValue10, signalChangePct, openGapPct, qualityTier, entryDiscountPct }]
  })
  const active = selectCandidates(eligible).map(row => {
    const referenceOpen = planning ? row.currentClose : row.currentOpen
    const entry = roundDown(referenceOpen * (1 - row.entryDiscountPct / 100))
    const filled = !planning && row.currentLow <= entry
    const status = planning ? 'TUNGGU OPEN' : filled ? 'LIMIT TERSENTUH' : actionable ? 'BOLEH PASANG LIMIT' : monitoring ? 'ENTRY BARU DITUTUP' : 'KEDALUWARSA'
    const qualityReason = row.qualityTier === 'A' ? 'Kapitulasinya paling kuat dan stabil lintas periode' : row.qualityTier === 'B' ? 'Pullback utama dengan edge positif, tetapi lebih tipis' : 'Cadangan untuk melengkapi lima sinyal; limit dibuat lebih dalam dan hanya dipakai setelah Tier A/B'
    return { ...row, qualityReason, entry, entryFinal: !planning, filled, status }
  })
  const nextEligible = rows.flatMap(row => {
    const qualityTier = classifyPanicTier(row.currentChangePct, null)
    if (!qualityTier || row.currentClose < 100 || row.currentClose >= MAX_ENTRY_PRICE || row.currentAvgValue10 < MIN_AVG_VALUE) return []
    const entryDiscountPct = qualityTier === 'C' ? RESERVE_ENTRY_DISCOUNT_PCT : PRIMARY_ENTRY_DISCOUNT_PCT
    return [{ ...row, signalChangePct: row.currentChangePct, avgValue10: row.currentAvgValue10, qualityTier, entryDiscountPct }]
  })
  const next = selectCandidates(nextEligible).map(row => ({ ...row, estimatedEntry: roundDown(row.currentClose * (1 - row.entryDiscountPct / 100)) }))
  return { asOf: now.toISOString(), source: 'TradingView delayed/public', universe: rows.length, actionable, monitoring, preOpen: planning, sessionDate: local.date, nextTradingDate: nextTradingDate(local.date), rules: { dropMinPct: -15, dropMaxPct: -1, minAverageValue: MIN_AVG_VALUE, entryDiscountPct: PRIMARY_ENTRY_DISCOUNT_PCT, reserveEntryDiscountPct: RESERVE_ENTRY_DISCOUNT_PCT, maxEntryPrice: MAX_ENTRY_PRICE, minSignals: MIN_SIGNALS, maxPositions: MAX_POSITIONS, exit: 'close resmi; eksekusi manual 15:45–15:49 WIB' }, active, next }
}
