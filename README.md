# PagiSore

Dashboard riset screening saham IDX untuk menguji rumus intraday:

```text
open == low
AND all_bid_volume > all_offer_volume
AND current_high > previous_high
AND current_low > previous_low
AND current_value > 100000000
```

Secara default dashboard langsung memindai seluruh IDX memakai mode **Rumus inti**. Feed publik menghasilkan **price-core** (seluruh syarat harga/nilai transaksi); feed Invezgo menghasilkan rumus **exact**, termasuk total bid/offer. Mode **Seimbang** menambahkan EMA, VWAP, RSI, relative volume, candle, flow, spread, dan persistensi order book. Mode **Ketat** mewajibkan semua konfirmasi yang tersedia.

## Yang sudah bekerja

- Scanner seluruh IDX dengan shortlist lima prioritas, harga buy-limit, TP, SL, alasan sinyal, dan histori.
- Pemindaian otomatis 843 saham IDX via TradingView scanner (data publik dapat tertunda). Karena tidak memiliki aggregate order book, hasilnya disebut **price-core**, bukan sinyal exact.
- Integrasi resmi endpoint screener Invezgo untuk menjalankan formula lengkap real-time bila `INVEZGO_API_KEY` tersedia.
- Backtest otomatis 5-menit Yahoo Finance, 843/843 ticker, dengan jendela sinyal pagi dan evaluasi bar sesudah entry sampai penutupan.
- Impor CSV untuk data snapshot sinyal + order book + pergerakan setelah sinyal; template tersedia di `/sample-backtest.csv`. Impor langsung menghasilkan riwayat backtest baru.
- Statistik setelah biaya: win rate, average net return, compounded return, max drawdown, dan profit factor.
- Tuning konfirmasi memakai split kronologis 70/30 agar parameter dipilih pada train dan dilaporkan pada test.
- Target default 1% gross dan stop 0,9%. Dengan biaya round-trip 0,3%, target teoritis bersih sekitar 0,7% sebelum slippage dan dampak antrean.
- Shortlist kualitas maksimal 10 memakai buy limit 3% di bawah open. Zona penurunan menengah di atas -12% dan di bawah -6% dikecualikan setelah validasi lintas periode; ini bukan jaminan lima transaksi terisi atau profit setiap hari.
- Exit statistik memakai harga penutupan resmi. TP net +1% dengan stop tetap 1%–7% tidak dipakai karena seluruh variasi negatif pada uji konservatif candle 60 menit.

## Menjalankan lokal

```bash
npm install
npm run dev
```

## Kontrak feed berlisensi

Untuk jalur yang paling langsung, set `INVEZGO_API_KEY` di environment Netlify. Function akan memanggil `POST https://api.invezgo.com/screener/screen` dengan formula:

```text
open == low && all_bid_volume > all_offer_volume && high > prev_high && low > prev_low && value > 100000000
```

Key hanya disimpan sebagai environment server dan tidak pernah dikirim ke browser.

Sebagai alternatif, set `MARKET_DATA_URL` dan, bila perlu, `MARKET_DATA_TOKEN`.

```json
[{ "ticker":"BBRI", "company":"Bank Rakyat Indonesia", "price":4820, "open":4780, "low":4780, "high":4860, "prevLow":4700, "prevHigh":4800, "volume":106313, "value":512430000, "allBidVolume":1680000, "allOfferVolume":1000000, "signalTime":"09:15:12", "source":"licensed" }]
```

## Batasan penting

Rumus ini bukan jaminan profit. Backtest yang sah membutuhkan snapshot/order-book log historis pada waktu sinyal. Kolom `futureHigh` dan `futureLow` harus hanya mencakup periode **setelah** `signalTime`; `close` adalah harga penutupan hari itu. Jika target dan stop sama-sama tersentuh tanpa tick sequence, engine memakai stop lebih dulu (konservatif). Tetap perhitungkan slippage, antrean, corporate actions, survivorship bias, dan out-of-sample testing. Mode proxy tidak menggantikan aggregate order book.
