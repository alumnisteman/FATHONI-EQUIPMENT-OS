# FATHONI EQUIPMENT OS — Laporan QA
**Versi aplikasi**: 3.0.2 (nama paket `hems-heavy-equipment-system`, dipertahankan sebagai kunci data — lihat §7)
**Tanggal laporan**: 2026-10-11
**Status**: Rilis terverifikasi. Rantai regresi penuh hijau dijalankan setelah paket
**3.0.2** dibangun (bukan jalur dev): 16 langkah, 1.175 assertion, 0 gagal, `rusak: tidak`,
`proses keluar tidak bersih: tidak` — untuk pertama kalinya **setiap** langkah Electron
juga keluar dengan kode 0, karena rantai tidak lagi memanggil Electron lewat `npx`
(§4.12). Rantai terakhir dijalankan terhadap paket yang sama: `rantai-302i.log`;
`npm audit` 0 kerentanan tinggi/kritis. Langkah
terakhir rantai (`smoke-paket`) menguji `FATHONI.exe` HASIL PAKET; harness lain menguji
`dist/` + `dist-electron/` yang dibundel ke dalam asar paket itu — dibuktikan dengan mengekstrak
`app.asar` ke folder sementara lalu `diff -r`: `dist/` dan `dist-electron/` di dalam paket
IDENTIK byte-for-byte dengan hasil build sumber hari ini. Bukti itu diulang setelah
pekerjaan #61/#62 (hanya berkas harness + skrip root yang berubah, tidak ada satu byte
pun di `src/` atau `electron/`), dan hasilnya masih identik: versi tetap 3.0.2, paket
tetap layak edar tanpa dibangun ulang.

Laporan ini menggantikan laporan 2026-09-23 (HEMS 1.0.0). Laporan lama itu sudah tidak
berlaku dan sengaja ditulis ulang, bukan ditambal: ia menyebut localStorage sebagai
lapisan penyimpanan, "no automated tests", dan Breakdown / Operator / Teknisi /
Approval / Audit Log sebagai "belum diimplementasikan" — semuanya sudah tidak benar.
Matriks rinci tiap assertion ada di `tests/harness/README.md`; dokumen ini ringkasannya.

---

## 1. Yang berubah sejak laporan 1.0.0

| Aspek | 1.0.0 (laporan lama) | 3.0.2 (hari ini) |
|---|---|---|
| Penyimpanan | `localStorage` (hems_*), kuota ~5 MB | SQLite (`fathoni.db`, better-sqlite3 11.10.0, WAL) di main process; 18 collection |
| Akses data | seluruh store disalin ke renderer saat boot | halaman besar query berpaginasi (`MAX_PAGE_LIMIT` 500); boot memindahkan **0 baris** lewat IPC |
| Akun & login | kredensial di sisi renderer | hash+salt di main process, token sesi, wajib ganti password, lockout 5x salah, `accounts.json` tanpa plaintext |
| Tulis data | `setX(wholeArray)` | jalur per-baris (`dbPatch`: upsert/removeIds) + aturan rujukan saat hapus; simpanan penuh hanya kalau collection terbukti terdimuat penuh |
| Pengujian | manual saja | 15 harness otomatis + audit dependensi, dijalankan berurutan oleh `tests/harness/regressi.sh`; uji kapasitas 400.000 baris menyala terpisah dengan `HEMS_PERF_KAPASITAS=1` |
| Paket | `HEMS-Setup-1.0.0.exe` 92,8 MB, ikon bawaan | `FATHONI-Setup-3.0.2.exe` 79,3 MiB, ikon exe sendiri, asar ramping (hanya `dist`, `dist-electron`, `better-sqlite3`); jalur signing opsional sudah ada di `build-installer.ps1` tapi sertifikat belum dibeli (§6) |

**Kenapa 3.0.2 dan bukan 3.0.1.** Paket 3.0.1 dibangun 2026-10-11 09:59 dan saat itu
rantainya hijau. Sesudah paket itu dibangun, lima hal masuk ke sumber: #77 (menu
Perawatan Sistem tidak lagi menghidrasi seluruh collection), #78 (`cetak-check` — dokumen
cetak dibuktikan runtime, dan dari sanalah cacat #10 di §4 ditemukan serta ditutup),
#79 (lintasan kapasitas 400.000 baris), #80 (plumbing signing di skrip build), plus
perapihan dua penjaga harness (§5). Aturan yang dipakai laporan ini sejak 3.0.0:
**bukti rilis adalah rantai yang dijalankan terhadap paket yang diedarkan** — begitu
sumber berubah setelah pemaketan, bukti lama tidak berlaku lagi. Jadi versi dinaikkan,
paket + installer dibangun ulang (`dist-app/win-unpacked` + `dist-installer/FATHONI-Setup-3.0.2.exe`,
build 2026-10-11 12:44), lalu rantai diulang dari nol: 16 langkah, 1.165 assertion, 0 gagal.
`FileVersion`/`ProductVersion` pada `FATHONI.exe` 3.0.2 dan manifest di dalam `app.asar`
berbunyi `3.0.2`; artefak 2.0.0/3.0.0/3.0.1 dibiarkan utuh di `dist-installer/` sebagai
catatan sejarah — hanya 3.0.2 yang layak edar.

**Siklus sesudah 3.0.2 (penutup #61 dan #62) tidak menaikkan versi, dan itu keputusan
yang ada alasannya.** Yang berubah hanya berkas harness (`tests/harness/*`) dan skrip
root (`auto-fix.ps1`, BOM pada `build-installer.ps1`): tidak satu byte pun di `src/`
atau `electron/`. Isi `app.asar` kemudian dibandingkan lagi dengan hasil build sumber
(`@electron/asar` `extractAll` ke folder sementara, lalu `diff -r` kedua folder) dan
keluar identik — jadi paket 3.0.2 hari ini masih paket yang sama dengan yang diuji, dan
naik versi hanya akan mengaburkan fakta itu. Yang berubah adalah **cara bukti dihasilkan**:
rantai kini memanggil `electron.exe` langsung, `validation-check` bertambah sepuluh
penjaga (291 ketika rantai dijalankan, 293 setelah dua penjaga `.iss` menyusul), dan satu
skrip di root yang sebelumnya bisa memusnahkan paket + kunci build sekarang menjadi
preflight non-destruktif (§4.11, §5). Siklus berikutnya (§4.13) juga hanya menyentuh
`tests/harness/`: `gui-check` tidak lagi membuka browser sungguhan di desktop manusia dan
dua wait `handoff-check` tidak lagi membaca keadaan loading sebagai data, plus empat
penjaga baru di unit (297). Rantai penuh sesudah itu: **16 langkah, 1.170 assertion,
0 gagal** (`rantai-302h.log`), dan `app.asar` paket dibandingkan ulang dengan hasil build
sumber — tetap identik, jadi 3.0.2 masih versi yang dibuktikan.

Siklus setelahnya (§4.14) juga tidak menyentuh `src/` atau `electron/`: yang berubah adalah
`build-installer.ps1` (jalur signing diberi preflight + diagnostik kegagalan) dan lima
penjaga baru di `validation-check` §29 yang mengunci bentuk jalur itu. Unit jadi **302**,
rantai penuh diulang: **16 langkah, 1.175 assertion, 0 gagal** (`rantai-302i.log`).
`app.asar` paket 3.0.2 tidak dibangun ulang — `build-installer.ps1` tidak ikut terbundel
ke asar, jadi bukti paket lama tetap berlaku dan versi tetap 3.0.2.

Sejarah kenaikan 3.0.1: artefak `FATHONI-Setup-3.0.0.exe` dibangun
2026-10-10 23:20, sebelum empat perbaikan terakhir: #71 (nomor dokumen bersumber dari
SQLite), #72 (field array pada baris cetak), #73 (urutan sidebar mengikuti siklus
proyek), #75 (satu daftar menu untuk palette dan pencarian topbar). Paket lama tidak
bisa dinyatakan lulus untuk perbaikan yang tidak ada di dalamnya, jadi versi dinaikkan
lalu seluruh rantai — termasuk uji asap paket — dijalankan ulang terhadap paket baru;
pola yang sama berulang untuk 3.0.2 di atas.

