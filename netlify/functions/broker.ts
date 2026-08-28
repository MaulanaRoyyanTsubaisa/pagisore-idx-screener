import type { Handler } from '@netlify/functions'

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=3600' }
const tickerPattern = /^[A-Z0-9]{4,6}$/
const jakartaDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)
const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0

export const handler: Handler = async event => {
  const ticker = String(event.queryStringParameters?.ticker || '').toUpperCase()
  if (!tickerPattern.test(ticker)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Kode saham tidak valid.' }) }
  const apiKey = process.env.INVEZGO_API_KEY
  if (!apiKey) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Broker summary belum aktif karena INVEZGO_API_KEY belum diatur.' }) }
  const toDate = new Date()
  const fromDate = new Date(toDate)
  fromDate.setDate(fromDate.getDate() - 10)
  const from = jakartaDate(fromDate)
  const to = jakartaDate(toDate)
  try {
    const url = new URL(`https://api.invezgo.com/analysis/summary/stock/${ticker}`)
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)
    url.searchParams.set('investor', 'all')
    url.searchParams.set('market', 'RG')
    const response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } })
    if (!response.ok) throw new Error(`Invezgo HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`)
    const payload = await response.json()
    const rows = (Array.isArray(payload) ? payload : payload?.data ?? []).map((row: Record<string, unknown>) => ({
      code: String(row.code ?? ''), name: String(row.name ?? row.code ?? ''),
      netValue: asNumber(row.net_value), buyValue: asNumber(row.buy_value), sellValue: asNumber(row.sell_value),
      buyAvg: asNumber(row.buy_avg), sellAvg: asNumber(row.sell_avg),
    })).filter((row: { code: string }) => row.code)
    const sorted = rows.toSorted((a: { netValue: number }, b: { netValue: number }) => b.netValue - a.netValue)
    return { statusCode: 200, headers, body: JSON.stringify({ ticker, from, to, asOf: 'EOD', topBuyers: sorted.slice(0, 3), topSellers: sorted.slice(-3).reverse() }) }
  } catch (error) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: error instanceof Error ? error.message : 'Broker summary gagal dimuat.' }) }
  }
}
