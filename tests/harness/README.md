# Harness verifikasi Fase 2, 3 & 4

Jalankan dari folder proyek, setelah `npm run build` dan `npm run build:electron`.
Sepuluh harness bertenaga Electron dipanggil lewat biner Electron langsung, bukan
`npx electron` — lihat catatan "cara mengakhiri proses" di bawah:

```
ELEKTRON=node_modules/electron/dist/electron.exe

node tests/harness/migration-check.cjs
node tests/harness/validation-check.cjs
"$ELEKTRON" tests/harness/auth-check.cjs
HEMS_DATA_DIR=D:/SANY/tmp-harness/r-gui     "$ELEKTRON" tests/harness/gui-check.cjs
HEMS_DATA_DIR=D:/SANY/tmp-harness/r-flow    "$ELEKTRON" tests/harness/flow-check.cjs
HEMS_DATA_DIR=D:/SANY/tmp-harness/r-handoff "$ELEKTRON" tests/harness/handoff-check.cjs
HEMS_DATA_DIR=D:/SANY/tmp-harness/r-usable  "$ELEKTRON" tests/harness/usable-check.cjs
"$ELEKTRON" tests/harness/cetak-check.cjs
"$ELEKTRON" tests/harness/db-check.cjs
"$ELEKTRON" tests/harness/integrity-check.cjs
"$ELEKTRON" tests/harness/compat-check.cjs
"$ELEKTRON" tests/harness/perf-check.cjs
HEMS_PERF_KAPASITAS=1 "$ELEKTRON" tests/harness/perf-check.cjs   # bagian 11: 400.000 baris, ±2 menit
node tests/harness/db-store-run.cjs
node tests/harness/db-backup-run.cjs
node tests/harness/smoke-paket-check.cjs
```

Satu perintah untuk semuanya: `sh tests/harness/regressi.sh` — menjalankan kelima belas
harness di atas plus `npm audit` secara BERURUTAN (mesin 3,8 GB RAM; dua harness Electron paralel membuat
yang kedua macet di tengah layar), membersihkan folder `HEMS_DATA_DIR` milik gui/flow/
handoff/usable lebih dulu, menyimpan log lengkap di `D:/SANY/tmp-harness/logs/<nama>.log`, dan
mencetak satu baris ringkasan per harness (`exit`, jumlah `FAIL`, baris "N lulus, M gagal").
Rantai keluar non-zero bila ada harness yang gagal. Rantai resolve
`node_modules/electron/dist/electron.exe` sendiri dan berhenti dengan `RAMBU` + `exit 8`
kalau berkas itu belum ada (belum `npm install`), alih-alih menjalankan separuh langkah
dengan `npx` yang gagal di tengah.

### Cara proses diakhiri menentukan rantai bisa dipercaya atau tidak

Dulu `regressi.sh` memakai `npx electron tests/harness/<nama>.cjs`. Akibatnya ada proses
node npm di antara rantai dan Electron: ia menambah ±60 MB di mesin 3,8 GB ini dan
menyediakan satu tempat lagi untuk mati tidak bersih. Dan itu benar-benar terjadi —
72 assertion gui-check lulus semua, tapi proses induknya keluar dengan `Segmentation fault`
(139), sehingga rantai ditandai rusak tanpa satu pun uji yang gagal. Mitigasinya bukan
menebak: harness wajib keluar lewat `tests/harness/selesai.cjs` (menutup koneksi SQLite lalu
mencetak `SELESAI kode=N` sendiri), dan rantai menilai hasilnya dari baris penanda itu, bukan
dari kode keluar. Setelah pemanggilan `electron.exe` langsung ditambahkan, 34 percobaan keluar
proses (12 dengan koneksi ditutup, 12 dengan koneksi dibiarkan terbuka, 8 gui-check penuh)
seluruhnya kode 0, dan rantai 16 langkah mencetak `proses keluar tidak bersih: tidak` —
jadi baris `exit=` di log kini berarti sesuatu.

Dua hal yang menahannya tetap benar (validation §15, diderivasi bukan ditulis tangan):
- Daftar harness Electron dibaca dari baris `"$ELEKTRON" tests/harness/<nama>.cjs` di
  `regressi.sh` ditambah harness yang di-spawn orkestrator `*-run.cjs`. Menambah langkah
  rantai baru otomatis ikut wajib `selesai()`; tidak ada lagi daftar tulis-tangan yang
  ketinggalan (cara `cetak-check` dulu lolos dari pemeriksaan ini).
- Satu pengecualian dinyatakan eksplisit: `profile-inspect.cjs` adalah perkakas baca profil
  untuk manusia, bukan langkah regresi, jadi ia boleh memakai `app.exit`.
  `regressi.sh` sendiri juga tidak boleh kembali mengandung `npx electron`.

`selesai.cjs` dinilai dari kodenya setelah komentar dibuang — kepala berkasnya sendiri
membahas `app.exit()`, dan teks penjelasan tidak boleh membuat penjaga mengira kodenya
mengandungi panggilan itu.

- `migration-check.cjs` — logika murni (node, tanpa Electron): bundel `dataMigration`,
  `invoiceFactory`, dan `revenue` lewat esbuild dengan shim `localStorage`.
- `auth-check.cjs` — unit store akun. Aman tanpa variabel apa pun: ia membuat folder
  sendiri lewat `fs.mkdtempSync(os.tmpdir())`. Hal yang sama berlaku untuk
  `compat-check.cjs` dan `perf-check.cjs` — keduanya mengisi folder barunya sendiri
  sebelum `dist-electron/main.js` dimuat, jadi tidak pernah menyentuh profil pengguna.
- `gui-check.cjs` — CSP, sandbox, dan penolakan IPC dari halaman asing. Bagian 11
  mengulang penolakan untuk SEMUA kanal database (load/patch/save/query/sum/group/
  stats/snapshot) dan membuktikan penolakannya tidak membocorkan path profil maupun
  meninggalkan residu di file; bagian 13 mengirim argumen rusak dari DALAM aplikasi
  (tabel sistem, collection asing, baris tanpa id, `where` berisi potongan SQL,
  `limit` 100.000, `offset` negatif, kolom kelompok asing, operator di luar daftar
  putih) dan bagian 14 menulis–membaca–menghapus lewat IPC
  untuk memastikan percobaan itu tidak merusak isi database. Bagian 15 mengunci
  kontrak subset kanal `db-load`: daftar nama hanya mengembalikan yang diminta,
  nama asing DAN argumen bukan daftar ditolak (kalau diterima lalu dilewati kosong,
  halaman akan menimpa collection itu dengan kosong), dan `reads.fullCalls` tetap
  nol sepanjang sesi — jendela aplikasi tidak pernah meminta seluruh store.
- `flow-check.cjs` — alur login, layar wajib ganti password, pemulihan sesi, halaman Pengguna.
- `handoff-check.cjs` — handoff Pembelian→Gudang/Pemasok/Kas, Servis→Part/Invoice,
  Invoice→Kas, dan halaman Laporan/Dasbor/Kas/Gudang/Control Tower/Equipment Passport,
  di atas profil yang datanya sudah berada di SQLite. Bagian 6 membandingkan SETIAP
  angka kartu dengan hasil `dbSum`/`dbGroup`/`dbQuery` yang dibaca harness langsung dari
  database (Laporan 6.3b/6.3d, Dasbor 6.5b, fleet Control Tower 6.8c, riwayat passport
  6.8e), dan menuntut daftar panjang hanya menampilkan satu halaman (6.3f). Bagian 7
  dan 8 memeriksa halaman berpaginasi: penanda halaman menyebut jumlah record sebenarnya
  dari database, hasil tulis terlihat di halaman pertama tanpa menunggu debounce,
  pencarian/penyaringan dikerjakan sisi SQL, dan satu simpanan sebagian tidak menghapus
  baris di luar yang berubah. Bagian 9 memeriksa #38 dari layar sungguhan: membuka dua
  menu yang menghidrasi collection-nya sendiri tidak menaikkan `reads.fullCalls` dan
  hanya memindahkan sebagian baris dari file (delta, karena harness sendiri memakai
  muat penuh untuk membaca kondisi), foto base64 benar-benar berpindah ke berkas saat
  halaman Unit dibuka meski array `units` di memori kosong, modal foto menyebut nomor
  sasis kartu yang diklik, nomor rangka ganda ditolak, dan usulan No. Bukti Mutasi
  Gudang melanjutkan nomor tertinggi di file (ditanami `TRX-<tahun>-888` yang tidak
  ada di array halaman, lalu usulan harus lewat dari 888). Bagian 10.19 menekan tombol
  "Buat SPK Baru" dengan tiga SPK bernomor 901–903 di file dan baris tertinggi sudah
  dihapus: usulan harus 903, bukan jumlah baris. Bagian 10.18 menekan
  tombol hapus di menu Teknisi dan Operator untuk satu orang yang namanya masih
  tertulis di dokumen: yang diharapkan bukan hanya "gagal", tapi alert menyebut
  menunya (Work Order Servis / Surat Jalan) sementara barisnya dan dokumennya dua
  duanya masih ada di file.
