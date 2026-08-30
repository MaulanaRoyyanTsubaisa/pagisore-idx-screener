import type { PanicHistoryDay } from '../types'

export function simulateFixedSlots(days: PanicHistoryDay[], maxPositions: number) {
  const slots = Math.max(1, Math.floor(maxPositions))
  const returns = [...days].sort((a, b) => a.date.localeCompare(b.date)).map(day => {
    const filled = day.candidates.filter(row => row.filled && Number.isFinite(row.netPct) && row.rank <= slots)
    return filled.reduce((sum, row) => sum + Number(row.netPct), 0) / slots
  })
  let equity = 1
  let peak = 1
  let maxDrawdownPct = 0
  for (const dailyReturn of returns) {
    equity *= 1 + dailyReturn / 100
    peak = Math.max(peak, equity)
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100)
  }
  const active = returns.filter(value => value !== 0)
  const wins = active.filter(value => value > 0)
  return {
    returnPct: (equity - 1) * 100,
    maxDrawdownPct,
    activeDays: active.length,
    winningDayRate: active.length ? wins.length / active.length * 100 : 0,
    slots,
  }
}
