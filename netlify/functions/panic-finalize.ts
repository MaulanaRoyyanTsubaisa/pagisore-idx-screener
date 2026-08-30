import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { buildPanicSnapshot } from './_shared/panic-engine'

export default async () => {
  const snapshot = await buildPanicSnapshot()
  const candidates = snapshot.active.map((row, index) => {
    const netPct = row.filled ? (row.currentClose / row.entry - 1) * 100 - .3 : null
    return {
      rank: index + 1, ticker: row.ticker, company: row.company, signalDate: null,
      tradeDate: snapshot.sessionDate, changePct: row.signalChangePct, avgValue10: row.avgValue10,
      open: row.currentOpen, low: row.currentLow, close: row.currentClose, entry: row.entry,
      entryDiscountPct: row.entryDiscountPct, qualityTier: row.qualityTier,
      filled: row.filled, status: row.filled ? 'TERISI' : 'TIDAK TERISI', netPct,
    }
  })
  const day = { date: snapshot.sessionDate, finalizedAt: new Date().toISOString(), source: snapshot.source, finalized: true, candidates }
  await getStore({ name: 'panic-history', consistency: 'strong' }).setJSON(`days/${snapshot.sessionDate}.json`, day)
  return Response.json(day)
}

export const config: Config = { schedule: '35 9 * * 1-5' }