- `cetak-check.cjs` — dokumen cetak dijalankan SUNGGUHAN, bukan hanya dijaga statis.
  Harness memasang telinga pada `app.on('web-contents-created')`: jendela aplikasi dicari
  dulu, lalu setiap `BrowserWindow` yang muncul sesudahnya adalah jendela cetak dan
  `webContents.print` milik jendela itu diganti dengan perekam (opsi + callback), sehingga
  harness yang menutup jendela tanpa menunggu printer. Untuk 10 dokumen baris
  (Penjualan, Pembelian, Rental, Invoice, Pengiriman, Servis, Breakdown, Operator, Teknisi,
  Persetujuan) harness mengklik tombol cetak yang paling dekat dengan nomor dokumen —
  bukan sembarang tombol "Cetak" di toolbar — lalu menuntut: jendela cetak terisi, isinya
  DOKUMEN (nama perusahaan ada, `#root` aplikasi tidak, url `data:text/html`), `print()`
  dipanggil sekali dengan A4 + `printBackground`, jendela ditutup lagi, tidak ada alert
  "Gagal mencetak", dan tidak ada artefak template (`undefined`/`[object`). Baris rusak
  hasil suntingan tangan (kolom array berupa string, kolom array hilang) tetap harus bisa
  dicetak — dari sinilah cacat `Technicians.tsx` ditemukan. Empat keadaan berbahaya ikut
  dikunci: XSS di nama/email/ catatan ditampilkan sebagai teks (0 `<script>`, 0 `<img>`,
  `window.__cetakBocor` tak pernah terdefinisi), jendela cetak membawa CSP
  `default-src 'none'` dan TIDAK punya `electronAPI` (tanpa preload), serta penjaga main
  process menolak dokumen kosong/bukan string/1,1 MB dengan pesan yang disebut ke renderer
  tanpa membuka jendela baru. Sisa jendela harus tepat satu dan aplikasi tetap sehat.
  Folder datanya dibuat sendiri (`mkdtemp`), jadi tidak menyentuh profil pengguna.
- `db-check.cjs` — lapisan SQLite di main process: skema, write-behind berbasis hash,
  paginasi/filter, patch per baris (`saveRows`), kesamaan hasil pencarian dengan
  renderer, migrasi kolom turunan pada profil lama (`ALTER TABLE` + indeks),
  integritas, dan kapasitas. Bagian 12 dan 13 mempertahankan aturan `where` dan
  agregat: nilai penyaringan yang rusak dari renderer tidak boleh membuat kueri
  melempar, nama kolom asing harus dilewati, `sqlite_master` tidak boleh terbaca, id silang
  collection tidak boleh menghapus di collection lain, dan `__proto__` bukan nama
  collection yang sah. Bagian 13 membandingkan SETIAP bentuk `where` (kesamaan,
  `IN`, dua batas sekaligus, `BETWEEN`, `op`/`value`, operator asing) dan setiap
  kelompok (`month`, `serviceDueIn`, `stockShortfall`, `groupCollection` satu/tiga/
  empat kolom) dengan hasil JavaScript pada baris yang sama — sisi renderer diambil
  langsung dari `src/domain/derivedColumns.ts` dan `useCollectionTotals.ts` lewat
  bundle esbuild `totals.entry.ts`, jadi paritas desktop vs mode browser ikut
  terbukti, bukan hanya diasumsikan. Bagian 14 menguji bentuk agregat yang justru
  dipakai halaman Laporan/Control Tower/Equipment Passport: `where` pada kunci `id`,
  lima COUNT fleet, selisih dua SUM piutang, jendela jatuh tempo, kelompok
  `month`+`type`, riwayat servis per nomor sasis, dan `isoDay` lokal — setiap hasil
  SQLite dibandingkan dengan loop JavaScript atas baris yang sama DAN dengan
  `matchesWhere` sisi renderer. Bagian 15 adalah lapisan #38: `loadStore(names)` hanya
  mengembalikan yang diminta, jejak baca (`reads.fullCalls`/`subsetCalls`/
  `subsetCollections`/`rows`) mencatat bentuk jalur yang dipakai, `rowCounts()` sama
  dengan `stats().totalRows`, kolom turunan `inlinePhoto` identik dengan
  `inlinePhotoOf` di renderer, dan matriks empat keadaan `rencanakanTulis`
  (belum termuat + hapus / sunting / diff rusak, sudah termuat) diuji sebagai fungsi
  murni — termasuk tuntutan bahwa perubahan yang tidak bisa dipetakan ke baris
  DIHAN, bukan diselundupkan sebagai simpanan penuh. Peta kebutuhan menu di
  `collectionNeeds.ts` ikut dibandingkan dengan daftar putih collection di SQLite,
  supaya rute baru tidak bisa meminta nama yang tidak ada.
- `compat-check.cjs` — dua keadaan yang membuat aplikasi gagal naik kelas. Skenario A
  memasang build baru di ATAS profil lama: sebagian kolom turunan sengaja di-
  `DROP COLUMN` dan `derived_revision` diturunkan lewat `better-sqlite3` mentah, lalu
  dibuktikan `ensureColumns` menyembuhkannya SEBELUM layar pertama dan halaman benar-
  benar bisa menulis ke kolom yang tadinya tidak ada (dulu INSERT suku cadang ditolak
  SQLite tanpa pesan apa pun). Skenario B membuka aplikasi di partisi tanpa preload
  sama sekali (`electronAPI undefined`): setiap halaman berpaginasi harus jatuh ke
  array store + localStorage, termasuk login demo, pindah halaman, pencarian, KPI kas,
  tulis baru, dan layar Backup yang tidak boleh crash. Seed localStorage ditanam lewat
  `compat-seed.html` yang dimuat SEBELUM `dist/index.html` pada partisi itu — menabur
  seed sesudah aplikasi jalan selalu hilang karena autosave store menulis ulang kuncinya.
- `perf-check.cjs` — kinerja yang diukur dari DALAM renderer (bukan hanya main process):
  waktu boot, jejak baca saat boot dan saat layar Unit terbuka (#38: nol baris store
  lewat IPC), muat penuh sebagai jalur Backup/impor, satu halaman vs isi store, lima
  pencarian layar Unit, enam kali berganti halaman, agregat KPI kas, latensi tulis satu
  baris, lalu tabel unit ditumbuhkan 12.000 → 50.000 dan seluruh pengukuran diulang.
  Angkanya dicetak sebagai `CATATAN`; ambang assertions ±3x nilai yang terukur supaya
  regresi tertangkap tanpa flaky di mesin 3,8 GB RAM.
  **Bagian 11 hanya jalan dengan `HEMS_PERF_KAPASITAS=1`**: ia menulis 100.000 baris ke
  masing-masing units/kas/spareParts/invoices (400.000 baris, berkas ±233 MB) lalu mengukur
  boot, membuka layar Armada, pencarian (dilanjutkan dari daftar penuh supaya teks pager
  dari kueri sebelumnya tidak dibaca sebagai jawaban — dua kueri berbeda bisa menghasilkan
  jumlah yang sama persis), jumlah record UI dibandingkan `COUNT(*)` SQLite, agregat KPI,
  tulis satu baris, kesehatan file dan memori. Angka nyatanya ada di QA_REPORT §3.1.
- `db-store-run.cjs` + `db-store-check.cjs` — integrasi end-to-end Fase 4 dalam tiga
  fase pada satu folder data sementara: tanam profil lama (seed) → boot pertama dengan
  SQLite (impor sekali + edit lewat UI + quit di tengah jendela debounce) → boot ulang
  dari file yang sama. Fase `import` sengaja berhenti mendadak: hanya handshake
  `db-flush-request`/`db-flush-done` yang bisa menyelamatkan perubahan terakhir.
  `openUnits()` di fase `verify` menunggu **kueri halaman** selesai (`#pager-info` tidak
  berbunyi "memuat" dan menyebut jumlah record), bukan sekadar judul "Manajemen Armada" —
  pernah satu kali fase ini membaca keadaan loading dan melaporkan "daftar unit kosong",
  padahal file baik-baik saja; itu flaky harness, bukan hilangnya data.
- `db-backup-run.cjs` + `db-backup-check.cjs` — cadangan Fase 4 di level berkas, juga
  tiga fase pada satu folder sementara. Fase `snapshots` menguji lapisan
  `electron/backup.ts` lewat IPC: checksum sha1, snapshot berdiri sendiri tanpa `-wal`,
  daftar izin settings (arsip `hems_data_store_v1`, key sesi, dan nilai non-JSON
  ditolak), path traversal pada nama snapshot, restore + `quick_check` + snapshot
  pengaman `pra-restore`, snapshot rusak ditolak tanpa mengubah database hidup, rotasi
  7 snapshot, dan regressi simpan-sebagian (`dbSave({units})` tidak boleh menghapus
  customers/kas). Fase `page` melakukan semuanya dari layar Backup & Restore dengan
  dialog simpan/buka asli: file `.sanybak` berisi data LIVE dari SQLite, restore dari
  file tidak menimpa arsip localStorage, dan kartu snapshot tampil di layar.

**`HEMS_DATA_DIR` wajib diisi** untuk harness Electron yang membuka layar aplikasi:
gui-check, flow-check, dan handoff-check. Masing-masing memuat
`dist-electron/main.js`, dan tanpa variabel itu aplikasi membuka profil pengguna
sungguhan di `%APPDATA%\hems-heavy-equipment-system` — termasuk menulis akun tes dan
menimpa `hems_business_modes`. Mengarahkan `APPDATA` tidak berhasil: Chromium membaca
known-folder Windows, bukan environment proses anak, jadi hanya `HEMS_DATA_DIR`
(dev-only, lihat `electron/main.ts`) yang benar-benar memindahkan profil.

Harness Electron membaca `dist/index.html`, jadi perubahan di `src/` tidak akan terlihat
kalau `npm run build` belum dijalankan ulang. Hapus folder `HEMS_DATA_DIR` sebelum
dijalankan ulang: marker migrasi `hems_data_migration_v1` hanya sekali per profil, dan
`db-store-run.cjs` menghapus file `fathoni.db` di antara fase supaya fase impor selalu
memulai dari database kosong. `db-backup-run.cjs` melakukan pembersihan yang sama, lalu
mengosongkan folder `snapshots` sebelum fase `page` supaya apa yang dicari di layar pasti
dihasilkan fase itu sendiri — file database justru dibiarkan, karena fase `page` harus
boot dari berkas warisan fase sebelumnya.

