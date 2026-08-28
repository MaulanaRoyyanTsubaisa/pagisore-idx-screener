import { useState } from 'react'
import { ChevronDown, Clock3, ShieldAlert, Zap } from 'lucide-react'
import { compactIdr, idr, pct } from '../lib/format'
import type { PanicCandidate, PanicPayload } from '../types'

export function PanicPanel({ payload, loading }: { payload: PanicPayload | null; loading: boolean }) {
  const [expanded, setExpanded] = useState('')
  const rows = payload?.active ?? []
  return <section className="panic-panel" aria-labelledby="panic-title">
    <div className="panic-heading">
      <div><span className="eyebrow"><Zap size={14} /> SINYAL UTAMA · INI YANG DIGUNAKAN</span><h2 id="panic-title">Panic Limit · ikuti urutan prioritas</h2><p>Mulai dari #1, lalu #2 dan seterusnya · maksimal 5 posisi · hanya jika buy limit final tersentuh</p></div>
      <div className={payload?.actionable ? 'session-badge active' : 'session-badge'}><Clock3 size={15} />{payload?.actionable ? 'Boleh pasang limit final' : payload?.preOpen ? 'Tunggu open · belum entry' : 'Sesi entry selesai'}</div>
    </div>
    <div className="panic-instructions"><b>Cara mengikuti sinyal:</b><span>① Order baru hanya 09:00–10:30 WIB</span><span>② Pasang hanya harga BUY LIMIT yang tertulis</span><span>③ “Limit tersentuh” bukan perintah membeli sekarang</span><span>④ Tidak terisi = batal/skip, jangan market buy</span></div>
    {loading && !payload ? <div className="panic-empty">Memuat kandidat sesi…</div> : rows.length === 0 ? <div className="panic-empty">Tidak ada kandidat yang lolos. Ini berarti skip—jangan menurunkan standar hanya supaya ada transaksi.</div> : <div className="panic-grid">
      {rows.map((row, index) => <PanicCard key={row.ticker} row={row} rank={index + 1} expanded={expanded === row.ticker} onToggle={() => setExpanded(current => current === row.ticker ? '' : row.ticker)} />)}
    </div>}
    <div className="panic-proof">
      <div><b>Uji 2024–2025</b><span>298/1.021 terisi (29,2%) · WR 55,0% · avg +0,73% net</span></div>
      <div><b>Holdout 2026</b><span>184/507 terisi (36,3%) · WR 50,5% · avg +1,03% net</span></div>
      <div className="panic-warning"><ShieldAlert size={16} /><span>Backtest candle 60 menit, biaya 0,3%, order harus tersentuh sebelum 15:00. Hasil lampau bukan jaminan; data publik tertunda.</span></div>
    </div>
  </section>
}

function PanicCard({ row, rank, expanded, onToggle }: { row: PanicCandidate; rank: number; expanded: boolean; onToggle: () => void }) {
  return <article className="panic-card">
    <button onClick={onToggle} aria-expanded={expanded}>
      <div className="panic-rank">#{rank}</div><div className="panic-symbol"><strong>{row.ticker}</strong><span>{row.company}</span></div>
      <div className="panic-drop">{pct(row.signalChangePct)}</div><div className={`panic-status ${row.filled ? 'filled' : ''}`}>{row.status}</div><ChevronDown className={expanded ? 'rotated' : ''} size={18} />
    </button>
    <div className="panic-levels"><div><span>{row.entryFinal ? 'OPEN HARI INI' : 'CLOSE REFERENSI'}</span><b>{idr(row.entryFinal ? row.currentOpen : row.currentClose)}</b></div><div className="entry"><span>{row.entryFinal ? 'BUY LIMIT −5%' : 'ESTIMASI LIMIT'}</span><b>{idr(row.entry)}</b></div><div><span>{row.entryFinal ? 'LOW SAAT INI' : 'FINAL SAAT OPEN'}</span><b>{row.entryFinal ? idr(row.currentLow) : 'Belum ada'}</b></div></div>
    <div className={row.filled ? 'panic-action touched' : 'panic-action'}>{row.filled ? `Harga limit ${idr(row.entry)} sudah tersentuh. Hanya dianggap terisi bila order sudah dipasang; jika belum, SKIP dan jangan beli di harga sekarang.` : row.status === 'BOLEH PASANG LIMIT' ? `Boleh antre buy limit ${idr(row.entry)} sampai 10:30 WIB. Jangan mengubahnya menjadi market buy.` : row.status === 'TUNGGU OPEN' ? 'Belum boleh entry. Muat ulang setelah open untuk mendapatkan harga limit final.' : 'Jangan memasang order baru. Status hanya untuk memantau order yang sudah dibuat sebelumnya.'}</div>
    {expanded && <div className="panic-details">
      <div><span>Target referensi +4%</span><b>{idr(row.takeProfitReference)}</b><small>Boleh ambil untung; backtest utama tetap menjual di close.</small></div>
      <div><span>Stop darurat −7%</span><b>{idr(row.emergencyStop)}</b><small>Batas risiko tambahan; tidak termasuk dalam statistik backtest close-exit dan tidak menjamin harga eksekusi saat gap/ARB.</small></div>
      <div><span>Exit utama</span><b>15:45–15:50 WIB</b><small>{row.entryFinal ? 'Jika limit tidak pernah terisi, batalkan. Jangan market buy dan jangan mengejar.' : 'Angka entry masih estimasi. Sesudah pasar buka, muat ulang dan cek open aktual di aplikasi broker.'}</small></div>
      <div><span>Likuiditas 10 hari</span><b>{compactIdr(row.avgValue10)}</b><small>Proxy gratis; bukan order book dan bukan broker flow.</small></div>
    </div>}
  </article>
}
