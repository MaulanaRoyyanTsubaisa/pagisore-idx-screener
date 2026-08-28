import type { Config } from '@netlify/functions'
import { buildPanicSnapshot } from './_shared/panic-engine'

export default async () => {
  try {
    const snapshot = await buildPanicSnapshot()
    return Response.json(snapshot, { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Panic feed gagal' }, { status: 502 })
  }
}

export const config: Config = { path: '/api/panic', method: 'GET' }