Klik tombol di layar dijalankan lewat `setTimeout(..., 0)` dan setiap `executeJavaScript`
punya watchdog (`withWatchdog`). Alasannya ditemukan saat menulis fase `page`: `confirm()`
asli membekukan thread renderer, dan karena `executeJavaScript` hanya menolak kalau
error — bukan kalau tidak pernah selesai — harness diam seribu bahasa sampai batas
waktu proses habis. Sekarang aksi yang macet dilaporkan dengan nama tindakannya.

Hasil yang diharapkan (rantai 2026-10-11 `tmp-harness/logs/rantai-302h.log` terhadap
**paket 3.0.2** — `dist`/`dist-electron` yang dibundel ke asar paket itu, dibuktikan
byte-identik dengan hasil build):
migration 49, unit/`validation-check` 297,
auth 58, gui 73, flow 30, handoff 123, usable 37, cetak 67, db 136, integritas 68, compat 30,
perf 40, store 47, backup 87, smoke-paket 28 — 16 langkah, 1.170 assertion, seluruhnya tanpa FAIL,
`rusak: tidak`, `proses keluar tidak bersih: tidak`, dan `exit=0` di setiap langkah
(ini baru bermakna sejak rantai memanggil `electron.exe` langsung, bukan `npx`).
Rantai penuh memakan ±15 menit dan **tidak boleh dijalankan dua-duanya sekaligus**:
`rantai-302g` adalah contoh kegagalannya — dua rantai bertumpuk, dan hanya uji waktu yang
jatuh (db 7.2: pencarian 50.000 baris 3.462 ms terhadap anggaran 1.000 ms) sementara
15 langkah lainnya hijau. Yang jatuh saat itu adalah lingkungan pengukurannya, bukan
aplikasinya — QA_REPORT §3 mencatat hitungan mundurnya.
Lapisan kapasitas TIDAK ikut angka di atas: `HEMS_PERF_KAPASITAS=1 "$ELEKTRON"
tests/harness/perf-check.cjs` menambah bagian 11 (400.000 baris) menjadi 55 lulus dan
memakan ±2 menit — angka nyatanya ada di QA_REPORT §3.1.
Langkah `smoke-paket` adalah yang membuktikan paket jadi ikut sekuat sumber, dan itulah
sebabnya installer lama (3.0.0 dan 3.0.1, keduanya dibangun sebelum perbaikan terbaru)
tidak dipakai sebagai bukti rilis.
Delapan jenis uji yang diminta terpetakan begitu: unit (validation-check, auth-check, db-check), fungsional
(flow-check, handoff-check, cetak-check yang mengklik tombol cetak di 10 layar), integrasi (db-store-run), kinerja (perf-check, db-check bagian 7,
perf-check bagian 11 untuk kapasitas),
keamanan (gui-check bagian 11 dan 13, db-check bagian 12, cetak-check 10–15 untuk jendela
cetak: CSP `default-src 'none'`, tanpa `electronAPI`, XSS sebagai teks, penolakan dokumen
> 1 MB), kegunaan (flow-check menuntun
login wajib ganti password, handoff 7.8 keadaan kosong, compat B.3 petunjuk mode demo),
kompatibilitas (compat-check A, ditambah db-check 13.20–13.22 dan 14.1/14.3–14.7 yang
membuktikan sisi renderer dan sisi SQLite menghitung kolom serta angka yang sama),
dan regresi (daftar periksa di bawah, masing-masing terikat ke assertion).

## Halaman berpaginasi dan simpanan per baris

Gudang, Kas, Invoice, Unit, dan Suku Cadang tidak memfilter seluruh array di renderer
lagi; mereka membaca satu halaman lewat `usePagedCollection` (`src/hooks/`), sehingga
pencarian, penyaringan (`where` pada kolom turunan) dan pengurutan dikerjakan SQLite.
Kartu KPI memakai `useCollectionSum`/`useCollectionCount` (`src/hooks/useCollectionTotals.ts`).
Tulisnya per baris: halaman memanggil `saveRow`/`saveRows`/`removeRow` pada store, jadi
satu aksi hanya menyebut record yang berubah — tidak ada lagi `data.map(...)` yang
menggabungkan array penuh untuk menyatakan satu perubahan. Store membandingkan
identitas objek untuk jalur debounce (`diffRows`) dan mengirim patch lewat `db-patch`;
collection dengan id ganda atau tanpa id jatuh kembali ke simpanan penuh — sejak #38
hanya bila collection itu memang sudah terbaca penuh, itunya di
`rencanakanTulis` (bagian berikut).

Main process mencatat jalur yang dipakai dalam `stats().writes`:
`patchCalls`/`patchUpsertRows`/`patchRemoveIds` untuk patch, `fullCalls`/`fullRows`
untuk collection penuh. Angka itu dilihat dari DALAM aplikasi (kanal `db-stats`), jadi
harness tidak perlu memalsukan IPC: handoff-check 7.12 dan 7.14 mengukur satu aksi UI
dan menuntut tepat satu baris/ satu id lewat patch dengan `fullCalls` tidak bergerak,
sedangkan db-check 13.24 membuktikan pemisahan pencatatan itu di sisi SQLite.

Empat hal yang harus dijaga supaya harness tetap berarti:
- Harness yang pindah ke halaman berpaginasi harus menunggu kueri halaman **selesai**,
  bukan menunggu elemennya ada: `usePagedCollection` punya debounce 200 ms dan selama
  itu `#pager-info` berbunyi "… memuat", yang di halaman kosong terbaca persis seperti
  kegagalan sungguhan. handoff-check 6.8g menuntut teks itu hilang sebelum bagian 7
  membaca penanda halaman. **Yang tidak boleh dipakai sebagai tanda selesai:** menguji
  `/record/` saja. `Pager.tsx` menulis "Tidak ada record" selama `total` masih 0 — jadi
  saat debounce berjalan dan saat kueri pertama belum kembali — sehingga kalimat
  loading-nya pun mengandung kata "record". Tanda yang sah hanyalah `!/memuat/` atau
  frasa `/dari … record/` (rantai-302f jatuh di handoff 8.1 dengan `sql=2, kartu=0`
  persis karena wait yang lemah; rantai-302g memperkuat kedua wait itu). *Penjaga*:
  unit 28 memeriksa isi setiap `waitFor` yang menyebut `#pager-info` di semua harness,
  dengan kontrol positif bahwa ia memang menemukan ≥15 wait dan ≥3 di antaranya
  menguji `/record/` apa adanya — dimutasi dengan menghapus satu klausul `!/memuat/`.
- Harness tidak boleh membuka browser atau jendela nyata di desktop manusia.
  `window.open` di renderer diblokir `setWindowOpenHandler`, lalu URL-nya diserahkan ke
  `shell.openExternal` — yang di mesin pengembangan berarti Chrome sungguhan terbuka ke
  example.com setiap langkah `gui` dijalankan. `gui-check` menambal `shell.openExternal`
  dengan perekam lebih dulu, dan penyerahan URL itu menjadi assertion 8.1b. *Penjaga*:
  unit 28 mewajibkan setiap harness yang memanggil `window.open` menambalnya lebih dulu.
- Halaman hanya boleh mengambil ulang datanya SETELAH tulisan masuk file. Karena itu
  store menaikkan `savedTick[namaCollection]` sesudah simpanan berhasil, dan halaman
  memakainya sebagai `revision`. Menjadikan identitas array store sebagai pemicu akan
  menampilkan data lama sebentar lalu membetulkan diri — sengaja tidak dilakukan.
- `saveRow(nama, baris)` / `saveRows(nama, baris)` / `removeRow(nama, id)` dipakai halaman
  agar baris hasil edit langsung terbaca kembali; ketiganya mencatat referensinya di
  `lastSavedRef` supaya debounce 800 ms tidak mengirim ulang yang sama. `removeRow` tetap
  mengirim id-nya walau barisnya tidak ada di memori — pada collection yang dimuat
  sebagian, "tidak ada di memori" bukan berarti "tidak ada di file".

`DERIVED_REVISION` di `electron/db.ts` dinaikkan setiap kali `dbSchema` mengubah cara
kolom turunan/blob pencarian dihasilkan, dan `ensureColumns` menambahkan kolom yang
belum ada pada profil lama — CREATE TABLE IF NOT EXISTS tidak melakukannya, sehingga
tanpa langkah itu setiap INSERT gagal setelah skema bertambah.

## Boot hanya membawa yang dibutuhkan menunya (tugas #38)

Sebelum ini, `dataStore` memanggil `dbLoad()` tanpa argument saat aplikasi terbuka:
seluruh isi file disalin ke renderer pada setiap boot, jadi biaya boot tumbuh linear
dengan jumlah record (5,73 MB IPC pada 25.000 baris). Sekarang:

- **Main process.** `loadStore(names?)` memuat hanya collection yang disebut, dan
  `rowCounts()` menjawab "profil ini kosong atau tidak" dari `COUNT(*)` tanpa
  memindahkan satu baris pun. Kanal `db-load` punya tiga bentuk: tanpa argument =
  muat semua (HANYA layar Backup dan jalur impor), daftar nama = muat sebagian,
  dan **nama asing / argumen bukan daftar DITOLAK** — bukan dilewati diam-diam,
  karena halaman yang menerima `{}` akan mengira collection itu kosong lalu
  menimpanya dengan kosong. `trustedHandle` mengubah penolakan menjadi
  `{ success:false, error:'Operasi gagal diproses' }` tanpa path profil.
