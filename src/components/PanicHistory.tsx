import { useMemo, useState } from 'react'
import { ChevronDown, History, Target, TrendingUp } from 'lucide-react'
import { idr, pct } from '../lib/format'
import { simulateFixedSlots } from '../lib/portfolio'
import type { PanicHistoryDay } from '../types'

export function PanicHistory({ days, loading, maxPositions }: { days: PanicHistoryDay[]; loading: boolean; maxPositions: number }) {
  const [openDate, setOpenDate] = useState('')
  const [capitalMillions, setCapitalMillions] = useState(100)
  const portfolio = useMemo(() => simulateFixedSlots(days, maxPositions), [days, maxPositions])
  const stats = useMemo(() => {
    const candidates = days.flatMap(day => day.candidates)
    const fills = candidates.filter(row => row.filled && Number.isFinite(row.netPct))
    const wins = fills.filter(row => Number(row.netPct) > 0)
    const losses = fills.filter(row => Number(row.netPct) <= 0)
    const values = fills.map(row => Number(row.netPct)).sort((a, b) => a - b)
    const total = fills.reduce((sum, row) => sum + Number(row.netPct), 0)
    const grossWin = wins.reduce((sum, row) => sum + Number(row.netPct), 0)
    const grossLoss = Math.abs(losses.reduce((sum, row) => sum + Number(row.netPct), 0))
    const winShare = fills.length ? wins.length / fills.length : 0
    const z = 1.96
    const wilsonDenominator = 1 + z * z / Math.max(1, fills.length)
    const wilsonCenter = (winShare + z * z / (2 * Math.max(1, fills.length))) / wilsonDenominator
    const wilsonHalf = z * Math.sqrt(winShare * (1 - winShare) / Math.max(1, fills.length) + z * z / (4 * Math.max(1, fills.length) ** 2)) / wilsonDenominator
    return {
      candidates: candidates.length, fills: fills.length, skipped: candidates.length - fills.length,
      fillRate: candidates.length ? fills.length / candidates.length * 100 : 0,
      winRate: fills.length ? wins.length / fills.length * 100 : 0,
      average: fills.length ? total / fills.length : 0,
      median: values.length ? values[Math.floor((values.length - 1) / 2)] : 0,
      profitFactor: grossLoss ? grossWin / grossLoss : 0,
      averageWin: wins.length ? grossWin / wins.length : 0,
      averageLoss: losses.length ? -grossLoss / losses.length : 0,
      worst: values[0] ?? 0,
      winRateLow: fills.length ? (wilsonCenter - wilsonHalf) * 100 : 0,
      winRateHigh: fills.length ? (wilsonCenter + wilsonHalf) * 100 : 0,
    }
  }, [days])

  return <section className="history-section" id="history">
    <div className="history-heading"><div><span className="eyebrow"><History size={14} /> DATA PASAR HISTORIS · BUKAN DEMO</span><h2>Histori Panic Limit</h2><p>Ini simulasi aturan pada OHLCV pasar, bukan transaksi akun broker. Sesi produksi otomatis masuk setelah 16:35 WIB; hari tanpa kandidat berarti skip.</p></div></div>
    <div className="no-fill-explainer"><b>TIDAK TERISI = TIDAK ADA TRANSAKSI</b><span>Low hari itu tidak mencapai buy limit. Dana tetap tunai, hasil Rp0, dan baris tersebut tidak dihitung sebagai menang maupun kalah.</span></div>
    <div className="history-kpis"><div><span>Kandidat · 90 sesi terbaru</span><b>{stats.candidates}</b><small>{stats.skipped} skip/tidak terisi</small></div><div><span>Terisi · 90 sesi terbaru</span><b>{stats.fills}</b><small>Fill rate {pct(stats.fillRate)}</small></div><div><span>WR · 90 sesi terbaru</span><b>{pct(stats.winRate)}</b><small>Rentang 95% {pct(stats.winRateLow)}–{pct(stats.winRateHigh)}</small></div><div><span>Avg net · 90 sesi terbaru</span><b className={stats.average >= 0 ? 'positive' : 'negative'}>{pct(stats.average, true)}</b><small>Setelah biaya 0,3%</small></div><div><span>Median net</span><b className={stats.median >= 0 ? 'positive' : 'negative'}>{pct(stats.median, true)}</b><small>Lebih tahan terhadap outlier</small></div><div><span>Profit factor</span><b className={stats.profitFactor >= 1 ? 'positive' : 'negative'}>{stats.profitFactor.toFixed(2)}</b><small>Target sehat di atas 1</small></div></div>
    <div className="portfolio-sim"><div><span>SIMULASI MODAL</span><label>Rp <input type="number" min="1" max="100000" step="1" value={capitalMillions} onChange={event => setCapitalMillions(Math.max(1, Number(event.target.value) || 1))} /> juta</label></div><div><span>Modal per order · {portfolio.slots} slot</span><b>{idr(capitalMillions * 1_000_000 / portfolio.slots)}</b></div><div><span>Net profit 90 sesi</span><b className={portfolio.returnPct >= 0 ? 'positive' : 'negative'}>{idr(capitalMillions * 1_000_000 * portfolio.returnPct / 100)}</b><small>{pct(portfolio.returnPct, true)} setelah biaya 0,3%</small></div><div><span>Nilai akhir simulasi</span><b>{idr(capitalMillions * 1_000_000 * (1 + portfolio.returnPct / 100))}</b></div></div>
    <div className="history-risk"><b>REALITAS RISIKO</b><span>Rata-rata menang {pct(stats.averageWin, true)} · rata-rata kalah {pct(stats.averageLoss, true)} · kerugian terburuk {pct(stats.worst, true)}. Hanya {portfolio.activeDays}/90 hari memiliki transaksi; WR hari aktif {pct(portfolio.winningDayRate)} dan max drawdown portofolio {pct(portfolio.maxDrawdownPct, true)}. Simulasi membagi modal ke {portfolio.slots} slot sejak pagi; order tidak terisi tetap kas. Slippage dan pajak/fee di luar asumsi 0,3% belum dihitung.</span></div>
    {loading && !days.length ? <div className="history-empty">Memuat histori…</div> : !days.length ? <div className="history-empty">Belum ada sesi historis yang tersimpan.</div> : <div className="history-days">
      {days.map(day => {
        const filled = day.candidates.filter(row => row.filled)
        const wins = filled.filter(row => Number(row.netPct) > 0)
        const average = filled.length ? filled.reduce((sum, row) => sum + Number(row.netPct), 0) / filled.length : 0
        const expanded = openDate === day.date
        return <article className="history-day" key={day.date}>
          <button onClick={() => setOpenDate(current => current === day.date ? '' : day.date)} aria-expanded={expanded}><strong>{formatDate(day.date)}</strong><span>{filled.length ? `${day.candidates.length} kandidat · ${filled.length} transaksi · ${wins.length} menang · avg ${pct(average, true)}` : day.candidates.length ? `${day.candidates.length} kandidat · 0 transaksi · semua SKIP (Rp0)` : 'Tidak ada kandidat · SKIP (Rp0)'}</span><ChevronDown className={expanded ? 'rotated' : ''} size={18} /></button>
          {expanded && <div className="history-trades">{day.candidates.length ? day.candidates.map(row => <div className="history-trade" key={`${day.date}-${row.ticker}`}><b>#{row.rank} {row.ticker} <i className={`tier tier-${row.changePct <= -12 ? 'a' : 'b'}`}>TIER {row.changePct <= -12 ? 'A' : 'B'}</i></b><span>turun {pct(row.changePct)}</span><span>limit {idr(row.entry)}</span><span>{row.filled ? `close ${idr(row.close)}` : `low ${idr(row.low)} > limit`}</span><strong className={!row.filled ? 'skipped' : Number(row.netPct) > 0 ? 'positive' : 'negative'}>{row.filled ? pct(Number(row.netPct), true) : 'SKIP · Rp0'}</strong></div>) : <div className="history-empty compact">Tidak ada kandidat · SKIP · Rp0</div>}</div>}
        </article>
      })}
    </div>}
    <div className="history-method"><Target size={15} /><span>Hasil hanya menghitung limit yang terisi sebelum 15:00, exit pada close, lalu dikurangi biaya 0,3%. <TrendingUp size={13} /> Data historis berasal dari candle publik 60 menit; histori baru dicatat dari snapshot sesi produksi.</span></div>
  </section>
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(`${date}T12:00:00+07:00`))
}
