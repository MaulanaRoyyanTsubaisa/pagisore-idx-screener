import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, BarChart3, BookOpenCheck, Database, FileUp, Filter, FlaskConical, Gauge, History, Info, Menu, RefreshCw, Search, Settings2, ShieldAlert, SlidersHorizontal, Target, TrendingUp, X } from 'lucide-react'
import { demoMarket, demoTrades } from './data/demo'
import { backtestRows, calculateStats, parseCsv, screenRows } from './lib/strategy'
import { compactIdr, idr, pct } from './lib/format'
import type { BrokerSummary, DataMode, MarketRow, PanicPayload, ScreenerSettings, Signal, TradeRecord } from './types'
import { SignalTable } from './components/SignalTable'
import { HistoryTable } from './components/HistoryTable'
import { EquityChart } from './components/EquityChart'
import { PanicPanel } from './components/PanicPanel'

const defaultSettings: ScreenerSettings = {
  minValue: 100_000_000,
  minBidOfferRatio: 1.3,
  transactionCost: .3,
  targetPct: 1,
  stopPct: .9,
  requireExactOrderBook: false,
  strategyMode: 'original', rsiMin: 55, rsiMax: 72, minRelativeVolume: 1.5,
  minCandleBodyRatio: .45, minCloseLocation: .65, minBuyFlow: .55,
  maxSpreadTicks: 2, minOrderBookPersistence: 3,
}

const nav = [
  [Gauge, 'Dashboard'], [Activity, 'Sinyal live'], [Filter, 'Penyaring'],
  [History, 'Riwayat'], [BarChart3, 'Statistik'], [FlaskConical, 'Backtest'],
] as const

const navTarget: Record<string, string> = {
  Dashboard: 'dashboard', 'Sinyal live': 'live-signals', Penyaring: 'filters',
  Riwayat: 'history', Statistik: 'statistics', Backtest: 'backtest',
}

