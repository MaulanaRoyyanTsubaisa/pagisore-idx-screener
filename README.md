# PagiSore

Dashboard riset screening saham IDX untuk menguji rumus intraday:

```text
open == low
AND all_bid_volume > all_offer_volume
AND current_high > previous_high
AND current_low > previous_low
AND current_value > 100000000
```

## Yang sudah bekerja

- Scanner, filter, level entry/target/stop, detail alasan sinyal, dan histori.
- Mode demo deterministik untuk mengecek seluruh alur UI.
- Mode proxy semua saham IDX via TradingView scanner (data dapat tertunda). Karena tidak memiliki aggregate order book, hasilnya selalu disebut **pra-sinyal**, bukan sinyal rumus asli.
- Adaptor `licensed` untuk feed IDX/redistributor yang menyediakan aggregate order book.
- Impor CSV untuk data snapshot sinyal + order book + pergerakan setelah sinyal; template tersedia di `/sample-backtest.csv`. Impor langsung menghasilkan riwayat backtest baru.
- Statistik setelah biaya: win rate, average net return, compounded return, max drawdown, dan profit factor.
- Tuning sederhana memakai split 70/30 agar parameter tidak dipilih dari seluruh sampel yang sama.

## Menjalankan lokal

```bash
npm install
npm run dev
```

## Kontrak feed berlisensi

Set `MARKET_DATA_URL` dan, bila perlu, `MARKET_DATA_TOKEN` di environment Netlify. Endpoint harus mengembalikan JSON array dengan field berikut:

```json
[{ "ticker":"BBRI", "company":"Bank Rakyat Indonesia", "price":4820, "open":4780, "low":4780, "high":4860, "prevLow":4700, "prevHigh":4800, "volume":106313, "value":512430000, "allBidVolume":1680000, "allOfferVolume":1000000, "signalTime":"09:15:12", "source":"licensed" }]
```

## Batasan penting

Rumus ini bukan jaminan profit. Backtest yang sah membutuhkan snapshot/order-book log historis pada waktu sinyal. Kolom `futureHigh` dan `futureLow` harus hanya mencakup periode **setelah** `signalTime`; `close` adalah harga penutupan hari itu. Jika target dan stop sama-sama tersentuh tanpa tick sequence, engine memakai stop lebih dulu (konservatif). Tetap perhitungkan slippage, antrean, corporate actions, survivorship bias, dan out-of-sample testing. Mode proxy tidak menggantikan aggregate order book.
