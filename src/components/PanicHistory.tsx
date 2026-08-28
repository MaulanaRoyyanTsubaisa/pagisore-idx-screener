import { useMemo, useState } from 'react'
import { ChevronDown, History, Target, TrendingUp } from 'lucide-react'
import { idr, pct } from '../lib/format'
import type { PanicHistoryDay } from '../types'

export function PanicHistory({ days, loading }: { days: PanicHistoryDay[]; loading: boolean }) {
  const [openDate, setOpenDate] = useState('')
  const stats = useMemo(() => {
    const candidates = days.flatMap(day => day.candidates)
    const fills = candidates.filter(row => row.filled && Number.isFinite(row.netPct))
    const wins = fills.filter(row => Number(row.netPct) > 0)
    const total = fills.reduce((sum, row) => sum + Number(row.netPct), 0)
    return { candidates: candidates.length, fills: fills.length, skipped: candidates.length - fills.length, fillRate: candidates.length ? fills.length / candidates.length * 100 : 0, wins: wins.length, winRate: fills.length ? wins.length / fills.length * 100 : 0, average: fills.length ? total / fills.length : 0 }
  }, [days])

  return <section className="history-section" id="history">
    <div className="history-heading"><div><span className="eyebrow"><History size={14} /> DATA PASAR HISTORIS · BUKAN DEMO</span><h2>Histori Panic Limit</h2><p>Ini simulasi aturan pada OHLCV pasar, bukan transaksi akun broker. Sesi produksi otomatis masuk setelah 16:35 WIB; hari tanpa kandidat berarti skip.</p></div></div>
    <div className="no-fill-explainer"><b>TIDAK TERISI = TIDAK ADA TRANSAKSI</b><span>Low hari itu tidak mencapai buy limit. Dana tetap tunai, hasil Rp0, dan baris tersebut tidak dihitung sebagai menang maupun kalah.</span></div>
    <div className="history-kpis"><div><span>Total kandidat</span><b>{stats.candidates}</b><small>{stats.skipped} skip/tidak terisi</small></div><div><span>Order terisi</span><b>{stats.fills}</b><small>Fill rate {pct(stats.fillRate)}</small></div><div><span>WR dari yang terisi</span><b>{pct(stats.winRate)}</b><small>Skip tidak dihitung</small></div><div><span>Rata-rata net terisi</span><b className={stats.average >= 0 ? 'positive' : 'negative'}>{pct(stats.average, true)}</b><small>Setelah biaya 0,3%</small></div></div>
    {loading && !days.length ? <div className="history-empty">Memuat histori…</div> : !days.length ? <div className="history-empty">Belum ada sesi historis yang tersimpan.</div> : <div className="history-days">
      {days.map(day => {
        const filled = day.candidates.filter(row => row.filled)
        const wins = filled.filter(row => Number(row.netPct) > 0)
        const average = filled.length ? filled.reduce((sum, row) => sum + Number(row.netPct), 0) / filled.length : 0
        const expanded = openDate === day.date
        return <article className="history-day" key={day.date}>
          <button onClick={() => setOpenDate(current => current === day.date ? '' : day.date)} aria-expanded={expanded}><strong>{formatDate(day.date)}</strong><span>{filled.length ? `${day.candidates.length} kandidat · ${filled.length} transaksi · ${wins.length} menang · avg ${pct(average, true)}` : day.candidates.length ? `${day.candidates.length} kandidat · 0 transaksi · semua SKIP (Rp0)` : 'Tidak ada kandidat · SKIP (Rp0)'}</span><ChevronDown className={expanded ? 'rotated' : ''} size={18} /></button>
          {expanded && <div className="history-trades">{day.candidates.length ? day.candidates.map(row => <div className="history-trade" key={`${day.date}-${row.ticker}`}><b>#{row.rank} {row.ticker}</b><span>turun {pct(row.changePct)}</span><span>limit {idr(row.entry)}</span><span>{row.filled ? `close ${idr(row.close)}` : `low ${idr(row.low)} > limit`}</span><strong className={!row.filled ? 'skipped' : Number(row.netPct) > 0 ? 'positive' : 'negative'}>{row.filled ? pct(Number(row.netPct), true) : 'SKIP · Rp0'}</strong></div>) : <div className="history-empty compact">Tidak ada kandidat · SKIP · Rp0</div>}</div>}
        </article>
      })}
    </div>}
    <div className="history-method"><Target size={15} /><span>Hasil hanya menghitung limit yang terisi sebelum 15:00, exit pada close, lalu dikurangi biaya 0,3%. <TrendingUp size={13} /> Data historis berasal dari candle publik 60 menit; histori baru dicatat dari snapshot sesi produksi.</span></div>
  </section>
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(`${date}T12:00:00+07:00`))
}
