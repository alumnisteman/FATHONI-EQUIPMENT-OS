# Ringkasan Status QA — FATHONI EQUIPMENT OS 3.0.0
**Tanggal**: 2026-10-11
**Rincian**: `QA_REPORT.md` (laporan lengkap) dan `tests/harness/README.md` (matriks assertion per cacat)

## Verdict

Rilis 3.0.0 terverifikasi pada mesin Windows ini. Rantai regresi penuh:
**15 langkah, 1.036 assertion, 0 gagal**, `rusak: tidak`, `proses keluar tidak bersih: tidak`,
`npm audit` 0 kerentanan tinggi/kritis.

| Langkah | Assertion |
|---|---|
| migration | 49 |
| unit (`validation-check`) | 243 |
| auth (keamanan) | 58 |
| gui (fungsional) | 72 |
| flow (fungsional) | 30 |
| handoff (integrasi lintas menu) | 118 |
| usable (usability + ukuran layar) | 33 |
| db (SQLite + paritas SQL) | 136 |
| integritas (atomisitas + rollback + hapus dirujuk) | 68 |
| compat (profil lama + mode browser) | 30 |
| perf (beban + stres) | 37 |
| store (rencana tulis per collection) | 47 |
| backup (snapshot + restore) | 87 |
| paket (uji asap FATHONI.exe jadi) | 28 |
| audit dependensi | 0 kerentanan |

## Yang sudah terbukti

- **Tidak kehilangan data**: hapus lewat jalur per-baris + aturan rujukan di main
  process; simpan sebagian tidak menimpa collection lain; patch beracun di-rollback
  penuh dan file tetap sehat. Termasuk orang: menghapus teknisi yang masih ditulis
  namanya di Work Order, atau operator yang masih membawa Surat Jalan, sekarang
  ditolak dengan alasan yang menyebut dokumennya (handoff 10.18).
- **Ringan walau data tumbuh**: boot memindahkan 0 baris lewat IPC; tabel 50.000 baris
  tetap 12 kartu DOM; pencarian median 275 ms; kueri telanjang 86 ms; tulis satu baris
  median 1 ms.
- **Aman**: akun ter-hash di main process, balasan login tanpa kredensial, lockout 5x,
  CSP + sandbox, `accounts.json` tanpa plaintext, CSV meng-escape dan menahan injeksi
  formula, uji asap paket berjalan di sandbox dan membuktikan profil nyata tidak berubah.
- **Naik versi tidak merusak**: profil lama hasil upgrade membangun kembali kolom
  turunannya dan mengembalikan baris warisan; mode browser tanpa `electronAPI` tetap
  terbuka dengan penanda demo dan nol error renderer.
- **Satu baris aneh tidak membekukan aplikasi**: nilai di luar peta status/severity,
  dan kolom angka/array yang kosong, kini tampil apa adanya alih-alih meruntuhkan
  seluruh menu (ini penyebab "aplikasi macet" yang paling sering dilaporkan).
- **Paket**: `dist-installer/FATHONI-Setup-3.0.0.exe` (79,3 MiB), asar hanya berisi
  `dist`, `dist-electron`, `better-sqlite3`; ikon exe sendiri; AppId dan nama data
  dipertahankan.

## Yang belum terbukti (jangan dinyatakan lulus)

macOS/Linux · scaling DPI dan ukuran layar lain · printer/perangkat keras sejati ·
code signing (SmartScreen akan memperingatkan) · walkthrough usability oleh manusia ·
kapasitas di atas 50.000 baris per collection · anggaran performa yang masih dilonggarkan.

## Yang menunggu keputusan

1. **Operator ↔ kontrak rental**: `rentals` tidak menyimpan identitas operator sama
   sekali (hanya `operatorIncluded` Ya/Tidak, dan `operatorName` cuma ada di tipe tanpa
   pernah ditulis layar). Menahannya berarti menambah kolom/blob baru → backfill
   profil live (`ensureColumns`, `DERIVED_REVISION` 5→6). Teknisi/operator vs dokumen
   lain sudah ditutup tanpa migrasi (aturan blob, QA_REPORT §4.6); batas yang tersisa:
   nama satu kata di bawah ambang token 6 huruf tidak tertahan.
2. **Prisma tidak dipakai** (~111 MB) — penghapusan butuh persetujuan.
3. **`auto-fix.ps1` di root** — merusak (`rm dist*/node_modules/package-lock` +
   `git reset/clean`).
4. **Artefak lama** — `HEMS-Setup-*.exe` dan `dist-electron-portable` (156 MB,
   `app.asar` terkunci proses).

## Jalur reproduksi

```bash
npm run build && npm run build:electron
sh tests/harness/regressi.sh
```

Satu instance Electron per jalan; harness profil memakai
`HEMS_DATA_DIR=D:/SANY/tmp-harness/r-<nama>` (paket: `--user-data-dir`).
