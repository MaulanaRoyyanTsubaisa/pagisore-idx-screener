import { useEffect, useState } from 'react'
import { Activity, Gauge, History, Menu, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { PanicPanel } from './components/PanicPanel'
import { PanicHistory } from './components/PanicHistory'
import type { PanicHistoryDay, PanicPayload } from './types'

const nav = [[Gauge, 'Dashboard', 'dashboard'], [Activity, 'Sinyal hari ini', 'signals'], [History, 'Histori', 'history']] as const

function App() {
  const [panicPayload, setPanicPayload] = useState<PanicPayload | null>(null)
  const [historyDays, setHistoryDays] = useState<PanicHistoryDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(new Date())

  const refreshSignals = async () => {
    try {
      const response = await fetch('/api/panic', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Feed sinyal HTTP ${response.status}`)
      const payload = await response.json()
      setPanicPayload(payload)
      setUpdatedAt(new Date(payload.asOf))
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Feed sinyal gagal dimuat')
    }
  }

  const refreshHistory = async () => {
    try {
      const [seedResponse, liveResponse] = await Promise.all([fetch('/data/panic-history.json'), fetch('/api/panic-history', { cache: 'no-store' })])
      const seed = seedResponse.ok ? await seedResponse.json() : { days: [] }
      const live = liveResponse.ok ? await liveResponse.json() : { days: [] }
      const byDate = new Map<string, PanicHistoryDay>()
      for (const day of (seed.days ?? []) as PanicHistoryDay[]) byDate.set(day.date, day)
      for (const day of (live.days ?? []) as PanicHistoryDay[]) byDate.set(day.date, day)
      setHistoryDays([...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90))
    } catch {
      setHistoryDays([])
    }
  }

  const refreshAll = async () => {
    setLoading(true)
    await Promise.all([refreshSignals(), refreshHistory()])
    setLoading(false)
  }

  useEffect(() => {
    refreshAll()
    const signalTimer = window.setInterval(refreshSignals, 60_000)
    const historyTimer = window.setInterval(refreshHistory, 300_000)
    return () => { window.clearInterval(signalTimer); window.clearInterval(historyTimer) }
  }, [])

  const goTo = (target: string) => {
    setMobileNav(false)
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return <div className="app-shell clean-shell">
    <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><span>Pagi</span>Sore<button onClick={() => setMobileNav(false)} aria-label="Tutup navigasi"><X /></button></div>
      <nav>{nav.map(([Icon, label, target]) => <button key={target} className={target === 'dashboard' ? 'active' : ''} onClick={() => goTo(target)}><Icon size={17} />{label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="source-card"><Activity size={16} /><div><small>Sumber data</small><strong>IDX publik · delayed</strong></div><i /></div></div>
    </aside>

    <main>
      <header className="topbar">
        <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Buka navigasi"><Menu /></button>
        <div className="market-state"><span>Pasar</span><strong>{isMarketOpen() ? 'Buka' : 'Tutup'}</strong><i /><span>IDX · WIB</span></div>
        <div className="top-actions"><span>Diperbarui <b>{updatedAt.toLocaleTimeString('id-ID')}</b></span><button onClick={refreshAll} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />Perbarui</button></div>
      </header>

      <div className="content clean-content" id="dashboard">
        <div className="page-title"><div><h1>PagiSore · Panic Limit</h1><p>Hanya data dan sinyal strategi yang dipakai. Riset price-core yang gagal telah dihapus dari dashboard.</p></div></div>
        {error && <div className="notice error"><ShieldAlert size={17} /><span>{error}</span><button onClick={() => setError('')}><X size={15} /></button></div>}
        <div id="signals"><PanicPanel payload={panicPayload} loading={loading} /></div>
        <PanicHistory days={historyDays} loading={loading} />
        <section className="risk-panel clean-risk"><ShieldAlert size={23} /><div><strong>Batas penggunaan</strong><p>Data publik dapat terlambat. Cocokkan open, antrean, dan status order di aplikasi broker. Backtest dan histori tidak menjamin hasil berikutnya; jangan market buy atau mengejar harga.</p></div></section>
      </div>
      <footer><span><i />Sistem normal</span><b>Panic Limit · data dan histori asli</b><span>Waktu server {new Date().toLocaleTimeString('id-ID')}</span></footer>
    </main>
  </div>
}

function isMarketOpen() {
  const now = new Date()
  const jakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
  const minutes = jakarta.getHours() * 60 + jakarta.getMinutes()
  return jakarta.getDay() >= 1 && jakarta.getDay() <= 5 && minutes >= 540 && minutes <= 960
}

export default App
