# FATHONI EQUIPMENT OS — Laporan QA
**Versi aplikasi**: 3.0.5 (nama paket `hems-heavy-equipment-system`, dipertahankan sebagai kunci data — lihat §7)
**Tanggal laporan**: 2026-10-13
**Status**: Rilis terverifikasi. Rantai regresi penuh hijau dijalankan terhadap paket
**3.0.5**: 19 langkah, 1.450 assertion, 0 gagal, `rusak: tidak`,
`proses keluar tidak bersih: tidak` — log `/tmp/rantai-305.log` (ringkasan
per langkah ada di `tmp-harness/logs/<nama>.log` dengan `mtime` 19:26–19:29),
dijalankan terhadap paket jadi
(`dist-app/win-unpacked`, `app.asar` 4.511.034 byte; `FATHONI.exe` `FileVersion` /
`ProductVersion` `3.0.5`, build 19:22) dan installer hasil ISCC 19:24
(`dist-installer/FATHONI-Setup-3.0.5.exe`, 83.168.646 byte, SHA-256 `f97e2b8c…11f56`,
**TIDAK TERSIGN**). `npm audit` 0 kerentanan (tinggi/kritis 0, sedang 0, rendah 0).
Langkah terakhir rantai (`smoke-paket`) menguji `FATHONI.exe` HASIL PAKET; harness lain
menguji `dist/` + `dist-electron/` yang dibundel ke dalam asar paket itu. Bukti bahwa
rantai ini melekat pada paket yang diedarkan diukur pada isi asar, bukan disimpulkan:
string tab riwayat unit yang baru (`mutasi gudang tidak menyimpan nomor sasis`) ADA di
`app.asar` (1 kecocokan), sedangkan lima nomor hiasan lama yang dulu dipajang identik untuk
semua alat (`SPK-2025-012` dkk.) tidak ada satu pun (0 kecocokan) — aturan yang dipakai
laporan ini sejak 3.0.0. Yang TIDAK diulang pada siklus ini dan jangan dihitung sebagai
bukti 3.0.5: lintasan kapasitas 400.000 baris (`HEMS_PERF_KAPASITAS=1`, 55 assertion) —
`perf` yang hijau di rantai ini adalah jalur beban standar 40 assertion (§3.1).

Laporan ini menggantikan laporan 2026-09-23 (HEMS 1.0.0). Laporan lama itu sudah tidak
berlaku dan sengaja ditulis ulang, bukan ditambal: ia menyebut localStorage sebagai
lapisan penyimpanan, "no automated tests", dan Breakdown / Operator / Teknisi /
Approval / Audit Log sebagai "belum diimplementasikan" — semuanya sudah tidak benar.
Matriks rinci tiap assertion ada di `tests/harness/README.md`; dokumen ini ringkasannya.

---

## 1. Yang berubah sejak laporan 1.0.0

| Aspek | 1.0.0 (laporan lama) | 3.0.5 (hari ini) |
|---|---|---|
| Penyimpanan | `localStorage` (hems_*), kuota ~5 MB | SQLite (`fathoni.db`, better-sqlite3 11.10.0, WAL) di main process; 20 collection (§4.17) |
| Akses data | seluruh store disalin ke renderer saat boot | halaman besar query berpaginasi (`MAX_PAGE_LIMIT` 500); boot memindahkan **0 baris** lewat IPC |
| Akun & login | kredensial di sisi renderer | hash+salt di main process, token sesi, wajib ganti password, lockout 5x salah, `accounts.json` tanpa plaintext |
| Tulis data | `setX(wholeArray)` | jalur per-baris (`dbPatch`: upsert/removeIds) + aturan rujukan saat hapus; simpanan penuh hanya kalau collection terbukti terdimuat penuh |
| Pengujian | manual saja | 18 harness otomatis + audit dependensi (19 langkah), dijalankan berurutan oleh `tests/harness/regressi.sh`; uji kapasitas 400.000 baris menyala terpisah dengan `HEMS_PERF_KAPASITAS=1` |
| Paket | `HEMS-Setup-1.0.0.exe` 92,8 MB, ikon bawaan | `FATHONI-Setup-3.0.5.exe` 83.168.646 byte, ikon exe sendiri, asar ramping (hanya `dist`, `dist-electron`, `better-sqlite3`); halaman Finish tidak lagi mencentang "jalankan aplikasi" (§4.16); jalur signing opsional sudah ada di `build-installer.ps1` tapi sertifikat belum dibeli (§6) |

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
catatan sejarah — waktu itu hanya 3.0.2 yang layak edar (lihat "Kenapa 3.0.3" di bawah).

**Kenapa 3.0.3.** Setelah paket 3.0.2 dibangun dan rantainya hijau (2026-10-11 12:44),
sumber berubah lagi dan perubahannya **fungsional**, bukan sekadar alat ukur: enam
perbaikan Tahap 1 (T1 kategori pembelian bisa disimpan, T2 satu aturan servis
berikutnya tanpa `+250` keras, T3 servis selesai menaikkan `hourMeter` + `lastServiceHM`
unit, T4 prosedur koreksi untuk pembacaan meter yang mundur, T5 biaya per jam &
profitabilitas dihitung dari data bukan konstanta, T6 otorisasi tulis ditegakkan di main
process lewat token sesi + peran — §4.15), plus kalibrasi penjaga T7 dan satu perbaikan
baris `[Run]` di installer (§4.16). Aturan yang sama berlaku: bukti rilis adalah rantai
yang dijalankan terhadap paket yang diedarkan, jadi versi dinaikkan, paket + installer
dibangun ulang (`app.asar` 16:02, `dist-installer/FATHONI-Setup-3.0.3.exe` 16:12), lalu
rantai diulang dari nol terhadap paket itu: **19 langkah, 1.381 assertion, 0 gagal**
(`tmp-harness/logs/rantai-303.log`). Artefak 2.0.0/3.0.0/3.0.1/3.0.2 tetap utuh di
`dist-installer/`. Versi 3.0.3 sudah terpasang di mesin ini (`%LOCALAPPDATA%\Programs\FATHONI`,
entri Program Features atas nama 3.0.3 setelah walkthrough §4.16) dan data live pengguna
tidak pernah tersentuh selama seluruh siklus ini (`fathoni.db` SHA-256 `39895b51…f6d7b7`
tetap dari awal sampai akhir).

**Kenapa 3.0.4.** Paket 3.0.3 dibangun 2026-10-12 16:02–16:12 dan rantainya hijau
(1.381 assertion). Setelah itu sumber berubah lagi, dan perubahannya fungsional: halaman
**Merek & Model** yang selama ini hanya bekerja di atas daftar bawaan kini menyimpan ke
database lewat dua collection baru (`brands`, `models`) dan menjadi sumber daftar merek
di formulir Unit (§4.17); lalu empat catatan yang tertulis "belum berfungsi" di panduan
pemakaian ditutup — empat tombol **View All** di Control Tower yang tidak mengarah ke
mana pun, **Cetak Bukti** di Gudang yang tidak mencetak apa pun, jenis dokumen **BPKB**
yang tidak ada di daftar, dan batas ekspor CSV Laporan yang tertahan di 500 baris
(§4.18). Satu perubahan lain bersifat alat ukur: `perf-check` P.12b, yang setelah katalog
dibuat harus menduga-duga berapa baris yang boleh lewat IPC — ia dikalibrasi ulang dan
dibuktikan dengan mutasi (§4.19). Aturan yang sama berlaku untuk ketiga kalinya: bukti
rilis adalah rantai terhadap paket yang diedarkan, jadi versi dinaikkan, paket + installer
dibangun ulang (`app.asar` 4.507.888 byte build 19:25, `dist-installer/FATHONI-Setup-3.0.4.exe`
83.150.078 byte ISCC 19:27), lalu rantai diulang dari nol terhadap paket itu:
**19 langkah, 1.429 assertion, 0 gagal** (`C:/tmp/rantai-3.0.4-final.log`), `exit=0`
di setiap langkah Electron. Lintasan kapasitas 400.000 baris diukur ulang di atas paket
yang sama: **55 lulus / 0 gagal** (§3.1). Artefak 2.0.0/3.0.0/3.0.1/3.0.2/3.0.3 tetap
utuh di `dist-installer/`. Data live pengguna kembali tidak tersentuh:
`%APPDATA%\hems-heavy-equipment-system\fathoni.db` 716.800 byte, time stamp
2026-10-10 18:07, tanpa `-wal`/`-shm`, identik sebelum dan sesudah rantai.

**Penutup dokumentasi (setelah rantai, tanpa menaikkan versi lagi).** Pemakai minta bab
"cara membuat record" — form demi form, termasuk membuat akun login — dan bab itu
(lima tangkapan layar pembaca sebagai acuan) justru menghasilkan lima temuan baru
karena penulisnya harus membaca setiap `<label>` dan tombol simpan di sumber (§4.20).
Permintaan lanjutan "panduan tidak melampirkan gambar" menambah sepuluh gambar + satu alat
potret (§4.21). Tidak satu byte pun `src/`/`electron/` berubah setelah 19:55, jadi bukti
paket tetap berlaku; PDF panduan final **48 halaman, 3.438.313 byte** (23:44).

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

Angka diambil dari rantai 2026-10-12 terakhir (`C:/tmp/rantai-3.0.4-final.log`,
dijalankan terhadap paket 3.0.4 yang dibangun 19:25–19:27, setelah katalog Merek & Model
(§4.17) dan empat catatan panduan (§4.18) masuk): **19 langkah, 1.429 assertion, 0 gagal**,
`rusak: tidak`, dan **setiap langkah Electron keluar dengan kode 0** — bukan hanya
"penanda bilang nol".

| Jenis | Harness | Assertion | Yang dibuktikan |
|---|---|---|---|
| **Unit** | `validation-check` | 391 | aturan batas validator, sanitasi, `matchesQuery` (termasuk "SANY SY215C" dua kolom), checksum pemulihan, usulan nomor dokumen (`nomorBerikut`), sinkron daftar menu antar jalan masuk (§4.8), peta hidrasi per rute (§4.9), + penjaga statis (§5), termasuk empat penjaga bentuk-kode terbaru (§5), dua penjaga cara harness menunggu/membuka jendela (§4.13), lima penjaga bentuk jalur signing (`build-installer.ps1`, §4.14), penjaga kontrak Tahap 1 (§4.15), penjaga katalog Merek & Model + empat catatan yang ditutup (§4.17–§4.18): dua collection baru terdaftar di `SEMUA_COLLECTION`, `collectionNeeds`, `WRITABLE_BY_ROLE`/`requiredRoles`, validator `brands`/`models`, dropdown Unit membaca katalog dengan fallback, `BATAS_EKSPOR` 5.000 vs `BATAS_CETAK`/`MAX_PAGE_LIMIT` 500, jenis `BPKB`, target tautan empat tombol View All, dan penjaga siklus 3.0.5 (§4.23): 11 assertion gerbang anti-dobel biaya (§38) + 10 assertion tab riwayat kartu Unit (§39) |
| **Unit (lapisan data)** | `migration-check`, `db-store-check`, `db-backup-check` | 49 + 48 + 88 | migrasi sekali dari arsip lama, rencana tulis per collection, atomisitas simpan sebagian, snapshot |
| **Fungsional** | `gui-check`, `flow-check`, `usable-check`, `cetak-check` | 73 + 30 + 42 + 73 | tiap layar membuka, mengisi, mencari, memfilter, menyimpan; semua 30 entri rute di `App.tsx` (termasuk wildcard halaman detail) dilewati minimal satu harness — dijaga validation 16; tiga pintu masuk menu (sidebar, cari di topbar, Ctrl+K) menawarkan daftar yang sama dan sama-sama tergerbang profil/peran — usable 7.1–7.4; **sebelas dokumen cetak benar-benar diklik** dan isi jendela cetak dibandingkan dengan aplikasi aslinya (cetak 1–9 + C.9b bukti mutasi Gudang, §4.10, §4.18); tautan luar diblokir sebagai jendela Electron **dan** URL-nya tercatat diserahkan ke browser sistem (gui 8.1 + 8.1b), tanpa ada browser yang benar-benar terbuka lagi (§4.13) |
| **Integrasi (lintas menu)** | `handoff-check` | 176 | Pembelian→Gudang/Unit/Pemasok/Kas, Servis→Part/Invoice/Kas, Invoice→Kas, 6 menu katalog menghapus lewat patch (§4.1), hapus teknisi/operator yang masih disebut dokumen ditolak dari tombolnya sendiri (§4.6), usulan nomor dokumen yang benar-benar diklik di layanannya (§4.7), dan **Unit ← Merek & Model**: baris katalog yang disimpan di halaman Merek/Model muncul sebagai pilihan di formulir Unit (§4.17); dibaca hanya setelah penanda halaman benar-benar selesai, bukan saat masih "memuat" (§4.13) |
| **Integritas & transaksi** | `db-check`, `integritas-check`, `crud-check` | 136 + 74 + 32 | paritas SQL vs `matchesWhere`, `where` pada kunci `id`, rujukan saat hapus termasuk aturan ber-blob untuk orang, rollback penuh saat patch beracun, file tetap sehat setelah dibuka ulang |
| **Keamanan** | `auth-check`, `otorisasi-check`, `cetak-check`, `npm audit` | 58 + 49 + (cetak 10–15) + 0 kerentanan | balasan login tanpa password/hash/salt, pesan generik, lockout, sesi palsu ditolak, **tulis ditolak main process untuk peran yang bukan pemilik collection** (`WRITABLE_BY_ROLE` + token sesi + jejak audit, §4.15) — termasuk dua collection katalog yang ikut tergerbang di ketiga kelompok menu, CSP/sandbox/izin, injeksi formula CSV ditahan; jendela cetak diuji berdiri sendiri: CSP `default-src 'none'`, TIDAK ada `electronAPI` (tanpa preload), skrip di dalam data ditampilkan sebagai teks, dan dokumen kosong/bukan string/1,1 MB ditolak main process tanpa membuka jendela |
| **Performa (beban + stres)** | `perf-check` | 40 + 55 (lintasan kapasitas) | angka di §3 dan §3.1: rantai dasar sampai 50.000 baris, lalu 400.000 baris (100.000 per collection besar) dengan `HEMS_PERF_KAPASITAS=1`. P.12b kini menuntut **persis** jumlah baris katalog yang lewat IPC saat layar Unit dibuka, bukan sekadar "kecil" (§4.19) |
| **Kompatibilitas** | `compat-check`, `usable-check`, `smoke-paket` | 31 + (ukuran) + 28 | boot di profil lama hasil upgrade (kolom turunan dibuat + dihitung ulang, dan dua tabel katalog kosong ditambahkan tanpa backfill — §4.17), mode browser tanpa `electronAPI` (login demo, nol error renderer), jendela 1200 px tanpa pemotongan tabel, paket jadi FATHONI.exe di sandbox |
| **Ketahanan** | `tahan-check` | 32 | kanal gagal lalu pulih, kegagalan database tidak meninggalkan setengah tulis, ditutup paksa lalu dibuka ulang, sesi panjang tanpa crash; harness ini sengaja memakai satu profil bersama (§5) karena yang diuji justru kelangsungan satu proses panjang |
| **Regresi** | `regressi.sh` | 19 langkah | seluruh rantai di atas dijalankan berurutan; hasil dibaca dari penanda `SELESAI kode=N` milik harness, dan rantai memanggil `node_modules/electron/dist/electron.exe` langsung — bukan lewat `npx`, yang dulu menyisakan proses pembungkus tempat kode keluar bisa mati tidak bersih setelah semua assertion lulus (§5) |

