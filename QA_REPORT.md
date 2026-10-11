# FATHONI EQUIPMENT OS — Laporan QA
**Versi aplikasi**: 3.0.0 (nama paket `hems-heavy-equipment-system`, dipertahankan sebagai kunci data — lihat §7)
**Tanggal laporan**: 2026-10-11
**Status**: Rilis terverifikasi. Rantai regresi penuh hijau: 15 langkah, 1.024 assertion, 0 gagal.

Laporan ini menggantikan laporan 2026-09-23 (HEMS 1.0.0). Laporan lama itu sudah tidak
berlaku dan sengaja ditulis ulang, bukan ditambal: ia menyebut localStorage sebagai
lapisan penyimpanan, "no automated tests", dan Breakdown / Operator / Teknisi /
Approval / Audit Log sebagai "belum diimplementasikan" — semuanya sudah tidak benar.
Matriks rinci tiap assertion ada di `tests/harness/README.md`; dokumen ini ringkasannya.

---

## 1. Yang berubah sejak laporan 1.0.0

| Aspek | 1.0.0 (laporan lama) | 3.0.0 (hari ini) |
|---|---|---|
| Penyimpanan | `localStorage` (hems_*), kuota ~5 MB | SQLite (`fathoni.db`, better-sqlite3 11.10.0, WAL) di main process; 18 collection |
| Akses data | seluruh store disalin ke renderer saat boot | halaman besar query berpaginasi (`MAX_PAGE_LIMIT` 500); boot memindahkan **0 baris** lewat IPC |
| Akun & login | kredensial di sisi renderer | hash+salt di main process, token sesi, wajib ganti password, lockout 5x salah, `accounts.json` tanpa plaintext |
| Tulis data | `setX(wholeArray)` | jalur per-baris (`dbPatch`: upsert/removeIds) + aturan rujukan saat hapus; simpanan penuh hanya kalau collection terbukti terdimuat penuh |
| Pengujian | manual saja | 14 harness otomatis + audit dependensi, dijalankan berurutan oleh `tests/harness/regressi.sh` |
| Paket | `HEMS-Setup-1.0.0.exe` 92,8 MB, ikon bawaan | `FATHONI-Setup-3.0.0.exe` 79,3 MiB, ikon exe sendiri, asar ramping (hanya `dist`, `dist-electron`, `better-sqlite3`) |

## 2. Matriks jenis pengujian

Angka diambil dari `D:/SANY/tmp-harness/logs/<nama>.log` pada rantai 2026-10-11.

| Jenis | Harness | Assertion | Yang dibuktikan |
|---|---|---|---|
| **Unit** | `validation-check` | 241 | aturan batas validator, sanitasi, `matchesQuery` (termasuk "SANY SY215C" dua kolom), checksum pemulihan, + penjaga statis (§5) |
| **Unit (lapisan data)** | `migration-check`, `db-store-run`, `db-backup-run` | 49 + 47 + 87 | migrasi sekali dari arsip lama, rencana tulis per collection, atomisitas simpan sebagian, snapshot |
| **Fungsional** | `gui-check`, `flow-check`, `usable-check` | 72 + 30 + 33 | tiap layar membuka, mengisi, mencari, memfilter, menyimpan; semua 30 entri rute di `App.tsx` (termasuk wildcard halaman detail) dilewati minimal satu harness — dijaga validation 16 |
| **Integrasi (lintas menu)** | `handoff-check` | 114 | Pembelian→Gudang/Unit/Pemasok/Kas, Servis→Part/Invoice/Kas, Invoice→Kas, dan 6 menu katalog menghapus lewat patch (§4) |
| **Integritas & transaksi** | `db-check`, `integritas-check` | 136 + 62 | paritas SQL vs `matchesWhere`, `where` pada kunci `id`, rujukan saat hapus, rollback penuh saat patch beracun, file tetap sehat setelah dibuka ulang |
| **Keamanan** | `auth-check`, `npm audit` | 58 + 0 kerentanan | balasan login tanpa password/hash/salt, pesan generik, lockout, sesi palsu ditolak, CSP/sandbox/izin, injeksi formula CSV ditahan |
| **Performa (beban + stres)** | `perf-check` | 37 | angka di §3, termasuk pertumbuhan ke 50.000 baris dan DOM yang tetap 12 kartu |
| **Kompatibilitas** | `compat-check`, `usable-check`, `smoke-paket` | 30 + (ukuran) + 28 | boot di profil lama hasil upgrade (kolom turunan dibuat + dihitung ulang), mode browser tanpa `electronAPI` (login demo, nol error renderer), jendela 1200 px tanpa pemotongan tabel, paket jadi FATHONI.exe di sandbox |
| **Regresi** | `regressi.sh` | 15 langkah | seluruh rantai di atas dijalankan berurutan; hasil dibaca dari penanda `SELESAI kode=N` milik harness, bukan kode keluar `npx` (pernah segfault 139 setelah semua assertion lulus) |

## 3. Kapasitas: berapa banyak record yang tahan

Terukur di mesin ini (RAM 3,8 GB) pada profil uji terisolasi, mode WAL:

