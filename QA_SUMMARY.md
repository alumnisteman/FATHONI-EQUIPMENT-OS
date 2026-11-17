# Ringkasan Status QA — FATHONI EQUIPMENT OS 3.1.0
**Tanggal**: 2026-11-17
**Rincian**: `QA_REPORT.md` (laporan lengkap) dan `tests/harness/README.md` (matriks assertion per cacat)

## Status rilis 3.1.0 — 2026-11-17 (terverifikasi terhadap paket)

Bagian ini mencatat rilis 3.1.0. Paket dibangun dari sumber hari ini
(`npm run build` + `build:electron` + `electron-builder`), lalu installer Inno Setup;
rantai penuh dijalankan terhadap paket itu, bukan jalur dev. Catatan rilis 3.0.5 di bawah
tetap disimpan sebagai sejarah.

- **Penjaga tulis baru** di `electron/automation.ts` (murni, tanpa SQLite) dipanggil dari
  `db-patch` di `electron/main.ts`: kontrak `duplicates` di skema ditegakkan saat baris
  ditulis (dulu hanya dilaporkan `integrity()` setelah data terlanjur kembar), satu sumber
  transaksi hanya boleh punya satu invoice, dan satu unit tidak boleh berada di dua kontrak
  sewa AKTIF yang periodenya beririsan (batas tanggal inklusif). Menyunting baris yang
  sudah ada tetap lolos supaya data warisan bisa diperbaiki; `db-save` (migrasi boot dan
  Restore) tetap dikecualikan; setiap penolakan diaudit `DATA_DENY`.
- **Servis selesai idempoten** di `dataStore`: WO yang sudah `COMPLETED` tidak diproses dua
  kali (stok tidak berkurang lagi, invoice tidak dibuat lagi), `actualCost` benar-benar
  tersimpan ke baris WO, dan layar Servis mengunci tombol sebelum memanggil
  `completeService`.
- **Bug yang ditemukan rantai dan diperbaiki**: banner “TIDAK TERSIMPAN ke database”
  menetap setelah tulisan berikutnya berhasil, karena jalur patch tidak membersihkan
  `storageWarning` (hanya `hasUnsavedChanges`). Operator akan mengira datanya masih hilang.
  Kini dibersihkan pada patch sukses, dan ada assertion unit yang mengunci urutannya.
- **Harness**: `automation-check` baru (33 assertion, murni Node); `otorisasi-check` +13
  (tiga penjaga diuji lewat IPC sungguhan); `validation-check` 395; `compat B.10` dan
  `perf P.21` memakai bulan berjalan karena kartu Kas berlabel “Bulan Ini” (tanggal seed
  tetap membuat kartu Rp 0 setelah bulan berganti — itu harness basi, bukan aplikasi);
  `smoke-paket` kini menyelesaikan pemilih profil bisnis pada instalasi baru dan
  mengizinkan kunci pengaturan `hems_business_modes`. Dua balapan navigasi di harness
  (redirect rute awal menimpa hash `#/units`/`#/spareparts`) ditutup dengan menunggu
  `.sidebar-item.active` sebelum berpindah layar (`perf P.9b`, `compat A.7b`).
