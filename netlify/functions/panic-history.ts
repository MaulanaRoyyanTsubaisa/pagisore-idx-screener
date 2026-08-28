import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'

export default async () => {
  try {
    const store = getStore({ name: 'panic-history', consistency: 'strong' })
    const { blobs } = await store.list({ prefix: 'days/' })
    const selected = blobs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 120)
    const days = (await Promise.all(selected.map(blob => store.get(blob.key, { type: 'json' })))).filter(Boolean)
    return Response.json({ days }, { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } })
  } catch (error) {
    return Response.json({ days: [], error: error instanceof Error ? error.message : 'Histori belum tersedia' }, { status: 200 })
  }
}

export const config: Config = { path: '/api/panic-history', method: 'GET' }
