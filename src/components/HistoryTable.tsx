import type { TradeRecord } from '../types'
import { number, pct } from '../lib/format'

export function HistoryTable({ trades }: { trades: TradeRecord[] }) {
  return <section className="panel history-panel">
    <div className="panel-heading"><div><h2>Riwayat trade</h2><span>Simulasi, setelah biaya transaksi</span></div><span>{trades.length} sampel</span></div>
    <div className="table-wrap"><table>
      <thead><tr><th>Tanggal</th><th>Ticker</th><th>Sinyal</th><th>Entry</th><th>Exit</th><th>Metode</th><th>Gross</th><th>Net</th><th>Hasil</th></tr></thead>
      <tbody>{trades.slice(0, 10).map((t, i) => <tr key={`${t.date}-${t.ticker}-${i}`}>
        <td>{t.date}</td><td><strong>{t.ticker}</strong><small>{t.company}</small></td><td>{t.signalTime}</td><td>{number(t.entry)}</td><td>{number(t.exit)}</td><td>{t.exitMethod}</td>
        <td className={t.grossReturn >= 0 ? 'positive' : 'negative'}>{pct(t.grossReturn, true)}</td>
        <td className={t.netReturn >= 0 ? 'positive' : 'negative'}>{pct(t.netReturn, true)}</td>
        <td><span className={`status ${t.netReturn > 0 ? 'active' : 'loss'}`}>{t.netReturn > 0 ? 'Menang' : 'Kalah'}</span></td>
      </tr>)}</tbody>
    </table></div>
  </section>
}