| Titik ukur | Hasil |
|---|---|
| Boot di profil 25.000 baris | jalan, **0 baris** pindah lewat IPC saat boot |
| Membuka layar Unit di 12.000 unit | terisi dari SQLite, **0 baris store** lewat IPC sejak login |
| Kueri telanjang dari renderer, 12.000 baris | < 150 ms |
| Agregat berindeks di 6.000 baris kas | < 150 ms, KPI dihitung SQLite |
| Tulis satu baris lewat `dbPatch` | median **1 ms** |
| Simpan 50.000 unit dari main process | 1.104 ms (membekukan event loop selama itu — tercatat, bukan tanpa batas) |
| Pencarian di layar Unit, 50.000 baris | median **275 ms**, dan tidak lebih dari 3x waktu di 12.000 baris |
| Kueri telanjang di 50.000 baris | median **86 ms** |
| Ukuran DOM tabel | tetap **12 kartu** saat tabel tumbuh ke 50.000 baris |
| Total baris profil uji | 63.000 di seluruh 18 collection |

Kesimpulan praktis: batasnya bukan SQLite. Yang menahan pertumbuhan adalah (a) jumlah
baris yang boleh masuk renderer — dibatasi halaman 500 baris, (b) waktu simpan
collection penuh bila diperlukan (±1,1 s per 50.000 unit), dan (c) RAM mesin. Data
sampai ratusan ribu baris masih searah dengan yang sudah terukur; di atas 50.000
per collection belum ada angka, jadi jangan dinyatakan sebagai "sudah teruji".

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
   sesudahnya. *Penjaga*: validation 22.
5. **Dua cacat yang hanya terlihat pada paket jadi** (ditemukan uji asap 3.0.0):
   `healthCheck` masih menulis probe ke `localStorage` dan menutup kegagalan file basis
   data dengan status "localStorage bisa ditulis"; serta tidak ada cara aman menguji
   paket — uji pertama diam-diam memakai profil nyata (password admin berubah, jejak
   audit bertambah; sudah dikembalikan dari snapshot). Sekarang `--user-data-dir`
   dihormati saat packaged dan uji asap membandingkan profil nyata sebelum/sesudah.

Pola yang menyatukan ketiganya: yang rusak bukan satu menu, melainkan asumsi bahwa
data yang dibaca selalu lengkap dan selalu berasal dari jalur yang sama.

## 5. Penjaga anti-regresi (bukan assertion fungsi)

`validation-check` §12, §15–§22 menahan bentuk kode, bukan hanya hasilnya:
peta `MENU_HAPUS` 17 collection + larangan filter-array di halaman ber-`useDataStore`;
harness Electron wajib keluar lewat `selesai()`; setiap rute aplikasi harus dilewati
minimal satu harness; `AuditLog` wajib bersumber dari main process dan tanpa baris
karangan; `healthCheck` wajib memeriksa SQLite; lokasi data paket dan sandbox uji asap;
boundary berkunci rute; dua aturan §4.3–4.4 di atas.

## 6. Yang BELUM diverifikasi (perbatasan laporan ini)

- **Sistem operasi lain**: hanya Windows 11 build ini. macOS/Linux tidak diuji;
  electron-builder dikonfigurasi Windows.
- **DPI/ukuran layar nyata**: `usable-check` mengukur pada 1200 px (client 1184) dan
  melaporkan tidak ada pemotongan. Variasi scaling Windows, 4K, dan netbook belum.
- **Perangkat keras**: tidak ada uji printer sejati, scanner, atau perangkat keras
  lapangan; cetak diverifikasi lewat jalur IPC/HTML, bukan hasil kertas.
- **Code signing**: exe/installer tidak ditandatangani — SmartScreen akan
  memperingatkan pengguna baru.
- **Walkthrough usability oleh manusia**: semua yang tercatat di §2 adalah pengukuran
  otomatis; tidak ada sesi diterimanya alur kerja oleh pemakai sebenarnya.
- **Anggaran performa masih dilonggarkan**: boot < 15 s, domReady < 12 s, cari median
  < 800 ms, kueri < 400 ms, patch < 250 ms. Angka §3 jauh di bawahnya, tapi
  ambangnya sendiri belum disepakati sebagai target rilis.
- **Kapasitas di atas 50.000 baris per collection** belum diukur.
- **Aturan rujukan untuk teknisi/operator** belum bisa menahan hapus:
  `services.mechanicName`, `breakdowns.assignedTechnician`, `rentals.operatorName`
  belum menjadi kolom tersimpan (`REFERENCE_RULES` hanya menerima kolom).
  Perbaikannya menyentuh profil live (backfill `ensureColumns`, `DERIVED_REVISION`
  5→6) sehingga menunggu keputusan.
- **Artefak lama di repo**: `dist-installer/HEMS-Setup-1.0.0.exe`,
  `installer/dist-installer/HEMS-Setup-*.exe`, `dist-electron-portable` (156 MB,
  `app.asar` terkunci proses), dan dependensi Prisma (~111 MB) yang tidak dipakai.
  Tidak ada yang dihapus tanpa persetujuan.

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
sh tests/harness/regressi.sh                   # 15 langkah, log di D:/SANY/tmp-harness/logs
```

Satu instance Electron pada satu waktu (mesin 3,8 GB RAM). Harness yang menyentuh
profil wajib lewat `HEMS_DATA_DIR=D:/SANY/tmp-harness/r-<nama>`; `APPDATA` tidak
dipakai untuk profil Chromium/paket — gunakan `--user-data-dir`.
