import type { Handler } from '@netlify/functions'

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30, s-maxage=30' }

export const handler: Handler = async (event) => {
  const requestedMode = event.queryStringParameters?.mode ?? 'proxy'
  try {
    if (requestedMode === 'licensed') {
      const url = process.env.MARKET_DATA_URL
      if (!url) return { statusCode: 503, headers, body: JSON.stringify({ error: 'MARKET_DATA_URL belum dikonfigurasi di Netlify. Gunakan feed IDX/redistributor berlisensi.' }) }
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
        columns: ['name','description','close','open','low','high','low|1','high|1','volume','Value.Traded','EMA10','EMA20','EMA50','RSI','VWAP','relative_volume_10d_calc'],
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
      const range = Math.max(1, h - l)
      const pressure = 1 + Math.max(0, (p - o) / range)
      return {
        ticker: String(ticker || item.s.split(':').pop()), company: String(company || ticker), price: p,
        open: o, low: l, high: h, prevLow: Number(prevLow), prevHigh: Number(prevHigh), volume: v,
        value: Number(tradedValue) || p * v, bidOfferRatio: pressure,
        emaFast: Number(emaFast) || undefined, emaMid: Number(emaMid) || undefined, emaSlow: Number(emaSlow) || undefined,
        rsi14: Number(rsi14) || undefined, vwap: Number(vwap) || undefined, relativeVolume: Number(relativeVolume) || undefined,
        signalTime: now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }), source: 'proxy',
      }
    }).filter(row => row.ticker && Number.isFinite(row.open))
    return { statusCode: 200, headers, body: JSON.stringify({ mode: 'proxy', asOf: now.toISOString(), data }) }
  } catch (error) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: error instanceof Error ? error.message : 'Market feed gagal' }) }
  }
}