## 3. Kapasitas: berapa banyak record yang tahan

Terukur di mesin ini (RAM 3,8 GB) pada profil uji terisolasi, mode WAL. Semua angka di
bawah dari rantai 2026-10-12 terhadap paket 3.0.4 (`tmp-harness/logs/perf.log` +
`db.log`, 40 assertion lulus; catatan RAM bebas saat db-check bagian 50.000 berjalan:
**424 MB dari 3.746 MB**):

| Titik ukur | Hasil |
|---|---|
| Boot pada profil 25.010 baris | proses sampai layar login siap **970 ms**, `domContentLoaded` **151 ms**, **0 baris** pindah lewat IPC |
| Membuka layar Unit di 12.000 unit | terisi dari SQLite, **10 baris** store lewat IPC — persis isi katalog merek/model, bukan armada (§4.19) |
| Kueri telanjang dari renderer, 12.000 baris | median **9 ms** |
| Agregat berindeks di 6.000 baris kas (`dbSum`) | median **1 ms**, KPI dihitung SQLite |
| Tulis satu baris lewat `dbPatch` | median **1 ms** |
| Simpan 50.000 unit dari main process | **1.027 ms** (membekukan event loop selama itu — tercatat, bukan tanpa batas) |
| Simpan ulang 50.000 unit dengan 10 baris berubah | **233 ms**, dan hanya 10 baris yang benar-benar ditulis (db-check 7.3) |
| Pencarian di layar Unit, 12.000 baris | median **228 ms** (debounce 200 ms termasuk) |
| Pencarian di layar Unit, 50.000 baris | median **261 ms** — tumbuh 1,15x untuk data 4x |
| Kueri telanjang di 50.000 baris | median **87 ms** |
| Berganti halaman | median **234 ms** |
| Ukuran DOM tabel | tetap **12 kartu** saat tabel tumbuh ke 50.000 baris |
| Memori | heap JS renderer **10 MB**, working set 176/178 MB per proses utama |
| Total baris profil uji | 63.010 di seluruh 20 collection, berkas **44,75 MB** |

Tabel di atas adalah angka dari jalan dengan kepala RAM longgar (424 MB bebas saat titik
50.000 diukur). Pembandingnya sudah tercatat di laporan ini sejak 3.0.2: rantai
`rantai-302e.log`, dijalankan ketika RAM tinggal ±0,3 GB, mencetak 40 assertion tetap
lulus dengan waktu yang berbeda — boot proses 1.872 ms, `domContentLoaded` 350 ms, cari
12.000 baris median 251 ms, kueri telanjang 22 ms, berganti halaman 240 ms, tulis satu
baris 1 ms, `saveStore` 50.000 unit 1.937 ms, dan cari pada 50.000 baris 639 ms. Selisih
terbesar persis di titik yang paling sensitif beban mesin — pembacaan `LIKE '%token%'` di
50.000 blob ketika Windows sedang kehabisan halaman memori. Dua hal yang tidak berubah di
antara dua jalan itu: **angka klaimnya** (DOM tetap 12 kartu, 0 baris lewat IPC, jumlah
record sama dengan `COUNT(*)`, tulis tetap satu baris) dan **status hijaunya**. Inilah
alasan ambang §4 lama ("simpan ulang harus >2x lebih cepat dari simpan penuh") sudah
diganti menjadi klaim bentuk (`inserted: 0, updated: 10, deleted: 0`): yang ingin ditahan
adalah sifat arsitekturnya, bukan waktu dinding yang bergantung pada mesin lain pada jam
yang sama. Lintasan kapasitas §3.1 di siklus ini **diulang di bawah tekanan RAM** (±0,1 GB
bebas ketika bagian 400.000 baris berjalan) dan hasilnya ada di tabel berikutnya — boot
yang dulu 966 ms kini terbaca 4.253 ms pada ambang yang sama (20 s), yang merupakan cara
terbaik untuk menunjukkan bahwa ambang waktu di mesin 3,8 GB ini mengukur Windows, bukan
aplikasi.

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
profil: 100.000 unit + 100.000 kas + 100.000 suku cadang + 100.000 invoice. Angka di bawah
diukur ulang di siklus ini **terhadap paket 3.0.4** (`C:/tmp/perf-kapasitas-304.log`,
55 lulus / 0 gagal) pada mesin dengan hanya ±0,1 GB RAM bebas — jadi kolom "Hasil"
menampilkan pengukuran paling buruk dari siklus ini, bukan yang paling enak dibaca.

| Titik ukur pada 400.000 baris | Hasil |
|---|---|
| Ukuran berkas `fathoni.db` | **233,17 MB** (±600 byte per baris), WAL, `integrity` lulus, `totalRows` 400.010 (400.000 + 10 baris katalog) |
| Boot aplikasi | **4.253 ms** terhadap ambang P.37 20 s — tidak tumbuh mengikuti isi berkas, karena boot tidak memindahkan baris (`reads.rows` 0 lewat IPC). Di jalan dengan RAM longgar titik yang sama mengukur 966 ms (3.0.3); selisihnya adalah Windows yang sedang memagangkan halaman, bukan aplikasi |
| Membuka layar Armada di 100.000 unit | **306 ms**, DOM tetap 12 kartu, **0 baris store** lewat IPC |
| Kueri pencarian pertama sesudah boot (LIKE di 100.000 blob, cache dingin) | **126 ms**, jumlah record benar (20.000) |
| Pencarian di layar pada 100.000 unit | 323–344 ms per kueri; lintasan kedua (cache hangat) median **324 ms**; jumlah yang tampil **sama persis** dengan `COUNT(*)` SQLite untuk kueri yang sama (P.39) |
| Kueri telanjang (`dbQuery`) median | **115 ms** |
| Agregat KPI kas di 100.000 baris (`dbSum`) | median **40 ms**, nilainya sama dengan `sumCollection` di main process |
| Menyimpan SATU baris di profil 400.000 baris (`dbPatch`) | median **1 ms**, dan nilainya terbaca kembali dari berkas |
| Menulis 400.000 baris sekaligus dari main process | **9.808 ms** — membekukan event loop selama itu. Rentang lintas siklus 9,8–37,3 s pada berkas yang sama; yang stabil adalah bentuknya (sekali tulis seluruh collection), bukan waktunya |
| Memori | heap JS renderer **10 MB**, working set 179–263 MB per proses — tidak bertambah saat berkas tumbuh dari 44 MB ke 233 MB |
| Total waktu rantai + uji kapasitas | **37 s**; 55 assertion lulus, 0 gagal |

**Pengukuran ulang 3.1.0 (17 Nov 2026, `C:/tmp/kapasitas-310c.log`, 56 lulus / 0 gagal)**
pada mesin yang sama: berkas **233,17 MB** / 400.010 baris; boot **1.350 ms**; layar Armada
di 100.000 unit **274 ms** dengan 0 baris store lewat IPC; pencarian hangat median
**326 ms**; `dbQuery` telanjang **108 ms**; `dbSum` kas **36 ms**; menulis 400.000 baris
sekaligus **6.500 ms**; tulis satu baris median **334 ms** (ambang 400 ms — commit pertama
sesudah impor massal menunggu checkpoint WAL; di profil 12.000 baris titik yang sama
23 ms). Working set 46–283 MB per proses, heap renderer 16 MB, total 30 s. P.42 sempat
merah dua kali karena harness menulis meter 2000–2008 ke baris yang lahir dengan
`hourMeter` 4999, sehingga gerbang meter-mundur 3.0.5 menolaknya dengan benar; harness
diperbaiki agar menulis maju (`dasar+1…+9`, diperiksa `dasar+9`) — produk tidak diubah.

