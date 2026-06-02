# Data Retrieval INAPROC-LKPP 🏢

![Next.js](https://img.shields.io/badge/Next.js-16.1-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-19.2-blue?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=for-the-badge&logo=tailwind-css)

Aplikasi Web Modern untuk mengambil, menyinkronkan, mengelola, dan mengekspor data pengadaan barang dan jasa dari sistem INAPROC dan LKPP (Lembaga Kebijakan Pengadaan Barang/Jasa Pemerintah). 

Aplikasi ini didesain dengan antarmuka pengguna (UI) yang kaya menggunakan komponen Radix UI, Framer Motion, dan Tailwind CSS, serta performa tinggi untuk merender ribuan baris data menggunakan virtualisasi.

---

## 🚀 Fitur Utama

- **Data Browser Berkecepatan Tinggi**: Menampilkan ribuan data pengadaan secara mulus berkat implementasi `@tanstack/react-virtual` dan `@tanstack/react-query`.
- **Sync Manager**: Fitur sinkronisasi data dari berbagai *endpoint* LKPP/INAPROC. Terdapat sinkronisasi tunggal (per tahun) dan rentang (*Range Sync*) untuk multi-tahun secara massal.
- **Sistem Deduplikasi Data**: Mencegah adanya duplikasi rekaman data saat sinkronisasi menggunakan metode *unique key matching*.
- **Penyimpanan Berbasis Excel**: Data yang disinkronkan akan disimpan ke dalam format file `.xlsx` menggunakan *library* `xlsx`. File metadata juga dibuat secara otomatis untuk melacak riwayat sinkronisasi.
- **Ekspor Data Mudah**: Pengguna dapat dengan mudah mengekspor data hasil pencarian dan filter ke format Spreadsheet/CSV dengan satu klik.
- **Dashboard Statistik Real-Time**: Melihat total nilai Pagu, jumlah total rekaman data, dan status API secara *real-time*.

---

## 🏗️ Arsitektur Proyek

Proyek ini menggunakan arsitektur **Next.js App Router**. Berjalan sepenuhnya sebagai aplikasi *Full-Stack* (Frontend React dan Backend Next.js API Routes).

### Direktori Utama:
- `src/app/page.tsx`: Halaman utama (*dashboard*) yang memuat *Browser*, *Sync Manager*, dan *Range Sync*.
- `src/app/api/`: Berisi rute backend untuk *fetching* API LKPP, proses sinkronisasi, dan ekspor.
  - `/api/inaproc`: Mengambil data (dengan fitur pagination/cursor).
  - `/api/sync`: Memproses sinkronisasi dan menyimpan ke lokal.
  - `/api/export`: Menghasilkan file unduhan Excel ke sisi klien.
- `src/lib/`: Kode logika bisnis dan utilitas.
  - `excel-service.ts`: Sistem manajemen operasi file Excel (Baca, Tulis, Deduplikasi).
  - `sync-state.ts` & `drive-config.ts`: Konfigurasi *endpoint* dan manajemen *state* saat sinkronisasi.
- `src/components/`: Komponen UI modular (Radix UI, Sheet, Badge, Loader, dll).

---

## 🛠️ Teknologi yang Digunakan

- **Framework Utama**: [Next.js 16.1.1](https://nextjs.org/) (App Router)
- **Library UI**: [React 19.2.3](https://react.dev/)
- **Bahasa**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Komponen UI**: [Radix UI](https://www.radix-ui.com/) & [Lucide React](https://lucide.dev/) (Ikon)
- **Animasi**: [Framer Motion](https://www.framer.com/motion/)
- **Data Fetching & Caching**: [TanStack React Query](https://tanstack.com/query/latest)
- **Virtualisasi Tabel**: [TanStack Virtual](https://tanstack.com/virtual/latest)
- **Pemrosesan Excel**: [SheetJS (xlsx)](https://sheetjs.com/)

---

## ⚙️ Cara Instalasi & Menjalankan Aplikasi

Ikuti langkah-langkah berikut untuk menjalankan proyek ini di mesin lokal Anda:

### 1. Persyaratan Sistem
Pastikan Anda sudah menginstal:
- **Node.js** (Versi 20.x atau terbaru disarankan)
- **npm**, **yarn**, atau **pnpm** (Manajer paket Node)

### 2. Kloning Repositori
*(Jika menggunakan Git)*
```bash
git clone <url-repositori-anda>
cd Data-Retrieval-INAPROC-LKPP
```

### 3. Instalasi Dependensi
Jalankan perintah ini di dalam direktori proyek untuk menginstal semua *library* yang dibutuhkan:
```bash
npm install
# atau
yarn install
# atau
pnpm install
```

### 4. Konfigurasi Lingkungan (Opsional)
Jika aplikasi membutuhkan *Environment Variables* tertentu untuk API INAPROC (seperti URL dasar API atau *secret key*), buat file `.env.local` di root proyek:
```env
# Contoh isi .env.local
# NEXT_PUBLIC_API_BASE_URL=https://api.inaproc.id/v1
```
*(Lewati langkah ini jika tidak ada kredensial khusus yang dibutuhkan)*

### 5. Menjalankan Server Pengembangan (Development)
Untuk menjalankan aplikasi dalam mode *development*:
```bash
npm run dev
# atau
yarn dev
# atau
pnpm dev
```
Aplikasi akan berjalan di **[http://localhost:3000](http://localhost:3000)**. 
Coba buka tautan tersebut di peramban (browser) Anda. Perubahan kode yang Anda buat akan langsung dimuat ulang secara otomatis (*hot-reload*).

### 6. Build untuk Produksi (Production)
Jika Anda ingin mencoba versi *build* siap rilis:
```bash
npm run build
npm run start
```

---

## 📝 Penggunaan Dasar

1. Buka aplikasi di `http://localhost:3000`.
2. Di halaman utama, Anda akan disajikan tampilan **Browser**.
3. Gunakan *dropdown* **Year** dan **Endpoint** di kanan atas untuk memfilter data.
4. Jika data dari suatu endpoint belum tersedia, navigasikan ke menu **Sync Manager** (menggunakan tab di *sidebar* atau *navbar* terkait).
5. Pada menu **Sync Manager**, pilih *endpoint* dan tahun yang diinginkan lalu klik **Start Sync**. Aplikasi akan mulai menarik data dari API LKPP/INAPROC dan menyimpannya di mesin lokal ke dalam file Excel.
6. Anda bisa menggunakan **Range Sync** untuk menarik data dari rentang tahun secara sekaligus (Misal: 2020 hingga 2025).

---
*Dibuat oleh Tim Pengembang internal untuk mempermudah analitik dan penarikan data LKPP Indonesia.*