- **Jejak baca** di `stats().reads`: `fullCalls`, `subsetCalls`, `subsetCollections`,
  `rows`. Semuanya dibaca dari DALAM aplikasi lewat kanal `db-stats`, jadi harness
  membuktikan bentuk jalur, bukan hanya hasilnya: gui-check 15.1–15.5 (kontrak
  subset + penolakannya), perf-check P.3b (boot tidak memindahkan baris apa pun)
  dan P.12b (membuka layar Unit di profil 12.000 unit menggeser NOL baris store),
  handoff-check 9.1–9.2 (membuka dua menu yang menghidrasi hanya meminta
  collection-nya sendiri, dan baris yang lewat IPC tetap sebagian kecil dari file).
  Di harness yang memakai `readStore()` (muat penuh) untuk membaca kondisi, angka
  itu hanya berarti sebagai DELTA antara dua pengukuran tanpa pembacaan harness.
- **Boot renderer** (`src/store/dataStore.tsx`): `dbInfo()` → bila file berisi,
  `publish(emptyStore())`. Array kosong di memori dengan sengaja BUKAN berarti
  "collection itu kosong"; status "sudah pernah dibaca penuh" dipegang oleh
  `loadedRef`, satu-satunya sumber kebenaran untuk penjaga tulis.
- **Gerbang rute**: `src/store/collectionNeeds.ts` adalah satu tempat yang
  mencatat collection yang dipakai tiap menu; `RouteGate` di `src/App.tsx`
  memanggil `ensureLoaded(needs)` dan baru menampilkan menunya sesudah selesai
  (`PageLoader` selama itu). Rute yang tidak terdaftar meminta semuanya, supaya
  menu baru yang lupa didaftarkan tetap benar — hanya lebih lambat.
  `ensureLoaded` memuat per collection, menggabungkan permintaan yang sedang
  berjalan, dan TIDAK menimpa perubahan pengguna bila array di memori sudah
  menyimpang dari `lastSavedRef` (collection tetap berstatus belum termuat dan
  penjaga tulis membatasi cara penulisannya).

### Penjaga tulis keras (`src/store/writeGuard.ts`)

Konsekuensi hidrasi tertunda adalah cara gagal yang menghapus data: autosave yang
menyimpan collection penuh dari array yang hanya terisi sebagian akan MENGHAPUS
baris yang tidak ikut terbaca. `rencanakanTulis(dirty, prevOf, nextOf, loadedOf)`
murni dan memutuskan bentuk tulisan sebelum satu byte pun dikirim:

| keadaan | yang dikirim |
| --- | --- |
| collection sudah termuat penuh | patch per baris; kalau diff tidak bisa dipercaya → simpanan penuh (`full`) |
| belum termuat, barisnya ada di memori (dibuat/disunting layar ini) | tetap patch `upsert` baris itu |
| belum termuat, pengguna menghapus baris yang tidak dimuat | patch `removeIds` (id-nya diketahui), sisanya tidak |
| belum termuat, tapi diff menghasilkan bentuk yang tidak bisa dipetakan ke baris | DITAHAN (`tertahan`): tidak ada `full`, tidak ada patch, perubahan tetap di memori dan pengguna diberi tahu |

`diffRows`/`rowKey` adalah bagian penjaga itu (bukan lagi milik `dataStore`) supaya
bisa diunitisasi. Dijaga db-check 15.6–15.10 (matriks empat keadaan di atas,
paritas `diffRows`, `rowKey({id:0})`) — termasuk tuntutan bahwa keadaan "ditahan"
tidak pernah jatuh ke simpanan penuh.

### Dua hal yang ternyata rusak oleh hidrasi tertunda (dan kini dikunci uji)

Halaman yang merutenya `needs: []` (Unit, Gudang) punya array store yang memang
kosong di desktop. Empat tempat masih membacanya seperti dulu:

- migrasi foto base64 memindai `data` → tidak pernah berjalan. Sekarang memakai
  kolom turunan baru `inlinePhoto` pada `units` (1 bila `photo` masih berupa
  `data:`), lewat `dbQuery({ where: { inlinePhoto: 1 }, limit: 500 })`; paritas
  `inlinePhotoOf` sisi renderer dengan `dbSchema` sisi SQLite dijaga db-check
  15.4–15.5, dan jalur sungguhnya dijaga handoff-check 9.3–9.5 (tanam unit dengan
  foto base64, buka halaman Unit, buktikan basisnya berpindah ke berkas foto dan
  tidak ada lagi record yang menyimpan fotonya di dalam payload).
- modal foto / upload / hapus foto / hapus unit mencari `data.find(id)` →
  `undefined`, sehingga upload diam-diam tidak melakukan apa pun. Handler sekarang
  memegang BARIS yang diklik (`photoTarget`, `deleteUnit(u)`, `openPhotoModal(u)`),
  terbukti di handoff-check 9.6–9.7: modal dari kartu SANY menyebut nomor sasis itu
  dan menayangkan `./units/sany.jpg`, bukan placeholder.
- cek nomor rangka ganda memakai `validateUniqueSerialNumber(serial, data)` →
  setiap nomor terasa "unik". Kandidatnya kini datang dari kueri pencarian SQL
  (`limit` 500) sementara ATURANNYA tetap satu fungsi — trim dan tidak peka huruf,
  yang tidak bisa diserahkan pada `=` TEXT di SQLite (case-sensitive). Dijaga
  handoff-check 9.8 dengan sengaja mengirim `hand-sy-001` huruf kecil dan menuntut
  peringatan muncul tanpa satu baris pun bertambah.
- saran `TRX-<tahun>-<n>` Gudang memakai `data.length` → selalu `-001` dan
  menabrak bukti yang sudah ada; setelah #49 memakai jumlah baris, yang masih salah
  bila ada bukti yang dihapus atau nomor tidak berurutan. Sejak #71 source-nya satu:
  `nomorBerikut()` (`src/utils/nomorBerikut.ts`) membaca nomor tertinggi di file lalu
  memeriksa kandidat (`WHERE trxNo IN (...)`, terindeks) sampai benar-benar bebas.
  Dijaga handoff-check 9.9 + 9.9b dan validation 23.

`DERIVED_REVISION` (`electron/db.ts`) kini diekspor supaya harness membandingkan
revisi di file dengan revisi kode, bukan menyalin angka yang selalu berganti
(db-check 13.22); kolom `inlinePhoto` menaikkan nilainya ke 5 sehingga profil lama
mengisi kolom itu sebelum kueri pertama dilayani.



## Nilai penyaringan dari renderer (`bindableWhere` / `filterClauses`)

`where`, `sort`, dan `search` datang dari kode halaman, jadi bentuknya tidak boleh
dipercaya. `electron/db.ts` punya satu aturan konversi yang dipakai bersama oleh
`queryCollection`, `sumCollection` dan `groupCollection`:

- hanya nama kolom yang terdaftar di spec yang diikat; entri asing DILEWATI (bukan
  membuat kueri gagal, dan bukan diteruskan sebagai teks);
- kolom TEXT mengikat string; angka dan boolean dikonversi seperti cara penulis
  mengisinya (`isActive: true` → `'true'`), sehingga filter boolean benar-benar cocok;
- kolom angka memakai `Number`; nilai tak terhingga menjadi NULL, sama seperti
  `toColumnValue` saat menulis;
- fungsi, symbol, bigint, dan objek tanpa kunci penyaringan TIDAK diikat —
  better-sqlite3 menolak semuanya, dan satu entri rusak tidak boleh menggagalkan
  seluruh halaman (inilah sumber "halaman macet" yang dulu muncul diam-diam);
- `sort` dan kolom agregat lewat daftar putih; nilai asing jatuh ke urutan bawaan
  spec, dan `sumCollection`/`groupCollection` menolak kolom TEXT sebagai kolom jumlah.

### Bentuk `where` yang dikenali

Operator disimpan di `Map` (bukan objek biasa) supaya kunci seperti `constructor`
tidak pernah berbalik menjadi klausa SQL. Nama kolom tetap dinilai ulang ke spec
dan SETIAP nilai di-ikat sebagai parameter, jadi tidak ada teks dari renderer yang
pernah menjadi SQL.

| bentuk | menjadi | catatan |
| --- | --- | --- |
| `{ status: 'LUNAS' }` | `"status" = ?` | seperti sebelumnya |
| `{ id: 'A-U1' }` | `"id" = ?` | kunci `id` dikenali lewat `ID_COLUMN` khusus di `electron/db.ts`, bukan lewat `spec.columns` — kolom `id` sudah selalu ada (`NOT NULL`, terindeks) tetapi INSERT menyusun daftar kolom dari `pk,id,payload,hash,search` + `spec.columns`, jadi menamainya di spec mendaftarkannya dua kali |
| `{ brand: ['SANY','TADANO'] }` | `"brand" IN (?, ?)` | multi-pilih halaman filter; dulu dilewati sehingga layar menampilkan SEMUA baris |
| `{ serviceDueIn: { gte: 1, lte: 50 } }` | dua klausa AND | satu kunci boleh membawa beberapa batas sekaligus |
| `{ endDate: { between: [a, b] } }` | `"endDate" BETWEEN ? AND ?` | harus tepat dua nilai yang bisa diikat |
| `{ month: { in: [...] } }` | `"month" IN (...)` | `in: []` dilewati, karena `IN ()` bukan sintaks yang sah |
| `{ status: { nin: ['COMPLETED','CANCELLED'] } }` | `"status" NOT IN (?, ?)` | "aktif" tanpa daftar status lengkap; `nin: []` dilewati. Hanya untuk kolom TEXT — kolom angka kehilangan NULL di SQL tapi tidak di sisi renderer |
| `{ status: { op: 'eq', value: 'LUNAS' } }` | `"status" = ?` | bentuk panjang |
| `{ status: { op: 'LIKE', value: '%' } }` | DILEWATI | operator di luar daftar putih; `=`/`<>` sebagai kunci juga ditolak |
| `{ status: { columnName: ..., operator: ..., value: ... } }` | DILEWATI | objek pembangun kueri dari renderer asing |