## 2. Matriks jenis pengujian

Angka diambil dari `D:/SANY/tmp-harness/logs/<nama>.log` pada rantai 2026-10-11
terakhir (`tmp-harness/logs/rantai-302i.log`, dijalankan setelah jalur signing diukur di
§4.14): 16 langkah, 1.175 assertion, `rusak: tidak`, dan **setiap langkah
Electron keluar dengan kode 0** — bukan hanya "penanda bilang nol".

| Jenis | Harness | Assertion | Yang dibuktikan |
|---|---|---|---|
| **Unit** | `validation-check` | 302 | aturan batas validator, sanitasi, `matchesQuery` (termasuk "SANY SY215C" dua kolom), checksum pemulihan, usulan nomor dokumen (`nomorBerikut`), sinkron daftar menu antar jalan masuk (§4.8), peta hidrasi per rute (§4.9), + penjaga statis (§5), termasuk empat penjaga bentuk-kode terbaru (§5), dua penjaga cara harness menunggu/membuka jendela (§4.13), dan lima penjaga bentuk jalur signing (`build-installer.ps1`, §4.14) |
| **Unit (lapisan data)** | `migration-check`, `db-store-run`, `db-backup-run` | 49 + 47 + 87 | migrasi sekali dari arsip lama, rencana tulis per collection, atomisitas simpan sebagian, snapshot |
| **Fungsional** | `gui-check`, `flow-check`, `usable-check`, `cetak-check` | 73 + 30 + 37 + 67 | tiap layar membuka, mengisi, mencari, memfilter, menyimpan; semua 30 entri rute di `App.tsx` (termasuk wildcard halaman detail) dilewati minimal satu harness — dijaga validation 16; tiga pintu masuk menu (sidebar, cari di topbar, Ctrl+K) menawarkan daftar yang sama dan sama-sama tergerbang profil/peran — usable 7.1–7.4; **sepuluh dokumen cetak benar-benar diklik** dan isi jendela cetak dibandingkan dengan aplikasi aslinya (cetak 1–9, §4.10); tautan luar diblokir sebagai jendela Electron **dan** URL-nya tercatat diserahkan ke browser sistem (gui 8.1 + 8.1b), tanpa ada browser yang benar-benar terbuka lagi (§4.13) |
| **Integrasi (lintas menu)** | `handoff-check` | 123 | Pembelian→Gudang/Unit/Pemasok/Kas, Servis→Part/Invoice/Kas, Invoice→Kas, 6 menu katalog menghapus lewat patch (§4.1), dan hapus teknisi/operator yang masih disebut dokumen ditolak dari tombolnya sendiri (§4.6), plus usulan nomor dokumen yang benar-benar diklik di layanannya (§4.7); dibaca hanya setelah penanda halaman benar-benar selesai, bukan saat masih "memuat" (§4.13) |
| **Integritas & transaksi** | `db-check`, `integritas-check` | 136 + 68 | paritas SQL vs `matchesWhere`, `where` pada kunci `id`, rujukan saat hapus termasuk aturan ber-blob untuk orang, rollback penuh saat patch beracun, file tetap sehat setelah dibuka ulang |
| **Keamanan** | `auth-check`, `cetak-check`, `npm audit` | 58 + (cetak 10–15) + 0 kerentanan | balasan login tanpa password/hash/salt, pesan generik, lockout, sesi palsu ditolak, CSP/sandbox/izin, injeksi formula CSV ditahan; jendela cetak diuji berdiri sendiri: CSP `default-src 'none'`, TIDAK ada `electronAPI` (tanpa preload), skrip di dalam data ditampilkan sebagai teks, dan dokumen kosong/bukan string/1,1 MB ditolak main process tanpa membuka jendela |
| **Performa (beban + stres)** | `perf-check` | 40 + 55 (lintasan kapasitas) | angka di §3 dan §3.1: rantai dasar sampai 50.000 baris, lalu 400.000 baris (100.000 per collection besar) dengan `HEMS_PERF_KAPASITAS=1` |
| **Kompatibilitas** | `compat-check`, `usable-check`, `smoke-paket` | 30 + (ukuran) + 28 | boot di profil lama hasil upgrade (kolom turunan dibuat + dihitung ulang), mode browser tanpa `electronAPI` (login demo, nol error renderer), jendela 1200 px tanpa pemotongan tabel, paket jadi FATHONI.exe di sandbox |
| **Regresi** | `regressi.sh` | 16 langkah | seluruh rantai di atas dijalankan berurutan; hasil dibaca dari penanda `SELESAI kode=N` milik harness, dan rantai memanggil `node_modules/electron/dist/electron.exe` langsung — bukan lewat `npx`, yang dulu menyisakan proses pembungkus tempat kode keluar bisa mati tidak bersih setelah semua assertion lulus (§5) |

## 3. Kapasitas: berapa banyak record yang tahan

Terukur di mesin ini (RAM 3,8 GB) pada profil uji terisolasi, mode WAL. Semua angka di
bawah dari rantai 2026-10-11 (`perf-check` jalur default, 40 assertion lulus):

| Titik ukur | Hasil |
|---|---|
| Boot pada profil 25.000 baris | proses sampai layar login siap **1.560 ms**, `domContentLoaded` **364 ms**, **0 baris** pindah lewat IPC |
| Membuka layar Unit di 12.000 unit | terisi dari SQLite, **0 baris store** lewat IPC sejak login |
| Kueri telanjang dari renderer, 12.000 baris | median **7 ms** |
| Agregat berindeks di 6.000 baris kas (`dbSum`) | median **1 ms**, KPI dihitung SQLite |
| Tulis satu baris lewat `dbPatch` | median **1 ms** |
| Simpan 50.000 unit dari main process | **1.178 ms** (membekukan event loop selama itu — tercatat, bukan tanpa batas) |
| Simpan ulang 50.000 unit dengan 10 baris berubah | 282 ms, dan hanya 10 baris yang benar-benar ditulis (db-check 7.3) |
| Pencarian di layar Unit, 12.000 baris | median **229 ms** (debounce 200 ms termasuk) |
| Pencarian di layar Unit, 50.000 baris | median **284 ms** — tumbuh 1,2x untuk data 4x |
| Kueri telanjang di 50.000 baris | median **91 ms** |
| Berganti halaman | median **230 ms** |
| Ukuran DOM tabel | tetap **12 kartu** saat tabel tumbuh ke 50.000 baris |
| Memori | heap JS renderer **10 MB**, working set 173–175 MB per proses |
| Total baris profil uji | 63.000 di seluruh 18 collection, berkas **44,71 MB** |