function App() {
  const [settings, setSettings] = useState(defaultSettings)
  const [market, setMarket] = useState<MarketRow[]>([])
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [mode, setMode] = useState<DataMode>('proxy')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(new Date())
  const [selected, setSelected] = useState<Signal | null>(null)
  const [activeNav, setActiveNav] = useState('Dashboard')
  const [mobileNav, setMobileNav] = useState(false)
  const [showFormula, setShowFormula] = useState(false)
  const [showRejectedResearch, setShowRejectedResearch] = useState(false)
  const [historyLabel, setHistoryLabel] = useState('Memuat backtest intraday nyata…')
  const [historyIsReal, setHistoryIsReal] = useState(false)
  const [feedReady, setFeedReady] = useState(false)
  const [brokerSummary, setBrokerSummary] = useState<BrokerSummary | null>(null)
  const [brokerStatus, setBrokerStatus] = useState('')
  const [panicPayload, setPanicPayload] = useState<PanicPayload | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const allSignals = useMemo(() => screenRows(market, settings), [market, settings])
  const signals = useMemo(() => allSignals.slice().sort((a, b) => b.score - a.score).slice(0, 5), [allSignals])
  const stats = useMemo(() => calculateStats(trades), [trades])
  const exactCount = signals.filter(s => s.exact).length

  const refreshPanic = () => fetch('/api/panic')
    .then(response => response.ok ? response.json() : Promise.reject(new Error('Panic feed belum tersedia')))
    .then(setPanicPayload).catch(() => setPanicPayload(null))

  const refresh = async (requestedMode: DataMode = mode) => {
    refreshPanic()
    if (requestedMode === 'demo' || requestedMode === 'import') {
      setUpdatedAt(new Date()); return
    }
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/market?mode=${requestedMode}`)
      if (!response.ok) throw new Error((await response.json()).error || 'Feed pasar tidak tersedia')
      const payload = await response.json()
      setMarket(payload.data)
      setMode(payload.mode)
      setFeedReady(payload.mode === 'licensed')
      setUpdatedAt(new Date(payload.asOf))
    } catch (err) {
      if (requestedMode === 'licensed') setMarket([])
      setFeedReady(false)
      setError(err instanceof Error ? err.message : 'Gagal mengambil data')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    refresh('proxy')
    fetch('/data/real-backtest.json')
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Backtest belum tersedia')))
      .then(payload => {
        setTrades(payload.trades ?? [])
        setHistoryIsReal(true)
        const meta = payload.meta
        setHistoryLabel(`${meta.source} · ${meta.interval} · ${meta.successful}/${meta.universe} ticker · ${meta.from ?? '—'}–${meta.to ?? '—'}`)
      })
      .catch(() => { setTrades(demoTrades); setHistoryIsReal(false); setHistoryLabel('Fallback demo — data nyata sedang dibuat') })
  }, [])

  useEffect(() => {
    if (mode === 'demo' || mode === 'import') return
    const timer = window.setInterval(() => refresh(mode), mode === 'licensed' ? 300_000 : 60_000)
    return () => window.clearInterval(timer)
  }, [mode])

  useEffect(() => {
    if (!selected || mode !== 'licensed' || !feedReady) { setBrokerSummary(null); setBrokerStatus(''); return }
    const controller = new AbortController()
    setBrokerSummary(null); setBrokerStatus('Memuat broker EOD…')
    fetch(`/api/broker?ticker=${encodeURIComponent(selected.ticker)}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : response.json().then(body => Promise.reject(new Error(body.error || 'Broker summary gagal'))))
      .then(payload => { setBrokerSummary(payload); setBrokerStatus('') })
      .catch(error => { if (error.name !== 'AbortError') setBrokerStatus(error instanceof Error ? error.message : 'Broker summary gagal') })
    return () => controller.abort()
  }, [selected, mode, feedReady])

  const setSource = (next: DataMode) => {
    setMode(next)
    if (next === 'demo') { setMarket(demoMarket); setTrades(demoTrades); setFeedReady(false); setError(''); setUpdatedAt(new Date()) }
    else refresh(next)
  }

  const goTo = (label: string) => {
    setActiveNav(label); setMobileNav(false)
    setShowRejectedResearch(label !== 'Dashboard')
    window.requestAnimationFrame(() => document.getElementById(navTarget[label])?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const applyFilters = () => {
    setError(`Filter diterapkan: menampilkan ${signals.length} prioritas tertinggi dari ${allSignals.length} kandidat (${market.length} saham dipindai).`)
    goTo('Sinyal live')
  }

  const importCsv = async (file?: File) => {
    if (!file) return
    try {
      const parsed = parseCsv(await file.text())
      const importedTrades = backtestRows(parsed, settings)
      setMarket(parsed); setTrades(importedTrades); setMode('import'); setUpdatedAt(new Date())
      setError(importedTrades.length ? `Backtest selesai: ${importedTrades.length} trade valid dari ${parsed.length} snapshot.` : 'Tidak ada trade backtest. Pastikan baris lolos rumus dan kolom futureHigh/futureLow/close terisi.')
    } catch (err) { setError(err instanceof Error ? err.message : 'CSV tidak valid') }
  }

  const tune = () => {
    const dates = [...new Set(trades.map(trade => trade.date))].sort()
    const cutoff = dates[Math.floor(dates.length * .7)]
    const candidates = [0, 1, 2, 3, 4, 5, 6].map(minConfirmations => {
      const eligible = trades.filter(trade => (trade.confirmations ?? 0) >= minConfirmations)
      const train = eligible.filter(trade => trade.date < cutoff)
      const test = eligible.filter(trade => trade.date >= cutoff)
      return { minConfirmations, train: calculateStats(train), test: calculateStats(test) }
    }).filter(candidate => candidate.train.trades >= 100 && candidate.test.trades >= 30)
      .sort((a, b) => b.train.avgNetReturn - a.train.avgNetReturn)
    const best = candidates[0]
    if (!best) { setError('Data belum cukup untuk tuning train/test.'); return }
    setSettings(current => ({ ...current, strategyMode: best.minConfirmations >= 3 ? 'balanced' : 'original' }))
    const verdict = best.test.avgNetReturn > 0 ? 'lolos uji' : 'belum menghasilkan edge positif'
    setError(`Tuning walk-forward 70/30: minimum ${best.minConfirmations} konfirmasi; test n=${best.test.trades}, WR ${best.test.winRate.toFixed(1)}%, avg ${best.test.avgNetReturn.toFixed(2)}% — ${verdict}.`)
  }

  const execution = selected ? executionState(selected) : null

  return <div className="app-shell">
    <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><span>Pagi</span>Sore<button onClick={() => setMobileNav(false)} aria-label="Tutup navigasi"><X /></button></div>
      <nav>{nav.map(([Icon, label]) => <button key={label} className={activeNav === label ? 'active' : ''} onClick={() => goTo(label)}><Icon size={17} />{label}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="source-card"><Database size={16} /><div><small>Sumber data</small><strong>{mode === 'demo' ? 'Demo deterministik' : mode === 'proxy' ? 'Proxy tertunda' : mode === 'licensed' ? 'Feed berlisensi' : 'CSV lokal'}</strong></div><i className={mode === 'licensed' ? 'online' : ''} /></div>
        <button className="nav-secondary" onClick={() => goTo('Penyaring')}><Settings2 size={17} />Pengaturan</button>
      </div>
    </aside>

    <main>
      <header className="topbar">
        <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Buka navigasi"><Menu /></button>
        <div className="market-state"><span>Pasar</span><strong>{isMarketOpen() ? 'Buka' : 'Tutup'}</strong><i /> <span>IDX · WIB</span></div>
        <div className="top-actions"><span>Terakhir diperbarui <b>{updatedAt.toLocaleTimeString('id-ID')}</b></span><button onClick={() => refresh()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />Perbarui</button></div>
      </header>

      <div className="content" id="dashboard">
        <div className="page-title"><div><h1>Dashboard screening</h1><p>Panic Limit adalah satu-satunya sinyal utama yang ditampilkan pada dashboard.</p></div></div>

        {error && <div className={/^(Tuning|Backtest selesai|Filter diterapkan)/.test(error) ? 'notice info' : 'notice error'}><Info size={17} /><span>{error}</span><button onClick={() => setError('')}><X size={15} /></button></div>}

        <PanicPanel payload={panicPayload} loading={loading} />

        <div className="research-verdict"><ShieldAlert size={20} /><div><strong>RISET PRICE-CORE DITOLAK · DISEMBUNYIKAN</strong><span>WR {stats.winRate.toFixed(2)}% dan rata-rata {stats.avgNetReturn.toFixed(2)}% net adalah hasil strategi lain yang gagal—bukan performa Panic Limit.</span></div><button onClick={() => setShowRejectedResearch(value => !value)}>{showRejectedResearch ? 'Tutup riset gagal' : 'Buka riset yang ditolak'}</button></div>

        {showRejectedResearch && <>
        <div className="source-switch rejected-source-switch" aria-label="Sumber data riset yang ditolak">
          <button className={mode === 'proxy' ? 'active' : ''} onClick={() => setSource('proxy')}>Riset price-core</button>
          <button className={mode === 'licensed' ? 'active' : ''} onClick={() => setSource('licensed')}>Rumus exact</button>
        </div>
        <div className={feedReady ? 'live-source exact-source' : 'live-source'}>
          <span className="live-dot" />
          <div><strong>{mode === 'licensed' ? (feedReady ? 'Rumus lengkap + order book' : 'Feed exact belum aktif') : 'RISET GAGAL · price-core seluruh IDX'}</strong><small>{mode === 'licensed' ? (feedReady ? 'Invezgo real-time, cache 5 menit' : 'Kandidat dikosongkan agar data proxy tidak dianggap sinyal exact') : `Jangan entry · WR ${stats.winRate.toFixed(2)}% · avg ${stats.avgNetReturn.toFixed(2)}% net · order book tidak tersedia`}</small></div>
          <button onClick={() => refresh()} disabled={loading}>{loading ? 'Memindai…' : 'Scan sekarang'}</button>
        </div>

        <section className="kpis">
          <div className="kpi"><div><span>Watchlist price-core</span><Activity size={16} /></div><strong>{signals.length}</strong><small>SKIP · bukan sinyal entry · {exactCount} exact</small></div>
          <div className="kpi"><div><span>WR price-core</span><Target size={16} /></div><strong>{pct(stats.winRate)}</strong><small>{historyIsReal ? 'Belum memakai order book' : 'Fallback demo'} · n={stats.trades}</small></div>
          <div className="kpi"><div><span>Net price-core</span><TrendingUp size={16} /></div><strong className={stats.avgNetReturn >= 0 ? 'positive' : 'negative'}>{pct(stats.avgNetReturn, true)}</strong><small>Setelah biaya {pct(settings.transactionCost)} · belum lolos</small></div>
          <div className="kpi"><div><span>Nilai minimum</span><Database size={16} /></div><strong>{compactIdr(settings.minValue)}</strong><small>Dapat diubah pada filter</small></div>
        </section>

        <section className="filterbar" id="filters">
          <label>Mode konfirmasi<select value={settings.strategyMode} onChange={e => setSettings(s => ({ ...s, strategyMode: e.target.value as ScreenerSettings['strategyMode'] }))}><option value="original">Rumus inti</option><option value="balanced">Seimbang</option><option value="strict">Ketat</option></select></label>
          <label>Minimum nilai transaksi<select value={settings.minValue} onChange={e => setSettings(s => ({ ...s, minValue: Number(e.target.value) }))}><option value="100000000">Rp100 juta</option><option value="500000000">Rp500 juta</option><option value="1000000000">Rp1 miliar</option></select></label>
          <label>Rasio bid/offer min<input type="number" min="1" step=".05" value={settings.minBidOfferRatio} disabled={mode !== 'licensed'} title={mode !== 'licensed' ? 'Aktif setelah feed order book exact terhubung' : ''} onChange={e => setSettings(s => ({ ...s, minBidOfferRatio: Number(e.target.value) }))} /></label>
          <label>Biaya round trip<input type="number" min="0" step=".05" value={settings.transactionCost} onChange={e => setSettings(s => ({ ...s, transactionCost: Number(e.target.value) }))} /></label>
          <label>TP minimum / SL<div className="dual-input"><input aria-label="Target profit minimum dalam persen" type="number" min=".1" step=".1" value={settings.targetPct} onChange={e => setSettings(s => ({ ...s, targetPct: Number(e.target.value) }))} /><span>/</span><input aria-label="Stop loss dalam persen" type="number" min=".1" step=".1" value={settings.stopPct} onChange={e => setSettings(s => ({ ...s, stopPct: Number(e.target.value) }))} /></div></label>
          <label className="checkbox"><input type="checkbox" checked={settings.requireExactOrderBook} disabled={mode !== 'licensed'} onChange={e => setSettings(s => ({ ...s, requireExactOrderBook: e.target.checked }))} /><span>Wajib order book exact</span></label>
          <button className="primary" onClick={applyFilters}><SlidersHorizontal size={16} />Terapkan & lihat hasil</button>
        </section>

        <div className="dashboard-grid">
          <div className="primary-column">
            <div id="live-signals"><SignalTable signals={signals} totalCandidates={allSignals.length} loading={loading} onSelect={setSelected} /></div>
            <div id="history"><div className="history-source">{historyLabel}</div><HistoryTable trades={trades} /></div>
          </div>
          <aside className="right-column">
            <div id="statistics"><EquityChart stats={stats} label={historyIsReal ? '60 hari · 843 saham' : 'Fallback demo'} /></div>
            <section className="panel formula-panel">
              <div className="panel-heading"><h2>Rumus & asumsi</h2><button onClick={() => setShowFormula(!showFormula)}>{showFormula ? 'Ringkas' : 'Detail'}</button></div>
              <code>open == low<br />AND all_bid_volume &gt; all_offer_volume<br />AND high &gt; prev_high<br />AND low &gt; prev_low<br />AND value &gt; 100000000</code>
              <div className="confirm-stack"><span>Konfirmasi seimbang</span><b>EMA 10 &gt; 20 &gt; 50</b><b>Harga &gt; VWAP</b><b>RSI 55–72</b><b>RVOL ≥ 1,5×</b><b>Flow + candle + spread</b></div>
              {showFormula && <ul><li>Mode seimbang membutuhkan mayoritas konfirmasi; mode ketat membutuhkan semuanya.</li><li>Order book memakai imbalance, spread, buyer flow, dan persistensi—bukan satu snapshot saja.</li><li>Target minimum {settings.targetPct.toFixed(1)}% gross ≈ {Math.max(0, settings.targetPct - settings.transactionCost).toFixed(1)}% setelah biaya {settings.transactionCost.toFixed(1)}%, sebelum slippage.</li><li>Emas hanya relevan sebagai filter sektoral untuk emiten yang eksposurnya memang terbukti.</li></ul>}
            </section>
            <section className="panel lab-panel" id="backtest">
              <div className="panel-heading"><h2>Backtest lab</h2><FlaskConical size={17} /></div>
              <p>Backtest nyata dimuat otomatis dari bar 5-menit. Impor data order book bila ingin menguji rumus lengkap.</p>
              <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={e => importCsv(e.target.files?.[0])} />
              <button onClick={() => fileRef.current?.click()}><FileUp size={16} />Impor CSV</button>
              <button onClick={tune}><Search size={16} />Tuning train/test</button>
              <a href="/sample-backtest.csv" download>Unduh template CSV</a>
            </section>
            <section className="risk-panel"><ShieldAlert size={23} /><div><strong>Baca sebelum menggunakan</strong><p>Ini alat riset, bukan saran keuangan. Tidak ada strategi yang pasti profit. Slippage, antrean, likuiditas, dan perubahan order book dapat membuat hasil aktual berbeda.</p></div></section>
          </aside>
        </div>
        </>}
      </div>
      <footer><span><i />Sistem normal</span><b>{showRejectedResearch ? (mode === 'demo' ? 'Data demo — bukan data real' : mode === 'proxy' ? 'Riset price-core terbuka' : mode === 'licensed' ? (feedReady ? 'Feed berlisensi aktif' : 'Feed berlisensi belum tersambung') : 'Data impor lokal') : 'Panic Limit · sinyal utama'}</b><span>Waktu server {new Date().toLocaleTimeString('id-ID')}</span></footer>
    </main>

    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="detail-drawer" onClick={e => e.stopPropagation()}>
      <button className="drawer-close" aria-label="Tutup detail sinyal" onClick={() => setSelected(null)}><X /></button><div className="ticker-mark">{selected.ticker.slice(0, 2)}</div>
      <small>Detail sinyal</small><h2>{selected.ticker}</h2><p>{selected.company}</p>
      <div className="price-hero"><span>Harga saat sinyal muncul</span><strong>{idr(selected.price)}</strong><em>Skor {selected.score}/100 · muncul {selected.signalTime}</em></div>
      <section className="trade-plan" aria-label={`Rencana transaksi ${selected.ticker}`}>
        <div className="trade-plan-title"><div><small>STATUS EKSEKUSI</small><strong>{execution?.title}</strong></div><span className={execution?.allowed ? '' : 'blocked'}>{execution?.label}</span></div>
        <div className={execution?.allowed ? 'execution-note allowed' : 'execution-note'}>{execution?.detail}</div>
        <div className="trade-step buy"><i>1</i><div><span>BELI / ENTRY</span><strong>{idr(selected.entryLow)}</strong><small>Pasang buy limit di harga ini hanya bila status exact masih aktif. Jika harga sudah naik, atau limit tidak terisi sebelum 10:30 WIB, cancel dan skip—jangan mengejar.</small></div></div>
        <div className="trade-step take-profit"><i>2</i><div><span>JUAL UNTUNG / TAKE PROFIT</span><strong>{idr(selected.target)}</strong><small>Target minimal +{settings.targetPct.toFixed(1)}% gross, kira-kira +{Math.max(0, settings.targetPct - settings.transactionCost).toFixed(1)}% setelah biaya {settings.transactionCost.toFixed(1)}% sebelum slippage.</small></div></div>
        <div className="trade-step stop-loss"><i>3</i><div><span>JUAL RUGI / STOP LOSS</span><strong>{idr(selected.stop)}</strong><small>Keluar bila harga menyentuh level ini. Estimasi hasil −{(settings.stopPct + settings.transactionCost).toFixed(1)}% setelah biaya, sebelum slippage.</small></div></div>
        <div className="close-rule"><b>Jika TP/SL belum tersentuh:</b> jual menjelang penutupan sesi II. Jika harga melewati TP, keuntungan tambahan tidak dijamin; gunakan trailing stop hanya bila siap memantaunya.</div>
      </section>
      <div className="level-grid compact-levels"><div><span>Bid/offer</span><b>{selected.bidOfferRatio?.toFixed(2) ?? 'Belum tersedia'}</b></div><div><span>Status data</span><b>{selected.exact ? 'Order book exact' : 'Price-core'}</b></div></div>
      <div className="indicator-grid"><div><span>RSI 14</span><b>{selected.rsi14?.toFixed(1) ?? '—'}</b></div><div><span>RVOL</span><b>{selected.relativeVolume ? `${selected.relativeVolume.toFixed(2)}×` : '—'}</b></div><div><span>VWAP</span><b>{selected.vwap ? idr(selected.vwap) : '—'}</b></div><div><span>Konfirmasi</span><b>{selected.confirmations}/{selected.confirmationTotal}</b></div></div>
      <h3>Broker summary (EOD)</h3>
      {!feedReady && <div className="broker-empty">Tersedia setelah feed Invezgo berlisensi aktif. Data broker bersifat EOD, bukan order flow real-time.</div>}
      {brokerStatus && <div className="broker-empty">{brokerStatus}</div>}
      {brokerSummary && <div className="broker-grid">
        <div><span>Top net buy</span>{brokerSummary.topBuyers.map(row => <b key={`buy-${row.code}`}>{row.code}<em>{compactIdr(row.netValue)}</em></b>)}</div>
        <div><span>Top net sell</span>{brokerSummary.topSellers.map(row => <b key={`sell-${row.code}`}>{row.code}<em>{compactIdr(row.netValue)}</em></b>)}</div>
      </div>}
      <h3>Kenapa muncul?</h3>{selected.reasons.map(r => <div className="reason" key={r}><BookOpenCheck size={16} />{r}</div>)}
      {!selected.exact && <div className="drawer-warning"><AlertTriangle size={17} />Price-core ini belum memiliki order book agregat. Gunakan sebagai daftar cek, bukan sinyal rumus exact.</div>}
    </aside></div>}
  </div>
}

function isMarketOpen() {
  const now = new Date()
  const jakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
  const minutes = jakarta.getHours() * 60 + jakarta.getMinutes()
  return jakarta.getDay() >= 1 && jakarta.getDay() <= 5 && minutes >= 540 && minutes <= 960
}

function executionState(signal: Signal) {
  if (!signal.exact) return { allowed: false, label: 'SKIP', title: 'Watchlist saja', detail: 'Order book exact belum tersedia. Jangan eksekusi hanya dari price-core, EMA, RSI, atau volume proxy.' }
  const now = new Date()
  const jakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
  const minutes = jakarta.getHours() * 60 + jakarta.getMinutes()
  const weekday = jakarta.getDay() >= 1 && jakarta.getDay() <= 5
  if (!weekday || minutes < 540 || minutes >= 630) return { allowed: false, label: 'SKIP', title: 'Di luar jam entry', detail: 'Rencana order hanya berlaku pukul 09:00–10:30 WIB. Setelah itu sinyal kedaluwarsa; jangan mengejar harga.' }
  return { allowed: true, label: 'EXACT', title: 'Boleh pasang limit order', detail: 'Rumus exact dan jendela waktu terpenuhi. Tetap batasi ukuran posisi karena backtest price-core belum menunjukkan edge positif.' }
}

export default App
