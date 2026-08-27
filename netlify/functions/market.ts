import type { Handler } from '@netlify/functions'

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30, s-maxage=30' }
const exactFormula = 'open == low && all_bid_volume > all_offer_volume && high > prev_high && low > prev_low && value > 100000000'

const asNumber = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const firstNumber = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const number = asNumber(row[key])
    if (number !== undefined) return number
  }
  return undefined
}

export const handler: Handler = async (event) => {
  const requestedMode = event.queryStringParameters?.mode ?? 'proxy'
  try {
    if (requestedMode === 'licensed') {
      const invezgoKey = process.env.INVEZGO_API_KEY
      if (invezgoKey) {
        const response = await fetch('https://api.invezgo.com/screener/screen', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${invezgoKey}` },
          body: JSON.stringify({ formula: exactFormula, category: ['COMPOSITE'] }),
        })
        if (!response.ok) {
          const message = await response.text()
          throw new Error(`Invezgo HTTP ${response.status}: ${message.slice(0, 220)}`)
        }
        const payload = await response.json()
        const rows = (Array.isArray(payload) ? payload : payload?.data ?? []) as Array<Record<string, unknown>>
        const now = new Date()
        const data = rows.map(row => {
          const price = firstNumber(row, ['close', 'price', 'last']) ?? 0
          const allBidVolume = firstNumber(row, ['all_bid_volume', 'allBidVolume'])
          const allOfferVolume = firstNumber(row, ['all_offer_volume', 'allOfferVolume'])
          return {
            ticker: String(row.code ?? row.ticker ?? ''), company: String(row.name ?? row.company ?? row.code ?? ''),
            price, close: price, open: firstNumber(row, ['open']) ?? 0, low: firstNumber(row, ['low']) ?? 0,
            high: firstNumber(row, ['high']) ?? 0, prevLow: firstNumber(row, ['prev_low', 'prevLow']) ?? 0,
            prevHigh: firstNumber(row, ['prev_high', 'prevHigh']) ?? 0, volume: firstNumber(row, ['volume']) ?? 0,
            value: firstNumber(row, ['value']) ?? 0, allBidVolume, allOfferVolume,
            bidOfferRatio: allBidVolume !== undefined && allOfferVolume !== undefined ? allBidVolume / Math.max(1, allOfferVolume) : undefined,
            emaFast: firstNumber(row, ['ema10']), emaMid: firstNumber(row, ['ema20']), emaSlow: firstNumber(row, ['ema50']),
            rsi14: firstNumber(row, ['rsi14', 'rsi']), vwap: firstNumber(row, ['vwap']),
            relativeVolume: firstNumber(row, ['relative_volume', 'rvol']),
            spreadTicks: firstNumber(row, ['spread_ticks']), orderBookPersistence: firstNumber(row, ['order_book_persistence']),
            signalTime: now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }), source: 'licensed',
          }
        }).filter(row => row.ticker && row.open > 0)
        return { statusCode: 200, headers: { ...headers, 'cache-control': 'public, max-age=60, s-maxage=300' }, body: JSON.stringify({ mode: 'licensed', provider: 'Invezgo', formula: exactFormula, exact: true, asOf: now.toISOString(), data }) }
      }
      const url = process.env.MARKET_DATA_URL
      if (!url) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Feed exact belum terhubung. Tambahkan INVEZGO_API_KEY di Netlify untuk menjalankan rumus lengkap secara live.' }) }
      const response = await fetch(url, { headers: process.env.MARKET_DATA_TOKEN ? { authorization: `Bearer ${process.env.MARKET_DATA_TOKEN}` } : {} })
      if (!response.ok) throw new Error(`Provider mengembalikan HTTP ${response.status}`)
      const data = await response.json()
      return { statusCode: 200, headers, body: JSON.stringify({ mode: 'licensed', asOf: new Date().toISOString(), data }) }
    }

    const response = await fetch('https://scanner.tradingview.com/indonesia/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'PagiSore-Research/1.0' },
      body: JSON.stringify({
        filter: [{ left: 'exchange', operation: 'equal', right: 'IDX' }],
        options: { lang: 'id' },
        markets: ['indonesia'],
        symbols: { query: { types: ['stock'] }, tickers: [] },
        columns: ['name','description','close','open','low','high','low[1]','high[1]','volume','Value.Traded','EMA10','EMA20','EMA50','RSI','VWAP','relative_volume_10d_calc'],
        sort: { sortBy: 'Value.Traded', sortOrder: 'desc' },
        range: [0, 1200],
      }),
    })
    if (!response.ok) throw new Error(`Proxy pasar mengembalikan HTTP ${response.status}`)
    const json = await response.json() as { data?: Array<{ s: string; d: Array<string | number | null> }> }
    const now = new Date()
    const data = (json.data ?? []).map(item => {
      const [ticker, company, price, open, low, high, prevLow, prevHigh, volume, tradedValue, emaFast, emaMid, emaSlow, rsi14, vwap, relativeVolume] = item.d
      const o = Number(open), l = Number(low), h = Number(high), p = Number(price), v = Number(volume)
      // Proxy tekanan beli hanya untuk peringkat pra-sinyal; bukan aggregate order book.
      return {
        ticker: String(ticker || item.s.split(':').pop()), company: String(company || ticker), price: p,
        open: o, low: l, high: h, prevLow: Number(prevLow), prevHigh: Number(prevHigh), volume: v,
        value: Number(tradedValue) || p * v,
        emaFast: Number(emaFast) || undefined, emaMid: Number(emaMid) || undefined, emaSlow: Number(emaSlow) || undefined,
        rsi14: Number(rsi14) || undefined, vwap: Number(vwap) || undefined, relativeVolume: Number(relativeVolume) || undefined,
        signalTime: now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }), source: 'proxy',
      }
    }).filter(row => row.ticker && Number.isFinite(row.open))
    return { statusCode: 200, headers, body: JSON.stringify({ mode: 'proxy', provider: 'TradingView delayed', exact: false, asOf: now.toISOString(), data }) }
  } catch (error) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: error instanceof Error ? error.message : 'Market feed gagal' }) }
  }
}
