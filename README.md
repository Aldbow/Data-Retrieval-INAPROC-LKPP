# Data Retrieval INAPROC-LKPP 🏢

![Next.js](https://img.shields.io/badge/Next.js-16.1-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-19.2-blue?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=for-the-badge&logo=tailwind-css)

Aplikasi web untuk menelusuri, menyinkronkan, dan mengekspor data pengadaan barang/jasa
pemerintah dari API INAPROC/LKPP (`data.inaproc.id`).

Mencakup **103 endpoint** dan menyimpan setiap dataset dalam **tiga format sekaligus**:
`.json`, `.csv`, dan `.xlsx`.

---

## 🚀 Fitur

| Fitur | Keterangan |
|---|---|
| **Browser** | Telusuri data live dari 103 endpoint, tabel tervirtualisasi, pencarian instan pada data termuat |
| **Sync Manager** | Sinkronisasi per endpoint per tahun ke penyimpanan lokal; badge menunjukkan format mana yang sudah ada |
| **Range Sync** | Sinkronisasi massal lintas tahun dan endpoint, dengan tombol hentikan |
| **Tiga format** | JSON kanonik, CSV & XLSX diturunkan otomatis saat sync selesai |
| **Ekspor** | Unduh sebagai JSON, CSV, atau XLSX; membaca file lokal bila sudah pernah disinkronkan |
| **Deduplikasi** | Berbasis kunci alami per endpoint, dengan fallback hash stabil bila kunci tidak diketahui |
| **Snapshot agregat** | Endpoint dashboard disimpan sebagai deret berstempel waktu (`_snapshot_at`), bukan ditimpa |

---

## 🗂️ Cakupan Endpoint

Semua 103 endpoint terdaftar di [`src/lib/endpoint-registry.ts`](src/lib/endpoint-registry.ts),
yang menjadi satu-satunya sumber kebenaran untuk pemetaan folder, kunci dedup, kelayakan sync,
dan pengelompokan UI.

| Kelompok | Kategori | Jumlah |
|---|---|---:|
| **V1 · Data** | RUP 9 · Tender 15 · E-Katalog 4 · E-Katalog Archive 5 | **33** |
| **V1 · Dashboard** | Realisasi 8 · Profil 6 · RUP 6 · Afirmasi 5 · Pembayaran 5 · Umum 1 | **31** |
| **Legacy** | Tender 20 · RUP 11 · E-Katalog Archive 5 · E-Katalog 2 · Bela 1 | **39** |
| | | **103** |

### Status endpoint

Setiap endpoint punya `status` yang menentukan apakah bisa diambil:

- **`ready`** (91) — bisa di-browse dan di-sync.
- **`requires-id`** (8) — butuh identifier per record (`kd_penyedia`, `kd_komoditas`, …),
  jadi tidak bisa ditarik massal.
- **`needs-params`** (4) — API mengembalikan HTTP 400 untuk **semua** kombinasi parameter yang
  sudah dicoba (12 kombinasi, plus POST → 405). Parameter wajibnya belum terdokumentasi:
  - `/v1/dashboard/rup/detail`
  - `/v1/dashboard/realisasi/detail/paket`
  - `/v1/dashboard/realisasi/detail/jadwal`
  - `/v1/dashboard/realisasi/filters/status-paket`

  Endpoint ini tetap terdaftar dan ditandai di UI. Bila Anda menemukan parameter yang benar,
  ubah `status` menjadi `'ready'` di registry.

> **Catatan:** endpoint `/v1/dashboard/*/geo/*` mengembalikan `items: []` dengan HTTP 200
> Success. Endpointnya sehat; datanya memang belum terisi untuk KLPD ini.

---

## 📦 Format Penyimpanan

Setiap dataset menghasilkan file berdampingan dengan nama dasar yang sama:

```
<INAPROC_DATA_PATH>/
└── v1/rup/
    ├── master-satker_2025.json        ← kanonik
    ├── master-satker_2025.csv
    ├── master-satker_2025.xlsx
    └── master-satker_2025.meta.json   ← sidecar: kunci dedup, jumlah baris, waktu tulis
```

Endpoint non-tahunan (data referensi, `/v1/dashboard/last-update`) tidak memakai akhiran tahun.
Path dashboard bersarang mengikuti strukturnya:
`/v1/dashboard/realisasi/geo/satker` → `v1/dashboard/realisasi/geo/satker_2025.*`

**JSON adalah format kanonik**, CSV dan XLSX diturunkan darinya. Alasannya teknis:

- XLSX punya batas keras **1.048.576 baris** — dataset RUP sudah mendekati skala itu.
  Bila terlampaui, XLSX dipecah ke beberapa sheet sementara JSON dan CSV tetap utuh.
- Parsing JSON jauh lebih murah daripada XLSX, dan file kanonik dibaca ulang setiap batch sync.
- JSON mempertahankan `null` dan tipe numerik; CSV dan XLSX meratakannya.

CSV dan XLSX dibuat ulang **saat sync selesai**, bukan setiap batch, agar biaya format tambahan
dibayar sekali per sync. Bila keduanya tertinggal dari JSON, UI menandainya `Stale` dan
menyediakan tombol regenerate (`POST /api/sync/materialize`).

---

## ⚙️ Instalasi

### 1. Prasyarat
- **Node.js 22.6+** (dibutuhkan untuk menjalankan test tanpa dependensi tambahan)
- npm

### 2. Instal dependensi
```bash
npm install
```

### 3. Konfigurasi environment — **wajib**

Salin `.env.example` menjadi `.env.local` dan isi:

```bash
cp .env.example .env.local
```

| Variabel | Wajib | Keterangan |
|---|:---:|---|
| `JWT_TOKEN` | ✅ | Token bearer API INAPROC. **Tanpa ini semua route mengembalikan HTTP 500.** |
| `INAPROC_DATA_PATH` | — | Root penyimpanan lokal. Default: `./DATA` di dalam proyek. |
| `INAPROC_KODE_KLPD` | — | Kode KLPD yang dikirim sebagai `?kode_klpd=`. Default: `K34`. |
| `INAPROC_API_BASE_URL` | — | Base URL API. Ubah hanya untuk mirror atau mock. |

> **Migrasi:** variabel `SYNC_LOCATION` sudah dihapus. Dulu kode membacanya lebih dulu sehingga
> `INAPROC_DATA_PATH` tidak pernah berlaku — akibatnya data bisa terpecah ke dua direktori.
> Kini hanya `INAPROC_DATA_PATH` yang dipakai.

### 4. Jalankan
```bash
npm run dev        # development di http://localhost:3000
npm run build      # build produksi
npm run start      # jalankan hasil build
```

### 5. Verifikasi
```bash
npm run verify     # typecheck + lint + test
npm test           # unit test
npm run typecheck
npm run lint
```

---

## 🔌 API Internal

| Route | Metode | Fungsi |
|---|---|---|
| `/api/inaproc` | GET | Proxy browse. Params: `endpoint`, `year`, `cursor`, `limit` |
| `/api/sync` | POST | Sinkronkan satu slice. Body: `endpoint`, `year`, `batchSize`, `maxPages`, `forceOverwrite` |
| `/api/sync/status` | GET | Status semua endpoint, termasuk format mana yang ada di disk |
| `/api/sync/materialize` | POST | Buat ulang CSV/XLSX dari JSON kanonik |
| `/api/sync/schedule` | GET/POST/PUT | Simpan preferensi jadwal (belum ada eksekutor — lihat Batasan) |
| `/api/export` | GET | Unduh. Params: `endpoint`, `year`, `format` (`json`\|`csv`\|`xlsx`), `search` |

### Kontrak sinkronisasi

Klien memanggil `POST /api/sync` berulang sampai `isComplete: true`. Respons menyertakan
`stalled: boolean` — **bila `true`, klien harus berhenti**: request tidak memperoleh data apa pun
dan tidak mencapai akhir, sehingga mengulanginya akan berputar tanpa henti.

---

## 🏗️ Arsitektur

```
src/lib/
├── endpoint-registry.ts   103 endpoint + metadata (sumber kebenaran tunggal)
├── response-adapter.ts    Normalisasi 6 bentuk envelope API → { rows, cursor, hasMore }
├── inaproc-client.ts      Pembangunan URL, auth, timeout, retry backoff
├── drive-config.ts        Resolusi path + penjagaan traversal
├── dataset-format.ts      Transformasi murni: identitas record, CSV, workbook
├── storage-service.ts     IO atomik, dedup, materialisasi format turunan
└── sync-state.ts          Cursor per endpoint/tahun, tulis terserialisasi
```

### Bentuk respons API

API mengembalikan setidaknya enam envelope berbeda, dan **tidak konsisten bahkan dalam satu
keluarga** (`/dashboard/rup/table` membungkus dengan `success`, `/dashboard/realisasi/table`
tidak). Karena itu deteksi dilakukan secara struktural, bukan berdasarkan deklarasi:

| Bentuk | Contoh endpoint |
|---|---|
| `[ {...} ]` | semua endpoint legacy |
| `{ data: [...], meta }` | dataset v1 |
| `{ data: { items: [] } }` | `/v1/dashboard/*/geo/*` |
| `{ data: { rows: [] } }` | `/v1/dashboard/*/table` |
| `{ data: {...} }` | `/v1/dashboard/*/summary`, `last-update` |
| `{ data: { data: {...} } }` | `/v1/dashboard/profil/precomputed` |

Paginasi dibaca dari `meta.cursor` dan `meta.has_more`.

---

## ⚠️ Batasan yang Diketahui

- **Tidak ada autentikasi pada route API.** Aman untuk `localhost`. Sebelum di-deploy ke
  jaringan manapun, tambahkan `middleware.ts` — tanpa itu siapa pun yang menjangkau URL-nya
  bisa memakai token LKPP Anda dan memicu sync.
- **Penjadwalan belum berjalan.** Konfigurasinya tersimpan, tetapi menjalankan sync terjadwal
  butuh proses yang hidup lebih lama dari sebuah request. UI-nya disembunyikan sampai itu ada.
- **Empat endpoint `needs-params`** (lihat di atas) belum bisa diambil.
- **Ekspor dari API langsung dibatasi 200 halaman.** Bila tercapai, respons menyertakan header
  `X-Export-Truncated: true` dan UI memperingatkan. Sinkronkan endpointnya untuk ekspor penuh
  dari file lokal.
- **Statistik "Nilai Baris Termuat"** hanya menjumlah baris yang sudah dimuat di layar, bukan
  total dataset. Untuk agregat sebenarnya gunakan endpoint `/v1/dashboard/*/summary`.
- **Presisi ID numerik panjang.** ID di atas 2^53 kehilangan presisi saat `JSON.parse`,
  di luar kendali aplikasi ini.

---

*Dibuat untuk mempermudah analitik dan penarikan data pengadaan LKPP.*
