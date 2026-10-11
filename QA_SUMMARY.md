# Ringkasan Status QA — FATHONI EQUIPMENT OS 3.0.2
**Tanggal**: 2026-10-11
**Rincian**: `QA_REPORT.md` (laporan lengkap) dan `tests/harness/README.md` (matriks assertion per cacat)

## Verdict

Rilis 3.0.2 terverifikasi pada mesin Windows ini, dan yang diuji adalah paket yang
diedarkan: `dist-app/win-unpacked` + `dist-installer/FATHONI-Setup-3.0.2.exe` (build
2026-10-11 12:44, manifest di dalam `app.asar` berbunyi 3.0.2, `FileVersion`/
`ProductVersion` `FATHONI.exe` 3.0.2, asar tanpa satu pun `.map`/`.pdb`). Sumber berubah
SESUDAH paket 3.0.1 dibangun, jadi bukti 3.0.1 tidak dipinjam: versi dinaikkan, paket
dibangun ulang, lalu rantai diulang dari nol. Hasilnya **16 langkah, 1.165 assertion,
0 gagal**, `rusak: tidak`, `proses keluar tidak bersih: tidak` — dan untuk pertama kalinya
baris `exit=` bernilai 0 di **setiap** langkah, termasuk sepuluh langkah Electron, karena
rantai tidak lagi memanggil Electron lewat `npx` (QA_REPORT §4.12). `npm audit` 0 kerentanan
tinggi/kritis — plus lintasan kapasitas 400.000 baris (`HEMS_PERF_KAPASITAS=1`, 55 lulus).

| Langkah | Assertion |
|---|---|
| migration | 49 |
| unit (`validation-check`) | 293 |
| auth (keamanan) | 58 |
| gui (fungsional) | 72 |
| flow (fungsional) | 30 |
| handoff (integrasi lintas menu) | 123 |
| usable (usability + ukuran layar) | 37 |
| **cetak (dokumen cetak runtime)** | **67** |
| db (SQLite + paritas SQL) | 136 |
| integritas (atomisitas + rollback + hapus dirujuk) | 68 |
| compat (profil lama + mode browser) | 30 |
| perf (beban + stres) | 40 |
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
  tetap 12 kartu DOM; pencarian median 229 ms; kueri telanjang 7 ms; tulis satu baris
  median 1 ms. Dan ini bukan ekstrapolasi: **400.000 baris** (100.000 unit + 100.000 kas
  + 100.000 suku cadang + 100.000 invoice, berkas 233 MB) sudah diukur — boot 966 ms,
  membuka layar Armada 475 ms, pencarian 0,4–0,7 s dengan jumlah record sama persis dengan
  `COUNT(*)` SQLite, agregat KPI 69 ms, tulis satu baris 1 ms, heap renderer tetap 10 MB
  (QA_REPORT §3.1).
- **Dokumen cetak dibuktikan sampai jendelanya**: `cetak-check` mengklik tombol cetak di
  10 layar (Penjualan, Pembelian, Rental, Invoice, Pengiriman, Servis, Breakdown, Operator,
  Teknisi, Persetujuan) dan memeriksa jendela cetak sungguhan: isinya dokumen (bukan
  aplikasi), `print()` sekali dengan A4 + latar, jendela ditutup lagi, tanpa artefak
  `undefined`/`[object`, baris rusak hasil suntingan tangan tetap tercetak, skrip di dalam
  data tampil sebagai teks, jendela cetak tidak punya `electronAPI` dan CSP-nya
  `default-src 'none'`, dokumen > 1 MB ditolak dengan pesan. Yang TIDAK dibuktikan: kertas
  keluar dari printer (dialog cetak asli `silent: false` tidak bisa dijalankan otomatis).
- **Membuka menu tidak lagi memuat seluruh database**: `/maintenance` dulu dipetakan ke
  SEMUA collection; sekarang nol kebutuhan, dan tombol "Muat data contoh" meminta hidrasi
  untuk dirinya sendiri dengan label menunggu yang jelas (QA_REPORT §4.9).