Jawaban praktis: **400.000 baris teruji dan tetap ringan** untuk pemakaian sehari-hari
(buka layar, cari, agregat KPI, simpan satu baris). Yang berubah drastis di atas 50.000
hanya satu hal: simpanan collection penuh dari main process (impor massal / restore)
menjadi puluhan detik dan membekukan aplikasi selama itu. Selain itu, batas nyatanya
adalah (a) satu hal yang tidak diukur harness ini — pencarian `LIKE '%token%'` memindai
blob pencarian dan tidak bisa memakai indeks, jadi biayanya linear terhadap jumlah baris
(terukur 0,32–0,34 s pada 100.000 unit di siklus ini, dan 0,2–0,7 s lintas siklus di
mesin ini; pada juta baris angka yang sama
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

### 4.15 Tahap 1 (T1–T6): enam cacat operasional ditutup, lalu kalibrasi T7 membuktikan penjaganya peka

Enam perbaikan ini masuk ke sumber **setelah** paket 3.0.2, dan semuanya mengubah
perilaku, bukan hanya angka harness:

- **T1 — kategori pembelian.** BBM/CONSUMABLE tidak lagi ditolak saat disimpan. Karena
  baris lama boleh menyimpan kategori yang sudah berhenti ditawarkan, `Purchase.tsx`
  menambah satu opsi dari `PURCHASE_CATEGORY_LEGACY_LABELS` — tanpa itu browser menampilkan
  opsi pertama dan Simpan mengganti kategori record tanpa pernah diminta.
- **T2 — satu aturan servis berikutnya.** `+250` keras dibuang; jarak servis bersumber
  dari data unit. `electron/dbSchema.ts` menduplikasi literal siklus itu bukan karena lupa:
  `electron/` dikompilasi terpisah dari `src/`, jadi tidak bisa mengimpor konstanta renderer.
- **T3 — servis selesai menaikkan unit.** `hourMeter` dan `lastServiceHM` unit ikut
  diperbarui, sebelumnya hanya tercatat di lembar servis.
- **T4 — pembacaan meter yang mundur.** Kontraknya
  `validateHourMeterProgress(hmBaru, hmLama, { koreksi?, alasan? })`; kalau mundur, tulis
  ditolak sampai kotak koreksi dicentang **dan** alasan diisi, dan alasan itu meninggalkan
  jejak lewat `catatanKoreksiHourMeter`. Cacat aslinya bukan aturannya melainkan pemanggilnya:
  state layar bernama `koreksiHm.aktif` dikirim apa adanya, sehingga `opts.koreksi` selalu
  `undefined` dan gerbangnya tidak pernah bisa dipenuhi — centang + alasan tetap ditolak
  dengan pesan "centang ... dan isi alasannya". Sekarang dipetakan eksplisit di
  `Service.tsx` dan `Units.tsx`, dan penjaga `PEMETAAN_KOREKSI` di unit mengunci bentuk
  pemetaan itu.
- **T5 — biaya per jam & profitabilitas dihitung dari data**, bukan konstanta
  (`biayaPerJam: 85000` di Dashboard dihapus); kartu biaya hanya tampil di tab profil
  `PERSONAL`.
- **T6 — tulis ditegakkan di main process.** Setiap tulis membawa token sesi; peran
  dihitung ulang di main lewat `WRITABLE_BY_ROLE` / `bolehTulis()`, dan penolakannya
  menghasilkan `alasanTulis()` yang menyebut peran **dan** collection. `kas` milik
  `FINANCE`; `approvals`/`operators` hanya `SUPERADMIN`. Penyimpangan yang disengaja:
  migrasi saat boot berjalan tanpa sesi (tidak ada token sebelum login) dan dicatat sebagai
  pengecualian, bukan sebagai celah yang boleh ditiru.

**Kalibrasi T7: penjaga diuji dengan merusak kode, bukan dengan mempercayainya.** Delapan
mutasi dilepas satu per satu, masing-masing harus menjatuhkan assertion yang tepat, lalu
dikembalikan byte-per-byte dan rantai dicetak ulang:

| Mutasi | Yang dirusak | Yang jatuh |
|---|---|---|
| M13 | `dbSchema.ts` siklus servis 500 → 250 | unit + db (aturan T2) |
| M14 | `bolehTulis()` selalu `true` | `otorisasi-check` 43 → FAIL (T6) |
| M11 / M11b | opsi kategori Purchase di-hardcode | unit + usable (T1) |
| M12 | Dashboard `biayaPerJam: 85000` | handoff 6.5 (T5) |
| M9 | `dataStore` membekukan `hourMeter`/`lastServiceHM` | handoff (T3) |
| M10 | gerbang koreksi Service dilewati | `validation-check` `gerbangBerpetak` (T4) |
| M8 | `{ aktif, alasan }` dikirim ke API validator (bug asli) | unit 2/345 gagal — persis cacat yang dicari |

Kalibrasi ini menemukan **satu penjaga yang tidak peka**, dan itu temuan yang jujur:
`handoff-check` 6.5e membandingkan angka harapan dengan angka harapan (`harapan.map(h =>
h.biaya)` vs `h.biaya`), jadi dasbor yang memakai satu konstanta untuk semua alat akan
tetap lulus. Assertion itu ditulis ulang untuk membaca angka yang benar-benar tercetak di
kartu (`BIAYA TERCATAT Rp…/HM`) dan menuntut tiga unit berbeda menghasilkan tiga angka
berbeda; setelah itu M12 memang menjatuhkannya. Catatan teknis: di dalam template literal
harness, `[\d.]` kehilangan backslash-nya, jadi penulisannya `[\\d.]` — kesalahan pertama
menyebabkan penjaga baru selalu mengembalikan `["-","-","-"]`.

Setelah kedelapan mutasi dikembalikan: unit **345/0**, `handoff-check` **172/0**,
`otorisasi-check` **43/0**, lalu seluruh rantai 19 langkah hijau (§2).

### 4.16 Halaman Finish tidak lagi membuka aplikasi — dan cara lama mengukur ini ternyata salah

`installer/FATHONI-InnoSetup.iss` baris `[Run]` kini `nowait postinstall skipifsilent
unchecked`; `package.json` juga menyet `nsis.runAfterFinish: false`. Yang kedua itu
kebersihan konfigurasi belaka: installer yang diedarkan adalah **Inno Setup**, bukan NSIS,
jadi yang menentukan adalah `unchecked` di baris `[Run]` — padanan "kotak Jalankan tidak
tercentang secara default".

Mekanismenya diukur dengan probe (`C:\tmp\bukti-probe`; AppId tiruan `{PROBE-LAUNCH-2026*}`
supaya entri Program Features produksi tidak tersentuh, isi salinan `cmd.exe` bernama
`FATHONI.exe` yang cuma menulis berkas penanda):

| uji | hasil |
|---|---|
| `/SILENT` | entry `postinstall skipifsilent` tidak pernah jalan; log internal Setup mencatat tepat 1 `-- Run entry --` (kontrol) dan 0 penanda postinstall |
| `/VERYSILENT` | sama: postinstall tidak jalan |
| entry `[Run]` kontrol (tanpa `postinstall`) | `FATHONI.exe` **diturunkan oleh installer**: pid 2584, `ParentProcessId` = 14480, yaitu proses keluarga Setup (yang pada snapshot itu sudah keluar, jadi namanya tidak terbaca — tapi bukan `explorer`/`cmd`/PowerShell, dan `ExecutablePath`-nya persis berkas yang baru saja disalin ke `{app}`) |
| `/S` | Setup masih hidup setelah 14 detik menunggu wizard, 0 entry jalan → `/S` bukan switch senyap Inno (itu switch NSIS) |

Dua hal yang harus ditarik dari laporan QA lama: **"`/S` langsung menjalankan aplikasi
terhadap profil live"** dan alat ukurnya. Kesalahnya berlapis: switch-nya bukan switch
Inno, dan `& $exe` di PowerShell tidak menunggu proses GUI, jadi "`/S` keluar kode=1 setelah
3 s" yang tercatat waktu itu bukan hasil instal senyap sama sekali. Perbaikan `unchecked`
tetap dibuat — tapi karena kotak Finish 3.0.2 memang tercentang default, sehingga instal
yang diklik sampai Finish membuka aplikasi, bukan karena instal senyap bisa membuka profil.

Bukti runtime di 3.0.3 (walkthrough manual, dicatat oleh pemantau proses pasif): instal
interaktif selesai 17:11:10 (`unins000.exe` ditulis, 75 berkas, `unins000` + isi folder
terakhir 17:11:28), dan sejak 17:10:18 pemantau **tidak melihat satu pun proses
`FATHONI.exe` muncul**; 0 proses berjalan sesudahnya. Profil hidup tidak tersentuh:
`fathoni.db` SHA-256 `39895b51…f6d7b7` tetap, 0 sisa `fathoni.db-wal`/`-shm`,
`Preferences` masih bertanggal 16:18:21 (sebelum instal). Kontrol positifnya bukan dari
walkthrough: langkah `paket` di rantai sudah membuktikan `FATHONI.exe` hasil paket bisa
boot dengan jendela, jadi "tidak ada peluncuran" tidak bisa dibaca sebagai "aplikasinya mati".

Sisi lain yang muncul dari laporan sandbox eksternal: sampel yang diflag satu mesin
(Filseclab, verdict generik `UDS:Trojan.Generic.jyce`, 1 dari 27) adalah
`FATHONI-Setup-3.0.2.exe` — ukuran 83.147.834 byte dan SHA-256 `4fd2efc4…28511649` cocok
persis dengan artefak 3.0.2 di `dist-installer/`, bukan 3.0.3. Dua simpul FILE yang
dilingkari tidak cocok dengan berkas apa pun yang kita paketkan. Tepi graf
"Setup → FATHONI.exe" yang jadi dasar tuduhan itu sudah dijelaskan di tabel probe di atas
sebagai perilaku installer. Akar yang tersisa dan belum ditutup: **semua binari kita
`NotSigned`** (§6, §4.14).

### 4.17 Merek & Model menjadi data, bukan daftar di dalam layar (R1–R4)

**Cacatnya** tertulis di panduan 3.0.3 sebagai "batasan nyata": halaman Merek & Model
bekerja di atas daftar bawaan yang tidak pernah disimpan. Isi formulir hilang saat pindah
menu, dan dropdown Merek di layar Unit membaca konstanta `VALID_BRANDS` di dalam kode —
jadi dua tempat yang sama-sama bicara soal merek tidak pernah membaca sumber yang sama.

**Perbaikannya** mengikuti jalur yang sudah dipakai collection lain, bukan jalur baru:

- `brands` dan `models` menjadi collection SQLite (`electron/dbSchema.ts:152,159`) —
  **20 collection** sekarang. Keduanya punya kolom turunan dan blob `search` seperti yang
  lain, jadi pencarian "SANY SY215C" bekerja di halaman katalog tanpa kode khusus.
- `src/pages/Brands.tsx` memuat dan menulis lewat `useDataStore`, menghapus lewat
  `removeRow('brands')` / `removeRow('models')` — bukan menyaring array di memori, yang
  adalah pola yang dikunci §4.1 untuk enam menu katalog. Dua aturan yang lahir bersama
  halaman ini: **katalog awal (`src/data/katalogAwal.ts`) hanya masuk lewat tombol yang
  dikonfirmasi** — tidak ada auto-seed senyap, dan penjaganya memeriksa siapa yang
  mengimpor modul itu (harus tepat satu berkas: `pages/Brands.tsx`); dan **mengubah nama
  merek ditahan bila merek itu masih tercatat di unit**, karena rujukan antar menu memakai
  nama, bukan id.
- Jumlah model per merek dihitung dari katalog (`jumlahModel`), bukan field
  `modelCount` yang tersimpan dan lalu membeku — field seperti itu terlihat benar sampai
  model pertama ditambahkan, dan salah secara diam-diam sesudahnya.
- Peta hidrasi (`src/store/collectionNeeds.ts:43,46`): `/brands` dan `/units` sama-sama
  membutuhkan `['brands','models']`. Ini membuat halaman Unit membaca katalog dari
  database, dan pada profil 12.000 unit hanya **10 baris** katalog yang lewat IPC
  (§4.19).
- Fallback dinyatakan, bukan diimplisitkan: `merekPilihan = merekKatalog.length > 0 ?
  merekKatalog : VALID_BRANDS`. Basis data lama yang katalognya masih kosong tidak
  kehilangan kemampuan menyimpan unit. `validateBrand` kini menerima katalog sebagai
  argumen kedua dan penjaganya menguji dua arah: tanpa katalog daftar merek tertutup
  (`validateBrand('XCMG-Baru')` ditolak), dengan katalog merek baru diterima, dan merek
  yang ada di katalog selalu valid apa pun isi daftar bawaan.
- Karena ini collection baru, satu kegagalan bentuk lama ikut dikunci (validation §12d):
  `dataStore` menyusun `dataRef.current` dari satu literal berisi nama collection, dan
  nama yang hilang di sana **tidak pernah ikut autosave** — perubahannya hilang tanpa
  pesan. Penjaga membandingkan literal itu (dan peta `collectionSetters`, yang dibutuhkan
  hidrasi untuk bisa menulis) dengan `COLLECTION_KEYS`, dua arah: kurang maupun lebih.

**Penambahan ini sengaja non-destruktif.** Dua tabel Kosong, `DERIVED_REVISION` **tetap 5**,
tidak ada backfill terhadap profil live — itulah alasan pekerjaan ini bisa dikerjakan tanpa
izin khusus (§7: hanya perubahan kolom turunan/rev yang memaksa profil live ditulis ulang).
`compat-check` A.5b menguncinya: profil lama hasil upgrade mendapat dua tabel katalog kosong
**tanpa menyentuh satu baris pun** yang sudah ada (compat 30 → 31).

**Rujukan silang ikut hidup**, karena nama merek dan kode model adalah kunci yang dibaca
layar Unit: menghapus merek yang masih punya model di bawahnya, atau masih tercatat di
unit, sekarang ditolak dengan alasan yang menyebut dokumennya; merek tanpa unit tapi
yang modelnya berpindah tetap tertahan; kode model yang belum menjadi unit boleh dihapus
dan mereknya sendiri yang menahannya (integritas 2d-katalog, enam assertion baru —
integritas 68 → 74). Di level main process, `brands`/`models` dimasukkan ke ketiga
kelompok menu penulis (`MENU_SALES`/`MENU_GUDANG`/`MENU_SERVIS`,
`electron/authorization.ts:22–24`), dan penjaga baru **otorisasi 1.10** menuntut
`requiredRoles` di `Layout.tsx` dan hak tulis di main process cocok untuk **semua**
collection — bukan hanya yang dulunya ada (43 → 49).

*Bukti*: db-check 15.11 (peta rute hanya memuat collection yang benar-benar dibaca
halamannya — `/units` dan `/brands` sama-sama `brands,models`, dan tidak ada yang lain), perf P.12b (runtime:
membuka layar Unit di profil 12.000 unit memindahkan **tepat 10 baris**, yaitu isi katalog,
bukan armada), otorisasi 4b.1–4b.4 + 1.10 (tulis `brands`/`models` benar-benar lewat IPC
main process dan ditolak untuk peran yang bukan pemiliknya), compat A.5b (profil lama
mendapat dua tabel kosong tanpa menyentuh baris lama), integritas 2d-katalog (enam
penolakan hapus di atas), usable + tahan (rute `#/brands` ikut didatangi dan ditahan
lintas sesi). Yang TIDAK diklaim: `handoff-check` tidak membuktikan dropdown Unit
mengisi dirinya dari katalog yang baru disimpan — rantai membuktikannya lewat jalur
hidrasi (P.12b + 15.11), dan jalur "ketik satu merek lalu muncul di form Unit" adalah
skenario yang layak ditambahkan bila katalog ini mulai dipakai tim. Unit 345 → 370,
`MENU_HAPUS` 17 → 19 entri. Kalibrasi mutasinya di §4.19.

### 4.18 Empat catatan "belum berfungsi" di panduan 3.0.3 ditutup (R6)

Sweep atas `PANDUAN_PENGGUNA.html` menghasilkan empat cacat nyata — yang lain adalah
batasan yang benar, dan itu tetap ditulis apa adanya (§6, Bab 12 panduan). Satu klaim
lain jatuh oleh angka laporan ini sendiri: Bab 12 dan tabel syarat mesin menulis "boot
tetap di bawah 2 detik" pada 400.000 baris, sedangkan lintasan kapasitas 3.0.4 mengukur
**4.253 ms** terhadap ambang 20 s (§3.1). Kedua tempat itu sudah ditulis ulang menjadi
angka terukur plus janji yang benar-benar ditahan (waktu boot tidak tumbuh mengikuti isi
berkas karena boot tidak memindahkan baris), dan PDF-nya dibangun ulang (33 halaman,
2.279.393 byte):

- **Empat tombol View All di Control Tower** (`🚜 Units`, `🔧 Services`, `📦 Spareparts`,
  `💰 Invoices`, `src/pages/ControlTower.tsx:215–224`) adalah `<button>` tanpa
  `onClick`: tampilannya tombol, perilakunya teks — bisa diklik, tidak mengarah ke mana
  pun, sampai panduan 3.0.3 terpaksa menulis "papan ini untuk melihat, bukan untuk membuka
  dokumen". Kini keempatnya memanggil `navigate('/units'|'/service'|'/spareparts'|'/invoices')`
  dan dibuktikan RUNTIME, bukan statis: `handoff-check` 6.8V1–6.8V4 menekan tiap tombol di jendela
  sungguhan dan menuntut `location.hash` benar-benar berpindah (empat assertion ini yang
  menaikkan handoff 172 → 176). Status yang harus ikut dibaca: di dalam rantai 19:55
  keempatnya masih tercetak dengan id `6.8e` — id yang sama juga dipakai kartu riwayat
  passport, sehingga log rantai tidak bisa dibaca per baris. Ganti id menjadi
  6.8V1–6.8V4 dilakukan SESUDAH rantai dan hanya menyentuh label; harness-nya lalu
  dijalankan ulang sendiri dan hijau dengan angka yang sama (`C:/tmp/handoff-68V.log`,
  21:03 — `176 lulus, 0 gagal`, `SELESAI kode=0`, keempat PASS muncul dengan label baru).
  Yang belum: label baru itu tercetak di dalam RANTAI penuh; itu baru terbukti pada siklus
  berikutnya.
- **Cetak Bukti di Gudang** dulu hanya memunculkan `alert` berisi nomor bukti. Sekarang
  tombol itu menurunkan jendela cetak dengan formulir **BUKTI SERAH TERIMA MUTASI
  BARANG** (`src/pages/Warehouse.tsx:136`) dan tiga blok tanda tangan. Ini dokumen cetak
  kesebelas yang dibuktikan runtime: `cetak-check` menanam baris `warehouse` lalu mengklik
  tombolnya dan memeriksa jendela cetak sungguhan (C.9b) — bukan memeriksa bahwa
  fungsinya "bisa ditekan". Jumlah dokumen cetak runtime 10 → 11, cetak 67 → 73.
- **BPKB tidak ada di daftar jenis dokumen**, padahal panduan memakainya untuk bukti
  kepemilikan kendaraan. Jenis `BPKB (Bukti Kepemilikan Kendaraan)` ditambahkan ke satu-satunya
  daftar yang mengisi pilihan formulir (validation §37), karena daftar itulah sumbernya —
  menambah entri di tempat lain tidak akan muncul di layar.
- **Ekspor CSV Laporan tertahan di 500 baris** — sama dengan batas satu kueri layar,
  padahal ekspor bukan kueri tunggal. `src/pages/Reports.tsx` kini punya tiga angka yang
  berbeda dan masing-masing dijelaskan di tempatnya: `BATAS_KUERI = 500` (ditegakkan main
  process), `BATAS_TAMPIL = 500` / `BATAS_CETAK = 500` (PDF), `BATAS_EKSPOR = 5000`.
  Ekspor menelusuri halaman demi halaman lewat `dbQuery` ber-`offset` — halaman berikutnya
  meminta `limit: min(500, sisa)` dengan `offset = jumlah yang sudah terkumpul`, dan
  urutan `"<sortCol>", "pk"` membuatnya deterministik, jadi tidak ada baris yang terlewat
  atau terduplikasi di batas halaman. Cetak PDF **sengaja tetap 500**: dokumen 5.000 baris
  bukan sesuatu yang bisa dibaca di kertas, dan batas itu bukan keterbatasan teknis.
  Penjaganya validation §36 — dan ia periksa dua arah: `BATAS_EKSPOR` tidak boleh dipakai
  sebagai `limit:` satu kueri, karena itu cara lama yang diam-diam memotong di 500.

### 4.19 P.12b: alat ukur yang jatuh karena aplikasinya membaik

Rantai 3.0.4 yang pertama **gagal di `perf` P.12b**, dengan angka yang kelihatan seperti
regresi: `{"penuh":0,"sebagian":2,"baris":0}`. Yang terjadi justru sebaliknya — sejak R3,
rute `/units` **memang** menghidrasi `brands` + `models` agar dropdown membaca katalog,
sedangkan assertion lama menuntut *nol* panggilan subset. Alat ukurnya yang belum tahu
bahwa perilaku baru itu diinginkan.

Perbaikannya dibuat lebih ketat, bukan lebih longgar, dan itu yang membuatnya layak
dilaporkan: profil kinerja kini di-seed **10 baris katalog** (5 merek + 5 model,
`BARIS_KATALOG`), dan P.12b menuntut delta baris yang lewat IPC **persis 10** dengan
`sebagian ≤ 2` dan `koleksi ≤ 2`. `perf-check` juga menghidrasi lewat `dbLoad`/store penuh
di bagian lain, jadi penegasan "nol" lama tidak bisa dipertahankan tanpa merusak bagian
itu — dan "≥ 10" atau "baris < 100" tidak akan menahan apa pun.

*Kalibrasi mutasi*: `collectionNeeds.ts` diubah menjadi `units: ['brands','models','units']`
— satu armada ikut terseret. P.12b jatuh sendirian dengan
`baris: 12010, sebagian: 3, koleksi: 3` (40 assertion, 1 gagal), persis assertion yang
ingin dipakai; tidak ada langkah lain yang ikut berubah. Sumber dipulihkan byte-per-byte
dari salinan (`C:/tmp/mutbak/collectionNeeds.ts.r4asli`), seperti siklus-siklus sebelum
ini — memulihkan dengan menyalin berkas yang dikenal membuat "sudah kembali seperti
semula" bisa diperiksa, bukan dipercaya — lalu **paket diverifikasi ulang terhadap hasil
build**: `Dashboard-Ht6Kgwcg.js` adalah nama chunk yang sama di dalam `app.asar` maupun di
`dist/assets` hasil build (nama berkas Vite adalah hash isi, jadi nama yang sama berarti
isi yang sama), dan marker 3.0.4 (`BUKTI SERAH TERIMA MUTASI BARANG`,
`BPKB (Bukti Kepemilikan Kendaraan)`, `View All Units`, `3.0.4`) ada di dalam arsip.
Rantai kemudian diulang dari nol terhadap paket itu dan hijau 1.429/0
(`C:/tmp/rantai-3.0.4-final.log`, 19:55). Rantai yang gagal itu sendiri dibiarkan ada:
`tmp-harness/logs/rantai-304.log` tetap menyimpan `perf-check: 39 lulus, 1 gagal` dan
baris `rusak: perf` — supaya klaim "alat ukurnya yang salah, bukan aplikasinya" bisa
dibandingkan dengan log merah aslinya alih-alih hanya dipercaya dari laporan ini.

### 4.20 Bab 13 panduan: menulis "cara membuat record" menemukan lima cacat yang belum tercatat

Permintaan terakhir siklus ini bukan pengujian, melainkan dokumentasi: menambahkan bab
yang mengikuti jendela form satu per satu (§13.1–§13.10, sesuai lima tangkapan layar yang
diberikan — Unit, PO, Operator, Pemasok, Pelanggan — plus pembuatan akun login). Bab
seperti ini memaksa penulisnya membaca `<label>` dan tombol `Simpan` di sumber, bukan
hanya hasil akhirnya, dan justru dari situlah lima hal muncul. Kelimanya hasil membaca
kode hari ini, bukan dugaan, dan semuanya dibiarkan apa adanya di panduan (Bab 12 +
kotak merah di §13.2/§13.4/§13.5/§13.8) karena memperbaikinya berarti mengubah layar
setelah paket terverifikasi — jadi daftar tunggu rilis. 3.0.5 yang keluar hari ini
**tidak menyentuh kelimanya** (lihat §4.23: siklus itu hanya membawa gerbang kas kembar dan
riwayat kartu Unit, keduanya tanpa skema):

- **Harga perolehan unit tidak pernah ditanyakan, dan tidak bisa diubah dari layar.**
  `src/pages/Units.tsx:289` mengisi `purchasePrice: 1750000000` pada jalur create; tidak
  ada satu pun `<label>` harga di dalam jendelanya. Angka itu bukan hiasan: ia yang
  tampil di kartu unit (`Units.tsx:568`), di Equipment Passport
  (`EquipmentPassport.tsx:327`), di kolom "Nilai Perolehan" Laporan
  (`Reports.tsx:201/285/496`), dan menjadi pembagi di biaya per jam (`Dashboard.tsx:221`).
  Yang lebih jelek: `Units.tsx:415` tetap menjalankan
  `validateAmount(form.purchasePrice, 1000000, 10000000000)` atas nilai yang tak bisa
  dilihat itu — unit lama di luar range menolak tombol Simpan tanpa kolom yang bisa
  diperbaiki. Panduan lama menulis dua tempat seolah-olah usernya yang mengetik harga:
  Bab 4 langkah 2 dan baris "Nilai / harga perolehan" di Bab 6 — keduanya dikoreksi
  malam ini menjadi apa yang sungguh terjadi di layar.
- **Simpan yang diam di dua halaman master.** `Suppliers.tsx:31` dan `Customers.tsx:31`
  adalah `if (!form.name.trim()) return;` — tanpa pesan, tanpa tanda, jendela hanya
  menutup atau diam. Ini jenis cacat yang di laporan-insiden pengguna disebut
  "tombolnya mati", dan yang menyebabkan data dianggap tersimpan padahal tidak ada.
- **Bawaan lokasi Gudang bukan salah satu opsinya.** `Warehouse.tsx:61` menyetel
  `warehouseName: 'Yard Cikande Main Hub'`, sedangkan empat opsi dropdown
  (`Warehouse.tsx:30–35`, dirender di `:397`) semuanya berekor — `Yard Cikande Main Hub
  (Banten)`. `<select>` yang value-nya tidak ada di daftar tidak menolak; mutasi
  tersimpan dengan teks pendek itu sementara kartu yard di halaman yang sama menyebut
  nama lain.
- **Empat jendela form masih bergaya lama** — `Approvals.tsx:436`, `Breakdown.tsx:640`,
  `Operators.tsx:411`, `Technicians.tsx:450` memakai `<div className="modal-content">`
  dengan `<input>` polos. Kelas `.modal-content` tidak ada di stylesheet, dan kolom
  gelap datang dari `.form-input/.form-select/.form-textarea` (`src/index.css:413–422`),
  jadi kolomnya tampil putih di atas jendela gelap. Sekalian: label `Telepon *`
  (`Operators.tsx:438`, `Technicians.tsx:477`) tidak menahan kosong, karena
  `validatePhone` pulang lebih dulu di `validation.ts:269` (`if (!phone) return null`) —
  bintangnya berbohong. NIK juga hanya diperiksa panjangnya kalau diisi
  (`Operators.tsx:96`), dan tidak ada pemeriksaan duplikat NIK/NPWP/nama perusahaan di
  mana pun.
- **Lima jalur tulis masih memakai `alert` alih-alih pesan inline**: `SpareParts.tsx:130`,
  `Warehouse.tsx:176`, `Delivery.tsx:66`, `Finance.tsx:91`, `Documents.tsx:68`
  (ditambah `Invoices.tsx:227` untuk pembayaran). Menolak dengan benar — tidak ada
  record yang masuk — tapi tanpa menunjuk kolom mana yang salah. Ditulis di §13.10
  supaya pengguna tidak mengira penolakan itu kegagalan simpan.

Yang berubah di panduan: Bab 13 baru (10 sub-bab, tabel kolom per form dengan nama kolom
persis seperti di layar, §13.6 membuat akun, §13.9 tabel efek lintas menu, §13.10 tiga
sumber penolakan), entri Daftar Isi Bab 13, koreksi dua pernyataan harga di Bab 4/Bab 6,
dan enam butir baru di Bab 12. PDF dibangun ulang: **42 halaman, 2.545.436 byte**
(23:15, dari 33 halaman / 2.279.393 byte sebelum Bab 13; angka ini lalu dilewati lagi oleh
build bergambar 48 halaman — §4.21). Pemeriksaan keseimbangan tag
yang saya jalankan malam ini — menghitung pasangan buka/tutup setiap elemen di berkas
HTML, bukan menyimpulkan dari tampilannya — menemukan dua
markup rusak di Bab 2 yang sudah ada sejak versi 33 halaman: `</b pagar keamanan>`
(tanda penutup `<b>` ditulis salah, dan peramban memaafkannya sehingga tampilannya
kebetulan benar) dan satu `</p>` yatim di dalam `<div class="catatan">`. Keduanya
dibenahi, lalu satu kata Inggris yang lolos (`gelap everywhere`) dan satu jargon
teknis (`field`) ikut diganti; itu sebabnya PDF dibangun tiga kali pada malam yang sama
(23:06 Bab 13, 23:10 perbaikan markup, 23:15 perbaikan diksi) dan angka finalnya adalah
yang terakhir. Tidak ada sumber aplikasi yang
disentuh — jadi bukti rantai 19:55 atas paket 3.0.4 tetap berlaku; yang berubah hanya
berkas dokumen.

### 4.21 Panduan Bab 13 tanpa gambar: pembaca butuh melihat jendelanya, dan alat potret menemukan dua hal

Permintaan berikutnya atas Bab 13: *"Panduan pengguna tidak melampirkan gambar seperti
contoh yg saya berikan"* — lima tangkapan layar yang dilampirkan pembaca justru membuktikan
klaim itu: mereka membuka form yang sama, tapi nama filenya (`1.png` … `5.png`) tidak
membawa informasi apa pun.

**Yang dibuat.** `scripts/panduan-gambar.cjs` — perkakas baca-saja yang login ke aplikasi
pada profil sementara (`HEMS_DATA_DIR=D:/SANY/tmp-harness/r-panduan`), membuka satu per satu
jendela "buat record" yang belum punya gambar, dan menyimpan `capturePage()` ke
`panduan-gambar/`. Ia sengaja **tidak** ditaruh di `tests/harness/`: penjaga §15
(`validation-check.cjs:605–624`) mewajibkan setiap berkas Electron di folder itu menjadi
langkah rantai atau didaftarkan di `DI_LUAR_RANTAI`, dan perkakas dokumentasi bukan langkah
regresi. `package.json build.files` adalah allowlist (`dist/**`, `dist-electron/**`,
`better-sqlite3/**`), jadi `scripts/` dan `panduan-gambar/` tidak pernah masuk `app.asar` —
isi paket 3.0.4 dan bukti rantai 19:55 tetap berlaku. Yang dilakukan alat itu hanya
login → buka jendela → potret → tutup; tidak satu pun tombol simpan diklik. Satu-satunya
tulis adalah satu baris merek sementara (form Model menolak terbuka tanpa merek di katalog),
dihapus lagi di langkah terakhir (`BERSIH {"brands":{"deleted":1}}`).

**Hasil ukur.** 5 potret baru (`13-6-tambah-pengguna`, `13-7-tambah-merek`,
`13-7-tambah-model`, `13-8-tambah-suku-cadang`, `13-8-mutasi-gudang`; masing-masing
1184×809 piksel) + 5 gambar pembaca = **10 `<img>` di §13.2–§13.8** dengan caption bernomor
(Gambar 13-1 … 13-10). PDF: **48 halaman, 3.438.313 byte** (23:44), naik dari 42 halaman /
2.545.436 byte; sepuluh `/Subtype /Image` di dalam berkas membuktikan tidak ada gambar yang
gagal dimuat (yang gagal akan meninggalkan `<img>` rusak tanpa XObject).

**Dua hal yang ditemukan alat potret, bukan alat baca.**

- **Satu temuan lama menjadi lebih tajam, dan kini punya bukti visual.** Butir Gudang di
  §4.20 berbunyi "teks bawaan tidak persis sama dengan opsi dropdown". Hasil potret
  menunjukkan mekanismenya lebih persis: `Warehouse.tsx:61` menyimpan
  `warehouseName: 'Yard Cikande Main Hub'`, sementara opsi pertama
  `WAREHOUSE_LOCATIONS` (`:31`) bernama `'Yard Cikande Main Hub (Banten)'`. Karena
  `<select value={...}>` (`:392–400`) tidak punya opsi yang cocok, peramban **menampilkan
  opsi pertama** sambil menahan nilai yang tidak cocok itu — jadi yang tampil di layar dan
  yang tersimpan ke database berbeda, dan pengguna tidak punya cara untuk menyadarinya
  sebelum membaca Gambar 13-10. Jumlah temuan tidak bertambah (cacat yang sama, jalur yang
  sama `Warehouse.tsx:176`), tetapi bentuk perbaikannya sekarang jelas: samakan teks
  bawaan dengan salah satu opsi, bukan "pilih ulang dari daftar".
- **Nama berkas gambar tidak boleh dipercaya.** Pemetaan awal kelima lampiran pembaca
  (berdasarkan urutan angka di nama file) salah tiga dari lima: `3.png` ternyata *Tambah
  Pemasok*, `4.png` *Tambah Operator Baru*, `5.png` *Buat Purchase Order*. Ketiganya baru
  ketahuan dengan membuka tiap PNG dan membaca judul jendelanya, lalu pemetaan akhir
  dibuktikan dengan SHA-1 sumber ↔ tujuan (`1.png`=unit, `2.png`=pelanggan, `3.png`=pemasok,
  `4.png`=operator, `5.png`=PO). Persis jebakan yang sama membuat dokumen pernah menyebut
  label kolom yang salah; angka dan nama yang tidak diverifikasi terhadap sumbernya
  terdengar meyakinkan sampai seseorang membuka layarnya.

**Dua kegagalan alat sebelum hijau** (dicatat karena ini pola umum, bukan sial pribadi):
pertama, alat mengasumsikan shell langsung muncul setelah gerbang password, padahal profil
baru selalu berhenti di layar "Selamat Datang … Pilih satu atau lebih profil" — kini
profil bisnis ditandai selesai lewat `localStorage` lalu renderer dimuat ulang; kedua,
tombol "Tambah Model Unit" baru bernama begitu setelah tab *Spesifikasi Model Unit* aktif,
jadi tab harus diklik sebelum tombolnya dicari. Keduanya menghasilkan potret yang salah
atau nol potret tanpa pesan jelas kalau tidak diurutkan dengan benar.

Pola yang menyatukan kedua puluh temuan itu: yang rusak bukan satu menu, melainkan
asumsi bahwa data yang dibaca selalu lengkap, selalu berasal dari jalur yang sama, dan
selalu diceritakan dengan cara yang sama di setiap tempat — dan bahwa alat yang dipakai
untuk "merapikan", cara uji diakhiri, sampai angka di layar yang paling meyakinkan
(tombol yang kelihatan seperti tombol) sudah pasti aman.

### 4.22 Satu panduan per menu: 26 berkas, dan DOM yang menolak disalin dari kode

Permintaan: *"Buat tiap menu panduan nya sendiri-sendiri"*. Bentuknya diputus lewat dua
pilihan — **satu PDF per menu** dan **cakupan semua menu sidebar** — dan ternyata sidebar
memang 26 menu, bukan 21 seperti dugaan awal, sehingga bilangan itu ikut dikoreksi sebelum
satu baris pun ditulis.

**Yang dibuat.** `scripts/panduan-menu.cjs` berjalan di aplikasi sungguhan (profil sementara
lewat `HEMS_DATA_DIR`, jendela 1125×980 px CSS), login lewat gerbang password, menandai
profil bisnis selesai, menyemai baris uji ber-id `PG-*` lewat IPC `db-patch` supaya dropdown
tidak kosong dan tombol baris ada yang memotret, lalu untuk setiap menu: membuka layar,
memotret, membuka setiap jendela form, **membuang isi DOM-nya** (label, jenis kontrol,
tanda wajib, isi bawaan, pilihan dropdown, tombol kaki, tinggi isi vs tinggi tampak),
memotret, dan menutup. Hasilnya `panduan-menu/data.json`. `scripts/panduan-menu-build.cjs`
menyusun 26 berkas HTML + indeks dari JSON itu; tidak satu pun nama kolom diketik ulang.
Keduanya di `scripts/`, bukan `tests/harness/`: penjaga §15 mewajibkan berkas Electron di
folder harness menjadi langkah rantai, dan perkakas dokumen bukan langkah regresi.
`build.files` tetap allowlist, jadi `panduan-menu/` dan `scripts/` tidak masuk `app.asar` —
bukti rantai 19:55 atas paket 3.0.4 tidak dibatalkan. Yang tidak dilakukan alat ini:
tidak satu pun tombol simpan, hapus, terima barang, backup, restore, muat data contoh, atau
ekspor diklik.

**Hasil ukur.** 26 menu · 27 layar (Merek & Model dua tab) · 21 jendela form · 48 potret
1184×967 px · **175 kolom terbaca, 62 bertanda wajib, 7 terisi otomatis dan tidak dapat
diketik**. 21 dari 21 form muat tanpa menggulir pada tinggi 980 px (tinggi isi 318–777 px),
sehingga tidak ada kolom yang hilang dari gambar. Output: 27 PDF, **118 halaman, 8,5 MB**,
dengan 48 `/Subtype /Image` — sama dengan jumlah `<img>` yang dirujuk, jadi tidak ada potret
yang gagal tertanam. `PANDUAN_PENGGUNA.html` mendapat empat perubahan: entri Daftar Isi dan kotak
pengantar Bab 5 yang menunjuk indeks per menu, lalu dua koreksi yang muncul dari potret
yang sama — tab Cetak di §5.22 dan langkah 1 di §13.1 selama ini menyebut ukuran kertas
cetak seolah bisa dipilih, padahal kedua dropdown-nya tidak terhubung ke state mana pun.
Butir itu masuk Bab 12 sebagai batas yang diketahui. PDF-nya dibangun ulang dan tag-nya
diperiksa berpasangan: **48 halaman, 3.446.045 byte** (dari 3.438.313; jumlah halaman tidak
berubah).

**Yang hanya kelihatan dari layar, bukan dari kode.** Membaca sumber memberi tahu bahwa
sebuah kolom ada; membaca DOM memberi tahu bahwa panduannya akan salah kalau hanya
menyalah sumber. Empat hal muncul hanya dari potret:

- **Tujuh menu tidak punya `.page-title`** (Dasbor, Operator, Teknisi, Persetujuan,
  Breakdown, Pemeliharaan Sistem, Audit Log) dan **tujuh menu lainnya punya `.stat-card`
  tanpa `.card-title`/`.card-value`** (Dasbor, Operator, Teknisi, Persetujuan, Gudang, Breakdown, Audit Log; Unit dan Sewa memakai komponen kartu sendiri sehingga daftarnya nol total), sehingga
  kartu-kartu itu terbaca sebagai baris kosong oleh alat. Delapan layar tidak memakai
  `<table>` sama sekali. Konsekuensinya jujur: untuk menu-menu itu panduan menunjuk gambar
  dan mengatakan bahwa bagiannya berupa komponen rancangan halaman, bukan daftar kolom yang
  bisa dikutip.
- **"Spesialisasi" dan "Skills" di form Teknisi bukan `input` atau `select`** — keduanya
  guli pilihan buatan halaman, sehingga tidak terbawa ke tabel kolom dengan jenis yang
  benar. Tabel panduan menuliskannya sebagai "kontrol khusus".
- **Dua dropdown di tab Pengaturan Cetak** (Ukuran Kertas, Orientasi) tampil sempurna di
  gambar, dan justru karena potret itu diperiksa barulah dibaca sumbernya: `Settings.tsx`
  merendernya tanpa `value`/`onChange`, jadi pilihan pengguna tidak tersimpan dan tidak
  dipakai dokumen cetak mana pun.
- **Master Operator dan Teknisi tidak dipakai satu form pun.** `grep` atas halaman transaksi
  membuktikan nama teknisi/operator selalu teks bebas (`Service.tsx:747`,
  `Breakdown.tsx:240`), dan Rental hanya punya kotak centang "Termasuk Tenaga Operator".
  Ini bukan cacat baru, tetapi panduan per menu adalah tempat pertama ia dinyatakan apa
  adanya: dua menu master itu hari ini adalah katalog tanpa konsumen.

**Dua kegagalan sebelum hijau.** Jalan pertama berhenti pada satu menu: tombol tab Merek
bernama `🏷️ Daftar Merek (2)` sehingga pemicu berjangkar `^Daftar Merek` tidak pernah cocok,
dan tab kedua beserta form Model tidak ikut termuat. Perbaikannya bukan menambal hasil,
melainkan menjalankan ulang seluruh 26 menu — `data.json` yang sekarang berasal dari satu
jalan utuh (`0 gagal`), bukan tambal-sulam dua jalan.

**Angka pada gambar tidak boleh dibaca sebagai angka perusahaan.** Profil potret diisi data
contoh `PG-*`, jadi setiap berkas panduan mengatakannya di kaki halaman, bersama daftar aksi
yang sengaja tidak dijalankan. Profil live tidak disentuh (`fathoni.db` masih 10 Okt 18:07),
profil sementara sudah dihapus, dan `find src electron -newermt "2026-10-12 19:56"` tetap
kosong. Kalimat terakhir itu milik baseline 3.0.4: siklus 3.0.5 (§4.23) **memang** mengubah
`src/` dan `electron/`, dan justru itu sebabnya ada rilis baru, bukan tambal-lapor.

### 4.23 Cek ulang enam titik operasi → servis → BBM → biaya → Dashboard, dan rilis 3.0.5

Permintaan yang diperiksa ulang: (1) operator mencatat HM awal dan HM akhir di menu
Operasional, (2) sistem menghitung jam kerja sebagai selisih dengan validasi sehingga meter
tidak bisa mundur tanpa prosedur koreksi, (3) menu BBM menaut pemakaian ke alat dan periode
operasi yang benar, (4) Maintenance memasang jam servis berikutnya dari HM yang sah, (5)
Biaya mencatat transaksi terkait tanpa menghitung biaya yang sama dua kali, (6) Dashboard
dan Laporan menampilkan hasil yang sama dengan transaksi sumber — plus "lancar, aman,
securitynya terjamin". Enam-enamnya **diukur terhadap kode hari ini**, bukan diyakini.

Alat ukurnya `scripts/ops-chain-probe.cjs` (817 baris, jalan di profil potret sendiri):
**60 lulus / 0 gagal / 6 temuan**, `SELESAI kode=0` (`C:/tmp/b13-probe3.log`, 18:38).
Angka lulus/temuannya dipisah dengan sengaja: enam temuan itu bukan regresi, melainkan
perilaku yang memang belum ada di skema dan ditulis apa adanya.

| Titik | Status terukur | Bukti / kutipan |
|---|---|---|
| 1. HM awal & HM akhir | **belum ada** | `1.1 tidak ada SATU pun collection yang menyimpan pasangan HM awal & HM akhir — "jam kerja" tidak bisa dihitung dari selisih`; `1.2 tidak ada menu "Operasional" tempat operator mencatat pembacaan meter per hari`. Yang ada sekarang satu pembacaan per Work Order (`hourMeter`), dan itu yang dihitung, bukan selisih dua kolom. |
| 2. Meter tidak bisa mundur | **jalan, dan hakimnya di main process** | `6.1` menolak pembacaan mundur lewat IPC meski renderer tidak menanyakan, `6.1b` penolakannya disertai alasan terbaca, `6.1c` koreksi beralasan tetap diterima, `6.1d` menaikkan kembali meter setelah koreksi tidak menghapus kolom lain; `2.3` WO 520 HM (naik dari 440) tersimpan tanpa penolakan. |
| 3. BBM → alat + periode operasi | **belum tertaut** | `3.4 konsumsi BBM tidak menaut ke SATU pun alat: baris PO tidak punya kolom unit/serial`; `3.5 tidak ada periode operasi yang bisa ditaut ke pembelian BBM (hanya tanggal order & terima)`; `3.3` PO kategori BBM sendiri bisa disimpan. |
| 4. Jam servis berikutnya dari HM sah | **jalan** | `2.6` servis selesai menulis `units.hourMeter = 520` (bukan dibiarkan 440), `2.7` `lastServiceHM = 520`, `2.8` kolom turunan SQLite `500 - (520 % 500) = 480`, `2.8b` alat dengan 40 HM tersisa tidak dianggap jatuh tempo. |
| 5. Biaya tidak dihitung dua kali | **jalan untuk tiga jalur; satu jujur-tapi-memalukan** | `4.3`/`4.4` layar Kas menolak biaya kedua dengan referensi+tipe+kategori yang sama dan tidak menutup modalnya, `4.5` referensi lain tetap boleh, `4.6` menyunting baris sendiri bukan duplikasi, `4.7` **main process** menolak baris kembar lewat IPC — penjaga yang tidak hanya ada di form; `7.3` dobel hitung bertahan lintas muat ulang (bukan artefak tampilan). Sisanya dicatat sebagai temuan `2.13b`: biaya aktual yang diketik saat menyelesaikan servis **tidak pernah sampai ke baris Work Order**, jadi kolom "Biaya (aktual / estimasi)" di kartu Unit selalu menunjukkan estimasi sementara uang aktualnya hanya ada di Invoice/Kas. |
| 6. Dashboard/Laporan = transaksi sumber | **jalan untuk meter; BBM masih putus** | `5.1` SQLite menjumlah meter armada = 520 HM, `5.3` kartu HM Dasbor sama dengan `SUM units.hourMeter`, `5.7`/`5.8` Laporan menampilkan angka yang sama; `5.4` biaya per jam menyebut penyusutan yang dihitung dari data. Temuan `5.5`: Dasbor menyatakan BBM "belum tercatat per unit" — pembelian solar Rp36 juta hari ini tidak masuk biaya per jam sama sekali (jujur, tapi rantainya putus). |
| Keamanan | **jalan di paket jadi** | `7.1`/`7.2` aplikasi dan meter bertahan setelah muat ulang di bawah gerbang otorisasi; rantai §15 menahan dua sisi peta peran cocok; `smoke-paket` 28/0 dijalankan terhadap `FATHONI.exe` hasil build, termasuk penolakan tulis tanpa sesi sah. |

**Lima perbaikan tanpa skema yang masuk 3.0.5** (dan hanya karena itu rilis baru masuk
akal): gerbang meter-mundur dan gerbang kas-kembar dipindah ke `db-patch` di main process,
angka hiasan per unit di `Units.tsx` diganti riwayat nyata, enam tombol `alert()` di kartu
Unit menjadi navigasi nyata, penjaga anti-dobel biaya dipakai di tiga jalur, dan tab
riwayat kelima dibaca lewat query atas nomor sasis. Skema tidak disentuh: `1.1`, `1.2`,
`3.4`, `3.5`, `5.5` dan `2.13b` menahan kolom/blob baru, yang wajib disertai
`DERIVED_REVISION` 5→6 + backfill profil live dan masih menunggu izin eksplisit.

**Alat ukurnya sendiri dikalibrasi, bukan hanya dibaca hijau.** `C:/tmp/kalibrasi-tab.cjs`
memutasi data potret dua kali, masing-masing dengan penjaga "kalau berkas masih asli,
berhenti": kontrak sewa ditaut ke sasis lain → **tepat satu** assertion merah (`2.14`);
teknisi pada Work Order ditukar (`Agus` → `Budi`) → **tepat satu** merah (`2.13`). Setelah
dua mutasi, berkas probe kembali **identik secara sha-256**. Jadi klaim "tab membaca data"
diuji dengan cara membuatnya salah, bukan dengan cara melihatnya benar.

**Tidak ada alur menu lain yang rusak.** Sebelum pemaketan, enam harness dijalankan satu
per satu terhadap sumber yang sudah diperbaiki — `gui` 73, `flow` 30, `otorisasi` 49,
`handoff` 176, `crud` 32, `usable` 42: **402 assertion, 0 gagal**
(`C:/tmp/ui2-*.log`, 18:45–18:47). Setelah pemaketan, rantai penuh
`tests/harness/regressi.sh` terhadap paket jadi: **19 langkah / 1.450 lulus / 0 gagal**,
`rusak: tidak`, `proses keluar tidak bersih: tidak`, audit dependensi 0 kerentanan
(`C:/tmp/rantai-305.log`, 19:26–19:29). Unit `validation-check` naik 370 → 391 (§38 dan §39).

**Yang TIDAK diulang di sini**: lintasan kapasitas 400.000 baris
(`HEMS_PERF_KAPASITAS=1`, 55 assertion) — `perf` yang hijau di rantai ini adalah jalur beban
standar 40 assertion. Dan satu kalimat yang perlu dipegang: angka 1.450 adalah angka
**rantai terhadap paket**, bukan jumlah yang sama seperti 3.0.4 (1.429) karena 21 assertion
§38/§39 baru.

**Bukti paket, bukan bukti pohon sumber**: `app.asar` (4.511.034 byte) memuat satu cocok
string `mutasi gudang tidak menyimpan nomor sasis` dan **nol** cocok untuk `SPK-2025-012`;
profil live `fathoni.db` masih 716.800 byte, mtime 2026-10-10 18:07.

**Dokumentasi disegarkan dari potret aplikasi hari ini, bukan dari laporan lama.**
`scripts/panduan-menu.cjs` dijalankan ulang terhadap sumber 3.0.5: **26 menu, 27 layar,
21 form, 0 gagal** (`/tmp/panduan-305.log`, 19:42, `SELESAI kode=0`), lalu
`scripts/panduan-menu-build.cjs` menyusun 26 berkas + indeks dan 27 PDF-nya dibangun ulang
(19:45–19:46); stempel versi di alat susun sudah 3.0.5. `PANDUAN_PENGGUNA.html` ikut
dikoreksi pada empat tempat yang berubah perilakunya (kartu Detail unit §5.4, prosedur
koreksi meter §5.4, penolakan kas kembar §5.20 dengan pesan yang dikutip persis dari
`src/utils/validation.ts`, catatan pembuka) dan pada satu klaim yang salah: kalimat
"Diperbaiki pada 3.0.5" untuk empat jendela form bergaya lama — diperiksa ke sumber,
gaya itu **belum** disentuh, jadi ditulis apa adanya sebagai sasaran 3.0.6. Lima janji
"sasaran 3.0.5" lainnya (kolom harga perolehan, kolom operator di kontrak rental, tombol
status Pengiriman, tab Cetak Pengaturan, dua bentuk form §4.20) dipindah menjadi 3.0.6
karena 3.0.5 tidak menyentuhnya. PDF panduan utama: **50 halaman / 3.471.228 byte**
(22:38). Tidak ada `src/` atau `electron/` yang berubah pada bagian dokumentasi ini —
penjaga statis dijalankan ulang sesudahnya dan tetap **391 lulus / 0 gagal**, jadi bukti
rantai 19:29 terhadap paket tetap berlaku.

## 5. Penjaga anti-regresi (bukan assertion fungsi)

`validation-check` §12, §15–§39 menahan bentuk kode, bukan hanya hasilnya:
peta `MENU_HAPUS` 19 entri collection (termasuk `brands` + `models` sejak 3.0.4) + larangan
filter-array di halaman ber-`useDataStore`;
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

Tiga kelompok penjaga baru masuk di siklus 3.0.4 (unit 345 → 370):

- **§12 diperluas + §12b/§12c/§12d.** `MENU_HAPUS` bertambah dua entri (`brands`,
  `models`, keduanya dari `Brands.tsx`), sehingga aturan "hapus lewat `removeRow`, bukan
  menyaring array" berlaku untuk katalog baru ini sejak hari pertama. §12b menahan bentuk
  halamannya: katalog dibaca dari `useDataStore` dan bukan `useState` lokal, nama merek
  wajib unik dan model wajib berdiri di bawah merek yang ada, jumlah model dihitung dari
  katalog (`jumlahModel`, bukan field beku), ganti nama merek ditahan bila masih dipakai
  unit, **katalog awal hanya boleh masuk lewat tombol yang dikonfirmasi** — termasuk
  pemeriksaan bahwa hanya satu berkas (`pages/Brands.tsx`) yang mengimpor
  `data/katalogAwal`, karena store yang mengimpornya akan mengembalikan auto-seed senyap
  yang sudah dibuang di Fase 3 — dan nama merek katalog harus sama dengan cara `units.brand`
  mencatatnya, atau pemeriksaan rujukan tidak akan pernah menemukan rujukannya. §12c
  menahan sisi Unit: dropdown dari `merekKatalog` dengan fallback eksplisit, tidak ada lagi
  `<option value="SANY">` yang ditulis tangan, merek di luar katalog tetap bisa dibaca dan
  disimpan ulang, kode model disarankan dari katalog (`kodeModelKatalog(form.brand)` +
  `list="unit-kode-model"`), dan `validateBrand` diuji dua arah terhadap katalog. §12d
  adalah penjaga yang menahan kegagalan yang paling sunyi: literal `dataRef.current` di
  `dataStore` dan peta `collectionSetters` harus menutup **tepat** `COLLECTION_KEYS` —
  collection yang hilang dari sana tidak ikut autosave dan hidrasinya tidak bisa menulis,
  tanpa satu pesan pun.
- **§36 menahan cara ekspor Laporan mencapai 5.000 baris**, bukan hanya angkanya:
  `BATAS_KUERI = 500` dan `BATAS_EKSPOR = 5000` wajib ada sebagai dua konstanta terpisah,
  `BATAS_EKSPOR` **tidak boleh** muncul sebagai `limit:` satu kueri (itu cara lama yang
  diam-diam memotong di 500), pemanggilan penelusuran per halaman harus ada di kedua
  jalur ekspor (penjaga non-vakum: jumlahnya harus dua), dan teks di layar yang menyebut
  batas harus memakai `{BATAS_EKSPOR}` supaya janji UI tidak tertinggal dari kode.
- **§37 menahan bahwa `BPKB` adalah entri daftar jenis yang sebenarnya**, karena daftar
  itulah satu-satunya sumber pilihan formulir — menambah string di tempat lain tidak akan
  pernah menampilkannya.

Kejujuran tentang cara penjaga baru ini diuji: yang **dibuktikan dengan mutasi** pada
siklus ini adalah jalur hidrasinya (§4.19 — `collectionNeeds.ts` dibelokkan dan P.12b
jatuh sendirian). Penjaga statis §12b/§12c/§12d/§36/§37 hijau pada kode yang benar dan
dirancang agar tidak bisa hijau pada kode lama (misalnya §12d membandingkan dua arah, dan
§12c menolak `<option value="SANY">SANY</option>` yang memang bentuk lama), tetapi
masing-masing belum dibungkam satu per satu dengan merusak sumbernya seperti §28/§29 di
atas. Itu tercatat sebagai sisa di §6, bukan dilupakan.

Dua kelompok penjaga baru masuk di siklus 3.0.5 (unit 370 → 391):

- **§38 — sebelas assertion: satu pembayaran tidak bisa masuk kas dua kali (titik 5).**
  Empat kasus validator murni (`noError`: baris tanpa referensi, nomor referensi lain,
  tipe berbeda atas dokumen yang sama, sunting baris yang sama), dua penolakan (nomor baris
  penahan disebut dalam pesan; huruf besar/kecil dan spasi tidak meloloskan dobel yang sama;
  daftar bukan array tidak meruntuhkan gerbang), lalu tiga penjaga pemasangan — karena
  gerbang yang tidak dipanggil sama dengan gerbang yang tidak ada: jalur otomatis
  `addKasEntry`, form manual `Finance.tsx` (periksa dulu, baru `commit`, dan modal tidak
  ditutup saat ditolak), dan hakim terakhir `db-patch` di main process yang memanggil
  `kasKembarCacat(` sebelum `transact(` dan mencatat penolakannya sebagai `DATA_DENY`.
  Penjaga kesepuluh menahan pengecualian yang memang harus ada: `db-save` (migrasi boot +
  Restore) **tidak** boleh memanggil kedua gerbang, kalau tidak setiap boot akan ditolak.
- **§39 — sepuluh assertion: tab riwayat kartu Unit adalah data, bukan hiasan.** Bentuk yang
  dikunci: tiga belas literal riwayat lama (`SPK-2025-012`, `KNT-2025-001`, `INS-ALLIANZ`,
  `GARANSI AKTIF`, dan sembilan lainnya) tidak boleh muncul satu pun di `Units.tsx`; tidak
  ada `onClick={() => alert(` di kartu detail; WO dan kontrak dibaca lewat
  `useCollectionQuery` dengan `kunciUnit = { serialNumber: serial }` dan ikut terpicu oleh
  `savedTick.services`/`savedTick.rentals`; lima tab memakai satu komponen
  `<UnitRiwayat>` (tidak ada jalur kedua yang bisa kembali berisi contoh); tiga hal yang
  memang tidak punya kolom penaut wajib **diucapkan** beserta alasan datanya, bukan dikarang;
  lima tombol menyerahkan pengguna ke menu pemilik record-nya (`/service` dengan unit
  terisi, `/service` dengan `cari`, `/rental`, `/documents`, `/spareparts`); tiga halaman
  tujuan menyambut state itu dan tetap mengambil calon nomor dari `nomorBerikut` di file,
  bukan dari array; dan peta status tunggal `labels.ts` dipakai Servis, Rental, dan kartu
  Unit bersama-sama.

Sisi runtime dari §39 justru yang dikalibrasi dengan mutasi (§4.23): dua perubahan data di
profil potret masing-masing menjatuhkan tepat satu assertion (2.14 dan 2.13) lalu berkas
probe kembali identik secara sha-256. Penjaga statis §38/§39 hijau pada kode yang benar dan
dibentuk agar tidak bisa hijau pada bentuk lama, tetapi belum dibungkam satu per satu
dengan merusak sumbernya seperti §28/§29 — sisa itu tercatat di bawah dan di §6.

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
- **Verdict antivirus eksternal belum dijawab, dan tidak bisa dijawab per-perilaku.**
  Sampel yang diunggah ke sandbox eksternal dan diberi skor 85/100 adalah
  `FATHONI-Setup-3.0.2.exe` (83.147.834 byte, SHA-256 `4fd2efc4…28511649`) — **bukan**
  3.0.3. Dari 27 mesin, satu (`Filseclab`) menyebut `UDS:Trojan.Generic.jyce`; tidak ada
  perilaku spesifik yang dituduhkan, dan dua simpul FILE yang ditandai tidak cocok dengan
  berkas yang kita paketkan (§4.16). Yang belum dilakukan: mengirim sampel untuk tinjauan
  false-positive ke pembuat tanda tangan itu, dan — akar yang sama dengan poin di atas —
  menandatangani paket. **3.0.3, 3.0.4 dan 3.0.5 belum pernah** discan di layanan itu; satu-satunya
  sampel yang punya verdict adalah artefak 3.0.2 di atas.
- **Walkthrough usability oleh manusia**: semua yang tercatat di §2 adalah pengukuran
  otomatis; tidak ada sesi diterimanya alur kerja oleh pemakai sebenarnya. Satu
  pengecualian kini tercatat: walkthrough halaman Finish installer 3.0.3 dikerjakan
  manual dan direkam oleh pemantau proses (§4.16) — itu membuktikan perilaku instalasi,
  bukan penerimaan alur kerja pengguna.
- **Yang tersisa dari bukti cetak**: `cetak-check` mengklik tombol cetak di 11 layar dan
  memeriksa jendela cetak sungguhan (§2, §4.9, §4.18), tetapi harness mengganti
  `webContents.print` dengan perekam — karena `silent: false` akan membuka dialog cetak
  asli yang menggantung tanpa tangan. Jadi yang terbukti adalah **dokumen sampai ke
  jendela cetak dengan bentuk dan opsi yang benar (A4 + latar)**, bukan kertas yang keluar
  dari printer tertentu, dan bukan kualitas driver/printer di lapangan.
- **Anggaran performa masih dilonggarkan**: boot < 15 s, domReady < 12 s, cari median
  < 800 ms, kueri < 400 ms, patch < 250 ms. Angka §3 jauh di bawahnya (cari 228 ms,
  kueri 9 ms, patch 1 ms), tapi ambangnya sendiri belum disepakati sebagai target rilis —
  menaatinya masih belum bisa disebut "kinerja yang dijanjikan", baru "regresi tertangkap".
- **Kapasitas di atas 400.000 baris** belum diukur (§3.1 sudah menutup 100.000 per
  collection besar). Yang belum terukur: juta baris, dan khususnya biaya pemindaian
  `LIKE '%token%'` pada blob pencarian di atas jumlah itu — ia linear terhadap baris,
  bukan indeks, jadi itu titik pertama yang akan terasa lambat.
- **Katalog Merek & Model diukur pada 10 baris, bukan pada bentuk besarnya.** `brands` dan
  `models` dimuat **penuh** ke renderer (halamannya memang menyunting array utuh, dan
  form Unit butuh daftar merek), jadi P.12b justru menuntut angka kecil yang persis.
  Katalog perusahaan dengan 5.000 merek + 20.000 model belum diukur pada jalur itu — ini
  satu-satunya collection baru yang belum punya lintasan berpaginasi, dan paginasinya
  akan menuntut perubahan halaman (`dbQuery` + `Pager`) seperti layar besar lain, bukan
  perubahan skema.
- **Lima temuan §4.20 diverifikasi dari sumber, bukan dari rantai.** Tidak ada satu pun
  assertion yang membuktikan misalnya "harga unit tidak bisa diubah" atau "nama pemasok
  kosong ditolak tanpa pesan" — ketentuannya memang bukan untuk diuji, karena yang
  dilaporkan adalah perilaku yang ada, bukan regresi. Cara membacanya: baris kode yang
  dikutip di §4.20 bisa dibuka sendiri, dan nanti pada rilis berikutnya masing-masing perbaikan
  baru layak menjadi assertion — `usable-check`/`crud-check` untuk bentuk jendelanya
  (kolom harga yang benar-benar ada, pesan yang benar-benar muncul saat nama kosong),
  `validation-check` untuk bentuk kodenya (satu angka bawaan tidak lagi ditulis sebagai
  konstanta di dalam jalur create). 3.0.5 yang keluar hari ini tidak menyentuh kelimanya
  (§4.23), jadi sampai saat itu statusnya **cacat yang diketahui dan
  didokumentasikan**, bukan "sudah diuji".
- **Sepuluh gambar §4.21 memotret keadaan bawaan, bukan keadaan berhasil.** Yang terlihat
  adalah jendela form sesaat setelah dibuka di profil kosong: teks placeholder, nilai awal,
  nomor usulan. Yang TIDAK difoto: form terisi, pesan validasi yang muncul setelah simpan
  ditolak, jendela Edit, dan tiga dari empat jendela bergaya lama (hanya Operator yang
  mewakili Teknisi/Breakdown/Persetujuan, karena bentuknya sama persis). Peramban juga
  memotret pada skala DPI mesin ini (1125 px CSS → 1184 px berkas), jadi angka piksel itu
  bukan ukuran jendela yang harus dicari pengguna.
- **Uji kapasitas tidak ikut rantai default.** Bagian 11 `perf-check` hanya jalan dengan
  `HEMS_PERF_KAPASITAS=1` (menulis 400.000 baris, ±2 menit, dan pada mesin 3,8 GB RAM ia
  bersaing dengan cache berkas). Angka §3.1 siklus ini berasal dari lintasan manual
  2026-10-12 terhadap paket 3.0.4 (`C:/tmp/perf-kapasitas-304.log`), bukan dari
  hijau/merahnya `regressi.sh`.
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
  keputusan. Ditunda ke 3.0.6 (tetap tertunda setelah 3.0.5 rilis 13 Oktober, karena
  paket itu sengaja tidak menyentuh skema turunan); panduan 3.0.4 menulis status
  ini apa adanya (§5.8).
- **Penjaga statis 3.0.4 belum masing-masing dibungkam.** Jalur hidrasi katalog dibuktikan
  peka lewat mutasi (§4.19); §12b/§12c/§12d/§36/§37 baru hijau pada kode yang benar.
  Bentuknya sudah melawan kode lama (mis. §12c menolak `<option value="SANY">SANY</option>`
  dan §12d membandingkan dua arah), tetapi belum satu-per-satu dirusak untuk melihat
  assertion mana yang jatuh — disiplin yang sudah diterapkan ke §24, §27, §28, §29 dan
  delapan mutasi Tahap 1 (§4.15).
- **Dua status Pengiriman masih tidak bisa dicapai lewat tombol** ("Tiba di Lokasi" dan
  "Dibatalkan" tidak punya pemicu di layar), dan membuat Surat Jalan **tidak** mengubah
  status unit atau menulis baris Kas. Ini bukan cacat yang baru muncul di 3.0.4 — ia adalah
  sisa yang sudah ada, dan karena tidak bisa diperbaiki tanpa memutuskan alur bisnisnya
  (siapa yang menandai tiba? apakah pengiriman menghasilkan mutasi kas?), panduan 3.0.4
  menulisnya sebagai batasan di Bab 12 alih-alih memperbaikinya diam-diam.
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
- **Collection baru boleh ditambahkan sebagai tabel kosong; kolom turunan tidak.**
  `brands` + `models` masuk ke `COLLECTION_KEYS`, `dbSchema`, `collectionNeeds`,
  `WRITABLE_BY_ROLE`/`requiredRoles`, dan `MENU_HAPUS` **tanpa** menyentuh
  `DERIVED_REVISION` (tetap 5) dan tanpa `ensureColumns` atas profil live — karena tidak
  ada baris lama yang perlu dihitung ulang. Begitu seseorang menaikkan revisi itu atau
  mengubah bentuk kolom turunan, setiap profil yang ada (termasuk
  `%APPDATA%\hems-heavy-equipment-system\fathoni.db` milik pengguna) di-backfill saat
  boot, dan itu butuh izin eksplisit sebelum dikerjakan (§4.17 adalah contoh jalur yang
  aman).

## 8. Cara menjalankan ulang verifikasi ini

```bash
npm run build && npm run build:electron        # bundel renderer + main
npm run make:installer                         # paket (win-unpacked) + FATHONI-Setup-<versi>.exe
sh tests/harness/regressi.sh                   # 19 langkah, log di D:/SANY/tmp-harness/logs
HEMS_PERF_KAPASITAS=1 node_modules/electron/dist/electron.exe tests/harness/perf-check.cjs   # lintasan kapasitas 400.000 baris (§3.1)
HEMS_SIGN_PFX=... HEMS_SIGN_PASS=... powershell -File build-installer.ps1  # build + tanda tangan (§6)
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --no-first-run --user-data-dir=C:/tmp/chrome-pdf --no-pdf-header-footer --print-to-pdf=D:/SANY/PANDUAN_PENGGUNA.pdf file:///D:/SANY/PANDUAN_PENGGUNA.html   # panduan: HTML -> PDF (50 halaman / 3.471.228 byte per 13 Okt 22:38; dulu 33 tanpa Bab 13, 42 dengan teksnya, 48 setelah gambar ditanam)
HEMS_DATA_DIR=D:/SANY/tmp-harness/r-panduan node_modules/electron/dist/electron.exe scripts/panduan-gambar.cjs   # potret jendela form untuk Bab 13 (§4.21); profil sementara, hapus folder itu setelahnya
HEMS_DATA_DIR=D:/SANY/tmp-harness/p-opschain node_modules/electron/dist/electron.exe scripts/ops-chain-probe.cjs   # probe enam titik rantai operasi→servis→BBM→biaya→Dashboard + keamanan (§4.23): 60 lulus / 0 gagal / 6 temuan; BUKAN bagian rantai 19 langkah
HEMS_DATA_DIR=D:/SANY/tmp-harness/r-panduan-305 node_modules/electron/dist/electron.exe scripts/panduan-menu.cjs   # potret ulang 26 menu + 21 form ke panduan-menu/data.json (§4.22); hanya data contoh PG-*, tidak pernah klik Simpan/Hapus
node scripts/panduan-menu-build.cjs              # susun 26 berkas panduan menu + indeks dari data.json itu, lalu PDF-nya satu per satu lewat Chrome di atas
```

`regressi.sh` harus dijalankan **setelah** `make:installer`, bukan sebelumnya: bukti rilis
adalah rantai yang dijalankan terhadap paket yang diedarkan, dan langkah terakhir rantai
(`smoke-paket`) menguji `FATHONI.exe` hasil paket. Mengubah `src/` atau `electron/`
setelah pemaketan membatalkan bukti itu — itu sebabnya siklus ini menaikkan versi ke 3.0.4
dan membangun ulang, bukan menambal laporan lama (§1).

Yang berubah SESUDAH rantai hijau 19:55 pada siklus ini tidak menyentuh kedua folder itu:
dokumen QA, `tests/harness/README.md`, panduan pemakai + PDF-nya, dan **baris teks** di
sembilan berkas harness — kesembilannya contoh pemakaian `npx electron ...` di kepala
berkas yang bertentangan dengan larangan §4.12, jadi ditulis ulang menjadi
`node_modules/electron/dist/electron.exe ...` (plus satu typo `SEBELUMElektron`, plus
ganti id `6.8e` → `6.8V1–6.8V4` di `handoff-check` yang dijelaskan di §4.18). Isi
executable tidak berubah; itu diperiksa, bukan diasumsikan: `node --check` pada
kesembilan berkas (nol SyntaxError), `handoff-check` dijalankan ulang sendiri dan hijau
dengan angka yang sama (176/0), dan langkah `unit` diulang karena penjaga §15 dan §28
MEMBACA TEKS berkas harness — 370 lulus / 0 gagal, angka yang sama seperti di dalam rantai.
Tidak ada langkah Electron lain yang dijalankan ulang untuk ini, dan itu disengaja: yang
diuji rantai adalah paket, bukan komentar alat ukurnya.

Setelah paragraf di atas masih ada dua penambahan dokumen lagi: **Bab 13 panduan**
(§4.20), koreksi dua pernyataan harga di Bab 4/Bab 6, enam butir Bab 12, entri Daftar
Isi; lalu sepuluh **gambar** yang ditanam di §13.2–§13.8 beserta alat potret dan
folder `panduan-gambar/` (§4.21). PDF dibangun ulang terakhir kali pukul **23:44 —
48 halaman, 3.438.313 byte**. Berkas HTML itu sekarang membaca gambar lewat jalur
relatif, jadi PDF hanya benar kalau `panduan-gambar/` ikut ada di sampingnya. Sekali lagi
tidak ada `src/` atau `electron/` yang berubah, jadi bukti rantai 19:55 tetap berlaku;
yang perlu diingat hanyalah bahwa angka "33 halaman" di §4.18 dan "42 halaman" di §4.20
adalah keadaan sebelum gambar, bukan berkas yang sekarang ada di disk.

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

## 9. Rilis 3.1.0 — 2026-11-17 (siklus otomatisasi, terverifikasi terhadap paket)

Bagian ini mencatat siklus audit-implementasi-uji yang berakhir sebagai rilis 3.1.0.
Paket dibangun dari sumber hari ini dengan `npm run build` + `build:electron` +
`electron-builder`, installer dikompilasi Inno Setup, lalu rantai penuh dijalankan
terhadap paket itu. Catatan rilis 3.0.5 di atas tidak diubah dan tetap menjadi sejarah.

### §9.1 Celah yang ditemukan di sumber

Audit menemukan kontrak yang dideklarasikan tetapi tidak pernah ditegakkan, ditambah dua
efek samping yang bisa berulang:

1. `dbSchema` menyatakan `duplicates` per collection (serial number, nomor invoice, nomor
   PO, dan seterusnya), tetapi satu-satunya pembacanya adalah `integrity()` — nomor kembar
   baru ketahuan setelah laporan integritas dijalankan, bukan saat barisnya ditulis.
2. Invoice otomatis aman karena id-nya deterministik (`INV-SVC-<nomor WO>`), tetapi invoice
   manual atau dari versi lain bisa menagih satu sumber dua kali dengan id berbeda.
3. Tidak ada penjaga yang mencegah satu unit berada di dua kontrak sewa aktif yang
   periodenya beririsan.
4. `completeService` menjalankan efek samping (potong stok, mutasi gudang, naikkan HM,
   buat invoice) pada setiap panggilan; panggilan kedua mengulanginya. `actualCost` dari
   modal juga tidak pernah ditulis ke baris Work Order.

### §9.2 Yang diimplementasikan

`electron/automation.ts` (baru, murni, tanpa akses SQLite) berisi tiga penjaga:
`dokumenKembarCacat`, `invoiceSumberKembarCacat`, dan `sewaTumpangTindihCacat`. Aturannya
sama untuk ketiganya dan sengaja dibuat konservatif:

- hanya baris **baru** yang dinilai; menyunting baris yang sudah ada selalu lolos, sehingga
  profil yang terlanjur memuat data kembar masih bisa diperbaiki;
- nilai kosong tidak pernah dianggap bentrok (banyak baris warisan tidak punya nomor);
- perbandingan nomor tidak peka huruf besar/kecil dan di-trim;
- sewa hanya dinilai untuk status AKTIF dengan serial dan dua tanggal `YYYY-MM-DD` yang sah,
  dan dua kontrak baru dalam satu patch juga saling dibandingkan;
- `removeIds` pada patch yang sama melepaskan nomor yang dihapus.

`electron/main.ts` memanggil ketiganya di dalam `db-patch`, setelah gerbang peran/sesi dan
sebelum transaksi, memakai satu cache `barisLama(nama)` agar satu collection tidak dimuat
tiga kali untuk satu klik. Setiap penolakan diaudit `DATA_DENY` lalu dikembalikan sebagai
`{ error, dilarang: true }`. `db-save` tetap dikecualikan karena tugasnya memang membawa
berkas lama apa adanya (migrasi boot dan Restore).

`src/store/dataStore.tsx`: `completeService` menjadi idempoten (WO `COMPLETED` langsung
kembali), `actualCost` hanya ditulis bila angkanya sah, dan `patchRows` yang berhasil kini
membersihkan `storageWarning`. `src/pages/Service.tsx` mengunci tombol sebelum
`completeService` dipanggil supaya klik ganda tidak mengirim dua kali.

### §9.3 Bug nyata yang ditemukan rantai

Banner merah “Perubahan pada "customers" TIDAK TERSIMPAN ke database” menetap setelah
tulisan berikutnya berhasil. Penyebabnya: jalur patch sukses hanya memanggil
`setHasUnsavedChanges(false)`, tidak pernah `setStorageWarning(null)`; `persist()` juga
tidak membersihkannya saat tidak ada collection kotor. Akibatnya operator diberi tahu
datanya hilang padahal sudah masuk file. Diperbaiki di `patchRows` dan dikunci assertion
unit (`dataStore: peringatan gagal simpan dibersihkan setelah tulisan berhasil`) serta uji
runtime `tahan A.14`.

### §9.4 Alat ukur yang ikut diperbaiki

Tiga kegagalan rantai pertama bukan cacat aplikasi, melainkan harness yang basi:

- `perf P.21` membandingkan kartu “Kas Masuk/Keluar **Bulan Ini**” dengan total sepanjang
  waktu, sementara data uji bertanggal tetap `2026-10-xx`. Setelah bulan berganti layar
  benar menampilkan Rp 0. Seed kini memakai bulan berjalan, patokan P.21 memakai filter
  bulan yang sama, dan angka nol ditolak supaya profil salah tanggal tidak lolos.
- `compat B.10` mengukur tabel Kas sesudah kotak cari muncul, padahal hook paginasi masih
  dalam debounce 200 ms (keadaan “memuat” yang sudah pernah menjatuhkan rantai). Kini
  menunggu penanda `dari 3 record`; tanggal seed juga memakai bulan berjalan.
- `smoke-paket` menganggap aplikasi “terbuka” padahal instalasi baru berhenti di pemilih
  profil bisnis, sehingga seluruh rute berikutnya hanya membaca layar itu. Harness kini
  menyelesaikan pemilih profil (Pilih Semua → Mulai Gunakan), menambahkan assertion 2.4
  “benar-benar masuk menu utama”, dan mengizinkan kunci pengaturan `hems_business_modes`
  yang memang ditulis sekali oleh layar tersebut.

`tahan A.14` juga kini mencetak teks banner yang tersisa saat gagal, bukan hanya `false`,
supaya kegagalan berikutnya langsung bisa didiagnosis.

Dua percobaan rantai terhadap paket 3.1.0 sempat merah karena balapan yang sama di
harness: setelah `reload()`, harness menyetel hash tujuan (`#/units` pada `perf`,
`#/spareparts` pada `compat`) sebelum redirect rute awal selesai, sehingga redirect itu
menimpa hash dan layar tujuan tidak pernah tampil (masing-masing menunggu 60/30 detik di
halaman lain). Rerun sendirian membuktikan aplikasinya sehat (`perf` 40/0, `compat` 31/0
dengan profil baru). Perbaikannya di harness: tunggu `.sidebar-item.active` sebelum
berpindah layar, lalu assertion `perf P.9b` dan `compat A.7b` mengunci prasyarat itu.
Tidak ada perubahan produk untuk dua kegagalan tersebut.

### §9.5 Hasil pengujian 2026-11-17

Rantai penuh `sh tests/harness/regressi.sh` (`C:/tmp/regressi-310c.log`), terhadap paket
3.1.0: migration 49, unit 395, otomatisasi 33, auth 58, otorisasi 62, gui 73, flow 30,
handoff 176, usable 42, crud 32, cetak 73, db 136, integritas 74, compat 32, perf 41,
tahan 32, store 48, backup 88, smoke-paket 28 — **1.502 assertion, 0 gagal**,
`rusak: tidak`, `proses keluar tidak bersih: tidak`, dan `exit=0` di setiap langkah.
`npm audit`: 0 kerentanan (tinggi/kritis 0, sedang 0, rendah 0). Langkah `paket` pada
rantai ini menguji `FATHONI.exe` 3.1.0 yang dibangun hari yang sama, bukan exe 24 Oktober.

Kenaikan dari 1.450 (3.0.5): unit +4, otorisasi +13 (tiga penjaga lewat IPC sungguhan),
harness baru `automation-check` 33, plus `perf P.9b` dan `compat A.7b`. `validation-check`
juga memuat assertion untuk `dataStore` (idempotensi, `actualCost`, pembersihan banner)
dan urutan kunci kirim ganda di layar Servis.

Biaya penjaga diukur terpisah pada 100.000 unit: memuat collection 265–465 ms dan
pemeriksaan 22 ms per tulisan; pada 12.000 unit P.23 (satu baris lewat `db-patch`) tetap
di bawah 250 ms.

### §9.6 Batas yang harus disebut

- **Tidak ada perubahan skema**; `DERIVED_REVISION` tetap 5 dan profil live
  `%APPDATA%\hems-heavy-equipment-system` tidak disentuh.
- Paket 3.1.0 ditandatangani 17 Nov 14:08–14:11: `app.asar` 4.522.534 B SHA-256
  `6cbdb3e7…c931ff5` (tidak berubah oleh signing); `FATHONI.exe` 177.026.440 B SHA-256
  `dd790ef7…9f01b4b`; `dist-installer/FATHONI-Setup-3.1.0.exe` 83.166.464 B SHA-256
  `4a49e2a6…ea39732`, ProductVersion 3.1.0. Keduanya **TERSIGN** dengan sertifikat
  **internal/self-signed** (`CN=FATHONI EQUIPMENT OS, OU=Internal Code Signing`,
  thumbprint `2D4FAE84…B722DB`, timestamp DigiCert, `verify /pa` lulus). SmartScreen tetap
  muncul di mesin yang belum memasang sertifikat itu; distribusi luas tetap menunggu
  sertifikat OV/EV publik. Rantai 1.502 diukur pada binari unsigned (`C:\tmp\riwayat\`);
  setelah signing, `smoke-paket` diulang 28/0 pada exe bertanda. Dua perbaikan harness
  sesudah pemaketan hanya mengubah `tests/` dan tidak masuk `app.asar`, jadi bukti paket
  tidak batal.
- Lintasan kapasitas 400.000 baris **dijalankan ulang pada 3.1.0** (17 Nov,
  `C:/tmp/kapasitas-310c.log`): **56 lulus / 0 gagal**, berkas 233,17 MB / 400.010 baris,
  boot 1.350 ms, tulis satu baris 334 ms (ambang 400 ms). P.42 sempat merah karena harness
  menulis meter mundur dan ditolak gerbang 3.0.5 dengan benar; yang diperbaiki harness,
  bukan produk. Angka kapasitas §3.1 untuk 3.0.4 tetap dibiarkan sebagai riwayat.
