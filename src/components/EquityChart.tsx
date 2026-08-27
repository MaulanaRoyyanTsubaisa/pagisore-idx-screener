import type { BacktestStats } from '../types'
import { pct } from '../lib/format'

export function EquityChart({ stats, label = 'Data historis' }: { stats: BacktestStats; label?: string }) {
  const values = stats.equity
  const min = Math.min(...values, 98)
  const max = Math.max(...values, 102)
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${100 - ((v - min) / Math.max(1, max - min)) * 86 - 7}`).join(' ')
  return <section className="panel chart-panel">
    <div className="panel-heading"><h2>Kinerja strategi</h2><span>{label}</span></div>
    <div className="chart-legend"><span><i className="dot green" />Ekuitas setelah biaya</span><span><i className="dot gray" />Baseline 100</span></div>
    <svg className="equity-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Kurva ekuitas backtest">
      {[20, 40, 60, 80].map(y => <line key={y} x1="0" y1={y} x2="100" y2={y} className="gridline" />)}
      <line x1="0" y1="50" x2="100" y2="50" className="baseline" />
      <polyline points={points} className="equity-line" />
    </svg>
    <div className="mini-stats">
      <div><span>Compounded 1×/setup</span><strong className={stats.totalReturn >= 0 ? 'positive' : 'negative'}>{pct(stats.totalReturn, true)}</strong></div>
      <div><span>Max drawdown</span><strong className="negative">{pct(stats.maxDrawdown)}</strong></div>
      <div><span>Profit factor</span><strong>{stats.profitFactor.toFixed(2)}</strong></div>
      <div><span>Win rate</span><strong>{pct(stats.winRate)}</strong></div>
    </div>
  </section>
}
