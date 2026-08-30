const MIN_AVG_VALUE = 20_000_000_000
const ENTRY_DISCOUNT_PCT = 3
const MAX_POSITIONS = 10

const tick = (price: number) => price < 200 ? 1 : price < 500 ? 2 : price < 2000 ? 5 : price < 5000 ? 10 : 25
const roundDown = (price: number) => Math.floor(price / tick(price)) * tick(price)
const acceptedDrop = (changePct: number) => changePct <= -12 || changePct >= -6

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
  const actionable = marketDay && minutes >= 540 && minutes < 630
  const monitoring = marketDay && minutes >= 540 && minutes < 900
  const rows = (payload.data ?? []).map(item => {
    const [ticker, company, close, open, low, high, change, value, currentAverageVolume, previousClose, previousChange, previousAverageVolume] = item.d
    const currentClose = Number(close), currentOpen = Number(open), currentLow = Number(low), currentHigh = Number(high)
    const priorClose = Number(previousClose), priorChangePct = Number(previousChange)
    return { ticker: String(ticker || item.s.split(':').pop()), company: String(company || ticker), currentClose, currentOpen, currentLow, currentHigh, currentChangePct: Number(change), currentValue: Number(value), currentAvgValue10: Number(currentAverageVolume) * currentClose, priorClose, priorChangePct, priorAvgValue10: Number(previousAverageVolume) * priorClose }
  }).filter(row => row.ticker && Number.isFinite(row.currentOpen) && Number.isFinite(row.priorChangePct))

  const activeSource = preOpen
    ? rows.filter(row => row.currentChangePct <= -5 && row.currentChangePct >= -15 && acceptedDrop(row.currentChangePct) && row.currentClose >= 100 && row.currentAvgValue10 >= MIN_AVG_VALUE).sort((a, b) => a.currentChangePct - b.currentChangePct)
    : rows.filter(row => row.priorChangePct <= -5 && row.priorChangePct >= -15 && acceptedDrop(row.priorChangePct) && row.priorClose >= 100 && row.priorAvgValue10 >= MIN_AVG_VALUE).sort((a, b) => a.priorChangePct - b.priorChangePct)
  const active = activeSource.slice(0, MAX_POSITIONS).map(row => {
    const signalChangePct = preOpen ? row.currentChangePct : row.priorChangePct
    const referenceOpen = preOpen ? row.currentClose : row.currentOpen
    const entry = roundDown(referenceOpen * (1 - ENTRY_DISCOUNT_PCT / 100))
    const filled = !preOpen && row.currentLow <= entry
    const status = preOpen ? 'TUNGGU OPEN' : filled ? 'LIMIT TERSENTUH' : actionable ? 'BOLEH PASANG LIMIT' : monitoring ? 'ENTRY BARU DITUTUP' : 'KEDALUWARSA'
    const qualityTier = signalChangePct <= -12 ? 'A' : 'B'
    const qualityReason = qualityTier === 'A' ? 'Kapitulasinya lebih kuat dan stabil lintas periode' : 'Pullback ringan masih positif, tetapi edge lebih tipis'
    return { ...row, avgValue10: preOpen ? row.currentAvgValue10 : row.priorAvgValue10, signalChangePct, qualityTier, qualityReason, entry, entryFinal: !preOpen, filled, status }
  })
  const next = rows.filter(row => row.currentChangePct <= -5 && row.currentChangePct >= -15 && acceptedDrop(row.currentChangePct) && row.currentClose >= 100 && row.currentAvgValue10 >= MIN_AVG_VALUE).sort((a, b) => a.currentChangePct - b.currentChangePct).slice(0, MAX_POSITIONS).map(row => ({ ...row, estimatedEntry: roundDown(row.currentClose * (1 - ENTRY_DISCOUNT_PCT / 100)) }))
  return { asOf: now.toISOString(), source: 'TradingView delayed/public', universe: rows.length, actionable, monitoring, preOpen, sessionDate: local.date, nextTradingDate: nextTradingDate(local.date), rules: { dropMinPct: -15, dropMaxPct: -5, minAverageValue: MIN_AVG_VALUE, entryDiscountPct: ENTRY_DISCOUNT_PCT, maxPositions: MAX_POSITIONS, exit: 'close resmi; eksekusi manual 15:45–15:49 WIB' }, active, next }
}
