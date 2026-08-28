import { AlertTriangle, ChevronRight } from 'lucide-react'
import type { Signal } from '../types'
import { idr, number } from '../lib/format'

export function SignalTable({ signals, totalCandidates, loading, onSelect }: { signals: Signal[]; totalCandidates: number; loading: boolean; onSelect: (s: Signal) => void }) {
  return <section className="panel signal-panel">
    <div className="panel-heading"><div><h2>Top 5 prioritas live</h2><span>Ranking kualitas dari kandidat yang lolos rumus inti</span></div><span>{signals.length} dari {totalCandidates}</span></div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Ticker</th><th>Harga sinyal</th><th>Waktu</th><th>Bid/Offer</th><th>RSI</th><th>RVOL</th><th>Beli di</th><th>TP / jual untung</th><th>SL / jual rugi</th><th>Skor</th><th>Status</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={12}><div className="loading-row">Mengambil snapshot pasar…</div></td></tr>}
          {!loading && signals.map((s, i) => <tr key={s.ticker} onClick={() => onSelect(s)} className="clickable-row">
            <td>{i + 1}</td><td><strong>{s.ticker}</strong><small>{s.company}</small></td><td>{number(s.price)}</td><td>{s.signalTime}</td>
            <td>{s.bidOfferRatio?.toFixed(2) ?? '—'} {!s.exact && <span className="proxy-mark" title="Price-core; order book belum tersedia">PC</span>}</td>
            <td>{s.rsi14?.toFixed(0) ?? '—'}</td><td>{s.relativeVolume ? `${s.relativeVolume.toFixed(1)}×` : '—'}</td><td><strong className="entry-price">{idr(s.entryLow)}</strong><small>buy limit · jangan kejar</small></td><td><strong className="positive">{idr(s.target)}</strong><small>take profit</small></td><td><strong className="negative">{idr(s.stop)}</strong><small>stop loss</small></td>
            <td><span className="score"><i style={{ width: `${s.score}%` }} />{s.score}</span></td>
            <td><span className={s.exact ? 'status active' : 'status proxy'}>{s.exact ? 'Cek entry' : 'Pantau / skip'}</span><ChevronRight size={14} /></td>
          </tr>)}
          {!loading && !signals.length && <tr><td colSpan={12}><div className="empty-state"><AlertTriangle size={22} /><strong>Belum ada saham yang lolos</strong><span>Coba mode “Rumus inti” atau gunakan data demo untuk melihat alurnya.</span></div></td></tr>}
        </tbody>
      </table>
    </div>
    <div className="table-foot"><span>Klik baris untuk detail. Hanya status exact dalam jam entry yang boleh menjadi rencana order.</span><span><b>PC</b> = watchlist; bukan sinyal beli</span></div>
  </section>
}
