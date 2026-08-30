# PagiSore · Panic Limit

Dashboard gratis untuk screening saham IDX dengan rencana **buy limit pagi, jual pada sore hari yang sama**. Feed live memakai scanner publik TradingView yang dapat tertunda; histori memakai candle publik Yahoo Finance 60 menit.

## Aturan produksi

- Seluruh universe IDX dipindai; likuiditas rata-rata 10 hari minimal Rp20 miliar.
- Harga open harus di bawah Rp2.500.
- Tier A: penurunan hari sinyal −15% sampai −12%; buy limit 3% di bawah open.
- Tier B: penurunan hari sinyal −6% sampai −5%; buy limit 3% di bawah open.
- Tier C: cadangan setelah A/B untuk melengkapi maksimal lima sinyal. Band utamanya −8% sampai −3% di luar A/B. Pullback −3% sampai −1% hanya lolos bila gap open berikutnya −3% sampai di bawah 0%. Buy limit Tier C 5% di bawah open.
- Tier A/B selalu diprioritaskan. Tier C hanya ditambahkan bila A/B kurang dari lima; maksimum tetap 10 posisi.
- Order baru hanya 09:00–10:30 WIB. Limit yang tidak tersentuh berarti batal/skip dan dana tetap tunai.
- Exit manual 15:45–15:49 WIB; backtest memakai harga penutupan resmi dan biaya total 0,3%.
- TP/SL tetap tidak digunakan: TP net +1% dengan stop 1%–7% semuanya negatif pada uji konservatif candle 60 menit.

Strategi tidak memaksa lima kandidat bila pasar tidak menyediakan lima saham yang lolos. Backtest bukan jaminan profit, dan aplikasi tidak mengeksekusi order broker.

## Validasi

Dataset riset mencakup 844 ticker saat ini. Parameter dipilih pada 2024–2025 dan diperiksa pada holdout 2026. Simulasi modal memakai 10 slot tetap sejak pagi; order yang tidak terisi tidak direalokasikan setelah melihat hasil.

Keterbatasan utama: data publik tertunda, candle 60 menit tidak menunjukkan urutan tick intrabar, asumsi biaya belum memasukkan seluruh slippage/pajak, dan universe saat ini menimbulkan survivorship bias. Feed gratis tidak menyediakan aggregate order book atau broker flow, sehingga keduanya tidak diklaim atau dipalsukan.

## Menjalankan lokal

```bash
npm install
npm run dev
```

Verifikasi:

```bash
npm run lint
npm test
npm run build
```