- **Aman**: akun ter-hash di main process, balasan login tanpa kredensial, lockout 5x,
  CSP + sandbox, `accounts.json` tanpa plaintext, CSV meng-escape dan menahan injeksi
  formula, uji asap paket berjalan di sandbox dan membuktikan profil nyata tidak berubah.
- **Naik versi tidak merusak**: profil lama hasil upgrade membangun kembali kolom
  turunannya dan mengembalikan baris warisan; mode browser tanpa `electronAPI` tetap
  terbuka dengan penanda demo dan nol error renderer.
- **Satu baris aneh tidak membekukan aplikasi**: nilai di luar peta status/severity,
  dan kolom angka/array yang kosong, kini tampil apa adanya alih-alih meruntuhkan
  seluruh menu (ini penyebab "aplikasi macet" yang paling sering dilaporkan). Field
  array pada dokumen cetak (sertifikat operator/teknisi, parts dipakai) ikut dinormalkan,
  karena `item.X && item.X.length > 0` tidak menahan nilai berbentuk teks — kini dibuktikan
  RUNTIME (cetak 12 menanam baris rusak lalu mengklik cetak) dan dijaga statis per kolom
  (validation 24). Dari sanalah cacat di layar Teknisi ditemukan dan ditutup (QA_REPORT §4.10).
- **Nomor dokumen tidak rangkap**: usulan nomor di 11 menu (SPK, rental, PO, WO, surat
  jalan, invoice, kerusakan, permohonan, operator, teknisi, bukti mutasi) berlanjut dari
  nomor tertinggi di `fathoni.db` lalu diperiksa sampai benar-benar bebas — bukan dari
  array di memori yang sejak #38 hanya sebagian. Nomor bisnis adalah kunci rujukan
  lintas menu (`electron/referential.ts`), jadi ini perlindungan integritas data, bukan
  kenyamanan mengetik (QA_REPORT §4.7).
- **Satu menu, satu cerita di semua jalan masuk**: urutan sidebar disusun ulang
  mengikuti siklus kerja (master data → beli → jual/sewa → setuju → tagih → gudang/part
  → rusak → servis → kirim → kas → laporan → sistem), dan tiga daftar lain yang dulu
  berdiri sendiri kini ikut dia: katalog modul di Pengaturan (kategori + urutan),
  CommandPalette Ctrl+K (dulu hanya 17 dari 26 menu), dan pencarian di topbar (dulu
  menawarkan menu yang sudah dimatikan untuk profil/peran pengguna). Dibuktikan di
  layar pada profil DEALER (usable 7.1–7.4: palette == sidebar sebutir-butir, kata
  kunci "onderdil" membuka `/spareparts`, "sewa" tidak membocorkan `/rental`) dan
  dikunci validation 25 (QA_REPORT §4.8).
- **Paket**: `dist-installer/FATHONI-Setup-3.0.2.exe` (79,3 MiB), asar hanya berisi
  `dist`, `dist-electron`, `better-sqlite3`; ikon exe sendiri; AppId dan nama data
  dipertahankan. `build-installer.ps1` kini punya jalur signing opsional
  (`HEMS_SIGN_PFX`/`HEMS_SIGN_PASS` → `signtool sign` SHA256 + timestamp + `verify /pa`,
  dan laporan akhir menyebut status tanda tangan); tanpa sertifikat ia mencetak
  `LEWAT sign` dan paket dilaporkan apa adanya sebagai **TIDAK TERSIGN**.
  `2.0.0`/`3.0.0`/`3.0.1` dibiarkan utuh di `dist-installer/` — hanya 3.0.2 yang layak edar.

## Yang belum terbukti (jangan dinyatakan lulus)

macOS/Linux · scaling DPI dan ukuran layar lain · kertas keluar dari printer sejati
(`print()` hanya dibuktikan dipanggil dengan opsi yang benar) · perangkat keras lapangan ·
**tanda tangan kode** — plumbing-nya ada, sertifikatnya belum dibeli, jadi SmartScreen akan
memperingatkan · walkthrough usability oleh manusia · lebih dari 400.000 baris (dan
khususnya biaya `LIKE '%token%'` yang linear di atas jumlah itu) · anggaran performa yang
masih dilonggarkan.