Tabel di atas adalah angka dari jalan dengan kepala RAM longgar. Rantai ulang terakhir
(`rantai-302e.log`, dijalankan ketika RAM tinggal ±0,3 GB) mencetak 40 assertion tetap
lulus dengan waktu yang berbeda: boot proses 1.872 ms, `domContentLoaded` 350 ms, cari
12.000 baris median 251 ms, kueri telanjang 22 ms, berganti halaman 240 ms, tulis satu
baris 1 ms, `saveStore` 50.000 unit 1.937 ms, dan cari pada 50.000 baris 639 ms (vs 284 ms
di jalan ringan). Selisih terbesar persis di titik yang paling sensitif beban mesin —
pembacaan `LIKE '%token%'` di 50.000 blob ketika Windows sedang kehabisan halaman memori. Dua hal yang
tidak berubah di antara dua jalan itu: **angka klaimnya** (DOM tetap 12 kartu, 0 baris
lewat IPC, jumlah record sama dengan `COUNT(*)`, tulis tetap satu baris) dan
**status hijaunya**. Inilah alasan ambang §4 lama ("simpan ulang harus >2x lebih cepat dari
simpan penuh") sudah diganti menjadi klaim bentuk (`inserted: 0, updated: 10, deleted: 0`):
yang ingin ditahan adalah sifat arsitekturnya, bukan waktu dinding yang bergantung pada
mesin lain pada jam yang sama. Angka kapasitas §3.1 berasal dari lintasan terpisah pada
mesin yang sama dan belum diulang di bawah tekanan RAM ini.

Satu kejadian tercatat supaya tidak terlihat seperti regresi aplikasi: rantai
`rantai-302g.log` mencetak **db-check 7.2 FAIL (pencarian 50.000 baris = 3.462 ms,
anggaran 1.000 ms)** — dan hanya itu, 15 langkah lainnya hijau. Penyebabnya bukan kode:
saya menyangka rantai pertama sudah berhenti karena batas waktu satu perintah, lalu
menjalankan rantai kedua untuk langkah yang tersisa, sehingga **dua rantai Electron
berjalan bersamaan** di mesin 3,8 GB ini — justru keadaan yang dilarang README dan
`regressi.sh` di baris pertamanya. Rantai bersih sesudah itu (`rantai-302h.log`, satu
proses, RAM longgar) mengukur titik yang sama: **162 ms** pencarian, simpan 50.000 unit
1.276 ms, ubah-10-baris 269 ms, agregat 25 ms. Angka 3.462 ms itu karena itu dibiarkan
tertinggal di log sebagai catatan apa adanya — tidak ada ambang yang dilonggarkan, dan
`7.2` tetap 1.000 ms.

### 3.1 Kapasitas teruji sampai 400.000 baris (100.000 per collection besar)

Pertanyaan "kuat tampung berapa banyak, dan tetap ringan?" dijawab dengan lintasan
kapasitas `perf-check` bagian 11 — dijalankan dengan `HEMS_PERF_KAPASITAS=1` karena ianya
menulis 400.000 baris dan memakan ±2 menit, sedangkan rantai regresi harus tetap cepat.
profil: 100.000 unit + 100.000 kas + 100.000 suku cadang + 100.000 invoice.

| Titik ukur pada 400.000 baris | Hasil |
|---|---|
| Ukuran berkas `fathoni.db` | **233,12 MB** (±600 byte per baris), WAL, `integrity` lulus, `totalRows` 400.000 |
| Boot aplikasi | **966 ms** — tidak tumbuh mengikuti isi berkas, karena boot tidak memindahkan baris (`reads.rows` 0 lewat IPC) |
| Membuka layar Armada di 100.000 unit | **475 ms**, DOM tetap 12 kartu, **0 baris store** lewat IPC |
| Kueri pencarian pertama sesudah boot (LIKE di 100.000 blob) | **380 ms**, jumlah record benar (20.000) |
| Pencarian di layar pada 100.000 unit | 402–739 ms per kueri; lintasan kedua median **406 ms**; jumlah yang tampil **sama persis** dengan `COUNT(*)` SQLite untuk kueri yang sama (P.39) |
| Kueri telanjang (`dbQuery`) median | **217 ms** |
| Agregat KPI kas di 100.000 baris (`dbSum`) | median **69 ms**, nilainya sama dengan `sumCollection` di main process |
| Menyimpan SATU baris di profil 400.000 baris (`dbPatch`) | median **1 ms**, dan nilainya terbaca kembali dari berkas |
| Menulis 400.000 baris sekaligus dari main process | **31,8 s** (rentang tiga lintasan 16,6–37,3 s) — membekukan event loop selama itu |
| Memori | heap JS renderer **10 MB**, working set 146–191 MB per proses — tidak bertambah saat berkas tumbuh dari 44 MB ke 233 MB |
| Total waktu rantai + uji kapasitas | 92 s; 55 assertion lulus, 0 gagal |

Jawaban praktis: **400.000 baris teruji dan tetap ringan** untuk pemakaian sehari-hari
(buka layar, cari, agregat KPI, simpan satu baris). Yang berubah drastis di atas 50.000
hanya satu hal: simpanan collection penuh dari main process (impor massal / restore)
menjadi puluhan detik dan membekukan aplikasi selama itu. Selain itu, batas nyatanya
adalah (a) satu hal yang tidak diukur harness ini — pencarian `LIKE '%token%'` memindai
blob pencarian dan tidak bisa memakai indeks, jadi biayanya linear terhadap jumlah baris
(terukur 0,2–0,7 s pada 100.000 unit di mesin ini; pada juta baris angka yang sama
menjadi detik-menit dan itu titik pertama yang harus diubah, misal dengan FTS5), dan
(b) RAM disk/OS untuk membaca halaman berkas pada sentuhan pertama.

## 4. Cacat yang ditemukan dan ditutup siklus terakhir

1. **Hapus di 6 menu katalog menulis ulang seluruh collection.** Operator, Teknisi,
   Dokumen, Pengiriman, Breakdown, Persetujuan menghapus dengan
   `setX(array.filter(...))`. Tampilannya sama, tapi pemeriksaan rujukan di main
   process tidak pernah dipanggil — PO/WO/SPK turunan bisa ikut hilang tanpa ditanya.
   Sekarang satu id lewat `removeRow`. *Bukti*: handoff 10.1–10.12, termasuk delta
   `stats().writes` yang dilihat dari dalam aplikasi (`removeIds: 1`, `fullCalls: 0`).
2. **Satu layar yang melempar membekukan semua menu.** `ErrorBoundary` hanya ada di
   akar; setelah tiga percobaan pulih otomatis, seluruh aplikasi menampilkan
   "Terjadi Kesalahan" sampai dimuat ulang. Inilah bentuk "aplikasi macet" yang paling
   sering dilaporkan. Boundary kini dipasang per rute (`key = pathname`).
   *Bukti*: validation 20 (statis) dan handoff 10.14 (runtime).
3. **Nilai di luar peta status menjatuhkan layar.** 21 titik membaca
   `MAP[nilai].label|badge|icon` tanpa fallback. *Bukti*: handoff 10.14 memakai
   `severity: 'MEDIUM'` + `status: 'ESCALATED'` — sebelum perbaikan layar Breakdown
   jatuh, sesudahnya barisnya tampil apa adanya. *Penjaga*: validation 21 untuk
   seluruh `src/`.
4. **Baris tanpa kolom angka/array meruntuhkan tabel.** Kolom INTEGER/REAL kembali
   sebagai `null` bila field tidak ada (data lama, impor, restore); sel tabel memanggil
   `.toLocaleString()`/`.slice()` langsung. 12 titik diberi `??`. *Bukti*: handoff 10.16
   gagal sebelum perbaikan (`layarKosong: ["operators","technicians"]`) dan lulus
   sesudahnya. *Penjaga*: validation 22. Perluasannya (#72): field **array** dari baris
   (`certifications`, `partsUsed`, `specializations`, `skills`, `compatibleModels`,
   `photos`, `items`, `serviceRecords`, `categories`, `models`) tidak boleh dibaca
   langsung sama sekali. Pemeriksaan `item.X && item.X.length > 0` yang dipakai tiga
   template cetak tidak menahan string — cadangan yang disunting tangan bisa
   menyimpannya sebagai teks, `length > 0` lolos, lalu `.map` melempar di layar cetak
   dan menjatuhkan rute itu. Tiga template kini menormalkan lebih dulu
   (`Array.isArray(item.X) ? item.X : []`), dan validation 24 menolak bentuk baca
   langsung di seluruh `src/`.
5. **Dua cacat yang hanya terlihat pada paket jadi** (ditemukan uji asap 3.0.0):
   `healthCheck` masih menulis probe ke `localStorage` dan menutup kegagalan file basis
   data dengan status "localStorage bisa ditulis"; serta tidak ada cara aman menguji
   paket — uji pertama diam-diam memakai profil nyata (password admin berubah, jejak
   audit bertambah; sudah dikembalikan dari snapshot). Sekarang `--user-data-dir`
   dihormati saat packaged dan uji asap membandingkan profil nyata sebelum/sesudah.
6. **Menghapus teknisi atau operator yang masih bekerja lolos tanpa pesan.** Keduanya
   tidak punya aturan rujukan sama sekali, dan nama orang tidak disimpan sebagai kolom
   turunan di dokumen anak (`mechanicName`, `assignedTechnician`, `driverName` hanya
   ada di payload dan di blob pencarian) — jadi jalan lama `REFERENCE_RULES` tidak bisa
   menjangkaunya tanpa backfill profil live. Aturan baru kini membaca blob pencarian
   yang sudah ada (`blobField`), dengan penjaga fail-closed: field yang tidak tercatat
   di `spec.search` anak membuat pemeriksaan mengembalikan error dan hapus ditahan.
   Tidak ada skema, kolom, atau `DERIVED_REVISION` yang berubah. *Bukti*: integrity 2d
   (teknisi ditahan Work Order — termasuk penulisan "… & Tim" — dan Laporan Kerusakan;
   operator ditahan Surat Jalan) dan handoff 10.18 (tombol hapus di menunya sendiri
   menampilkan alasan yang menyebut dokumennya; baris orang dan dokumennya tetap ada).
   *Penjaga*: validation 12 (aturan blob wajib menyebut field yang benar-benar ikut
   ditulis ke blob; teknisi dan operator wajib berpemeriksaan).
7. **Usulan nomor dokumen dihitung dari array yang tidak lengkap.** Sebelas halaman
   mencetak nomor berikutnya dari `data.length + 1` (SPK, kontrak rental, PO, WO,
   surat jalan, invoice, laporan kerusakan, permohonan, nomor operator/teknisi, bukti
   mutasi). Sejak #38 array itu hanya sebagian dari isi file, jadi nomor yang
   diusulkan bisa (a) menabrak nomor yang sudah ada, atau (b) berhenti di tengah dan
   menyisakan celah. Ini bukan hiasan: `electron/referential.ts` menandai dokumen
   lintas menu lewat **nomor bisnisnya**, jadi nomor rangkap merusak pemeriksaan hapus
   dan rujukan antar menu. Sumbernya kini satu fungsi (`src/utils/nomorBerikut.ts`):
   tertinggi di file +1, lalu kandidat diperiksa berlapis (`WHERE <no> IN (...)`,
   terindeks) sampai benar-benar bebas — termasuk kasus nomor leksikografis
   (`SO-2026-999` vs `SO-2026-1000`) dan collection yang baru mulai di tahun berikutnya.
   Tidak ada skema, IPC, atau `DERIVED_REVISION` yang berubah. *Bukti*: validation 23
   (15 kasus murni: celah sesudah hapus, 60 nomor terisi → 61, lebar nomor berbeda
   `T-00010`, embel asing tidak menghalangi, mode browser) dan handoff 9.9 + 10.19
   (tombol asli diklik: usulan SPK melanjutkan 902 → 903 walau baris tertinggi sudah
   dihapus; usulan bukti mutasi melewati nomor tanam 888, yang mustahil dihasilkan
   rumus lama).

8. **Menu yang sama diceritakan empat kali, dan keempatnya sudah menyimpang.**
   Sebuah jalur kerja dibaca pengguna dari empat tempat: urutan sidebar, katalog modul
   di tab Pengaturan (`ALL_MODULES`), tombol "aktifkan semua menu" (`ALL_PATHS` di
   `configStore`), dan CommandPalette Ctrl+K yang dulu menyalin daftarnya sendiri.
   Yang ditemukan: katalog Pengaturan menempatkan Sewa/Rental di kelompok Operasional
   padahal sidebar memanggilnya Transaksi, `Ctrl+K` hanya menawarkan 17 dari 26 menu
   (Operator, Teknisi, Persetujuan, Breakdown, Dokumen, Pengguna, Backup, Pemeliharaan,
   Audit Log tidak bisa dicari sama sekali), dan pencarian di topbar membaca
   `ALL_NAV_ITEMS` mentah — menu yang dimatikan untuk profil/peran pengguna
   tetap muncul sebagai hasil cari dan bisa dibuka dari sana. Urutan sidebar kini
   mengikuti siklus proyek (Utama → Master Data → Transaksi: beli-jual/sewa-acc-faktur
   → Operasional: gudang-part-rusak-servis-kirim → Keuangan → Sistem), dan tiga daftar
   lain tidak lagi berdiri sendiri: palette menerima item hasil gerbang dari Layout,
   pencarian topbar memakai daftar yang sama, katalog Pengaturan disusun ulang mengikuti
   sidebar. Tidak ada skema, IPC, atau `DERIVED_REVISION` yang berubah. *Bukti*:
   usable 7.1–7.4 (profil DEALER: 25 menu di sidebar, palette == sidebar sebutir-butir,
   kata kunci "onderdil" menemukan Suku Cadang dan Enter benar-benar pindah ke
   `/spareparts`, kata "sewa" tidak membocorkan `/rental` yang mati untuk profil itu).
   *Penjaga*: validation 25 (kategori katalog == grup sidebar, urutan katalog subsekuensi
   urutan sidebar, siklus grup sidebar tetap, `ALL_PATHS` wajib memuat semua menu
   bergerbang, tidak ada path mati, palette tidak boleh punya daftar sendiri,
   pencarian topbar wajib lewat daftar tergerbang, tiap menu punya kata kunci, tiap menu
   punya kunci di peta hidrasi).

9. **Membuka menu Perawatan Sistem memindahkan SELURUH isi database ke renderer.**
   `/maintenance` dipetakan ke `SEMUA_COLLECTION` di peta hidrasi (#38), padahal satu pun
   kartunya tidak meminta semua collection — pemetaannya hanya warisan dari tombol
   "Muat data contoh". Di profil 63.000 baris itu berarti puluhan MB lewat IPC, dan pada
   profil 400.000 baris itulah bentuk "aplikasi macet" yang paling mahal. Perbaikan:
   `/maintenance` → tidak perlu collection (`needs: []`), dan tombol muat contoh sekarang
   meminta hidrasi untuk dirinya sendiri (`await ensureLoaded(SEMUA_COLLECTION)`) sebelum
   menabur, dengan tombol berlabel "⏳ Memuat collection dari database..." selama menunggu.
   Yang dulu menjadi sifat menu kini menjadi sifat satu tombol yang memang memerlukannya.
   *Bukti*: perf 12c/12d/12e — membuka menu itu dari layar Unit memindahkan **0 baris
   store** lewat IPC, `reads.fullCalls` tetap nol, dan db-check 15.11 mengunci
   `needsForPath('/maintenance').length === 0`. *Penjaga*: validation 26 — tidak ada satu
   pun rute yang boleh dipetakan ke `SEMUA_COLLECTION`, dan setiap file yang memanggil
   `loadSampleData(` wajib juga memanggil `ensureLoaded(`.

10. **Baris Teknisi hasil suntingan tangan meruntuhkan seluruh layar dan dokumennya.**
    `Technicians.tsx` membaca `item.specializations`/`item.skills`/`item.certifications`
    langsung (`.map`, `.slice(0,2).map`) — kalau salah satu kolom itu berisi teks dan bukan
    daftar (kolom JSON yang disunting tangan, hasil restore sebagian, baris dari versi lama),
    `.map` melempar dan seluruh menu Teknisi jatuh ke error boundary. Ini bukan temuan
    statik: `cetak-check` C.12 menanam baris rusak lalu mengklik tombol cetak di layarnya,
    dan dokumennya tidak pernah jadi sebelum perbaikannya. Perbaikannya sama seperti #72:
    satu penjaga `daftar(nilai) = Array.isArray(nilai) ? nilai : []` dipakai di kartu, di
    baris daftar, dan di template cetak. *Bukti*: cetak 12 (empat baris rusak tetap
    tercetak), cetak 9 (tidak ada artefak `undefined`/`[object`). Temuan ikutan yang
    **bukan** cacat kode: layar Rental dibuka pada mode Timeline, yang tidak punya tombol
    cetak sama sekali — harness harus memindahkannya ke "📊 Tabel" lebih dulu; itu
    keputusan tata letak yang perlu persetujuan pengguna, bukan bug.

11. **Satu skrip di root bisa memusnahkan bukti rilis dan kunci build dalam sekali jalan.**
    `auto-fix.ps1` (versi 1) dijalankan tanpa parameter apa pun langsung
    `Remove-Item` atas `dist/`, `dist-electron/`, `dist-electron-portable/`, `node_modules/`
    **dan `package-lock.json`**, lalu `npm cache clean --force`, lalu `git reset` +
    `git clean -fd`, lalu membangun ulang. Tiga dari lima itu tidak bisa dipulihkan dari
    kode: `package-lock.json` + `.npmrc` bersama-sama menentukan prebuild `better-sqlite3`
    untuk ABI Electron (kehilangan salah satunya berarti `npm install` mengambil build
    untuk ABI Node dan aplikasi mati saat start-up dengan `MODULE_VERSION` salah),
    `dist-app/` + `dist-installer/` tidak terlacak git sehingga `git clean -fd` menghapus
    paket yang sedang diuji, dan cache prebuild adalah satu-satunya yang membuat build
    jalan di mesin offline. Skrip itu juga menyebut dirinya "memperbaiki TypeScript
    errors" padahal yang ia lakukan adalah menghapus artefak lalu menjalankan `tsc --noEmit`.
    Perbaikannya bukan menghapus skripnya (keputusan itu milik pengguna) melainkan
    **membalik sifatnya**: sekarang ia `PREFLIGHT` — 21 pemeriksaan tanpa menulis apa pun
    secara default, dan satu-satunya jalur tulis adalah cabang `-Apply` yang cuma
    membersihkan `node_modules/.vite` serta memanggil `npm run` yang sudah ada. Ia juga
    memeriksa hal-hal yang selama ini hanya diketahui lewat ingatan: apakah
    `better-sqlite3` benar-benar termuat di dalam Electron (probe nyata, mencetak ABI),
    apakah `.npmrc target` sama dengan versi electron terpasang, apakah RAM cukup,
    apakah ada proses Electron yang akan merebut single-instance lock, apakah
    `dist`/`dist-electron`/`app.asar` lebih tua dari sumbernya, dan installer mana yang
    versinya sama dengan `package.json`. *Bukti*: dijalankan dua kali — periksa-saja
    (`FAIL=0 WARN=3`, kode keluar 0) dan `-Apply` (hanya `.vite` yang hilang, `node_modules`
    dan lock utuh, kode keluar 0); `Parser::ParseFile` bersih untuk kedua skrip root.
    **Temuan ikutan yang lebih berbahaya**: skrip itu membuka mata bahwa `build-installer.ps1`
    mengandung karakter non-ASCII **tanpa BOM**. Windows PowerShell 5.1 membaca berkas
    tanpa BOM sebagai cp1252, jadi satu tanda hubung panjang (E2 80 94) pecah menjadi tiga
    karakter dan byte terakhirnya (0x94) adalah tanda kutip kiri — yang menutup string di
    tengah baris dan membuat skrip build mati dengan error parse yang terlihat tidak
    berhubungan. Keduanya kini ber-BOM, dan bentuk kesalahannya dijaga (§5).
    **Dua kalibrasi yang ditemukan dengan menjalankan skripnya sendiri, bukan dengan
    membacanya.** Pertama: ambang FAIL untuk RAM dulu ditaruh di 250 MB, padahal mesin ini
    memang berdiam di 240–300 MB — jadi preflight melempar `FAIL=1` pada satu jalan dan
    `FAIL=0` pada jalan berikutnya dengan isi repo yang sama persis (terdokumentasi: tiga
    jalan beruntun, yang di tengah jatuh di 242 MB). Rantai penuh 16 langkah dan build
    rilis keduanya selesai hijau pada 269 MB bebas, jadi vonis itu salah. FAIL kini
    disimpan untuk keadaan yang benar-benar tidak bisa dijalankan (< 128 MB), sementara
    tekanan memori yang hanya membuat pengukuran waktu tidak valid turun menjadi WARN —
    rapor merah yang muncul terus-menerus adalah cara tercepat melatih orang mengabaikan
    preflight. Kedua: tuduhan "app.asar lebih tua dari sumber" akan menempel selamanya
    sebagai peringatan basi-palsu, karena dua berkas (`src/store/collectionNeeds.ts`,
    `src/pages/Technicians.tsx`) punya mtime lebih baru dari paket hanya karena sempat
    disentuh uji mutasi lalu dipulihkan — isinya sama dengan HEAD, jadi tidak ada yang
    perlu dibundel ulang. Pemeriksaan kesegaran kini membandingkan **isi terhadap HEAD**,
    bukan jam: selama `src/` dan `electron/` bersih terhadap commit, geseran mtime
    dilaporkan sebagai OK lengkap dengan alasannya; begitu salah satu berkas benar-benar
    berbeda, WARN-nya kembali (dimutasi dengan menambahkan satu baris komentar, kedua
    peringatan terlihat muncul, sumber lalu dipulihkan dan `git status --porcelain -- src`
    terbukti kosong lagi).
    *Penjaga*: validation 27 — daftar hitam perintah (`git clean`, `git reset`,
    `npm cache clean`, `npm install/ci`) dan daftar putih sasaran hapus (hanya berkas
    sementara, `node_modules/.vite`, `tmp-harness`) diberlakukan ke **semua** skrip root
    setelah komentar dan string literal dibuang; `.ps1` non-ASCII wajib ber-BOM;
    `auto-fix.ps1` wajib punya gerbang `[switch]$Apply` dan tidak boleh menjalankan
    `npm run`/`Remove-Item` sebelum gerbang itu (dengan penjaga positif bahwa cabang
    `-Apply` benar-benar berisi perbaikan, supaya assertion tidak lolos kosong).

12. **Hasil rantai pernah tidak bisa dipercaya karena cara prosesnya keluar.** Riwayatnya:
    72 assertion gui-check lulus semua, tapi proses induknya keluar dengan
    `Segmentation fault` (139), sehingga `regressi.sh` menandai rantai rusak tanpa ada
    satu pun uji yang gagal. Mitigasi yang sudah ada (harness wajib lewat
    `tests/harness/selesai.cjs`, yang menutup koneksi SQLite lebih dulu dan mencetak
    `SELESAI kode=N` sendiri) membuat rantai hijau lagi, dan sisanya adalah pertanyaan
    yang belum dijawab: siapa sebenarnya yang mati tidak bersih. Siklus ini menjawabnya
    dengan percobaan, bukan dengan asumsi: 12 keluar proses dengan koneksi SQLite
    **ditutup**, 12 dengan koneksi **dibiarkan terbuka**, dan 8 gui-check penuh
    (4 lewat `npx electron`, 4 lewat `electron.exe` langsung) — **34 dari 34 keluar
    dengan kode 0**. Jadi (a) koneksi terbuka saat `ExitProcess` bukan penyebab yang
    cukup, dan (b) setelah lapisan `selesai()` tidak ada satu pun kegagalan yang bisa
    direproduksi. Satu-satunya bagian yang tersisa di antara rantai dan Electron adalah
    pembungkus `npx` — proses node npm yang menunggu `electron.exe`, menambah satu proses
    ~60 MB di mesin 3,8 GB ini dan menyediakan satu tempat lagi untuk mati tidak bersih.
    Ia dihapus dari rantai: `regressi.sh` kini resolve `node_modules/electron/dist/electron.exe`
    dan berhenti dengan pesan jelas kalau berkas itu belum ada. Rantai penuh sesudah
    perubahan itu: 16 langkah, 0 gagal, dan baris `exit=` bernilai 0 untuk **setiap**
    langkah — termasuk sepuluh langkah Electron — sehingga `proses keluar tidak bersih`
    tidak lagi bisa disembunyikan di balik pembungkus. *Penjaga*: validation 15 — daftar
    harness Electron **diderivasi** dari baris `"$ELEKTRON"` di `regressi.sh` plus
    harness yang di-spawn orkestrator `*-run.cjs` (bukan daftar tulis tangan, yang pernah
    ketinggalan `cetak-check`), setiap pengguna `require('electron')` wajib menjadi
    langkah rantai atau perkakas yang dinyatakan (`profile-inspect.cjs`), `selesai.cjs` wajib
    menutup database sebelum `app.exit` dan mencetak penanda, dan `regressi.sh` tidak boleh
    kembali memakai `npx electron`.

13. **Harness membuka browser sungguhan di desktop manusia, dan satu wait uji membaca
    keadaan "memuat" sebagai data.** Dua efek dari sebab yang sama — uji mengukur efek
    samping, bukan keadaan sebenarnya:
    (a) `gui-check` bagian 8 menguji `window.open('https://example.com')`. Handler
    `setWindowOpenHandler` di `electron/main.ts` memblokir jendelanya lalu menyerahkan
    URL-nya ke `shell.openExternal` — di mesin pengembangan artinya **Chrome sungguhan
    terbuka ke halaman IANA example.com setiap kali langkah `gui` dijalankan**, di
    desktop orang yang sedang bekerja. Yang dibuktikan uji itu cuma separuhnya (popup
    diblokir); penyerahan URL-nya hanya "terbukti" lewat jendela yang muncul di layar.
    Sekarang `shell` ditambal dengan perekam sebelum uji berjalan, dan URL yang
    diserahkan menjadi assertion baru (gui **8.1b**) — tidak ada browser yang terbuka
    lagi, dan perilaku yang dulu hanya terlihat oleh mata itu justru kini dijaga.
    (b) Rantai berikutnya (`rantai-302f`) jatuh di `handoff` 8.1 dengan `sql=2, kartu=0`
    — bukan regresi
    aplikasi, melainkan wait harness yang menguji `/record/.test(#pager-info)`.
    `Pager.tsx` menampilkan "Tidak ada record" selama `total` masih 0, yaitu selama
    debounce 200 ms dan selama kueri pertama berjalan, dengan akhiran " · memuat...".
    Kalimat itu mengandung "record", jadi wait tersebut **benar saat halaman kosong dan
    benar saat halaman sedang memuat** — ia tidak pernah menandai selesai. Kedua wait
    (Unit dan invoice) diperketat menjadi `penanda ada && !/memuat/ && /record/`; semua
    wait lain sudah memakai `/dari N record`, yang tidak mungkin cocok dengan teks
    loading. *Penjaga*: validation 28 — setiap `waitFor` yang menyentuh `#pager-info`
    wajib mengecualikan "memuat" atau menguji frasa "dari N record" (penjaga positif:
    minimal 15 wait pager terdeteksi dan minimal 3 di antaranya menguji `/record/` apa
    adanya, supaya tidak lolos kosong), dan setiap harness yang memanggil `window.open`
    wajib menambal `shell.openExternal` lebih dulu. Kalibrasi: menghapus satu klausul
    `!/memuat/` di `handoff-check` membuat penjaga ini FAIL dan unit turun ke 296/1;
    setelah dikembalikan, 297/0.

### 4.14 Jalur signing diukur dengan sertifikat uji — dan ia gagal di tempat yang salah

Plumbing signing (#80) sudah ditulis tetapi **tidak pernah dijalankan sekali pun**. Ia
diukur sekarang, di sandbox (`C:\tmp\sign-test`) memakai sertifikat self-signing uji,
terhadap salinan PE yang benar-benar belum bertanda tangan (salinan `cat.exe` Git —
salinan `chcp.com` tetap membawa tanda tangan Microsoft meski `signtool remove /s`
sudah dijalankan, jadi hasil pertama tidak berarti). Tiga hal terukur:

1. `signtool sign /fd SHA256 /tr <TSA>` dengan timestamp **tidak terjangkau** keluar 1
   dan berkasnya **tinggal tanpa tanda tangan** — bukan tanda tangan tanpa timestamp,
   jadi build yang mengabaikan kode keluar akan memproduksi paket separuh bertanda.
2. Tanda tangan dari sertifikat **tidak dipercaya** Windows menempel dengan rapi, tapi
   `signtool verify /pa` keluar 1 dan `Get-AuthenticodeSignature` melaporkan
   `UnknownError`/`NotTrusted`. Untuk sertifikat OV/EV resmi kegagalan ini tidak boleh
   terjadi; untuk sertifikat uji, kegagalan itu benar dan paketnya memang tidak layak
   diedarkan.
3. Keduanya baru diketahui di **langkah 5 dari 6**, yaitu ±15 menit setelah
   `npm run build` dimulai — mesin build offline kehilangan tiga perempat jamnya hanya
   untuk diberi tahu bahwa pfx/password/TSA-nya salah.

Yang diubah: `build-installer.ps1` kini memverifikasi prasyarat signing (`signtool.exe`
ditemukan dan berkas pfx yang ditunjuk `HEMS_SIGN_PFX` benar-benar ada) **sebelum**
langkah build pertama, dan mencetak jalur yang dipakai (`sign AKTIF via …`), dan `Sign-Exe` memanggil `sign` lalu `verify /pa` dengan
diagnostik yang menyebut penyebab tersering. Mode "tanpa pfx" tetap dicetak terang
(`LEWAT sign: paket ini TIDAK ditandatangani`) supaya tidak pernah ada paket yang
diduga sudah bertanda padahal tidak. *Penjaga*: validation 29 mengunci bentuk blok itu
— prasyarat harus berada sebelum `npm run build`, `/fd SHA256` + `/tr $signTs` +
`/td SHA256` harus ada, kedua perintah harus di-follow `throw` saat kode keluar bukan
nol, `Sign-Exe` harus dipanggil untuk `FATHONI.exe` **dan** installer, dan pesan
"LEWAT sign" harus tetap ada. Kalibrasi penjaga ini dilakukan dengan merusak berkas
build-nya sendiri: `/tr $signTs` dihapus dari baris `signtool sign` → validation 29
FAIL dan unit turun ke 301/1; setelah klausul itu dikembalikan → **302/0**.

Ini **bukan** perubahan isi paket: `build-installer.ps1` tidak ikut terbundel —
`build.files` hanya `dist/**`, `dist-electron/**` dan `better-sqlite3`. Karena itu
bukti `app.asar` 3.0.2 tetap berlaku dan versi tidak naik; yang berubah hanya cara
installer berikutnya akan ditandatangani. Keputusan membeli sertifikat OV/EV tetap ada
di sisi user (§7); tanpa itu jalur ini tidak diaktifkan dan paket tetap tanpa tanda
tangan.

Pola yang menyatukan keempat belas temuan itu: yang rusak bukan satu menu, melainkan asumsi bahwa
data yang dibaca selalu lengkap, selalu berasal dari jalur yang sama, dan selalu
diceritakan dengan cara yang sama di setiap tempat — dan bahwa alat yang dipakai untuk
"merapikan" serta cara uji diakhiri sudah pasti aman.


## 5. Penjaga anti-regresi (bukan assertion fungsi)

`validation-check` §12, §15–§29 menahan bentuk kode, bukan hanya hasilnya:
peta `MENU_HAPUS` 17 collection + larangan filter-array di halaman ber-`useDataStore`;
harness Electron wajib keluar lewat `selesai()`; setiap rute aplikasi harus dilewati
minimal satu harness; `AuditLog` wajib bersumber dari main process dan tanpa baris
karangan; `healthCheck` wajib memeriksa SQLite; lokasi data paket dan sandbox uji asap;
boundary berkunci rute; dua aturan §4.3–4.4 di atas; bentuk daftar rujukan
(§4.6) — kolom aturan wajib ada di `COLLECTION_SPECS`, `blobField` wajib ada di
daftar `search` anak, dan teknisi/operator tidak boleh kembali menjadi record daun;
sumber nomor dokumen (§4.7) — tidak ada lagi baris di `src/pages` yang menghitung
nomor dari `.length + n`, ke-11 collection bernomor bisnis wajib dipanggil lewat
`nomorBerikut`, dan pasangan (collection, field) itu wajib benar-benar kolom SQL di
`dbSchema` supaya pemeriksaan kandidat tidak pernah diam-diam disaring keluar;
satu daftar menu (§4.8) — `NAV_GROUPS` dibaca parser dan jumlah itemnya dicocokkan dengan
berkas, grup sidebar wajib tetap mengikuti siklus proyek, katalog `ALL_MODULES` wajib
berkategori sama dan berurutan subsekuensinya, `ALL_PATHS` `enableAllMenus` wajib
memuat semua menu bergerbang tanpa path mati, palette tidak boleh mengulang daftar,
pencarian topbar wajib membaca hasil gerbang, tiap menu punya kata kunci dan kunci
peta hidrasi; peta hidrasi siklus ini (§4.9) — tidak ada rute yang boleh dipetakan ke
`SEMUA_COLLECTION`, rute tak dikenal tetap jatuh ke muat semua, dan setiap file yang
memanggil `loadSampleData(` wajib juga memanggil `ensureLoaded(` (§26). Penjaga §24 juga
diperketat: template cetak Operator/Teknisi/Breakdown boleh menormalkan kolom array secara
inline ATAU lewat satu penjaga lokal, tetapi penagihannya kini PER KOLOM
(`certifications`, `partsUsed`, `specializations`, `skills`) — punya penjaga di file itu
tidak lagi cukup kalau salah satu kolomnya tetap dibaca mentah.
Ketujuh penjaga itu diverifikasi dengan mutasi (menabrakannya sengaja
lalu dilihat FAIL) — bukan hanya hijau pada kode yang sudah benar. Dua penjaga terbaru
dimutasi siklus ini: bacaan `daftar(item.certifications)` di Technicians sempat dikembalikan
menjadi bacaan mentah dan §24 memang jatuh (280 lulus, 1 gagal) sebelum sumber dipulihkan.

Lima penjaga bentuk-kode baru menyusul setelah penutup §4.11–§4.14, dan semuanya
lahir dari temuan yang hampir tidak terlihat:

- **§15 ditulis ulang supaya tidak bisa basi.** Daftar harness Electron dulunya
  daftar tulis-tangan, jadi menambah harness baru tanpa menambahkannya ke daftar
  itu justru membuat penjaga "wajib lewat `selesai()`" diam-diam tidak mencakup
  apa-apa. Kini daftarnya diturunkan dari `regressi.sh` (panggilan
  `"$ELEKTRON" tests/harness/<nama>.cjs`) ditambah harness yang di-spawn dari
  `*-run.cjs`, sehingga langkah rantai baru otomatis ikut diperiksa. Satu pengecualian
  dinyatakan eksplisit di kode (`DI_LUAR_RANTAI`): `profile-inspect.cjs` memang
  perkakas baca profil untuk manusia, bukan langkah regresi, dan memang boleh
  memakai `app.exit`. Penjaga yang sama juga memastikan rantai **tidak** kembali
  memanggil Electron lewat `npx`.
- **§27 mengunci bentuk skrip root.** Semua `.ps1`/`.sh`/`.cmd`/`.bat` di root
  repo dibaca: string kutip dan komentar dibuang dulu, lalu kode yang tersisa
  tidak boleh mengandung `git clean`, `git reset`, `npm cache clean`, `npm install`/`ci`,
  juga tidak boleh `Remove-Item`/`del`/`rm` ke `node_modules`, `package-lock.json`,
  `app.asar`, `dist-app`, `dist-installer`, `fathoni.db`, `.npmrc`, `src` atau `APPDATA`
  — kecuali ke path yang secara nyata temporer (`$probe`, `$viteCache`, `tmp-harness`,
  `GetTempPath`). Ditambah tiga aturan struktural: setiap penghapusan di luar temp
  wajib berada setelah penjaga `-Apply`, tidak boleh ada `npm run` di depan penjaga
  itu, dan harus ada kontrol positif yang membuktikan cabang `-Apply` sungguhan
  berisi tindakan (supaya penjaga tidak hijau pada skrip yang dinonaktifkan total).
  §27 juga memegang aturan BOM: `.ps1` ber-UTF-8 tanpa non-ASCII boleh tanpa BOM,
  yang mengandung karakter non-ASCII **wajib** diawali `EF BB BF` — tanpa itu
  Windows PowerShell 5.1 membacanya sebagai cp1252 dan tanda em-dash mengubah
  string menjadi kutip pintar.
- **§14 ditambah dua penjaga `.iss` lama.** `installer.iss` di root adalah duplikat
  basi yang menunjuk `dist-electron-portable` dan menulis `AppVersion "1.0.0"`; kalau
  build pemanggil ISCC berubah arahnya, ia mengemas paket mati dan tetap lulus
  compile. Kini rantai build wajib menyebut `installer\FATHONI-InnoSetup.iss` secara
  eksplisit, dan tidak ada berkas jalur build yang boleh memanggil `.iss` root.

- **§28 mengunci dua jebakan harness (§4.13).** Pertama: komentar atau string yang
  mengandung kata "record" tidak lagi boleh dijadikan tanda selesai. Setiap `waitFor`
  yang menyebut `#pager-info` di kedelapan harness pengguna renderer diperiksa isinya
  — wajib ada `!/memuat/` atau frasa `/dari …record/`, dua bentuk yang tidak mungkin
  cocok dengan teks loading. Kontrolnya dijaga agar tidak vakum: minimal 15 wait pager
  harus terdeteksi dan minimal 3 di antaranya menguji `/record/` apa adanya. Kedua:
  harness yang memanggil `window.open` dari renderer wajib menambal
  `shell.openExternal` lebih dulu, supaya tidak ada uji yang lagi-lagi membuktikan
  dirinya lewat jendela yang terbuka di desktop manusia.

- **§29 mengunci bentuk jalur signing (§4.14).** Lima assertion membaca berkas
  `build-installer.ps1` apa adanya: periksa-signtool dan periksa-pfx harus berada
  BARIS sebelum `& npm run build` (dibandingkan lewat indeks baris, bukan ditebak dari
  teks); baris `signtool sign` wajib `/fd SHA256`, `/tr $signTs` dan `/td SHA256`
  dengan `$signTs` didefinisikan satu kali; setiap panggilan `signtool` wajib diikuti
  `if ($LASTEXITCODE -ne 0) { throw … }` untuk `sign` maupun `verify /pa`; `Sign-Exe`
  wajib dipanggil untuk `appExe` DAN target ber-nama setup (penjaga non-vakum: kalau
  hanya satu yang ditandatangani, daftar pemanggilan dicetak di pelanggarannya); dan
  pesan `LEWAT sign: paket ini TIDAK ditandatangani` tidak boleh hilang, supaya jalur
  tanpa sertifikat tetap terang, bukan diam-diam.

Kelima penjaga baru ini juga dimutasi, bukan hanya dilihat hijau: BOM `build-installer.ps1`
dikupas sehingga §27 jatuh, dan jalur ISCC diubah menunjuk `installer.iss` sehingga kedua
penjaga `.iss` jatuh. Untuk §28, klausul `!/memuat/` di salah satu wait `handoff-check`
dihapus sengaja — penjaganya langsung FAIL dan unit turun ke 296 lulus / 1 gagal, dengan
kutipan panggilan yang salah di daftar pelanggarannya; sumber dipulihkan dan hijau kembali.
Untuk §29, `signtool sign /tr $signTs` sempat dikembalikan menjadi `signtool sign` tanpa
timestamp di `build-installer.ps1` — assertion kedua jatuh (301 lulus / 1 gagal) dan
mencetak baris yang melanggar; setelah klausul itu dipasang lagi, unit hijau 302/0.

## 6. Yang BELUM diverifikasi (perbatasan laporan ini)

- **Sistem operasi lain**: hanya Windows 11 build ini. macOS/Linux tidak diuji;
  electron-builder dikonfigurasi Windows.
- **DPI/ukuran layar nyata**: `usable-check` mengukur pada 1200 px (client 1184) dan
  melaporkan tidak ada pemotongan. Variasi scaling Windows, 4K, dan netbook belum.
- **Perangkat keras**: tidak ada uji printer sejati, scanner, atau perangkat keras
  lapangan.
- **Code signing**: jalur signing-nya sudah **diukur berjalan** (§4.14) memakai sertifikat
  uji self-signed di sandbox: `signtool sign /fd SHA256 /tr … /td SHA256` menempelkan
  tanda tangan, `verify /pa` menolak rantai yang tidak dipercaya, dan bentuk kegagalan
  timestamp yang meninggalkan exe tanpa tanda tangan sudah diketahui. Yang belum ada
  tetap **sertifikatnya** (OV/EV masih keputusan pembelian), jadi paket ini masih akan
  memicu SmartScreen pada pengguna baru — dan sertifikat uji tidak boleh dipakai untuk
  edaran, karena `verify /pa`-nya memang gagal.
- **Walkthrough usability oleh manusia**: semua yang tercatat di §2 adalah pengukuran
  otomatis; tidak ada sesi diterimanya alur kerja oleh pemakai sebenarnya.
- **Yang tersisa dari bukti cetak**: `cetak-check` mengklik tombol cetak di 10 layar dan
  memeriksa jendela cetak sungguhan (§2, §4.9), tetapi harness mengganti
  `webContents.print` dengan perekam — karena `silent: false` akan membuka dialog cetak
  asli yang menggantung tanpa tangan. Jadi yang terbukti adalah **dokumen sampai ke
  jendela cetak dengan bentuk dan opsi yang benar (A4 + latar)**, bukan kertas yang keluar
  dari printer tertentu, dan bukan kualitas driver/printer di lapangan.
- **Anggaran performa masih dilonggarkan**: boot < 15 s, domReady < 12 s, cari median
  < 800 ms, kueri < 400 ms, patch < 250 ms. Angka §3 jauh di bawahnya (cari 229 ms,
  kueri 7 ms, patch 1 ms), tapi ambangnya sendiri belum disepakati sebagai target rilis —
  menaatinya masih belum bisa disebut "kinerja yang dijanjikan", baru "regresi tertangkap".
- **Kapasitas di atas 400.000 baris** belum diukur (§3.1 sudah menutup 100.000 per
  collection besar). Yang belum terukur: juta baris, dan khususnya biaya pemindaian
  `LIKE '%token%'` pada blob pencarian di atas jumlah itu — ia linear terhadap baris,
  bukan indeks, jadi itu titik pertama yang akan terasa lambat.
- **Uji kapasitas tidak ikut rantai default.** Bagian 11 `perf-check` hanya jalan dengan
  `HEMS_PERF_KAPASITAS=1` (menulis 400.000 baris, ±2 menit, dan pada mesin 3,8 GB RAM ia
  bersaing dengan cache berkas). Angka §3.1 berasal dari lintasan manual 2026-10-11, bukan
  dari hijau/merahnya `regressi.sh`.
- **Batas aturan rujukan orang** (setelah §4.6): kunci yang lebih pendek dari
  `PANJANG_TOKEN_MIN` (6) sengaja dilewat, jadi teknisi/operator bernama satu kata
  ("Budi", "Joko") masih bisa terhapus meski dokumen menyebutnya — disengaja, karena
  token pendek terlalu mudah terselip di kolom lain dan akan menolak hapus yang aman.
  Diuji sebagai karakterisasi (integrity 2d), bukan harapan. Blob pencarian juga tidak
  tahu kolom mana yang cocok: nama teknisi yang kebetulan sama dengan nama pelanggan
  di baris yang sama ikut menahan hapus (menolak berlebihan, bukan meloloskan).
- **Operator ↔ kontrak rental belum terjaga**: `rentals` tidak menyimpan nama operator
  sama sekali — `operatorName` hanya ada di tipe `src/types/index.ts` dan tidak ditulis
  layar mana pun. Menahannya berarti menambah kolom/blob baru, yang wajib disertai
  backfill profil live (`ensureColumns`, `DERIVED_REVISION` 5→6) dan masih menunggu
  keputusan.
- **Artefak lama di repo**: `dist-installer/HEMS-Setup-1.0.0.exe`,
  `installer/dist-installer/HEMS-Setup-*.exe`, bekas `FATHONI-Setup-2.0.0.exe` dan
  `FATHONI-Setup-3.0.0.exe` (yang terakhir dibangun sebelum #71–#75 sehingga tidak
  layak edar), `dist-electron-portable` (156 MB,
  `app.asar` terkunci proses), dan dependensi Prisma (~111 MB) yang tidak dipakai.
  Tidak ada yang dihapus tanpa persetujuan.
- **`installer.iss` di root ikut kategori yang sama dan sengaja tidak dihapus.** Ia
  duplikat basi dari `installer/FATHONI-InnoSetup.iss`: `Source` menunjuk
  `dist-electron-portable\win-unpacked` (folder yang sudah ditinggalkan) dan
  `AppVersion "1.0.0"`. Menyimpannya tidak berbahaya selama ISCC tidak dipanggil
  dengannya — dan itu kini dijaga §14 — tapi menghapusnya tetap keputusan pengguna,
  karena ia satu-satunya catatan bentuk build portable lama.
- **Yang tadinya belum terverifikasi dan kini sudah: cara proses rantai keluar.** Sampai
  siklus ini, langkah Electron di `regressi.sh` dipanggil lewat `npx`, dan pembungkus npm itu
  sesekali mati dengan Segmentation fault (139) **setelah** semua assertion tercetak
  lulus — akibatnya "rantai hijau" dan "rantai rusak" bisa berasal dari kode yang sama.
  Setelah pemanggilan langsung `node_modules/electron/dist/electron.exe`,
  `keluar tidak bersih` untuk rantai penuh 16 langkah adalah **kosong** (§2, §4.12),
  jadi baris `exit=` di log kini berarti sesuatu. Yang belum tercover: mesin dengan
  RAM lebih besar atau Windows versi lain, di mana npx mungkin justru aman — rantai
  tetap memakai jalur langsung karena ia lebih cepat dan lebih mudah dibaca, bukan
  karena npx terbukti merusak di mana-mana.

## 7. Keputusan yang tidak boleh dibalik tanpa migrasi

- `package.json "name"` = `hems-heavy-equipment-system` dan prefiks kunci
  `hems_*` adalah **kunci data**, bukan label. Data pengguna hidup di
  `%APPDATA%\hems-heavy-equipment-system\fathoni.db` (sama untuk dev dan paket,
  karena `electron/main.ts` mem-pin folder datanya). Ganti nama tanpa langkah
  migrasi = pengguna kehilangan basis datanya.
- Branding yang tampil untuk pengguna sudah FATHONI EQUIPMENT OS; itu dilakukan di
  `productName`, `installer/FATHONI-InnoSetup.iss`, dan ikon exe lewat
  `scripts/apply-exe-branding.cjs` (`signAndEditExecutable` tetap `false` karena
  arsip `winCodeSign` berisi symlink macOS yang tidak bisa diekstrak tanpa hak
  khusus di mesin ini).
- `AppId` Inno tidak boleh berubah: itu kunci upgrade instalasi lama
  (dijaga validation 14).

## 8. Cara menjalankan ulang verifikasi ini

```bash
npm run build && npm run build:electron        # bundel renderer + main
sh tests/harness/regressi.sh                   # 16 langkah, log di D:/SANY/tmp-harness/logs
HEMS_PERF_KAPASITAS=1 node_modules/electron/dist/electron.exe tests/harness/perf-check.cjs   # lintasan kapasitas 400.000 baris (§3.1)
HEMS_SIGN_PFX=... HEMS_SIGN_PASS=... powershell -File build-installer.ps1  # build + tanda tangan (§6)
```

Sebelum menyentuh build, periksa lingkungan tanpa mengubah apa pun:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File auto-fix.ps1          # PREFLIGHT: baca saja, 21 pemeriksaan
powershell -NoProfile -ExecutionPolicy Bypass -File auto-fix.ps1 -Apply   # boleh menuntaskan; hanya .vite cache + rebuild native/build yang dihapus-dibangun
```

`auto-fix.ps1` keluar dengan kode 1 kalau ada FAIL. Baris terakhirnya
`FAIL=x WARN=y dari z pemeriksaan`; WARN berarti curiga (misalnya `mtime` sumber lebih baru
dari `app.asar`) dan yang memutuskannya tetap rantai, khususnya langkah `paket` —
`mtime` bukan bukti basi, isinya yang bukti. Skrip itu tidak bisa lagi menghapus
`node_modules`, `package-lock.json`, `app.asar`, artefak build, basis data, atau profil
pengguna; §27 `validation-check` menahannya demikian.

Satu instance Electron pada satu waktu (mesin 3,8 GB RAM). Harness yang menyentuh
profil wajib lewat `HEMS_DATA_DIR=D:/SANY/tmp-harness/r-<nama>`; `APPDATA` tidak
dipakai untuk profil Chromium/paket — gunakan `--user-data-dir`. Rantai memanggil
Electron langsung dari `node_modules/electron/dist/electron.exe`, bukan `npx electron`
(§4.12); kalau berkas itu belum ada, `regressi.sh` berhenti dengan `RAMBU` dan `exit 8`
alih-alih menjalankan rantai setengah jalan.