Dijaga oleh db-check 13.18–13.19 (sembilan bentuk asing + sebelas operator dibandingkan
dengan hasil JavaScript pada baris yang sama), db-check 13.19b (`nin` pada kolom TEXT
ikut memuat baris tanpa status, persis seperti SQL), db-check 14.1 (kunci `id` menyaring
dan `id` asing tidak pernah membuat kueri mengembalikan semua baris), dan gui-check
13.11–13.14 (kanalnya dipakai dari dalam renderer).

## Agregat kelompok (`groupCollection` → kanal `db-group` → `useCollectionGroup`)

Dasbor dan Laporan butuh angka yang selama ini dihitung dengan menelusuri seluruh
array di renderer. Lapisannya:

- kolom turunan baru di `electron/dbSchema.ts`: `month` ('YYYY-MM' pada invoices,
  sales, rentals, services, kas, purchases — tanggal tak terbaca menjadi kunci
  kosong, sama seperti `revenueByMonth` yang MENGABAIKANNYA), `serviceDueIn`
  (sisa HM ke servis 500 HM berikutnya), `stockShortfall` (`stock - minStock`,
  dibuat saat menulis supaya ikut terisi di indeks dan bisa disaring),
  `minStock`, dan `endDate` pada sewa;
- `DERIVED_REVISION` naik ke 4, sehingga `ensureColumns` + `refreshDerivedColumns`
  menambahkan DAN mengisi kolom itu pada profil yang sudah terpasang — terbukti di
  db-check 13.22, yang benar-benar menjatuhkan kolom `month` lalu membuka ulang;
- `groupCollection({ collection, by[1..3], sum?, where?, search?, limit? })`
  mengembalikan `groups: [{ key, keys, count, sum }]` dengan urutan kunci yang
  pasti, maksimum 500 kelompok;
- kanal IPC `db-group` memakai `trustedHandle` yang sama: penolakan selalu
  `'Operasi gagal diproses'`, tidak pernah berisi path;
- `useCollectionGroup(req, localRows, revision)` jatuh ke `groupLocally` bila tidak
  ada database, dan fallback itu memakai `src/domain/derivedColumns.ts` — cerminan
  `dbSchema` yang diuji paritasnya (db-check 13.9, 13.20, 13.21).

`queryCollection({ collection })` TANPA `limit` tetap memotong ke
`DEFAULT_PAGE_LIMIT` (100), jadi daftar yang dipakai untuk perhitungan harus
menyebut limit-nya sendiri — atau lebih baik, pakai `dbGroup`/`dbSum`/`total`.

## Dasbor: kartu dihitung SQLite, bukan oleh array store

`src/pages/Dashboard.tsx` tidak lagi menelusuri `units`/`sales`/`rentals`/`services`/
`invoices`/`spareParts` untuk menghitung angka. Yang dipakai:

- jumlah per status dari SATU `useCollectionGroup({ by: ['status'] })` — termasuk
  `totalUnits` yang menjumlahkan seluruh kelompok, jadi status baru tidak hilang dari
  hitungan;
- `useCollectionCount` / `useCollectionSum` untuk uang (omzet, piutang sewa sebagai
  `sum(totalAmount) - sum(paidAmount)`, pendapatan jasa WO selesai, tarif sewa aktif);
- `useCollectionGroup({ collection: 'invoices', by: ['month'], sum: 'totalAmount' })`
  dengan `where: { month: { between: [bulanan pertama, terakhir] }, type: { in: [...] } }`
  untuk grafik enam bulan — `type` dibatasi RENTAL/PENJUALAN/SERVICE karena
  `revenueByMonth` lama memang mengabaikan SPAREPART;
- `useCollectionQuery` untuk Alert Center dan daftar di kartu: `limit` 20 (alert) atau
  5 (daftar) baris yang benar-benar dikirim, sementara badge jumlah memakai `total`
  yang tidak dipotong. Kueri dibuat tanpa `sort` supaya urutannya sama dengan urutan
  store sebelumnya dan isi kartunya tidak berubah;
- jendela alert memakai kolom turunan: `{ serviceDueIn: { gte: 1, lte: 50 } }`,
  `{ stockShortfall: { lte: 0 } }`, `{ endDate: { gt: hari ini, lte: hari ini + 7 } }`.

Dijaga handoff-check 6.5b (angka kartu DEALER dibandingkan hitungan penuh atas isi
database, dibaca langsung dari DOM) dan 6.5c (Alert Center hanya ada bila database
memang punya masalah — `where` yang bocor akan menampilkan peringatan palsu).

## Laporan, Control Tower, Equipment Passport: sama, angka lahir di query

