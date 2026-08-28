import { useMemo, useState } from 'react'
import { ChevronDown, History, Target, TrendingUp } from 'lucide-react'
import { idr, pct } from '../lib/format'
import type { PanicHistoryDay } from '../types'

export function PanicHistory({ days, loading }: { days: PanicHistoryDay[]; loading: boolean }) {
  const [openDate, setOpenDate] = useState('')
  const stats = useMemo(() => {
    const fills = days.flatMap(day => day.candidates).filter(row => row.filled && Number.isFinite(row.netPct))
    const wins = fills.filter(row => Number(row.netPct) > 0)
    const total = fills.reduce((sum, row) => sum + Number(row.netPct), 0)
    return { fills: fills.length, wins: wins.length, winRate: fills.length ? wins.length / fills.length * 100 : 0, average: fills.length ? total / fills.length : 0, total }
  }, [days])

  return <section className="history-section" id="history">
    <div className="history-heading"><div><span className="eyebrow"><History size={14} /> DATA PASAR HISTORIS · BUKAN DEMO</span><h2>Histori Panic Limit</h2><p>Ini simulasi aturan pada OHLCV pasar, bukan transaksi akun broker. Sesi produksi otomatis masuk setelah 16:35 WIB; hari tanpa kandidat berarti skip.</p></div></div>
    <div className="history-kpis"><div><span>Order terisi</span><b>{stats.fills}</b></div><div><span>Win rate</span><b>{pct(stats.winRate)}</b></div><div><span>Rata-rata net</span><b className={stats.average >= 0 ? 'positive' : 'negative'}>{pct(stats.average, true)}</b></div><div><span>Total per-trade</span><b className={stats.total >= 0 ? 'positive' : 'negative'}>{pct(stats.total, true)}</b></div></div>
    {loading && !days.length ? <div className="history-empty">Memuat histori…</div> : !days.length ? <div className="history-empty">Belum ada sesi historis yang tersimpan.</div> : <div className="history-days">
      {days.map(day => {
        const filled = day.candidates.filter(row => row.filled)
        const wins = filled.filter(row => Number(row.netPct) > 0)
        const average = filled.length ? filled.reduce((sum, row) => sum + Number(row.netPct), 0) / filled.length : 0
        const expanded = openDate === day.date
        return <article className="history-day" key={day.date}>
          <button onClick={() => setOpenDate(current => current === day.date ? '' : day.date)} aria-expanded={expanded}><strong>{formatDate(day.date)}</strong><span>{day.candidates.length} kandidat · {filled.length} terisi · {wins.length} menang · avg {pct(average, true)}</span><ChevronDown className={expanded ? 'rotated' : ''} size={18} /></button>
          {expanded && <div className="history-trades">{day.candidates.length ? day.candidates.map(row => <div className="history-trade" key={`${day.date}-${row.ticker}`}><b>#{row.rank} {row.ticker}</b><span>turun {pct(row.changePct)}</span><span>limit {idr(row.entry)}</span><span>close {idr(row.close)}</span><strong className={!row.filled ? '' : Number(row.netPct) > 0 ? 'positive' : 'negative'}>{row.filled ? pct(Number(row.netPct), true) : 'tidak terisi'}</strong></div>) : <div className="history-empty compact">Tidak ada kandidat · skip</div>}</div>}
        </article>
      })}
    </div>}
    <div className="history-method"><Target size={15} /><span>Hasil hanya menghitung limit yang terisi sebelum 15:00, exit pada close, lalu dikurangi biaya 0,3%. <TrendingUp size={13} /> Data historis berasal dari candle publik 60 menit; histori baru dicatat dari snapshot sesi produksi.</span></div>
  </section>
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(`${date}T12:00:00+07:00`))
}