- **Paket (ditandatangani 17 Nov 14:08–14:11)**: `dist-app/win-unpacked/FATHONI.exe`
  177.026.440 B SHA-256 `dd790ef7…9f01b4b` (ProductVersion 3.1.0), `app.asar` 4.522.534 B
  SHA-256 `6cbdb3e7…c931ff5` (tidak berubah oleh signing); installer
  `dist-installer/FATHONI-Setup-3.1.0.exe` 83.166.464 B SHA-256 `4a49e2a6…ea39732`.
  Keduanya **TERSIGN** dengan sertifikat **internal** `CN=FATHONI EQUIPMENT OS,
  OU=Internal Code Signing` (thumbprint `2D4FAE84…B722DB`, timestamp DigiCert);
  `signtool verify /pa` lulus dan `Get-AuthenticodeSignature` = `Valid`. Ini **bukan**
  sertifikat CA publik — SmartScreen tetap muncul di mesin yang belum memasang
  `fathoni-internal.cer`. `smoke-paket` 28/0 diulang pada exe bertanda; rantai 1.502 di
  bawah diukur pada binari unsigned dengan `app.asar` identik, salinannya disimpan di
  `C:\tmp\riwayat\`.
- **Hasil rantai 2026-11-17** (`C:/tmp/regressi-310c.log`): 19 harness + audit,
  **1.502 assertion lulus, 0 gagal**, `rusak: tidak`, semua proses keluar bersih,
  `npm audit` 0 kerentanan (tinggi/kritis 0, sedang 0, rendah 0). Angka 1.502 =
  1.500 sebelumnya + `perf P.9b` + `compat A.7b`.
- **Batas**: tidak ada perubahan skema dan `DERIVED_REVISION` tetap 5; profil live
  `%APPDATA%\hems-heavy-equipment-system` tidak disentuh. Lintasan kapasitas 400.000 baris
  tidak diulang. Dua perbaikan harness sesudah pemaketan hanya mengubah `tests/`, tidak
  masuk `app.asar`, jadi bukti paket tetap berlaku. Biaya penjaga terukur: pada 100.000
  unit muat collection 265–465 ms + pemeriksaan 22 ms per tulisan; pada 12.000 unit P.23
  tetap di bawah 250 ms.

## Verdict

Bagian di bawah adalah catatan **rilis 3.0.5** (2026-10-13) dan tetap berlaku untuk paket
3.0.5 yang diedarkan; ia tidak diperbarui untuk rilis 3.1.0 di atas.
Rilis 3.0.5 terverifikasi pada mesin Windows ini, dan yang diuji adalah paket yang
diedarkan: `dist-app/win-unpacked` + `dist-installer/FATHONI-Setup-3.0.5.exe` (`app.asar`
4.511.034 byte; `FATHONI.exe` `FileVersion`/`ProductVersion` `3.0.5`, build 19:22;
installer 83.168.646 byte, ISCC 19:24, SHA-256 `f97e2b8c…11f56`, **TIDAK TERSIGN**).
Sumber berubah SESUDAH paket 3.0.4 dibangun — pemeriksaan ulang enam titik rantai
operasi→servis dan lima perbaikan tanpa skema di `src/` + `electron/` (QA_REPORT §4.23) —
jadi bukti 3.0.4 tidak dipinjam: versi dinaikkan, paket dibangun ulang, lalu rantai
diulang dari nol terhadap paket itu. Hasil: **19 langkah, 1.450 assertion, 0 gagal**
(`/tmp/rantai-305.log`; ringkasan per langkah di `tmp-harness/logs/<nama>.log`, `mtime`
19:26–19:29), `rusak: tidak`, `proses keluar tidak bersih: tidak`, dan `exit=` bernilai 0
di **setiap** langkah Electron (rantai tidak memanggil `npx`, QA_REPORT §4.12). `npm audit`
0 kerentanan (tinggi/kritis 0, sedang 0, rendah 0). Isi asar dibuktikan melekat pada paket
ini: string tab riwayat baru (`mutasi gudang tidak menyimpan nomor sasis`) ADA di
`app.asar`, dan lima nomor hiasan lama (`SPK-2025-012` dkk.) tidak lagi muncul satu pun
(0 kecocokan).

| Langkah | Assertion | vs 3.0.4 |
|---|---|---|
| migration | 49 | = |
| unit (`validation-check`) | 391 | +21 |
| auth (keamanan: sesi + akun) | 58 | = |
| otorisasi (tulis per peran) | 49 | = |
| gui (fungsional) | 73 | = |
| flow (fungsional) | 30 | = |
| handoff (integrasi lintas menu) | 176 | = |
| usable (usability + ukuran layar) | 42 | = |
| crud (CRUD + pencarian konsisten) | 32 | = |
| cetak (dokumen cetak runtime) | 73 | = |
| db (SQLite + paritas SQL) | 136 | = |
| integritas (atomisitas + rollback + hapus dirujuk) | 74 | = |
| compat (profil lama + mode browser) | 31 | = |
| perf (beban + stres) | 40 | = |
| tahan (ketahanan kanal/db + sesi panjang) | 32 | = |
| store (rencana tulis per collection) | 48 | = |
| backup (snapshot + restore) | 88 | = |
| paket (uji asap FATHONI.exe jadi) | 28 | = |
| audit dependensi | 0 kerentanan | = |
| **total assertion** | **1.450 lulus / 0 gagal** | **+21** |

**Keputusan pemakaian.** Pilot internal dengan paket 3.0.5 ini **boleh jalan** — semua
jalur yang dipakai sehari-hari (buat unit/PO/operator/pelanggan/pemasok/akun, mutasi
gudang, servis, invoice, kas, cetak 11 dokumen, ekspor CSV 5.000 baris) terbukti pada
paket jadi, dan profil live berisi 11 baris asli tanpa residu uji
(`%APPDATA%\hems-heavy-equipment-system\fathoni.db` tetap 716.800 byte, `mtime` 2026-10-10
18:07 — tidak satu pun langkah rantai/probe menulis ke sana). **Distribusi luas
masih ditahan**: binari `NotSigned` sehingga SmartScreen muncul di mesin pengguna dan
heuristik scanner eksternal masih bisa menuduh generik (1 dari 27 mesin menandai
sampel 3.0.2, AV triage belum diajukan). Yang belum diverifikasi sama sekali: macOS/Linux,
DPI selain 100%, dan printer lapangan tertentu (§6).

## Yang baru di 3.0.5 dan dibuktikan

- **Rantai operasi→servis→BBM→biaya→Dashboard diperiksa ulang, dan yang dilaporkan adalah
  angka, bukan keyakinan** (QA_REPORT §4.23). Alat ukurnya tersendiri:
  `scripts/ops-chain-probe.cjs` — sengaja TIDAK menjadi langkah rantai (ia tidak dibundel
  dan tidak masuk asar) — menghasilkan **60 lulus / 0 gagal / 6 temuan, `SELESAI kode=0`**
  terhadap sumber yang sama dengan paket ini, dan `validation-check` §38 (11) + §39 (10)
  menambahkan 21 assertion (370 → **391 lulus / 0 gagal**).
- **Pembacaan meter yang mundur ditolak di main process, bukan di layar**
  (`electron/main.ts` `meterMundurCacat` di dalam `db-patch`). Terbukur 6.1–6.1d: angka
  mundur ditolak dengan alasan yang terbaca, koreksi yang disertai alasan tetap diterima,
  kenaikan setelah koreksi tidak menghapus kolom lain, dan peran yang tidak berhak
  (Keuangan) ditolak saat mengubah meter — dengan jejak `DATA_DENY` di Audit Log (6.9) dan
  **file tidak berubah** (6.8).
- **Angka hiasan per unit di kartu Unit dibuang.** Kapasitas, daya, dan berat kini dibaca
  dari katalog Merek & Model (`specModel()`), dan spesifikasi yang tidak ada di katalog
  tidak dikarang (2.11/2.12). GPS, konsumsi BBM per unit, dan operator tetap dinyatakan
  apa adanya sebagai "belum tercatat".
- **Biaya kembar ditolak dua kali di dua tempat**: layar Kas menolak referensi + kategori +
  tipe yang sama sambil tetap menampilkan alasannya dan tidak menutup form (4.3/4.4), dan
  IPC `db-patch` menolak baris yang sama walau dipanggil langsung (4.7) — penjaganya bukan
  perhiasan renderer. Pembayaran dengan referensi dokumen lain tetap tersimpan (4.5), dan
  menyunting baris yang sudah ada tidak ikut ditolak (4.6).
- **Lima tab riwayat di kartu detail Unit tidak lagi memajang daftar fiktif dan tidak ada
  satu pun tombol `alert()` yang tersisa** (2.13–2.24; perintah user: *"amanankan alert()
  dulu tanpa skema"*). PERAWATAN dan SEWA membaca Work Order dan kontrak **unit ini** dari
  SQLite atas nomor sasis; SUKU CADANG, GARANSI, dan DOKUMEN mengucapkan keterbatasannya
  apa adanya (mutasi gudang tidak menyimpan sasis; masa berlaku garansi tidak disimpan di
  baris unit; menu Dokumen tidak punya kolom penaut per unit). Empat tombol pintas terbukti
  benar-benar berpindah ke menu tempat record itu dibuat, dengan unit + model terisi dan
  nomor dokumen diusulkan dari isi file (2.19–2.23), dan `window.__alerts` kosong
  sepanjang sequences (2.24).
- **Penjaganya dikalibrasi dengan mutasi data, bukan dengan keyakinan.** Menukar nomor
  sasis kontrak sewa membuat **tepat satu** assertion merah (`FAIL 2.14`); menukar teknisi
  pada Work Order membuat **tepat satu** merah (`FAIL 2.13`); masing-masing run 59/1/6 dan
  skrip probe dipulihkan byte-identik (sha256 `95ea71ea…`) — jadi tabel itu sungguh
  mengikuti database, bukan teks yang kebetulan cocok.
- **Temuan baru yang ditulis apa adanya (2.13b):** `completeService` tidak pernah menulis
  `actualCost` ke baris `services`. Biaya aktual hanya masuk Invoice dan Kas, sehingga
  kolom *Biaya (aktual / estimasi)* di kartu Unit selalu menampilkan **estimasi**. Ini
  perilaku yang sekarang didokumentasikan (Bab 5 panduan), bukan diperbaiki diam-diam.
- **Alur menu lain terbukti tidak ikut dirusak.** Sebelum packing, enam harness UI yang
  berhadapan dengan layar dijalankan berurutan, satu proses Electron pada satu waktu,
  masing-masing dengan profil `HEMS_DATA_DIR` sendiri: otorisasi 49, gui 73, flow 30,
  handoff 176, usable 42, crud 32 = **402 lulus / 0 gagal**; setelah packing, rantai penuh
  19 langkah diulang dari nol terhadap paket jadi (**1.450 lulus / 0 gagal**).
- **Dokumentasi disegarkan dari potret hari ini.** 26 panduan per menu + indeks dipotret
  ulang terhadap aplikasi berjalan (26 menu, 27 layar, 21 form, **0 gagal**) dan 27 PDF-nya
  dibangun ulang; `PANDUAN_PENGGUNA.html` + PDF (50 halaman / 3.471.228 byte) ikut dikoreksi
  di empat tempat yang berubah perilakunya dan pada satu klaim yang ternyata salah
  ("empat jendela form bergaya lama diperbaiki pada 3.0.5" — belum, jadi ditulis apa adanya).
  Lima janji "sasaran 3.0.5" dipindah menjadi **3.0.6**. Penjaga statis dijalankan ulang
  sesudahnya: tetap 391/0, dan tidak ada `src/` atau `electron/` yang berubah.
- **Yang TIDAK masuk 3.0.5 dan masih terbuka.** Enam temuan probe (1.1, 1.2, 3.4, 3.5, 5.5
  dan catatan jejak tulis) semuanya butuh perubahan skema — pasangan HM awal–akhir + layar
  pencatatan meter per hari, kolom unit/periode pada `purchases` untuk BBM, dan collection
  sejarah tulis — yang memaksa `DERIVED_REVISION` dan backfill `fathoni.db` live, jadi
  menunggu keputusan pemilik. Lima cacat bentuk form yang dulu dijanjikan untuk 3.0.5
  (§4.20: harga perolehan tidak bisa diketik, Simpan yang diam di dua halaman master,
  bawaan lokasi Gudang, empat jendela bergaya lama, lima `alert()` di jalur tulis lain)
  **tidak dikerjakan pada siklus ini** dan statusnya tetap *cacat yang diketahui dan
  didokumentasikan*.

## Yang baru di 3.0.4 dan dibuktikan

- **Merek & Model adalah data, bukan daftar di layar** (QA_REPORT §4.17). `brands` dan
  `models` menjadi collection SQLite (20 collection sekarang), halaman katalog
  menyimpan permanen — bertahan pindah menu, tutup aplikasi, dan ikut cadangan. Formulir
  Unit mengambil pilihan merek dari katalog itu, dengan fallback ke daftar bawaan selama
  katalognya masih kosong, jadi basis data lama tidak kehilangan kemampuan menyimpan.
  Penambahan ini non-destruktif: dua tabel kosong, `DERIVED_REVISION` tetap **5**, profil
  live tidak di-backfill. Penjaga: db-check 15.11, integritas 2d-katalog, otorisasi 1.10
  dan 4b, compat A.5b, validation §12b/§12c/§12d. Yang belum: lintasan runtime
  "ketik satu merek di halaman katalog lalu muncul di form Unit" (bukti saat ini lewat
  jalur hidrasi), dan kalibrasi mutasi per-assertion untuk penjaga statis baru itu.
- **Empat catatan "belum berfungsi" di panduan 3.0.3 ditutup** (QA_REPORT §4.18): tombol
  **View All** di Control Tower benar-benar membuka menunya — keempatnya ditekan di
  jendela sungguhan dan `location.hash` terbukti berpindah (handoff 6.8V1–6.8V4; id diganti
  dari 6.8e karena label itu sudah dipakai kartu riwayat passport — dua assertion dengan id
  sama membuat log rantai tidak bisa dibaca per baris); **Cetak Bukti** di Gudang
  mencetak formulir *Bukti Serah Terima Mutasi Barang* dengan tiga blok tanda tangan
  (sebelumnya hanya menampilkan nomor bukti dalam kotak dialog); **BPKB** tersedia sebagai
  jenis dokumen sendiri; dan ekspor **CSV Laporan menelusuri sampai 5.000 baris** halaman
  demi halaman, sementara cetak PDF sengaja tetap 500 baris dan satu kueri layar tetap
  dibatasi 500.
- **Alat ukurnya sendiri yang dikoreksi, bukan aplikasinya** (QA_REPORT §4.19). Rantai
  3.0.4 yang pertama jatuh di `perf` P.12b (`{"penuh":0,"sebagian":2,"baris":0}`): sejak
  R3 rute `/units` memang menghidrasi `brands` + `models`, sedangkan assertion lama
  menuntut *nol* panggilan subset. Profil perf kini di-seed 10 baris katalog sehingga
  P.12b menuntut delta baris **persis 10** — lebih ketat, bukan lebih longgar. Kalibrasi
  mutasi (`units: ['brands','models','units']`) menjatuhkannya dengan
  `baris: 12010, sebagian: 3, koleksi: 3` dan hanya menjatuhkan itu; sumber dipulihkan
  byte-per-byte, Paket diverifikasi ulang terhadap hasil build, lalu rantai penuh diulang
  dan hijau.
- **Panduan pemakai disapu habis** dan dibangun ulang PDF-nya (`PANDUAN_PENGGUNA.html` +
  `PANDUAN_PENGGUNA.pdf`, 33 halaman, 2.279.393 byte): setiap catatan yang dulu bilang "belum berfungsi"
  diberi versi kapan ia mulai berfungsi, dan yang masih belum berfungsi ditulis apa adanya
  — dua status Pengiriman yang tidak punya tombol, kolom operator↔rental yang ditunda ke
  3.0.5, dan tiga batas angka yang berbeda (500 kueri / 500 cetak / 5.000 CSV).
  Satu klaim lama ikut dikoreksi karena tidak sesuai angka kita sendiri: Bab 12 dan
  tabel syarat mesin dulu menulis "boot di bawah 2 detik" untuk 400.000 baris, padahal
  lintasan kapasitas 3.0.4 mengukur **4,3 detik** terhadap ambang 20 detik (±1 detik pada
  25.000 baris, RAM bebas 424 MB). Yang kini dijanjikan panduan adalah apa yang sungguh
  ditahan aplikasi — waktu boot tidak tumbuh mengikuti isi berkas karena boot tidak
  memindahkan baris — beserta angka nyatanya, bukan satu angka bundar yang nyaman.
  Bab 13 kemudian ditambahkan — **cara membuat record form demi form** mengikuti jendela
  yang benar-benar tampil (Unit, PO, Operator/Teknisi, Pelanggan/Pemasok, akun login,
  Merek & Model, Suku Cadang + mutasi Gudang, lalu tabel efek dokumen kerja ke menu lain)
  — dan penulisannya menemukan lima cacat yang belum pernah dicatat (QA_REPORT §4.20).
  Bab yang sama lalu diminta **bergambar**: pembaca memberi lima tangkapan layar sebagai
  contoh, dan sepuluh gambar sekarang menanam di §13.2–§13.8 (lima milik pembaca, lima
  potret sendiri dari instalasi baru lewat perkakas `scripts/panduan-gambar.cjs`), masing-
  masing dengan caption bernomor yang menyebut kolom dan tombol persis seperti di layar
  (QA_REPORT §4.21). PDF final: **48 halaman, 3.446.045 byte** — 33 halaman tanpa Bab 13,
  42 dengan teksnya, 48 setelah gambar ditanam, dan tetap 48 halaman (3.446.045 byte)
  setelah sisipan indeks per menu plus koreksi tab Cetak §5.22/§13.1/Bab 12.
- **Setiap menu kini punya panduannya sendiri** (permintaan *"Buat tiap menu panduan nya
  sendiri-sendiri"*; QA_REPORT §4.22). 26 berkas HTML + PDF di `panduan-menu/` plus satu
  indeks, disusun dari **DOM aplikasi yang benar-benar dijalankan** — bukan salinan kode —
  lewat `scripts/panduan-menu.cjs` (potret + buang DOM ke `data.json`) dan
  `scripts/panduan-menu-build.cjs` (susun berkas). Isi terukur: 27 layar, 21 jendela form,
  48 potret 1184×967 px, 175 kolom (62 wajib, 7 terisi otomatis), 21/21 form muat tanpa
  menggulir; 27 PDF = 118 halaman / 8,5 MB dengan 48 `/Subtype /Image`. Empat hal hanya
  kelihatan dari layar: tujuh menu tanpa `.page-title`, tujuh menu dengan kartu yang tidak
  terbaca judulnya, dua dropdown Pengaturan Cetak yang tidak terikat state apa pun, dan
  master Operator/Teknisi yang ternyata tidak dipakai satu form pun.

## Yang sudah terbukti (tetap terbukti di 3.0.5)

- **Siklus operasional awal–selesai satu cerita (Tahap 1, QA_REPORT §4.15).** Kategori
  pembelian (BBM/CONSUMABLE) bisa disimpan; aturan "servis berikutnya" hanya satu; servis
  selesai menaikkan `hourMeter` + `lastServiceHM`; pembacaan meter yang mundur wajib lewat
  prosedur koreksi; biaya per jam dan profitabilitas dihitung dari data; dan **tulis
  ditegakkan di main process** — token sesi + `WRITABLE_BY_ROLE`, `kas` untuk `FINANCE`,
  `approvals`/`operators` hanya `SUPERADMIN`. Katalog yang baru ikut aturan yang sama:
  hak tulis `brands`/`models` hanya untuk peran yang memegang menunya, dan penolakannya
  masuk Audit Log sebagai *Tulis data ditolak*.
- **Hapus yang masih dirujuk ditolak dengan alasan yang menyebut dokumennya** — termasuk
  merek yang masih dipakai model/unit dan model yang masih dipakai unit
  (`electron/referential.ts`); patch beracun di-rollback penuh dan file tetap sehat.
- **Ringan walau data tumbuh** (profil 12.000 unit dalam rantai 3.0.4): boot memindahkan
  **0 baris** lewat IPC walau profil uji berisi 25.010 baris; satu halaman unit = 0,1 %
  dari seluruh store; mencari di layar Unit median 228 ms (kueri telanjang 9 ms);
  berganti halaman 234 ms; tulis satu baris 1 ms. Membuka layar Unit di profil 12.000 unit
  hanya menggeser **10 baris katalog**, bukan armadanya; membuka Perawatan Sistem 0 baris.
- **400.000 baris diukur pada paket ini**, bukan diekstrapolasi dari 3.0.3: 100.000 unit +
  100.000 kas + 100.000 suku cadang + 100.000 invoice (berkas 233,17 MB) — membuka layar
  Armada 306 ms, pencarian median 324 ms dengan jumlah record sama persis dengan
  `COUNT(*)`, agregat `dbSum` kas 40 ms, tulis satu baris 1 ms, heap renderer tetap 10 MB.
  Boot ulang tercatat 4.253 ms (ambang P.37 20 s; mesin ini hanya 3,8 GB dan sedang di
  ~0,1 GB free saat diukur, jadi angka boot tunggal ini jangan dibaca sebagai tren).
- **Dokumen cetak dibuktikan sampai jendelanya**: `cetak-check` kini mengklik tombol cetak
  di **11** layar (sepuluh yang lama + Gudang) dan memeriksa jendela cetak sungguhan:
  isinya dokumen (bukan aplikasi), `print()` sekali dengan A4 + latar, jendela ditutup
  lagi, tanpa artefak `undefined`/`[object`, baris rusak hasil suntingan tangan tetap
  tercetak, skrip di dalam data tampil sebagai teks, jendela cetak tidak punya
  `electronAPI` dan CSP-nya `default-src 'none'`, dokumen > 1 MB ditolak dengan pesan.
  Untuk bukti Gudang, assertion C.9b menuntut formulir serah terima (judul, nomor
  transaksi, blok *Penerima Barang*, > 20 elemen) dan menuntut **tidak ada** `alert()`.
  Yang TIDAK dibuktikan: kertas keluar dari printer.
- **Membuka menu tidak lagi memuat seluruh database** (`/maintenance` nol kebutuhan;
  tombol "Muat data contoh" meminta hidrasi sendiri), dan **harness tidak lagi berbohong
  lewat efek samping** (`gui-check` tidak membajak browser pengguna; wait pager wajib
  `!/memuat/` — QA_REPORT §4.13).
- **Aman**: akun ter-hash di main process, balasan login tanpa kredensial, lockout 5x,
  CSP + sandbox, CSV meng-escape dan menahan injeksi formula, uji asap paket berjalan di
  sandbox dan membuktikan profil nyata tidak berubah. **Profil live tetap utuh** sepanjang
  siklus 3.0.4: `%APPDATA%\hems-heavy-equipment-system\fathoni.db` 716.800 byte,
  mtime 2026-10-10 18:07, tanpa `-wal`/`-shm` sisa.
- **Naik versi tidak merusak**: profil lama membangun kembali kolom turunannya; mode
  browser tanpa `electronAPI` tetap terbuka dengan penanda demo dan nol error renderer;
  upgrade instalasi menimpa berkas program saja.
- **Paket**: asar hanya berisi `dist`, `dist-electron`, `better-sqlite3`; ikon + metadata
  merek exe lewat `scripts/apply-exe-branding.cjs` (`signAndEditExecutable` tetap false);
  versi hanya dari `package.json`; `build-installer.ps1` punya jalur signing opsional
  (`HEMS_SIGN_PFX`) yang tanpa sertifikat mencetak `LEWAT sign` dan melaporkan paket apa
  adanya sebagai TIDAK TERSIGN (QA_REPORT §4.14). Halaman Finish tidak mencentang
  "jalankan aplikasi". `2.0.0`/`3.0.0`/`3.0.1`/`3.0.2`/`3.0.3`/`3.0.4` dibiarkan utuh di
  `dist-installer/` — hanya 3.0.5 yang layak edar.

## Yang belum terbukti (jangan dinyatakan lulus)

macOS/Linux · scaling DPI dan ukuran layar lain · kertas keluar dari printer sejati
(`print()` hanya dibuktikan dipanggil dengan opsi yang benar) · perangkat keras lapangan ·
**tanda tangan kode** — plumbing-nya ada, sertifikatnya belum dibeli, semua binari kita
`NotSigned`, jadi SmartScreen akan memperingatkan · **penjelasan verdict antivirus
eksternal** — satu dari 27 mesin (Filseclab) menuduh generik pada sampel yang ternyata
`FATHONI-Setup-3.0.2.exe`; 3.0.3, 3.0.4, dan 3.0.5 belum pernah discan dan tidak ada tinjauan
false-positive yang diajukan · penerimaan alur kerja oleh pemakai sebenarnya (walkthrough
installer sudah dikerjakan manual dan direkam, §4.16; usability kerja belum) · lebih dari
400.000 baris (dan khususnya biaya `LIKE '%token%'` yang linear di atas jumlah itu) ·
anggaran performa yang masih dilonggarkan · **bukti P.12b untuk katalog besar**: delta
dibatasi "≤ 2 koleksi" dan profil perf hanya punya 10 baris katalog, jadi katalog berisi
ribuan model belum diukur waktu buka halaman Unit-nya.

## Yang menunggu keputusan

1. **Sertifikat code signing (OV vs EV)** — pembelian + organisasi; tanpa itu distribusi
   luas tetap memunculkan peringatan SmartScreen, dan heuristik scanner eksternal punya
   celah untuk menuduh generik (QA_REPORT §6). Alternatif tanpa beli: kirim sampel ke
   tinjauan false-positive masing-masing vendor — itu tidak menghilangkan `NotSigned`.
2. **Layar Rental dibuka pada mode Timeline**, yang tidak punya tombol cetak — harness
   harus memindahkan ke "📊 Tabel" dulu (masih sama di 3.0.5; tercatat sebagai CATATAN
   cetak-check). Ubah bawaan ke Tabel, atau tambahkan cetak di Timeline? Keputusan tata
   letak, bukan bug.
3. **Operator ↔ kontrak rental** — **masih ditunda** (dulu "ditunda ke 3.0.5", 2026-10-12;
   3.0.5 dipakai untuk pemeriksaan ulang rantai operasi dan lima perbaikan tanpa skema).
   `rentals` tidak menyimpan identitas operator sama sekali (hanya `operatorIncluded`
   Ya/Tidak), jadi menahannya menambah kolom/blob baru → `DERIVED_REVISION` 5→6 + backfill
   profil live, yang memerlukan izin eksplisit. 3.0.5 sengaja tidak menyentuh skema turunan.
4. **Dua status Pengiriman tanpa tombol** (<i>Tiba di Lokasi</i>, <i>Dibatalkan</i>) —
   ada di peta status tetapi tidak bisa dicapai dari layar (§5.15 panduan). Menambah
   tombolnya berarti menambah aksi tulis `deliveries` + efek status; belum disepakati.
5. **Prisma tidak dipakai** (~111 MB) — penghapusan butuh persetujuan.
6. **`installer.iss` di root** — duplikat basi dari installer resmi (`Source` menunjuk
   folder yang ditinggalkan, `AppVersion "1.0.0"`); sudah dijaga agar tidak mungkin ikut
   ter-build (validation 14). Menghapusnya tetap keputusan pengguna.
7. **Artefak lama** — `HEMS-Setup-*.exe`, `FATHONI-Setup-2.0.0 … 3.0.3.exe`, dan
   `dist-electron-portable` (156 MB, `app.asar` terkunci proses).
8. **Amaran loading di `Pager.tsx`** — selama debounce 200 ms dan kueri pertama belum
   kembali, `total` masih 0 sehingga penanda halaman berbunyi **"Tidak ada record ·
   memuat..."** (QA_REPORT §4.13). Sisinya yang bisa diperbaiki tanpa menyentuh paket sudah
   diperbaiki (harness + penjaga validation 28); memperbaiki teksnya adalah perubahan
   `src/` yang membatalkan bukti paket — jadi ia menunggu rilis berikutnya (3.0.6).

9. **Lima temuan Bab 13 panduan — kandidat rilis berikutnya** (QA_REPORT §4.20; semuanya
   diverifikasi dari sumber, tidak satu pun diperbaiki pada 3.0.5 karena siklus itu dipakai
   untuk pemeriksaan ulang rantai operasi→servis→BBM→biaya→Dashboard):
   **(a)** `purchasePrice` unit tidak ditanyakan form dan tidak bisa diubah dari layar —
   setiap unit baru Rp 1.750.000.000 dan angka itu mengalir ke Passport, Laporan, dan biaya
   per jam (`Units.tsx:289`), sementara validasi range-nya (`Units.tsx:415`) bisa menolak
   simpan tanpa kolom yang bisa diperbaiki; **(b)** `Suppliers.tsx:31` dan `Customers.tsx:31`
   menolak simpan nama kosong **tanpa pesan apa pun**; **(c)** bawaan `warehouseName`
   `Warehouse.tsx:61` bukan salah satu dari empat opsi dropdown (`:30–35`) — dan karena
   `<select>` tidak punya opsi yang cocok, layar menampilkan opsi pertama sementara nilai
   pendek itulah yang tersimpan: yang dilihat ≠ yang disimpan, terbukti pada Gambar 13-10
   (§4.21);
   **(d)** empat jendela lama (`Operators.tsx:411`, `Technicians.tsx:450`, `Breakdown.tsx:640`,
   `Approvals.tsx:436`) memakai `.modal-content` yang tidak ada di stylesheet sehingga
   kolomnya putih di atas jendela gelap, dan label `Telepon *` tidak menahan kosong
   (`validation.ts:269`) — plus tidak ada pemeriksaan duplikat NIK/NPWP/nama perusahaan;
   **(e)** lima jalur tulis masih `alert` alih-alih pesan inline (`SpareParts.tsx:130`,
   `Warehouse.tsx:176`, `Delivery.tsx:66`, `Finance.tsx:91`, `Documents.tsx:68`).
   Dua butir tambahan muncul dari panduan per menu (§4.22): **(f)** master Operator dan
   Teknisi tidak dipakai satu form pun — nama teknisi/operator selalu teks bebas
   (`Service.tsx:747`, `Breakdown.tsx:240`) dan Rental hanya punya kotak centang, jadi
   menautkannya butuh kolom baru; **(g)** dua dropdown tab Pengaturan Cetak
   (`Settings.tsx`, tab `print`) dirender tanpa `value`/`onChange` sehingga pilihan kertas
   dan orientasi tidak tersimpan dan tidak dipakai dokumen mana pun.
   (a)–(d), (f), (g) adalah perubahan perilaku/layar; (e) kosmetik-ke-perhatian.

Yang sudah selesai dan tidak lagi menunggu keputusan: **`auto-fix.ps1` di root**. Versi
lamanya menghapus `dist*`, `node_modules`, `package-lock.json` dan menjalankan
`git reset --hard`/`git clean -fd` tanpa konfirmasi. Kini ia **PREFLIGHT**: 21 pemeriksaan
baca-saja (node/npm, nama lockfile vs `package.json`, versi Electron, drift `.npmrc`,
probe native sungguhan yang men-load `better-sqlite3` di dalam Electron, kesegaran
`dist`/`dist-electron`/`app.asar`/installer, RAM, `NODE_OPTIONS`, proses Electron nyasar,
status git), keluar kode 1 hanya kalau ada FAIL, dan satu-satunya tindakan tulis terjadi di
balik `-Apply`. Bentuk destruktifnya dikunci validation §27, dan BOM UTF-8
`auto-fix.ps1` + `build-installer.ps1` ikut dijaga — tanpa BOM, PowerShell 5.1 membaca
em-dash sebagai cp1252 dan skrip build mati dengan error parse yang terlihat tidak
berhubungan (QA_REPORT §4.11).

## Jalur reproduksi

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File auto-fix.ps1   # PREFLIGHT baca-saja, 21 pemeriksaan
npm run build && npm run build:electron
npm run make:installer                         # paket win-unpacked + FATHONI-Setup-<versi>.exe
sh tests/harness/regressi.sh                                  # 19 langkah, terhadap paket jadi
HEMS_PERF_KAPASITAS=1 node_modules/electron/dist/electron.exe tests/harness/perf-check.cjs # kapasitas 400.000 baris
```

Satu instance Electron per jalan; harness profil memakai
`HEMS_DATA_DIR=D:/SANY/tmp-harness/r-<nama>` (paket: `--user-data-dir`); `cetak-check`,
`db-check`, `compat-check`, `perf-check` membuat foldernya sendiri (`mkdtemp`). Rantai
memanggil `node_modules/electron/dist/electron.exe` langsung — `npx electron` pernah
membuat rantai tampak rusak padahal 72 assertion lulus, karena pembungkus npm-nya mati
tidak bersih setelah hasil tercetak.
