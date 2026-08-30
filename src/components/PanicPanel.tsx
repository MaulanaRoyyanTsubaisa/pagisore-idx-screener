import { useState } from 'react'
import { ChevronDown, Clock3, ShieldAlert, Zap } from 'lucide-react'
import { compactIdr, idr, pct } from '../lib/format'
import type { PanicCandidate, PanicPayload } from '../types'

export function PanicPanel({ payload, loading }: { payload: PanicPayload | null; loading: boolean }) {
  const [expanded, setExpanded] = useState('')
  const rows = payload?.active ?? []
  const maxPositions = payload?.rules.maxPositions ?? 10
  return <section className="panic-panel" aria-labelledby="panic-title">
    <div className="panic-heading">
      <div><span className="eyebrow"><Zap size={14} /> SINYAL UTAMA · INI YANG DIGUNAKAN</span><h2 id="panic-title">Panic Limit · ikuti urutan prioritas</h2><p>Dahulukan Tier A, lalu Tier B. Tier C hanya mengisi kekurangan menuju {payload?.rules.minSignals ?? 5} sinyal · maksimal {maxPositions} antrean.</p></div>
      <div className={payload?.actionable ? 'session-badge active' : 'session-badge'}><Clock3 size={15} />{payload?.actionable ? 'Boleh pasang limit final' : payload?.preOpen ? 'Tunggu open · belum entry' : 'Sesi entry selesai'}</div>
    </div>
    <div className="panic-instructions"><b>Cara mengikuti sinyal:</b><span>① Order baru hanya 09:00–10:30 WIB</span><span>② Tier A/B memakai limit −3%; Tier C lebih selektif di −5%</span><span>③ Harga open ≥Rp2.500 dibuang karena hasil 2024 kembali negatif</span><span>④ Tidak terisi = batal/skip, jangan market buy</span></div>
    {payload && rows.length > 0 && rows.length < payload.rules.minSignals && <div className="signal-shortfall"><ShieldAlert size={15} /><span>Hanya {rows.length} kandidat yang lolos dari target {payload.rules.minSignals}. Jangan menambah saham di luar daftar hanya untuk memenuhi kuota.</span></div>}
    {loading && !payload ? <div className="panic-empty">Memuat kandidat sesi…</div> : rows.length === 0 ? <div className="panic-empty">Tidak ada kandidat yang lolos. Ini berarti skip—jangan menurunkan standar hanya supaya ada transaksi.</div> : <div className="panic-grid">
      {rows.map((row, index) => <PanicCard key={row.ticker} row={row} rank={index + 1} expanded={expanded === row.ticker} onToggle={() => setExpanded(current => current === row.ticker ? '' : row.ticker)} />)}
    </div>}
    <div className="panic-proof">
      <div><b>Tier A · utama</b><span>Validasi avg +0,98% / PF 1,45 · holdout +2,84% / PF 2,49</span></div>
      <div><b>Tier B · utama</b><span>Validasi avg +1,02% / PF 1,88 · holdout +0,12% / PF 1,06</span></div>
      <div><b>Tier C · cadangan sampai 5</b><span>Validasi avg +0,52% / PF 1,36 · holdout +0,35% / PF 1,22 · limit −5%</span></div>
      <div className="panic-warning"><ShieldAlert size={16} /><span>Backtest candle 60 menit, biaya 0,3%, order harus tersentuh sebelum 15:00. Hasil lampau bukan jaminan; data publik tertunda.</span></div>
    </div>
  </section>
}

function PanicCard({ row, rank, expanded, onToggle }: { row: PanicCandidate; rank: number; expanded: boolean; onToggle: () => void }) {
  const indicativeNet = row.filled ? (row.currentClose / row.entry - 1) * 100 - .3 : null
  return <article className="panic-card">
    <button onClick={onToggle} aria-expanded={expanded}>
      <div className="panic-rank">#{rank}</div><div className="panic-symbol"><strong>{row.ticker} <i className={`tier tier-${row.qualityTier.toLowerCase()}`}>TIER {row.qualityTier}</i></strong><span>{row.company}</span></div>
      <div className="panic-drop">{pct(row.signalChangePct)}</div><div className={`panic-status ${row.filled ? 'filled' : ''}`}>{row.status}</div><ChevronDown className={expanded ? 'rotated' : ''} size={18} />
    </button>
    <div className="panic-levels"><div><span>{row.entryFinal ? 'OPEN HARI INI' : 'CLOSE REFERENSI'}</span><b>{idr(row.entryFinal ? row.currentOpen : row.currentClose)}</b></div><div className="entry"><span>{row.entryFinal ? `BUY LIMIT −${row.entryDiscountPct}%` : `ESTIMASI LIMIT −${row.entryDiscountPct}%`}</span><b>{idr(row.entry)}</b></div><div><span>{row.entryFinal ? 'LOW SAAT INI' : 'FINAL SAAT OPEN'}</span><b>{row.entryFinal ? idr(row.currentLow) : 'Belum ada'}</b></div></div>
    <div className={row.filled ? 'panic-action touched' : 'panic-action'}>{row.filled ? `Harga limit ${idr(row.entry)} sudah tersentuh. Hanya dianggap terisi bila order sudah dipasang; jika belum, SKIP dan jangan beli di harga sekarang.` : row.status === 'BOLEH PASANG LIMIT' ? `Boleh antre buy limit ${idr(row.entry)} sampai 10:30 WIB. Jangan mengubahnya menjadi market buy.` : row.status === 'TUNGGU OPEN' ? 'Belum boleh entry. Muat ulang setelah open untuk mendapatkan harga limit final.' : 'Jangan memasang order baru. Status hanya untuk memantau order yang sudah dibuat sebelumnya.'}</div>
    {expanded && <div className="panic-details">
      <div><span>P&amp;L indikatif saat ini</span><b className={indicativeNet === null ? '' : indicativeNet >= 0 ? 'positive' : 'negative'}>{indicativeNet === null ? 'Belum terisi' : pct(indicativeNet, true)}</b><small>Harga publik tertunda dan asumsi biaya total 0,3%; bukan saldo broker.</small></div>
      <div><span>Kualitas kandidat</span><b>Tier {row.qualityTier}</b><small>{row.qualityReason}. Tier menunjukkan kekuatan historis kelompok, bukan jaminan transaksi ini menang.</small></div>
      <div><span>Exit aturan tervalidasi</span><b>15:45–15:49 WIB</b><small>Backtest memakai harga penutupan resmi. Eksekusi manual sebelum prapenutupan dapat berbeda dari close resmi.</small></div>
      <div><span>TP/SL tetap</span><b>TIDAK DIGUNAKAN</b><small>TP net +1% dengan SL 1%–7% gagal pada uji konservatif candle 60 menit. Jangan memakai angka +4%/−7% lama.</small></div>
      <div><span>Likuiditas 10 hari</span><b>{compactIdr(row.avgValue10)}</b><small>Proxy gratis; bukan order book dan bukan broker flow.</small></div>
    </div>}
  </article>
}
