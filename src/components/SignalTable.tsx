import { AlertTriangle, ChevronRight } from 'lucide-react'
import type { Signal } from '../types'
import { idr, number } from '../lib/format'

export function SignalTable({ signals, loading, onSelect }: { signals: Signal[]; loading: boolean; onSelect: (s: Signal) => void }) {
  return <section className="panel signal-panel">
    <div className="panel-heading"><div><h2>Sinyal live</h2><span>Memenuhi seluruh filter aktif</span></div><span>{signals.length} sinyal</span></div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Ticker</th><th>Harga</th><th>Waktu</th><th>Bid/Offer</th><th>RSI</th><th>RVOL</th><th>Range entry</th><th>Target</th><th>Stop</th><th>Skor</th><th>Status</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={12}><div className="loading-row">Mengambil snapshot pasar…</div></td></tr>}
          {!loading && signals.map((s, i) => <tr key={s.ticker} onClick={() => onSelect(s)} className="clickable-row">
            <td>{i + 1}</td><td><strong>{s.ticker}</strong><small>{s.company}</small></td><td>{number(s.price)}</td><td>{s.signalTime}</td>
            <td>{s.bidOfferRatio?.toFixed(2) ?? '—'} {!s.exact && <span className="proxy-mark" title="Bid/offer proxy">P</span>}</td>
            <td>{s.rsi14?.toFixed(0) ?? '—'}</td><td>{s.relativeVolume ? `${s.relativeVolume.toFixed(1)}×` : '—'}</td><td>{number(s.entryLow)}–{number(s.entryHigh)}</td><td>{idr(s.target)}</td><td>{idr(s.stop)}</td>
            <td><span className="score"><i style={{ width: `${s.score}%` }} />{s.score}</span></td>
            <td><span className={s.exact ? 'status active' : 'status proxy'}>{s.exact ? 'Valid' : 'Pra-sinyal'}</span><ChevronRight size={14} /></td>
          </tr>)}
          {!loading && !signals.length && <tr><td colSpan={12}><div className="empty-state"><AlertTriangle size={22} /><strong>Belum ada saham yang lolos</strong><span>Coba mode “Rumus inti” atau gunakan data demo untuk melihat alurnya.</span></div></td></tr>}
        </tbody>
      </table>
    </div>
    <div className="table-foot"><span>Klik baris untuk melihat alasan dan level harga.</span><span><b>P</b> = proxy, bukan order book agregat</span></div>
  </section>
}
