# Cara Cepat Menarik Data

Contekan untuk skrip `pull:v1`, yang menarik semua endpoint `/v1/*` berstatus `ready`
sampai tuntas tanpa membuka UI.

## Perintah utama

Jalankan dari folder proyek (`web-app`):

```powershell
npm run pull:v1 -- --year 2025
```

Ganti `2025` dengan tahun yang diinginkan. Tanda `--` sebelum `--year` wajib ada, karena
itulah yang meneruskan opsi ke skrip.

## Variasi

| Kebutuhan | Perintah |
|---|---|
| Tarik semua, lanjutkan dari titik terakhir | `npm run pull:v1 -- --year 2025` |
| Hapus data lama, tarik ulang dari nol | `npm run pull:v1 -- --year 2025 --fresh` |
| Satu endpoint saja | `npm run pull:v1 -- --year 2025 --endpoint /v1/rup/master-satker` |
| Satu endpoint, dari nol | `npm run pull:v1 -- --year 2025 --fresh --endpoint /v1/rup/master-satker` |

`--year` selalu wajib (empat digit, 2000–2100), termasuk untuk endpoint yang tidak
bertahun; endpoint seperti itu mengabaikan nilainya.

## Sebelum menjalankan

- Kode sudah yang terbaru: jalankan `git pull` dulu. Perbaikan untuk perubahan API bisa
  saja sudah ada di remote tetapi belum ditarik ke komputer ini.
- `.env.local` berisi `JWT_TOKEN`. Tanpa token, skrip berhenti sebelum mengirim permintaan apa pun.
- Node.js 22.6 atau lebih baru.
- Tidak ada sync yang sedang berjalan dari UI. Keduanya menulis ke `sync-state.json`
  yang sama tanpa kunci antar-proses, jadi jangan dijalankan bersamaan.

## Membaca hasilnya

Setiap endpoint mencetak satu baris:

```
[3/50] /v1/rup/master-satker (2025) ... complete -- 5 page(s), +480 new, 0 dup skipped, 480 total
```

| Status | Arti | Tindakan |
|---|---|---|
| `complete` | Semua halaman sudah ditarik | Tidak ada |
| `incomplete` | Berhenti sebelum habis | Jalankan ulang perintah yang sama untuk melanjutkan |
| `FAILED` | API menolak atau terjadi galat | Baca pesannya di bagian `Failed` pada ringkasan |

Di akhir muncul ringkasan (`--- Summary ---`) berisi jumlah endpoint yang selesai, belum
tuntas, dan gagal, serta total record baru. Bila ada yang gagal, skrip keluar dengan kode 1.

## Lokasi data

Hasil tersimpan di `INAPROC_DATA_PATH` (default `./DATA`), tiga format per dataset:

```
DATA/v1/rup/
├── master-satker_2025.json   ← kanonik
├── master-satker_2025.csv
└── master-satker_2025.xlsx
```

CSV dan XLSX dibuat setelah sebuah endpoint selesai (`complete`), bukan per halaman.

## Hal yang perlu diingat

- **`--fresh` menghapus dataset** untuk endpoint dan tahun itu sebelum menarik ulang.
  Tanpa `--fresh`, skrip melanjutkan dan melewati record duplikat.
- **Hanya endpoint v1.** Endpoint legacy ditarik lewat UI: `npm run dev`, buka
  http://localhost:3000, lalu pakai Sync Manager atau Range Sync.
- **Endpoint `requires-id`, `needs-params`, dan `unavailable` dilewati**, karena tidak bisa
  ditarik massal. Itu termasuk `/v1/ekatalog/list-produk-penyedia` (butuh `kode_penyedia`)
  dan seluruh `/v1/dashboard/pembayaran/*` (API membalas 404).

## Bila ada masalah

| Pesan | Penyebab | Solusi |
|---|---|---|
| `JWT_TOKEN is not configured` | Token kosong atau `.env.local` tidak ada | Isi `JWT_TOKEN` di `.env.local` |
| `Usage: npm run pull:v1 -- --year <YYYY> ...` | `--year` hilang atau tidak valid | Pastikan ada `--` dan tahun empat digit |
| `--endpoint ... is not a ready v1 endpoint` | Salah ketik path, atau endpoint bukan v1/`ready` | Cek [endpoint-registry.ts](../src/lib/endpoint-registry.ts) |
| `API menolak permintaan (1004): Permintaan tidak valid` | Endpoint butuh parameter yang tidak dikirim skrip | Bila butuh ID per record, ubah `status`-nya menjadi `'requires-id'` di [endpoint-registry.ts](../src/lib/endpoint-registry.ts) |
| `API menolak permintaan (...)` dengan kode lain | API INAPROC menolak, sering karena token kedaluwarsa | Perbarui token, lalu jalankan ulang |
| `Upstream returned 404` | Alamat endpoint tidak dilayani API | Ubah `status`-nya menjadi `'unavailable'` di registry supaya dilewati |
| `Upstream returned 503 (5 attempts)`, atau di UI: "Server API INAPROC sedang tidak tersedia" | Server INAPROC sedang gangguan; aplikasi sudah mencoba ulang selama ~15 detik | Tunggu beberapa menit, lalu jalankan ulang. Data yang sudah tersimpan aman, dan penarikan melanjutkan dari titik terakhir yang tersimpan |
| `pagination is not advancing` | API mengabaikan parameter paginasi dan mengirim halaman yang sama | Sesuaikan `pagination` endpoint itu di registry (`cursor` atau `offset`) |
| `[adapter] ... expected shape ... but found ...` | API mengubah bentuk responsnya; data tetap terbaca | Sesuaikan `shape` endpoint itu di registry agar peringatannya hilang |

Sumber: [scripts/pull-v1-all.ts](../scripts/pull-v1-all.ts)