Ketiga menu ini sebelumnya menghitung dengan menelusuri array store di renderer. Pada
hydration tertunda (tugas #38) array itu TIDAK penuh, jadi cara lama bukan hanya lebih
lambat — angkanya bisa nol atau setengah tanpa pesan apa pun. Yang dipakai sekarang:

- **Laporan** (`src/pages/Reports.tsx`): pendapatan per jenis dari
  `useCollectionGroup({ by: ['type'], sum: 'totalAmount' })` (sepanjang masa) dan
  `by: ['month','type']` dengan `where: { month: { between: [...] }, type: { in: TIPE_PENDAPATAN } }`
  untuk grafik enam bulan; piutang = `useCollectionSum('invoices','totalAmount', WHERE_PIUTANG)`
  dikurangi `SUM paidAmount` dengan `where` yang sama, `useCollectionCount` untuk jumlahnya;
  dua tab terakhir dibatasi `PAGE_SIZE` 25 (`usePagedCollection` untuk unit, satu
  `useCollectionQuery` untuk daftar piutang). Ekspor CSV/Cetak mengambil
  `limit: BATAS_EKSPOR` (500) dari database dan **menyebut** pemotongannya
  (`Ekspor dibatasi 500 baris pertama; total N baris di database.`), DSO pun ditulis
  "atas N piutang terbaru dari TOTAL" bila terpotong — angka yang salah diam-diam
  lebih berbahaya daripada angka yang dibatasi dan diterangkan.
- **Control Tower** (`src/pages/ControlTower.tsx`): lima kartu fleet adalah lima
  `useCollectionCount('units', …)` atas collection yang sama — `in: ['ON_PROJECT','RENTED']`
  untuk operating, `nin: ['COMPLETED']` untuk WO aktif, `{ stockShortfall: { lte: 0 } }`
  untuk stok kritis — sehingga status baru tidak hilang dari hitungan; daftar "unit live"
  memakai `useCollectionQuery({ limit: 8 })`, bukan `units.slice(0, 8)`.
- **Equipment Passport** (`src/pages/EquipmentPassport.tsx`): unit dibuka lewat
  `where: { id }` (`limit: 1`), riwayat dan kartu per nomor sasis lewat `where: { serialNumber }`
  dengan `useCollectionCount`/`useCollectionSum`/`useCollectionQuery({ sort: 'openDate', desc: true, limit: 30 })`.
  Komponennya dipecah dua (`EquipmentPassport` mencari unit + layar "tidak ditemukan",
  `PassportDetail` memegang semua hook) karena hook tidak boleh dipanggil setelah
  `return` lebih awal. Nilai karang yang dulu di-hardcode di halaman ini (utilisasi 82 %,
  14,2 L/HM, nama pemilik tetap) diganti `-` atau kolom asli bila memang ada, dan
  `undefined.toLocaleString()` yang bisa crash hilang.
- Kunci tanggal "hari ini" pindah ke `src/domain/revenue.ts` (`isoDay`), dihitung dari
  zona lokal. Kolom tanggal di SQLite adalah TEXT tulisan manusia, jadi membandingkan
  dengan `toISOString()` (UTC-tengah-malam) membuat invoice yang jatuh tempo **hari ini**
  dulu ikut dianggap lewat tempo — dan karena `where` TEXT memakai `gt: ''`, invoice
  tanpa `dueDate` sekarang benar-benar tidak ikut, bukan tergantung urutan perbandingan.

Dijaga handoff-check 6.3b/6.3d/6.3f (Laporan vs `dbGroup`/`dbSum`/`dbQuery` langsung dari
database, tabel hanya satu halaman), 6.8c (lima fleet count vs lima `dbQuery`), 6.8d–6.8f
(passport lewat tautan id: kartu riwayat vs COUNT per sasis, tab maintenance memuat WO
unit itu), dan db-check 14.1–14.9 untuk bentuk kuerinya.

## Kinerja yang terukur dari DALAM aplikasi (perf-check, 12.000 → 50.000 unit)

Mesin 3,8 GB RAM dengan hanya ±250 MB bebas; angka di bawah adalah median dari satu kali jalan.

| yang diukur | 12.000 unit | 50.000 unit |
| --- | --- | --- |
| layar login siap (wall clock harness) | 295 ms | — |
| `domContentLoaded` renderer | 278 ms | — |
| **baris store yang lewat IPC saat boot (profil 25.000 baris)** | **0** (P.3b) | — |
| `dbLoad` seluruh store — jalur Backup/impor, BUKAN boot lagi | 417 ms (5,73 MB IPC) | — |
| **baris store yang lewat IPC sejak login sampai layar Unit terbuka** | **0** (P.12b) | — |
| satu halaman Unit vs isi store yang lewat IPC | 0,1 % | DOM tetap 12 kartu |
| pencarian di layar Unit (debounce 200 ms termasuk) | 227 ms | 281 ms |
| `dbQuery` telanjang lewat IPC | 10 ms | 109 ms (offset 12.000) |
| berganti halaman | 225 ms | — |
| `dbSum` kas 6.000 baris | 1 ms | — |
| tulis satu baris lewat `db-patch` | 1 ms | — |
| working set renderer / main | 172 / 167 MB | — |
| heap JS renderer | 10 MB | — |
| file `fathoni.db` | — | 44,71 MB (63.000 baris) |

Boot tidak lagi membayar perpindahan store: pada profil 25.000 baris, `reads` tetap
nol sampai layar login muncul (P.3b) dan membuka menu terbesar tetap nol (P.12b) —
yang pindah hanya satu halaman hasil kueri. Biaya 5,73 MB itu sekarang hanya terjadi
di layar Backup dan jalur impor, yang memang sengaja needing seluruh isi file.

Yang masih sengaja dilaporkan apa adanya:
- `saveStore` 50.000 baris butuh ±0,9–1,5 detik dan berjalan sinkron di main process,
  jadi event loop membeku selama itu. Jalur UI (`db-patch` per baris, 1 ms) tidak
  mengalami ini; hanya impor massal dan simpanan penuh yang perlu dipecah.

Kapasitas yang terukur (db-check bagian 7, mesin 3,8 GB RAM): 50.000 unit = simpan
±1,2 detik, pencarian berindeks ±0,12 detik, simpan ulang dengan sedikit perubahan
±0,3 detik, agregasi di SQL ±26 ms, file ±27 MB. Batas localStorage lama ±4 MB hilang
bersama SQLite.

Assertion bagian 7 dulu menuntut "simpan ulang dengan sedikit perubahan LEBIH CEPAT
sekali daripada simpan penuh" (`tDiff < tWrite / 2`). Klausa itu benar-benar pernah
membuktikan write-behind, tapi bentuknya waktu dinding: pada rantai yang berjalan saat
RAM tinggal ±200 MB, dua simpanan berjarak 1.758 vs 1.218 ms dan assertion jatuh tanpa
ada yang rusak di kode. Yang ditahan sekarang adalah klaimnya sendiri dalam bentuk yang
tidak bergantung pada beban mesin — `inserted: 0, updated: 10, deleted: 0` dari
`saveCollection` yang sama — sementara waktunya tetap dicetak sebagai `CATATAN`.

## Daftar periksa regresi

Setiap baris adalah bug yang benar-benar pernah ada (atau cara gagal yang terbukti
membuat aplikasi tidak bisa naik kelas). Kolom kanan menyebut assertion yang
menolaknya kembali — kalau assertion itu diubah, baris ini harus ikut diubah.

| Regresi yang tidak boleh kembali | Dijaga oleh |
| --- | --- |
| Pencarian dua kata ("SANY SY215C") tidak pernah cocok karena kalimat dibandingkan per kolom | db-check 5.1–5.3 (kesamaan SQL vs `matchesQuery`), handoff 8.2, compat A.14, compat B.8, perf "setiap pencarian mendapat jawaban" |
| Field suku cadang (kategori, merek cocok, rak) dibuang saat menyimpan / ditampilkan palsu | handoff 8.3–8.6, compat A.11–A.12 |
| Profil lama diam-diam menolak INSERT karena kolom turunan tidak pernah di-ALTER | compat A.2–A.4 dan A.12, db-check 10.5 dan 11.1–11.4 (`ensureColumns` + `DERIVED_REVISION`) |
| Layar mati saat `electronAPI` absen (dev browser / build lama) | compat B.1–B.15: login demo, paginasi array store, KPI kas, tulis baru, layar Backup tanpa crash, nol error renderer |
| Halaman besar memuat seluruh isi database ke renderer | handoff 6.3d/6.3f/7.1 dan 8.1, perf "satu halaman hanya mengirim sebagian kecil" (0,1 %) dan "DOM tetap 12 kartu" pada 50.000 baris |
| Hasil tulis di menu lain tidak terlihat di halaman (stale) | handoff 7.4 dan 8.5, db-store-run "unit ketiga masuk file lewat autosave" (`savedTick`/`revision`) |
| Simpanan sebagian menghapus baris collection lain | handoff 7.11, db-check 12.11–12.12, db-backup-run "simpan sebagian membiarkan collection lain utuh" |
| Satu aksi UI menulis ulang seluruh collection (jalur yang menghapus baris yang tidak dimuat halaman) | handoff 7.12 dan 7.14 (`stats().writes` dilihat dari dalam aplikasi: tepat satu upsert / satu id, `fullCalls` tidak bergerak), db-check 13.24 |
| Menu katalog (Operator, Teknisi, Dokumen, Pengiriman, Breakdown, Persetujuan) menghapus dengan menyaring array di memori: seluruh collection ikut ditulis ulang dan pemeriksaan rujukan tidak pernah berjalan | handoff 10.1–10.12 (satu id lewat patch per menu, `fullCalls` tidak bergerak, baris tetangga tetap ada), validation 12 (peta `MENU_HAPUS` + larangan filter-array pada halaman ber-`useDataStore`) |
| Layar menjatuhkan dirinya karena satu baris memuat nilai di luar peta status/severity (`MAP[nilai].label` tanpa fallback) | handoff 10.14 (`severity: 'MEDIUM'` + `status: 'ESCALATED'` tetap tampil apa adanya, tanpa layar kesalahan), validation 21 (larangan pencarian peta tanpa `?.` di seluruh `src/`) |
| Baris tanpa kolom angka/array (data lama, impor, restore) membuat sel tabel memanggil `.toLocaleString()` pada null — layar Operator dan Teknisi jatuh | handoff 10.16 (baris tanpa `totalHours`/`specializations` tetap tampil), validation 22 (angka/teks baris harus lewat `??` atau pemeriksaan dulu) |
| Field array dari baris dibaca langsung: `item.X && item.X.length > 0` LOLOS untuk string (cadangan yang disunting tangan), lalu `.map` melempar di template cetak dan menjatuhkan rutenya | validation 24 (sepuluh nama field array wajib dinormalkan `Array.isArray` / `?? []` sebelum dipakai, + tiga template cetak Operator/Teknisi/Breakdown); penjaga ini terbukti menggigit: `parts.length` dikembalikan menjadi `item.partsUsed.length` dan harness menolak |
| Menghapus teknisi/operator yang namanya masih tertulis di dokumen lolos tanpa pesan: keduanya tidak punya aturan rujukan, dan namanya tidak disimpan sebagai kolom turunan di dokumen anak | integrity 2d (teknisi tertahan Work Order + Laporan Kerusakan, operator tertahan Surat Jalan; nama satu kata sengaja di bawah ambang token), handoff 10.18 (tombol hapus di menunya menolak dengan alasan yang menyebut dokumennya), validation 12 (aturan blob hanya boleh menyebut field yang ikut ditulis ke blob + teknisi/operator wajib berpemeriksaan) |
| Satu layar yang melempar membuat SEMUA menu menampilkan "Terjadi Kesalahan" sampai aplikasi dimuat ulang (boundary hanya di akar) | handoff 10.14 (Pelanggan tetap terbuka dan terisi sesudah baris asing dibuka), validation 20 (boundary berkunci rute di `ProtectedRoute`) |
| Collection yang BELUM pernah dibaca penuh ditulis sebagai collection penuh, sehingga baris yang tidak ikut terbaca hilang dari file | db-check 15.6–15.9 (matriks `rencanakanTulis`: upsert tetap jalan, simpanan penuh ditahan, `tertahan` tidak pernah berubah menjadi `full`), handoff 7.11 |
| Boot menyalin seluruh store ke renderer — waktu buka aplikasi dan memori renderer tumbuh mengikuti jumlah record | perf P.3b (nol baris lewat IPC di profil 25.000 baris) dan P.12b (membuka layar Unit 12.000 unit menggeser nol baris), gui 15.4, handoff 9.1–9.2 |
| Nama collection asing atau argumen bukan daftar pada `db-load` diterima lalu dilewati diam-diam, sehingga halaman mengira collection itu kosong dan menimpanya dengan kosong | gui-check 15.1–15.3 dan 15.5, db-check 15.1–15.3 |
| Handler layar Unit / Gudang membaca array store yang sejak #38 memang kosong: upload dan hapus foto tidak melakukan apa pun, nomor rangka ganda terasa unik, saran nomor mutasi selalu `-001` | handoff 9.6–9.9 |
| Usulan nomor dokumen dihitung dari `array.length + 1` di 11 menu: nomor rangkap atau melompat, padahal nomor bisnis itulah kunci rujukan lintas menu (`electron/referential.ts`) | handoff 9.9 + 9.9b (bukti mutasi harus melewati nomor tanam `TRX-<tahun>-888` yang tidak ada di array halaman) dan 10.19a–d (SPK berlanjut dari 902 walau baris tertinggi sudah dihapus; usulan terbukti tidak ada di file), validation 23 (celah sesudah hapus, 60 nomor terisi → 61, `T-00010` tetap menghalangi 10, embel asing tidak menghalangi, mode browser) + penjaga statis: tidak ada `.length + n` pada baris bernomor di `src/pages`, ke-11 collection wajib dipanggil lewat `nomorBerikut`, dan pasangannya wajib kolom SQL sungguhan di `dbSchema` |
| Menu yang sama diceritakan empat daftar berbeda: katalog Pengaturan dikelompokkan lain dari sidebar, `Ctrl+K` hanya menawarkan 17 dari 26 menu, dan pencarian topbar membocorkan menu yang sudah dimatikan untuk profil/peran | usable 7.1–7.4 (profil DEALER: 25 menu, palette == sidebar sebutir-butir, "onderdil" → `/spareparts` lewat Enter, "sewa" tidak menampilkan `/rental`), validation 25 (kategori katalog == grup sidebar, urutan katalog subsekuensi sidebar, siklus grup sidebar tetap, `ALL_PATHS` lengkap tanpa path mati, palette tanpa daftar sendiri, topbar lewat hasil gerbang, kata kunci + kunci peta hidrasi per menu); penjaga ini menggigit pada penulisan pertamanya: katalog meletakkan `/documents` sebelum `/users` dan harness menolak, lalu `cat: 'Operasional'` dikembalikan ke `/rental` dan harness menolak lagi |
| Migrasi foto base64 tidak pernah berjalan lagi karena memindai array `units` yang belum termuat | handoff 9.3–9.5 (kolom turunan `inlinePhoto` + jalur sungguhnya), db-check 15.4–15.5 (paritas SQLite vs `inlinePhotoOf`) |
| Handoff antar menu patah (Pembelian→Gudang/Pemasok/Kas, Servis→Part/Invoice, Invoice→Kas) | handoff-check bagian 1–6 |
| Angka kartu Dasbor berbeda dari isi database setelah pindah ke query | handoff 6.5b (kartu DEALER vs hitungan penuh), db-check 13.1–13.10 |
| Alert Center menampilkan peringatan palsu karena `where` agregat bocor / kolom turunan kosong | handoff 6.5c, db-check 13.2 (jendela servis), 13.3–13.4 (stok kritis) |
| Angka Laporan / Control Tower / Equipment Passport dihitung dari array store yang belum terisi penuh sehingga menampilkan nol atau setengah tanpa pesan | handoff 6.3b/6.3d/6.3f/6.8c/6.8e (kartu dan jumlah baris dibandingkan `dbGroup`/`dbSum`/`dbQuery` langsung dari database), db-check 14.2–14.7 |
| `where` pada kunci `id` dilewati sehingga Equipment Passport membuka unit yang salah (atau "tidak ditemukan" palsu) | db-check 14.1 (`ID_COLUMN`; `id` asing dan `id` kosong mengembalikan NOL baris, bukan semua baris), handoff 6.8d–6.8f |
| Invoice tanpa `dueDate`, atau yang jatuh tempo tepat hari ini, dianggap lewat tempo | db-check 14.4 (baris tanpa dueDate tidak ikut, SQL vs `matchesWhere` sama), 14.8 (`isoDay` lokal + rollover bulan/tahun), handoff 6.3d |
| Nilai utilisasi/bbm/pemilik passport ditulis tetap di layar dan data asli tidak pernah diperiksa | Equipment Passport menampilkan `-` bila kolomnya kosong; dijaga handoff 6.8e (kartu riwayat = COUNT per sasis dari database) |
| Status baru berhenti ikut dihitung di Dasbor karena daftarnya ditulis tangan | pakai `nin`/`group by status`: db-check 13.19 dan 13.19b |
| Penanda halaman menyebut jumlah palsu / hasil kosong menampilkan data lama | handoff 7.1 dan 7.7–7.9, 8.1, compat B.6 |
| `where`/`sort`/kolom asing membuat kueri melempar atau menyuntik SQL | db-check 12.1–12.10, 13.18, gui-check 13.6–13.9, 13.11–13.13 |
| Nama collection `__proto__`/`constructor` atau tabel sistem terbaca renderer | db-check 12.16–12.17, 13.13, gui-check 13.1–13.2, 13.11 |
| IPC database dilayani untuk frame/halaman asing | gui-check 11.3–11.9, 11.11–11.12 (penolakan + tidak ada residu di file) |
| Pesan error membocorkan path profil | gui-check 11.10, 13.15 |
| `limit`/`offset` liar dari renderer | gui-check 13.7, db-check 12.13–12.15, 13.15 |
| Argumen rusak dari dalam aplikasi membuat jendela macet, bukan ditolak rapi | gui-check 13.0–13.5 dan 14 (tulis–baca–hapus bersih) |
| `where` berbentuk daftar (multi-pilih) dilewati sehingga layar menampilkan SEMUA baris | db-check 13.19 (`IN` lewat daftar dan lewat kunci `in`), gui-check 13.6 |
| Nilai `NULL` ikut terbawa oleh operator `<>` sehingga jumlah kartu salah | db-check 13.19 (`lt angka (NULL ikut terbuang)`, `ne terhadap null`) |
| Kolom turunan agregat (`month`, `serviceDueIn`, `stockShortfall`) kosong pada profil lama sehingga Dasbor menampilkan nol | db-check 13.1–13.4 (terisi saat menulis), 13.22 (dibuat DAN diisi ulang sesudah kolom sengaja dijatuhkan) |
| Angka KPI desktop dan mode browser berbeda | db-check 13.6–13.10 dan 13.16–13.17 (SQL vs `revenueByMonth`/`groupLocally` pada baris yang sama), 13.20–13.21 (paritas `derivedColumns` dengan `dbSchema`) |
| Password/hash/salt keluar ke renderer, atau akun tak terkunci setelah banyak salah | auth-check "balasan login tanpa password/hash/salt", "akun terkunci setelah 5x salah", "sesi palsu ditolak" |
| Kredensial demo plaintext kembali tampil / wajib ganti password dilewati | flow-check "tidak ada teks Demo: admin/admin123", "layar wajib ganti password muncul", db-store-run "wajib ganti password tidak muncul lagi" |
| Backup: snapshot tidak berdiri sendiri, nama snapshot jadi path traversal, restore tanpa salinan pengaman | db-backup-run "snapshot berdiri sendiri tanpa -wal", "nama snapshot berpola aman", "snapshot pengaman pra-restore tercatat" |
| Restore file rusak menghapus database hidup | db-backup-run "snapshot rusak tidak mengubah database hidup" |
| Cadangan membekukan arsip localStorage alih-alih data live | db-backup-run "ekspor tidak berisi arsip beku", "baris live masuk ke database" |
| Restore menimpa arsip localStorage pengguna | db-backup-run "arsip localStorage tidak tersentuh restore" |
| Arsip lama (380 KB `HEMS_DATA_BACKUPS` + `HEMS_HEALTH_LOGS`) ikut backup lagi | migration-check 5.1–5.2 |
| Data contoh / mock kembali muncul tanpa permintaan | migration-check 1.1–1.4, 3.0, 8.1–8.3 (seed hanya lewat paket contoh) |
| Cetak dokumen kembali lewat popup | gui-check "kanal cetak merespons (tidak menggantung)", "cetak dokumen kosong ditolak" |
| Aplikasi macet saat data bertambah | perf "median waktu cari < 800 ms", "berganti halaman < 800 ms", "50.000 baris tidak lebih dari 3x waktu 12.000 baris" |
| Halaman Jejak Audit menayangkan baris karangan (AUDIT-001..) alih-alih kejadian nyata, dengan CSV rakitan sendiri | unit 17 (sumber authClient, tanpa log karangan, CSV lewat `buildCsv`, menu SUPERADMIN, rute tanpa collection), smoke-paket "Jejak Audit menampilkan LOGIN_OK/PASSWORD_CHANGED yang sungguh terjadi" |
| Ada rute aplikasi yang tidak pernah dibuka satu harness UI pun, jadi kerusakannya tidak terlihat | unit 16 "cakupan UI: setiap rute aplikasi dilewati minimal satu harness" (daftar rute dibaca dari `App.tsx`) |
| Health check mengira localStorage masih tempat data: probe tulis tiap siklus memperbesar arsip lama, dan file SQLite yang tidak terbuka tertutup status "localStorage bisa ditulis" | unit 18 (cek penyimpanan & integritas dialihkan ke `dbInfo`/`dbIntegrity`, probe hanya mode demo), smoke-paket 4.1–4.2 (kunci yang ditulis selama sesi) |
| Uji asap paket mengganti password admin / menambah jejak audit pada profil pengguna nyata | unit 19 (`--user-data-dir` adalah satu-satunya jalan berpindah folder di paket), smoke-paket 7.1 (isi leveldb profil live dibandingkan sebelum/sesudah) |
| Harness Electron keluar tanpa `selesai()` sehingga koneksi SQLite masih terbuka saat Windows membongkar DLL-nya — rantai pernah ditandai rusak padahal semua assertion lulus | unit 15: daftarnya **diderivasi** dari `regressi.sh` + orkestrator `*-run.cjs` (setiap pengguna `require('electron')` wajib jadi langkah rantai atau perkakas yang dinyatakan), `selesai.cjs` wajib menutup database sebelum `app.exit` dan mencetak penanda, dan `regressi.sh` tidak boleh kembali memakai `npx electron` |
| Skrip perawatan di root repo menghapus `node_modules` / `package-lock.json` / `dist*` lalu `git reset --hard` + `git clean -fd` tanpa konfirmasi — di repo yang data penggunanya hidup dan satu-satunya konfigurasi build ada di `package.json` | unit 27: semua `.ps1`/`.sh`/`.cmd`/`.bat` di root dibaca setelah komentar dan string literal dibuang, daftar hitam perintah + daftar putih sasaran hapus (hanya temp, `node_modules/.vite`, `tmp-harness`), tindakan di luar temp wajib berada setelah gerbang `-Apply`, tidak boleh ada `npm run` sebelum gerbang itu, dan ada kontrol positif bahwa cabang `-Apply` benar-benar berisi perbaikan (supaya penjaga tidak hijau pada skrip yang dilumpuhkan) |
| `.ps1` non-ASCII tanpa BOM: Windows PowerShell 5.1 membaca UTF-8 sebagai cp1252, em-dash menjadi byte 0x94 = kutip kiri yang menutup string di tengah baris — error parse yang terlihat tidak berhubungan dengan isinya | unit 27: setiap `.ps1` di root yang mengandung non-ASCII wajib diawali `EF BB BF` (dimutasi dengan mengupas BOM `build-installer.ps1` — penjaga jatuh, sumber dipulihkan, hijau kembali) |
| ISCC dipanggil dengan `installer.iss` basi di root (`Source` menunjuk `dist-electron-portable`, `AppVersion "1.0.0"`): paket berisi folder mati dan tetap lulus compile | unit 14: `build-installer.ps1` wajib menyebut `installer\FATHONI-InnoSetup.iss`, dan tidak ada berkas jalur build yang boleh memanggil `.iss` root (dimutasi dengan membelokkan jalur ISCC — kedua penjaga jatuh) |
| Wait harness menguji `/record/` pada `#pager-info` sebagai "kueri selesai", padahal `Pager.tsx` juga menulis "Tidak ada record" selama `total` masih 0 — jadi teks loading pun cocok. Rantai-302f jatuh di handoff 8.1 (`sql=2, kartu=0`) karena ini, bukan karena aplikasinya | unit 28: setiap `waitFor` yang menyebut `#pager-info` wajib punya `!/memuat/` ATAU `/dari … record/`; kontrol positif menuntut ≥15 wait terdeteksi dan ≥3 di antaranya menguji `/record/` apa adanya (dimutasi dengan menghapus satu klausul `!/memuat/` di handoff-check — FAIL langsung, 296/1) |
| Harness membuktikan dirinya lewat desktop manusia: `gui-check` bagian 8 membuka `window.open('https://example.com')`, handler menyerahkannya ke `shell.openExternal`, dan Chrome sungguhan terbuka setiap langkah `gui` dijalankan | unit 28: harness yang memanggil `window.open` wajib menambal `shell.openExternal` dengan perekam lebih dulu, dan hasil tambalan itu wajib dipakai sebagai assertion (gui 8.1b) — bukan dibuktikan dengan jendela yang muncul di layar pengguna |

## PREFLIGHT lingkungan (`auto-fix.ps1` di root repo)

Sebelum menyalahkan harness atas kegagalan yang sebenarnya berasal dari lingkungan
(Node salah, `.npmrc` bergeser dari ABI yang dipakai `better-sqlite3`, bundel basi, RAM
habis, satu proses Electron nyasar memegang profil), jalankan skrip periksa ini. Ia
**baca-saja** secara bawaan dan berhenti dengan kode 1 hanya kalau ada FAIL:

```
powershell -NoProfile -ExecutionPolicy Bypass -File auto-fix.ps1          # 21 pemeriksaan, tidak menulis apa pun
powershell -NoProfile -ExecutionPolicy Bypass -File auto-fix.ps1 -Apply   # boleh menuntaskan: .vite cache + rebuild native/build
```

Yang diperiksa: node/npm dan `node_modules`; nama `package-lock.json` vs
`package.json "name"` (kunci, bukan label — lihat QA_REPORT §7); versi Electron;
drift `runtime`/`target` di `.npmrc` dibanding `package.json`; **probe native sungguhan**
— skrip sementara yang dijalankan oleh Electron proyek dan benar-benar membuka
`better-sqlite3` di database `:memory:` (ABI yang salah tidak bisa dideteksi dari teks);
kesegaran `dist/index.html`, `dist-electron/main.js`, `app.asar` dan installer dibanding
sumbernya; RAM bebas, `NODE_OPTIONS`, proses Electron/FATHONI yang masih hidup; status
git (baca saja). Baris terakhir `FAIL=x WARN=y dari z pemeriksaan`.

Tiga batas yang membuat skrip ini bisa dibiarkan ada di root repo:
- **Ia tidak bisa menghancurkan.** Versi lamanya menghapus `dist*`, `node_modules`,
  `package-lock.json` dan menjalankan `git reset --hard` + `git clean -fd` tanpa
  konfirmasi. Penjaga validation §27 membaca semua skrip root (setelah komentar dan
  string literal dibuang) dan menolak daftar hitam perintah maupun penghapusan di luar
  path sementara; semua tindakan tulis wajib berada setelah gerbang `-Apply`.
- **WARN bukan vonis.** Yang dibandingkan lebih dulu adalah `mtime`, dan `mtime` sumber
  yang lebih baru dari `app.asar` hanyalah kecurigaan — isinya bisa tetap identik. Karena
  itu pemeriksaan kesegaran membandingkan **isi terhadap HEAD** (`git status --porcelain --
  src electron`, dibaca saja): selama pohon kerja sama dengan commit yang dibundel, geseran
  mtime dilaporkan OK dengan alasannya — ini terjadi nyata pada dua berkas yang sempat
  dipakai uji mutasi lalu dipulihkan, yang akan membuat peringatan menempel selamanya.
  Begitu sumber benar-benar berbeda, WARN-nya muncul lagi. Verdict isi paket tetap milik
  langkah `paket` di `regressi.sh`; FAIL hanya untuk berkas yang memang tidak ada.
- **Ambangnya dikalibrasi pada mesin ini, bukan pada mesin ideal.** RAM bebas di 3,8 GB
  ini berdiam di 240–300 MB, jadi garis FAIL yang ditaruh di 250 MB menghasilkan koin:
  `FAIL=1` dan `FAIL=0` pada isi repo yang sama. Rantai penuh dan build rilis keduanya
  selesai pada 269 MB bebas. FAIL kini hanya di bawah 128 MB (keadaan yang benar-benar
  tidak bisa dijalankan); tekanan memori yang cuma membuat angka waktu harness tidak valid
  adalah WARN. Rapor merah yang muncul terus-menerus melatih orang mengabaikan preflight —
  itulah kegagalan yang ingin dicegah oleh PREFLIGHT ini.
- **Ia sendiri diuji.** Branch `-Apply` diverifikasi hanya menyentuh `node_modules/.vite`
  dan membangun ulang, dengan `node_modules`, lockfile, `app.asar`, basis data dan profil
  pengguna tetap utuh; kontrol positif di §27 memastikan cabang itu tidak dilumpuhkan
  supaya penjaganya tidak hijau kosong.

Catatan teknis yang menyelamatkan satu sesi build: `.ps1` non-ASCII di root **wajib
ber-BOM UTF-8**. Windows PowerShell 5.1 membaca berkas tanpa BOM sebagai cp1252, sehingga
tanda em-dash (`E2 80 94`) terurai menjadi tiga karakter dan byte terakhirnya (0x94)
adalah tanda kutip kiri — string tertutup di tengah baris dan skrip mati dengan error
parse yang terlihat tidak berhubungan dengan isinya. Aturan itu ikut dijaga §27.

## Uji asap terhadap paket (`smoke-paket-check.cjs`)

Harness-harness lain menguji kode dari DALAM proses Electron. Yang satu ini
menguji barang yang benar-benar diserahkan ke pengguna: `FATHONI.exe` hasil
`dist-app/win-unpacked`, dengan `app.asar` berisi, tanpa `HEMS_DATA_DIR`.

```
npm run make:installer            # atau npm run dist:dir
node tests/harness/smoke-paket-check.cjs
```

Cara kerjanya:

1. Sandbox profil dibuat ulang di `tmp-harness/appdata-smoke/hems-heavy-equipment-system`
   dan diisi salinan arsip `Local Storage` pra-SQLite (bisa ditunjuk lain lewat
   `SMOKE_ARSIP`), sehingga jalur sekali-impor ikut teruji. Tanpa arsip, yang
   teruji jalur instalasi baru.
2. Paket dinyalakan dengan `--user-data-dir=<sandbox>` dan `--remote-debugging-port`.
   `electron/main.ts` mem-pin folder datanya, dan switch itulah — bukan variabel
   APPDATA, yang diabaikan Windows untuk proses anak — satu-satunya cara memindah
   profil paket. Tanpa pin ini, menjalankan paket = mengganti password admin dan
   menambah jejak audit milik pengguna nyata.
3. Jendela dikendalikan lewat CDP: login, gerbang wajib ganti password, lalu
   halaman Pemasok/Pembelian/Gudang/Armada/Jejak Audit. Yang diperiksa bukan hanya
   "layar muncul", tapi barisnya benar-benar hasil impor dan dokumen tidak terpotong.
4. Sebelum keluar dipasang pencatat `Storage.prototype.setItem/removeItem`. Setelah
   sesi, daftar kunci yang ditulis dibandingkan dengan daftar izin; tambahan apa pun
   berarti ada kode yang masih memperlakukan localStorage sebagai tempat data.
5. Setelah proses mati: database sandbox dibaca (penanda impor, tepat 11 baris asli,
   tanpa baris contoh), `accounts.json` diperiksa (hash+salt, nol plaintext), dan
   isi leveldb profil nyata dibandingkan sebelum/sesudah sebagai bukti isolasi.

Tanpa paket yang sudah dibangun, harness mencetak `LEWAT` dan `SELESAI kode=0` —
rantai regresi tidak dianggap rusak hanya karena biner rilis belum dibuat.

## Memeriksa profil sungguhan tanpa menyentuhnya

`profile-inspect.cjs` membuka **salinan** profil dan mencetak setiap kunci
localStorage beserta bentuknya; ia tidak memuat `dist-electron/main.js` sehingga
aplikasi tidak boot dan tidak menulis apa pun. `migration-dryrun.cjs` lalu menjalankan
`migrateStore` di atas salinan itu dengan localStorage yang menolak semua tulisan,
jadi terlihat persis apa yang akan berubah sebelum migrasi berjalan sungguhan.

```
cp -r "$APPDATA/hems-heavy-equipment-system" D:/SANY/tmp-harness/livecopy
HEMS_DATA_DIR=D:/SANY/tmp-harness/livecopy node_modules/electron/dist/electron.exe tests/harness/profile-inspect.cjs
node tests/harness/migration-dryrun.cjs D:/SANY/tmp-harness/livecopy/localStorage-dump.json
```