## Yang menunggu keputusan

1. **Sertifikat code signing (OV vs EV)** — pembelian + organisasi; tanpa itu distribusi
   luas tetap memunculkan peringatan SmartScreen.
2. **Layar Rental dibuka pada mode Timeline**, yang tidak punya tombol cetak — harness
   harus memindahkan ke "📊 Tabel" dulu. Ubah bawaan ke Tabel, atau tambahkan cetak di
   Timeline? Ini keputusan tata letak, bukan bug.
3. **Operator ↔ kontrak rental**: `rentals` tidak menyimpan identitas operator sama
   sekali (hanya `operatorIncluded` Ya/Tidak, dan `operatorName` cuma ada di tipe tanpa
   pernah ditulis layar). Menahannya berarti menambah kolom/blob baru → backfill
   profil live (`ensureColumns`, `DERIVED_REVISION` 5→6). Teknisi/operator vs dokumen
   lain sudah ditutup tanpa migrasi (aturan blob, QA_REPORT §4.6); batas yang tersisa:
   nama satu kata di bawah ambang token 6 huruf tidak tertahan.
4. **Prisma tidak dipakai** (~111 MB) — penghapusan butuh persetujuan.
5. **`installer.iss` di root** — duplikat basi dari installer resmi: `Source` menunjuk
   `dist-electron-portable\win-unpacked` (folder yang ditinggalkan) dan `AppVersion
   "1.0.0"`. Sudah dijaga agar tidak mungkin ikut ter-build (validation 14), jadi ia
   tidak berbahaya selama dibiarkan; menghapusnya tetap keputusan pengguna.
6. **Artefak lama** — `HEMS-Setup-*.exe`, `FATHONI-Setup-2.0.0/3.0.0/3.0.1.exe` dan
   `dist-electron-portable` (156 MB, `app.asar` terkunci proses).

Yang sudah selesai dan tidak lagi menunggu keputusan: **`auto-fix.ps1` di root**. Versi
lamanya menghapus `dist*`, `node_modules`, `package-lock.json` dan menjalankan
`git reset --hard`/`git clean -fd` tanpa konfirmasi — di repo dengan data pengguna hidup
dan satu-satunya konfigurasi build ada di `package.json`, itu alat yang lebih merusak
daripada memperbaiki. Kini ia **PREFLIGHT**: 21 pemeriksaan baca-saja (node/npm, nama
lockfile vs `package.json`, versi Electron, drift `.npmrc`, probe native sungguhan yang
men-load `better-sqlite3` di dalam Electron, kesegaran `dist`/`dist-electron`/`app.asar`/
installer, RAM, `NODE_OPTIONS`, proses Electron nyasar, status git), keluar dengan kode 1
hanya kalau ada FAIL, dan satu-satunya tindakan tulis terjadi di balik `-Apply`: membersihkan
`node_modules/.vite` lalu `npm run rebuild:native` / `npm run build` kalau memang sumbernya
lebih baru. Bentuk destruktifnya dikunci validation §27 sehingga tidak bisa kembali, dan
BOM UTF-8 `auto-fix.ps1` + `build-installer.ps1` ikut dijaga — tanpa BOM, PowerShell 5.1
membaca em-dash sebagai cp1252 dan skrip build mati dengan error parse yang terlihat tidak
berhubungan (QA_REPORT §4.11).

## Jalur reproduksi

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File auto-fix.ps1   # PREFLIGHT baca-saja, 21 pemeriksaan
npm run build && npm run build:electron
sh tests/harness/regressi.sh                                  # 16 langkah
HEMS_PERF_KAPASITAS=1 node_modules/electron/dist/electron.exe tests/harness/perf-check.cjs # kapasitas 400.000 baris
```

Satu instance Electron per jalan; harness profil memakai
`HEMS_DATA_DIR=D:/SANY/tmp-harness/r-<nama>` (paket: `--user-data-dir`). Rantai memanggil
`node_modules/electron/dist/electron.exe` langsung — `npx electron` pernah membuat rantai
tampak rusak padahal 72 assertion lulus, karena pembungkus npm-nya mati tidak bersih
setelah hasil tercetak.
