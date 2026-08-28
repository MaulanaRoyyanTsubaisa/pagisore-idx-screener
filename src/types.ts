export type DataMode = 'demo' | 'proxy' | 'licensed' | 'import'
export type StrategyMode = 'original' | 'balanced' | 'strict'

export interface MarketRow {
  ticker: string
  company: string
  price: number
  open: number
  low: number
  high: number
  prevLow: number
  prevHigh: number
  close?: number
  futureHigh?: number
  futureLow?: number
  date?: string
  volume: number
  value: number
  allBidVolume?: number
  allOfferVolume?: number
  bidOfferRatio?: number
  emaFast?: number
  emaMid?: number
  emaSlow?: number
  rsi14?: number
  vwap?: number
  relativeVolume?: number
  buyerInitiatedVolume?: number
  sellerInitiatedVolume?: number
  spreadTicks?: number
  orderBookPersistence?: number
  signalTime: string
  source: DataMode
}

export interface ScreenerSettings {
  minValue: number
  minBidOfferRatio: number
  transactionCost: number
  targetPct: number
  stopPct: number
  requireExactOrderBook: boolean
  strategyMode: StrategyMode
  rsiMin: number
  rsiMax: number
  minRelativeVolume: number
  minCandleBodyRatio: number
  minCloseLocation: number
  minBuyFlow: number
  maxSpreadTicks: number
  minOrderBookPersistence: number
}

export interface Signal extends MarketRow {
  entryLow: number
  entryHigh: number
  target: number
  stop: number
  score: number
  exact: boolean
  reasons: string[]
  confirmations: number
  confirmationTotal: number
  setupLabel: 'Inti' | 'Terkonfirmasi' | 'Ketat'
}

export interface TradeRecord {
  date: string
  ticker: string
  company: string
  signalTime: string
  entry: number
  exit: number
  target: number
  stop: number
  exitMethod: 'Target' | 'Stop' | 'Close'
  grossReturn: number
  netReturn: number
  exact: boolean
  confirmations?: number
  confirmationTotal?: number
  metrics?: {
    value?: number
    rsi14?: number
    relativeVolume?: number
    vwap?: number
    flowProxy?: number
  }
}

export interface BacktestStats {
  trades: number
  wins: number
  losses: number
  winRate: number
  avgNetReturn: number
  totalReturn: number
  maxDrawdown: number
  profitFactor: number
  equity: number[]
}

export interface BrokerFlowRow {
  code: string
  name: string
  netValue: number
  buyValue: number
  sellValue: number
  buyAvg: number
  sellAvg: number
}

export interface BrokerSummary {
  ticker: string
  from: string
  to: string
  asOf: 'EOD'
  topBuyers: BrokerFlowRow[]
  topSellers: BrokerFlowRow[]
}

export interface PanicCandidate {
  ticker: string
  company: string
  currentClose: number
  currentOpen: number
  currentLow: number
  currentHigh: number
  currentChangePct: number
  currentValue: number
  priorClose: number
  priorChangePct: number
  signalChangePct: number
  avgValue10: number
  entry: number
  entryFinal: boolean
  takeProfitReference: number
  emergencyStop: number
  filled: boolean
  status: 'LIMIT TERSENTUH' | 'BOLEH PASANG LIMIT' | 'ENTRY BARU DITUTUP' | 'TUNGGU OPEN' | 'KEDALUWARSA'
}

export interface PanicPayload {
  asOf: string
  source: string
  universe: number
  actionable: boolean
  monitoring: boolean
  preOpen: boolean
  sessionDate: string
  nextTradingDate: string
  active: PanicCandidate[]
}
