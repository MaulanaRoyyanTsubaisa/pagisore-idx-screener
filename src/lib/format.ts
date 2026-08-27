export const idr = (value: number) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(value)

export const compactIdr = (value: number) => {
  if (value >= 1e12) return `Rp ${(value / 1e12).toFixed(2)} T`
  if (value >= 1e9) return `Rp ${(value / 1e9).toFixed(2)} M`
  if (value >= 1e6) return `Rp ${(value / 1e6).toFixed(1)} Jt`
  return idr(value)
}

export const pct = (value: number, signed = false) =>
  `${signed && value > 0 ? '+' : ''}${value.toFixed(2).replace('.', ',')}%`

export const number = (value: number) => new Intl.NumberFormat('id-ID').format(value)

export const tickSize = (price: number) => {
  if (price < 200) return 1
  if (price < 500) return 2
  if (price < 2000) return 5
  if (price < 5000) return 10
  return 25
}

export const roundToTick = (price: number) => {
  const tick = tickSize(price)
  return Math.round(price / tick) * tick
}
