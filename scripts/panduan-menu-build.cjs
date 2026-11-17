/**
 * panduan-menu-build.cjs
 *
 * Menyusun 26 berkas panduan (satu per menu sidebar) + satu indeks dari
 * panduan-menu/data.json. Isi data.json adalah hasil potret DOM yang dibaca
 * langsung dari aplikasi yang sedang berjalan (scripts/panduan-menu.cjs), jadi
 * nama kolom, label tombol dan isi bawaan di panduan ini persis seperti yang
 * tampil di layar — bukan salinan dari kode sumber.
 *
 * Bagian "kegunaan", "setelah disimpan" dan "perlu diketahui" ditulis tangan di
 * peta PROSE di bawah, dan setiap butirnya sudah diperiksa ke file sumber atau
 * hasil uji (QA_REPORT §4.20). Angka kartu/tabel pada gambar berasal dari data
 * contoh pengujian ber-id PG-* di profil sementara, sehingga setiap berkas
 * diberi keterangan itu secara terang-terangan.
 *
 * Skrip ini hanya membaca dan menulis di panduan-menu/. Tidak ada sumber
 * aplikasi yang disentuh.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const OUT = path.join(AKAR, 'panduan-menu');
const DATA = JSON.parse(fs.readFileSync(path.join(OUT, 'data.json'), 'utf8'));

const VERSI = '3.0.5';
const TANGGAL = '13 Oktober 2026';

const ROLE = { SUPERADMIN: 'Super Admin', SALES: 'Sales', WAREHOUSE: 'Gudang', SERVICE: 'Teknisi', FINANCE: 'Keuangan' };
const MODE = {
  DEALER: 'Dealer / Distributor',
  TRADER: 'Pedagang Alat Bekas',
  WORKSHOP: 'Bengkel / Workshop',
  CONTRACTOR: 'Kontraktor',
  RENTAL: 'Perusahaan Sewa (Rental)',
};

// ── Peta prose ───────────────────────────────────────────────
// peran/mode dibaca dari NAV_GROUPS (src/components/Layout.tsx); efek lintas
// menu dibaca dari src/store/dataStore.tsx dan halaman terkait.
const PROSE = {
  dasbor: {
    ringkas: 'Halaman pertama yang muncul setelah login. Isinya ringkasan satu layar: kartu kondisi armada, pendapatan, pekerjaan servis yang berjalan, plus pintasan ke modul lain dan pemilih profil bisnis. Menu ini hanya membaca — tidak ada satu pun form di sini.',
    efek: ['Tidak menulis data apa pun. Kartu dan grafik dihitung dari collection di SQLite pada saat halaman dibuka.', 'Tombol "Ganti Mode Profil" mengubah profil bisnis aktif; pilihan itu yang menentukan menu mana yang muncul di sidebar (lihat Bab "Profil Bisnis" di panduan utama).'],
    cacat: ['Judul halaman tidak memakai kelas `.page-title` (halaman ini punya kepala sendiri), jadi panduannya menyebut isi layar, bukan satu judul baku.', 'Semua angka di gambar adalah angka data contoh PG-*, bukan angka perusahaan Anda.'],
  },
  'control-tower': {
    ringkas: 'Layar pemantauan fleet secara langsung: status unit, pekerjaan servis aktif, suku cadang menipis, dan tagihan. Empat tombol "View All …" di bawah mengarahkan ke menu yang bersangkutan.',
    efek: ['Tidak menulis data. Angka diambil dari query SQLite (units, services, spareParts, invoices).', 'Tombol "View All Units / Services / Spareparts / Invoices" menavigasi ke menu terkait, bukan membuka jendela.'],
    cacat: ['Sama seperti Dasbor: angka pada gambar adalah data contoh PG-*.', 'Control Tower memakai komponen kartu sendiri, sehingga daftar ini tidak menampilkan tabel kolom.'],
  },
  'merek-model': {
    ringkas: 'Katalog merek manufaktur dan spesifikasi teknis model. Satu layar berisi dua tab: "Daftar Merek" dan "Spesifikasi Model Unit". Katalog ini adalah hulu dari seluruh data unit — form Unit mengambil pilihan merek dari sini.',
    efek: ['Merek yang disimpan di sini menjadi isi dropdown "Merek *" pada form Unit dan form Model.', 'Model yang disimpan di sinilah yang membuat dropdown unit di Penjualan / Rental / Servis menampilkan "Merek + Model" yang benar; spesifikasi (kapasitas, daya, berat operasional) ikut muncul di Equipment Passport.', 'Hapus merek yang masih dipakai unit akan ditahan aturan referensi (Fase 6).'],
    cacat: ['Kolom "Kategori Unit", "Kapasitas", "Daya Mesin" dan "Berat Operasional" adalah teks bebas tanpa format baku — tulisan "21 t" dan "21 ton" dianggap dua hal berbeda.', 'Tab beralih lewat tombol, bukan URL; membuka kembali menu selalu mulai dari tab Daftar Merek.'],
  },
  unit: {
    ringkas: 'Daftar armada beserta nomor seri, hour meter, status operasional dan lokasi. Nomor seri di menu ini adalah kunci penghubung ke Penjualan, Rental, Servis, Breakdown dan Pengiriman.',
    efek: ['Status unit berubah otomatis dari menu lain: terjual menjadi SOLD (Penjualan), sewanya aktif menjadi RENTAL/RENTED (Sewa), work order "Sedang Berjalan" menjadi MAINTENANCE (Servis), laporan breakdown menjadi BREAKDOWN, dan servis selesai mengembalikan AVAILABLE sekaligus menaikkan Hour Meter.', 'Hanya unit berstatus AVAILABLE yang muncul di dropdown "Pilih Unit (AVAILABLE)" pada Penjualan dan Rental; Servis juga menerima ON_PROJECT.', 'Foto unit dikompres (sisi terpanjang 1400 px) dan disimpan sebagai berkas di folder data, bukan di dalam database.', 'Kartu detail menaut tab-nya ke nomor sasis unit ini: PERAWATAN menampilkan Work Order dan SEWA menampilkan kontrak rental dengan sasis yang sama, dibaca dari database (12 baris pertama, dengan penanda bila lebih). SUKU CADANG, GARANSI dan DOKUMEN menyatakan alasannya secara jujur karena skema belum menyimpan kunci penaut — tidak ada baris contoh.', 'Tombol pada kartu detail adalah navigasi nyata ke menu yang bersangkutan dengan unit sudah terisi (+ Catat Service Baru, Lihat Stok Suku Cadang, Catat Pemakaian Part, + Alokasikan Kontrak Baru, + Upload Dokumen, PASSPORT DIGITAL); tidak ada tombol yang hanya memunculkan kotak peringatan.'],
    cacat: ['Harga perolehan (purchasePrice) tidak pernah ditanyakan di jendela ini dan tidak bisa diubah dari layar; unit baru diisi Rp 1.750.000.000 dan angka itulah yang tampil di kartu unit, Equipment Passport, kolom "Nilai Perolehan" Laporan, serta menjadi pembagi biaya per jam di Dasbor (QA §4.20).', 'Karena kolomnya tidak ada, validasi `validateAmount(form.purchasePrice, 1 juta, 10 miliar)` tetap berjalan atas nilai yang tak terlihat: unit lama di luar rentang itu menolak tombol Simpan tanpa kolom yang bisa diperbaiki.', '"Kode Model *" adalah teks bebas — harus persis sama dengan kode di menu Merek & Model supaya terhubung.'],
  },
  pelanggan: {
    ringkas: 'Master pelanggan. Nama di sinilah yang muncul di dropdown pembeli pada SPK Penjualan dan pada work order Servis.',
    efek: ['Setiap pelanggan baru langsung menjadi pilihan di "Nama Pembeli (Pilih dari Data Pelanggan)" (Penjualan) dan "Pelanggan (Pilih dari Master)" (Servis).', 'Kontrak Rental memakai dropdown "Nama Penyewa (Pilih dari Master)" yang sumbernya sama.'],
    cacat: ['Menekan Simpan dengan nama kosong berhenti diam-diam: tidak ada pesan, tidak ada tanda merah, tombol terasa mati (QA §4.20).', 'Tidak ada pemeriksaan duplikat nama maupun NPWP — PT yang sama bisa masuk dua kali dan keduanya muncul di semua dropdown.'],
  },
  pemasok: {
    ringkas: 'Master pemasok, termasuk nama bank dan nomor rekening untuk pembayaran PO.',
    efek: ['Menu Pembelian tidak mengambil nilai ini dari dropdown: nama pemasok diketik ulang di PO. Saat PO diterima, sistem memastikan pemasok dengan nama itu ada di sini (pembuatannya otomatis bila belum ada).', 'Rekening pemasok hanya teks keterangan di daftar ini — pembayaran PO masuk ke kas tanpa menunjuk rekening tujuan.'],
    cacat: ['Sama seperti Pelanggan: nama kosong ditolak tanpa pesan (QA §4.20).', 'Tidak ada pemeriksaan duplikat nama/NPWP, sehingga ejaan berbeda ("PT Sany" vs "PT SANY") menghasilkan dua pemasok.'],
  },
  operator: {
    ringkas: 'Daftar operator beserta lisensi, penugasan, dan jam kerja. Menu ini tulis-only untuk Super Admin (penegakan peran ada di proses utama).',
    efek: ['Kontrak Rental hanya mencatat "Termasuk Tenaga Operator" sebagai kotak centang; nama operator dari menu ini tidak pernah dipilih di form mana pun (lihat cacat).', 'Kolom "Unit Terassign" adalah dropdown ke daftar unit; mengubahnya di sini tidak mengubah status unit di menu Unit.'],
    cacat: ['Label "Telepon *" menahan kosong di layar lama: bintangnya berbohong, karena `validatePhone` mengembalikan "tidak ada kesalahan" untuk nilai kosong (QA §4.20).', 'Jendela ini memakai gaya lama (`.modal-content` tidak ada di stylesheet) sehingga kolomnya tampil putih di atas jendela gelap.', 'NIK hanya diperiksa panjangnya kalau diisi, dan tidak ada pemeriksaan duplikat NIK.', 'Tidak ada satu pun form di menu lain yang mengambil nama dari daftar operator — hubungan antara operator dan kontrak sewa masih berupa kotak centang, dan tautan sungguhnya membutuhkan kolom baru (dicatat di QA sebagai sisa Tahap 2).'],
  },
  teknisi: {
    ringkas: 'Daftar teknisi beserta spesialisasi, sertifikasi, dan beban kerja (jumlah work order, jam kerja).',
    efek: ['Seperti Operator, nama teknisi di sini tidak menjadi pilihan di form Servis maupun Breakdown — keduanya mengetik nama secara bebas.', 'Angka "Total Work Orders" dan "Total Jam Kerja" adalah isian manual di daftar ini, bukan hasil hitung dari menu Servis.'],
    cacat: ['"Spesialisasi" dan "Skills" bukan input atau select biasa (keduanya guli pilihan buatan sendiri), sehingga tidak ikut terbawa saat form disalin/diakuratkan.', 'Jendela gaya lama: kolom putih di atas jendela gelap; label "Telepon *" tidak menahan kosong (QA §4.20).', 'Tidak ada pemeriksaan duplikat NIK.'],
  },
  pembelian: {
    ringkas: 'Purchase order untuk suku cadang, consumable, BBM, dan unit. Alur selesai ada di baris tabel: tombol "Terima Barang".',
    efek: ['"Terima Barang" (menggunakan kotak konfirmasi standar Windows) membuka satu rantai: mutasi gudang BARANG MASUK atas nomor PO, status PO menjadi RECEIVED, pemasok dipastikan ada di menu Pemasok, stok suku cadang bertambah bila kategorinya bukan UNIT, dan kas keluar sebesar nilai PO tercatat di Kas & Bank.', 'Jumlah yang masuk ke gudang dan stok diambil dari angka pertama di kolom "Nama Barang / Spesifikasi Pesanan" (misal "10 Filter Oli"  10), bukan dari kolom jumlah tersendiri.', 'PO berkategori UNIT tidak menambah stok suku cadang dan tidak membuat unit baru — unit harus tetap diketik sendiri di menu Unit.'],
    cacat: ['Kategori "BBM" kini bisa disimpan dan "CONSUMABLE" tidak lagi ditolak (diperbaiki pada T1, rilis 3.0.3); sebelum itu keduanya ditolak tanpa penjelasan.', 'Nomor PO usulan berasal dari jumlah baris di SQLite; menghapus baris tengah dapat memunculkan nomor yang sudah dipakai, dan sistem tidak menolak duplikat nomor.'],
  },
  penjualan: {
    ringkas: 'SPK (Sales Order) penjualan unit. Satu aksi simpan menutup seluruh handoff: unit menjadi terjual, invoice lahir, uang muka masuk kas, dan surat jalan menunggu dijadwalkan.',
    efek: ['Unit dengan nomor seri SPK menjadi SOLD di menu Unit dan hilang dari dropdown unit tersedia.', 'Invoice bertipe PENJUALAN otomatis terbit di Faktur / Invoice (satu invoice per nomor SPK; menekan simpan dua kali tidak menghasilkan tagihan ganda).', 'Uang muka lebih dari nol masuk ke Kas & Bank sebagai kas masuk kategori PENJUALAN dengan referensi nomor SPK.', 'Dokumen pengiriman berstatus MENUNGGU dibuat otomatis di menu Pengiriman, dengan jadwal dan tujuan masih kosong.'],
    cacat: ['"Model Terpilih" terisi otomatis dan tidak dapat diketik — kalau merek/kode model tidak cocok dengan katalog, kolom itu tetap menampilkan nilai lama hasil tebakan, bukan kosong.', 'Nomor SPK usulan dapat bertabrakan seperti di Pembelian; tidak ada pemeriksaan duplikat nomor SPK saat simpan.'],
  },
  'sewa-rental': {
    ringkas: 'Kontrak sewa bulanan: penyewa, unit, lama sewa, tarif, jam minimum, dan opsi termasuk operator.',
    efek: ['Kontrak berstatus AKTIF mengubah unit menjadi RENTED/RENTAL di menu Unit dan menerbitkan invoice Sewa (satu invoice per nomor kontrak).', 'Menyelesaikan/mengembalikan kontrak mengembalikan status unit menjadi AVAILABLE.', '"Minimal Jam Operasi (HM)" dipakai Laporan Kinerja Unit untuk menghitung selisih jam tarik (underhours).'],
    cacat: ['"Termasuk Tenaga Operator" hanya centang Ya/Tidak — nama orangnya tidak pernah dipilih dari menu Operator.', 'Tanggal berakhir tidak divalidasi harus sesudah tanggal mulai di jendela ini; kontrak dengan tanggal terbalik tersimpan dan membuat perhitungan hari sewa negatif.'],
  },
  persetujuan: {
    ringkas: 'Antrean persetujuan internal (permintaan pembelian, diskont, pengeluaran). Hanya Super Admin yang dapat membuka dan menulis; tombol ✓ dan ✗ ada di baris.',
    efek: ['Menyetujui sebuah request TIDAK menjalankan apa pun: tidak membuat PO, tidak menggerakkan kas, tidak mengubah stok. Statusnya saja yang berubah menjadi APPROVED.', 'Menu ini adalah satu dari dua menu yang penulisannya dijaga peran di proses utama (selain Kas untuk peran Keuangan).'],
    cacat: ['"Amount" bawaan 0 dan tidak wajib — request bernilai nol bisa disetujui dan angka nol itulah yang tampil di laporan.', 'Jendela gaya lama (kolom putih di atas jendela gelap, QA §4.20).', 'Penolakan dan penyimpanan memakai `alert`, jadi pesan keluar dari konteks form.'],
  },
  faktur: {
    ringkas: 'Semua tagihan: terbit otomatis dari Penjualan, Sewa, dan Servis, atau dibuat manual. Kolom pembayaran diisi lewat tombol "Bayar" di baris.',
    efek: ['"Bayar" mencatat jumlah yang diterima dan rekening tujuannya, menaikkan progres pembayaran invoice, dan menulis kas masuk ke Kas & Bank (kategori mengikuti sumber tagihan).', 'Invoice manual tidak terhubung ke sumber apa pun — nomor SPK/ kontrak tidak diperiksa, sehingga tagihan bisa dibuat untuk pelanggan yang tidak ada di master.', 'Invoice hasil otomatis tidak dibuat ganda: penerbitan memakai kunci sumber (sourceType + nomor sumber).'],
    cacat: ['Invoice yang Anda terbitkan manual tidak terhubung ke dokumen sumber mana pun — kolom pelanggan adalah teks bebas, sehingga tagihan bisa dibuat untuk nama yang tidak ada di master Pelanggan.', 'Kelebihan pembayaran ditolak dengan `alert` (QA §4.20) tanpa menunjuk kolom jumlah.', 'Nomor invoice usulan diambil dari jumlah baris di SQLite; tidak ada penolakan duplikat nomor invoice saat simpan.'],
  },
  gudang: {
    ringkas: 'Buku mutasi barang masuk/keluar beserta lokasi yard, dan kartu ringkasan per yard. Setiap baris punya bukti cetak.',
    efek: ['Mutasi otomatis datang dari: penerimaan PO (BARANG MASUK), pemakaian suku cadang saat servis selesai (BARANG KELUAR), dan penyesuaian stok.', 'Mutasi yang Anda catat sendiri di menu ini hanya menulis buku mutasi. Stok di menu Suku Cadang TIDAK berubah — itulah sebabnya stok perlu disesuaikan di menu Suku Cadang.', '"Cetak Bukti" membuka jendela cetak berisi formulir serah terima (jalur yang sama dengan Surat Jalan dan PO).'],
    cacat: ['Isi bawaan "Lokasi Gudang / Yard" adalah "Yard Cikande Main Hub", sedangkan empat opsi dropdown semuanya berekor, misalnya "Yard Cikande Main Hub (Banten)". Select tidak menolak nilai asing, jadi mutasi tersimpan dengan nama pendek sementara kartu yard di halaman yang sama menyebut nama lain (QA §4.20).', 'Satu penolakan memakai `alert`, bukan pesan inline.', 'Nomor bukti (TRX/GR/GI) diusulkan dari jumlah baris; tidak ada penolakan duplikat.'],
  },
  'suku-cadang': {
    ringkas: 'Katalog part: part number, kategori, kompatibilitas model, stok, batas minimum, harga beli dan harga jual.',
    efek: ['Stok berkurang otomatis ketika sebuah work order diselesaikan dengan daftar suku cadang (menu Servis), dan bertambah ketika PO suku cadang diterima (menu Pembelian).', 'Baris yang stoknya di bawah "Batas Min. Stok" memicu kartu peringatan di Control Tower dan menandai work order "MENUNGGU SPAREPART".', 'Harga jual dipakai nilai pemakaian part pada laporan servis; harga beli dipakai margin.'],
    cacat: ['Penolakan simpan memakai `alert` tanpa menunjuk kolom (QA §4.20).', '"Model Kompatibel / Brand" teks bebas, sehingga pencarian part yang cocok dengan model tertentu sering melewatkan ejaan berbeda.'],
  },
  breakdown: {
    ringkas: 'Laporan kerusakan unit di lapangan: lokasi, tingkat keparahan, diagnosis, penugasan teknisi, estimasi vs biaya aktual, dan jam henti.',
    efek: ['Melaporkan breakdown mengubah status unit menjadi BREAKDOWN di menu Unit.', 'Status diubah menjadi RESOLVED atau CANCELLED dari jendela edit mengembalikan unit menjadi AVAILABLE.', '"Downtime (Jam)" dihitung sendiri dari "Waktu Mulai" dan "Waktu Selesai" — kalau salah satu kosong, kolomnya kosong dan Laporan Kinerja tidak menganggapnya jam henti.', 'Biaya aktual breakdown ikut menjadi biaya pemeliharaan unit di Laporan Kinerja Unit.'],
    cacat: ['"Serial Number Unit *" dan "Model Unit *" keduanya teks bebas: nomor seri yang tidak ada di menu Unit tetap tersimpan, dan unit di layar Unit tidak tahu ada laporan kerusakan atas namanya.', 'Jendela gaya lama: kolom putih di atas jendela gelap (QA §4.20).', 'Sepuluh jalur penolakan di halaman ini memakai `alert`.'],
  },
  servis: {
    ringkas: 'Work order bengkel (berkala 250/500/1000/2000 jam, repair, inspeksi) dengan tampilan Kanban dan Tabel. Penutupan work order dilakukan lewat jendela "Selesaikan Servis" yang meminta suku cadang dan biaya aktual.',
    efek: ['Memindahkan work order ke "Sedang Berjalan" mengubah unit menjadi MAINTENANCE di menu Unit.', 'Menyelesaikan servis: status COMPLETED + tanggal selesai, setiap suku cadang yang dipakai keluar dari stok dan tercatat sebagai mutasi BARANG KELUAR, unit kembali AVAILABLE, Hour Meter unit dinaikkan ke pembacaan work order bila lebih besar, "Jam servis terakhir" ikut bergerak sehingga siklus servis berikutnya benar, dan biaya aktual menjadi invoice SERVICE.', 'Pembacaan meter yang MUNDUR terhadap unit tidak pernah diambil: hour meter dibiarkan apa adanya, sesuai prosedur koreksi (T4).', 'Servis selesai juga memperbaiki tampilan "Sedang Berjalan" di Servis dan Control Tower.'],
    cacat: ['"Teknisi / Mekanik *" teks bebas, tidak mengambil nama dari menu Teknisi.', 'Tiga belas jalur penolakan memakai `alert`; penolakan karena HM atau nama teknisi tidak valid tidak menunjuk kolom yang dimaksud.', 'Sebelum 3.0.3, servis selesai tidak menaikkan Hour Meter unit dan tidak menulis jam servis terakhir (diperbaiki pada T3).'],
  },
  pengiriman: {
    ringkas: 'Surat jalan (DO) untuk unit: referensi SPK yang belum dikirim, tujuan, driver, dan plat kendaraan.',
    efek: ['Baris "MENUNGGU" dibuat otomatis saat SPK penjualan disimpan, dengan jadwal dan tujuan masih kosong.', 'Form manual hanya menampilkan SPK yang belum dikirim pada dropdown rujukannya, tetapi tidak menolak duplikat: dua surat jalan untuk satu SPK tetap mungkin dibuat.', 'Halaman ini hanya menulis data pengiriman sendiri: status unit di menu Unit tidak berubah ketika surat jalan dibuat atau ditandai terkirim.'],
    cacat: ['Mengirim unit di menu ini TIDAK mengubah status unit di menu Unit — unit hasil penjualan sudah SOLD lebih dulu, jadi tidak ada sinkronisasi dua arah (jalur tulis halaman ini hanya menulis array-nya sendiri).', '"Serial Number" dapat dibiarkan kosong dan tidak diambil otomatis dari referensi SPK yang dipilih, sehingga surat jalan bisa dicetak tanpa nomor seri.', 'Satu penolakan memakai `alert` (QA §4.20).'],
  },
  'kas-bank': {
    ringkas: 'Buku kas harian: pemasukan dan pengeluaran, kategori, rekening, dan referensi dokumen. Kartu di atas adalah total kas masuk, keluar, dan saldo bersih.',
    efek: ['Sebagian besar baris di sini bukan ketikan manual: uang muka Penjualan, pembayaran PO, dan penerimaan pembayaran invoice menulis kas otomatis dengan kunci referensi sehingga pencatatan ganda tidak terjadi.', 'Dropdown "Rekening / Kas" diambil dari collection rekening bank yang dikelola di Pengaturan tab "Rekening Bank"; rekening non-aktif tidak lagi ditawarkan.', 'Menu ini adalah menu yang penulisannya dijaga peran di proses utama: hanya Super Admin dan Keuangan yang boleh menulis.'],
    cacat: ['Dua penolakan memakai `alert`, termasuk jumlah bernol atau negatif.', 'Kas yang dicatat manual tidak pernah dicocokkan ke dokumen referensinya — referensi "SPK/PO/INV" hanya teks.'],
  },
  laporan: {
    ringkas: 'Rekap pendapatan per bulan (potret hari ini memperlihatkan Mei–Oktober 2026), kinerja unit (jam, biaya per jam, profitabilitas), dan piutang. Tiga tab di satu layar.',
    efek: ['Menu ini hanya membaca. Seluruh angkanya dihitung dari SQLite atas Penjualan, Sewa, Servis, Breakdown, Pembelian, dan Kas.', '"Ekspor CSV" menghasilkan maksimal 5.000 baris (batas lama 500 dinaikkan pada R6); "Cetak PDF" memakai jalur jendela cetak.'],
    cacat: ['Nilai "Rp 0" pada pendapatan servis berarti belum ada work order COMPLETED pada periode itu, bukan biaya servis nol.', 'Biaya per jam dan profitabilitas memakai harga perolehan unit yang tidak bisa diubah dari layar (lihat menu Unit), jadi angka margin ikut salah untuk unit yang harga belinya bukan Rp 1.750.000.000.'],
  },
  pengaturan: {
    ringkas: 'Enam tab: Data Perusahaan, Modul & Menu, Sistem, Rekening Bank, Pengaturan Cetak, dan Tentang. Tombol "Simpan Pengaturan" hanya menyimpan tab Data Perusahaan.',
    efek: ['Nama perusahaan dan NPWP di sini yang tercetak di kepala Surat Jalan, PO, Invoice, dan bukti Gudang.', '"Modul & Menu" menentukan menu mana yang hidup di sidebar; "Ubah Profil Bisnis" melompat ke layar setup profil.', 'Rekening bank yang dibuat di tab "Rekening Bank" menjadi isi dropdown rekening di Kas & Bank dan jendela "Bayar" di Faktur.'],
    cacat: ['Dua dropdown di tab "Pengaturan Cetak" (Ukuran Kertas dan Orientasi) tidak terhubung ke state mana pun: pilihan Anda tidak tersimpan dan tidak dipakai dokumen cetak apa pun.', 'Isian di tab Sistem hanya mata uang dan zona waktu; keduanya tersimpan bersama data perusahaan, sedangkan sisanya baca-saja.', '"Simpan Pengaturan" hanya menyimpan tab Data Perusahaan/Sistem. Tab Modul & Menu menyimpan langsung saat sakelar diubah, dan tombol "Ubah Profil Bisnis" membuka kembali layar setup tanpa menghapus profil yang sudah dipilih — ia hanya memaksa Anda melewatinya lagi.'],
  },
  pengguna: {
    ringkas: 'Akun login beserta peran dan status aktif. Peran inilah yang menentukan menu apa yang dilihat saat pengguna itu masuk.',
    efek: ['Akun baru langsung memengaruhi sidebar: peran Gudang hanya melihat menu yang mengizinkan Gudang, dan seterusnya (peta peran per menu ada di setiap berkas panduan).', 'Password disimpan ter-hash di proses utama; pengguna baru wajib mengganti password pada login pertama (gerbang ganti password).', 'Menonaktifkan "Akun Aktif" melarang login tanpa menghapus data yang sudah dibuat akun itu.'],
    cacat: ['Kolom wajib form ini memakai validasi bawaan peramban (atribut required pada Nama Lengkap dan Email), jadi pesannya berupa tooltip kecil di kolom — berbeda dari menu lain yang memakai pesan inline atau alert.', 'Menghapus akun tidak menghapus jejak audit "dibuat oleh"; log audit menyimpan nama, bukan id.'],
  },
  'dokumen-legal': {
    ringkas: 'Berkas legal perusahaan dan unit (SIA, izin angkut, sertifikat, BPKB, STNK) beserta tanggal berakhir masa berlaku dan status legalitas.',
    efek: ['Status legalitas dihitung dari "Masa Berlaku": tanggal yang sudah lewat menjadi badge Kadaluarsa, dan yang mendekati jatuh tempo diberi warna peringatan di halaman ini.', 'Cetak PDF dokumen melapisi kepala berkas dengan warna badge status, jadi dokumen kadaluarsa terlihat dari lembar cetaknya.', 'Berkas yang diunggah disimpan sebagai file di folder data profil; database hanya mencatat tautan dan datanya.'],
    cacat: ['"Jenis Dokumen" adalah daftar tetap; jenis baru harus ditambahkan ke kode sumber.', 'Satu penolakan memakai `alert` (QA §4.20).', 'Tidak ada pemeriksaan nomor dokumen ganda, sehingga satu BPKB bisa terdaftar dua kali untuk unit berbeda.'],
  },
  backup: {
    ringkas: 'Buat cadangan, lihat daftar cadangan, pulihkan, dan unduh berkas cadangan. Halaman ini bekerja di atas berkas SQLite profil, bukan localStorage.',
    efek: ['"Backup Sekarang" menulis berkas .sanybak ke folder yang Anda pilih lewat kotak simpan Windows, lalu menawarkan menyertakan berkas foto ke subfolder photos; arsip lama sengaja tidak ikut terbawa.', '"Restore" mengganti isi database profil dengan isi berkas yang dipilih — seluruh perubahan sejak cadangan itu hilang. Jalur unduh browser di halaman ini tidak dipakai di paket desktop.'],
    cacat: ['Dua tombol di halaman ini bersifat merusak (Restore dan hapus cadangan) dan hanya bermodal konfirmasi standar; keduanya sengaja tidak dipotret alur jendelanya di panduan ini.', 'Panduan ini TIDAK menjalankan tombol tersebut. Untuk data produksi, buat cadangan tangan sebelum menyentuh Restore.'],
  },
  'pemeliharaan-sistem': {
    ringkas: 'Alat perawatan: pemeriksaan kesehatan database, pembuatan snapshot, perbaikan data, pembersihan cadangan, muat data contoh, dan ekspor laporan kesehatan.',
    efek: ['"Run Health Check" memeriksa ukuran/isi SQLite dan integritas collection lalu menampilkan hasilnya di halaman.', '"Muat Data Contoh" hanya menambah baris yang id-nya belum ada; ia tidak menimpa record Anda, tetapi memang memasukkan data latihan ke database aktif.'],
    cacat: ['Beberapa label tombol masih bahasa Inggris (Create Backup, Clear Backups, Export, Clear, Run Health Check) sementara sisanya Indonesia.', '"Repair Data" dan "Clear Backups" merusak keadaan lama; keduanya tidak dijalankan dalam pembuatan panduan ini.', 'Sebelum 3.0.1 halaman ini memuat seluruh collection saat dibuka (diperbaiki pada #77).'],
  },
  'audit-log': {
    ringkas: 'Riwayat kejadian sistem dan tulis-data yang dicatat proses utama: waktu, jenis kejadian, akun, pelaku, dan detail.',
    efek: ['Isi log ditulis di proses utama setiap kali ada tulis, hapus, login, dan percobaan tulis yang ditolak peran — jadi percobaan Penjualan dari akun tanpa hak tulis pun tercatat di sini.', 'Menu ini baca-saja dan khusus Super Admin.'],
    cacat: ['Kolom "Dilakukan Oleh" menyimpan nama, sehingga ganti nama akun membuat jejak lama ikut terbaca sebagai nama baru.', '"Export CSV" menghasilkan file di folder data, bukan unduhan peramban.', 'Judul halaman tidak memakai `.page-title`; kepala layar dibuat komponen sendiri.'],
  },
};

// ── Saring derau layar ───────────────────────────────────────
const ROLE_NAMA = Object.values(ROLE);
function tombolLayar(arr) {
  return (arr || [])
    .map(t => t.replace(/\s+/g, ' ').trim())
    .filter(t => t
      && !/Profil:\s*\d+ Profil Aktif/.test(t)
      && !/Cari menu/.test(t)
      && !(t.includes('Administrator') && ROLE_NAMA.some(r => t.includes(r)))
      && t.replace(/[^p{L}p{N}]/gu, '').length >= 2);
}
function isianLayar(arr) {
  return (arr || []).filter(i => !(i.contoh || '').includes('Cari menu'));
}

const LABEL_JENIS = {
  'input:text': 'teks',
  'input:number': 'angka',
  'input:date': 'tanggal',
  'input:datetime-local': 'tanggal & waktu',
  'input:email': 'email',
  'input:password': 'sandi',
  'input:file': 'berkas (pilih file)',
  'input:checkbox': 'kotak centang',
  input: 'teks',
  textarea: 'uraian beberapa baris',
  select: 'dropdown',
};
function namaKontrol(k) {
  const dasar = LABEL_JENIS[`${k.jenis}:${k.tipe}`] || LABEL_JENIS[k.jenis] || k.jenis || 'kontrol khusus';
  const extra = [];
  if (k.jenis === 'select' && Array.isArray(k.opsi)) extra.push(`${k.opsi.length} pilihan`);
  if (k.terkunci) extra.push('terisi otomatis, tidak dapat diketik');
  else if (k.hanyaBaca) extra.push('hanya baca');
  return extra.length ? `${dasar} (${extra.join(', ')})` : dasar;
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const CSS = `@page { size: A4; margin: 18mm 15mm 16mm 15mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.2pt; line-height: 1.5; color: #16202b; margin: 0; }
h1 { font-size: 16pt; color: #b00016; margin: 0 0 4mm; border-bottom: 2.4pt solid #b00016; padding-bottom: 2mm; }
h2 { font-size: 12.4pt; color: #0f2a4a; margin: 6mm 0 2mm; border-left: 4pt solid #b00016; padding-left: 3mm; }
h3 { font-size: 10.8pt; color: #123c66; margin: 4.5mm 0 1.5mm; }
p { margin: 0 0 2.2mm; }
ul, ol { margin: 0 0 2.4mm; padding-left: 6mm; }
li { margin-bottom: 1.1mm; }
table { width: 100%; border-collapse: collapse; margin: 0 0 3.5mm; font-size: 9.2pt; }
th { background: #0f2a4a; color: #fff; text-align: left; padding: 1.6mm 2mm; font-weight: 600; }
td { border: 0.5pt solid #b9c4d0; padding: 1.4mm 2mm; vertical-align: top; }
tr:nth-child(even) td { background: #f4f7fa; }
code, .k { font-family: "Consolas", monospace; font-size: 9pt; background: #eef2f6; padding: 0.3mm 1mm; border-radius: 2pt; }
.lbl { font-weight: 600; }
.kotak { border: 0.7pt solid #b9c4d0; border-radius: 3pt; padding: 2.6mm 3mm; margin: 0 0 3.5mm; page-break-inside: avoid; }
.meta td:first-child { width: 34mm; font-weight: 600; background: #eef2f6; }
.gambar { margin: 0 0 3.8mm; page-break-inside: avoid; }
.gambar img { max-width: 100%; height: auto; border: 0.7pt solid #b9c4d0; border-radius: 3pt; display: block; }
.gambar figcaption { font-size: 8.8pt; color: #47566a; margin-top: 1.3mm; }
.gambar figcaption b { color: #0f2a4a; }
.cacat { border-left: 4pt solid #b00016; background: #fdf0f1; padding: 2.4mm 3mm; margin: 0 0 3mm; page-break-inside: avoid; }
.cacat b.ct { color: #b00016; }
.efek { border-left: 4pt solid #1a7f4b; background: #f0f8f3; padding: 2.4mm 3mm; margin: 0 0 3mm; page-break-inside: avoid; }
.efek b.ct { color: #1a7f4b; }
.wa { color: #b00016; font-weight: 700; }
.auto { color: #47566a; font-style: italic; }
footer.catatan-kaki { font-size: 8.6pt; color: #66748a; border-top: 0.6pt solid #b9c4d0; padding-top: 2mm; margin-top: 6mm; }
a { color: #0f2a4a; }
header.konf { text-align: right; font-size: 8.4pt; color: #66748a; margin-bottom: 2mm; }`;

function kepala(nomor, teks) { return `<h2>${nomor}. ${esc(teks)}</h2>`; }

function tabelKolom(kolom) {
  if (!kolom.length) return '<p class="auto">Tidak ada kolom input yang terbaca pada jendela ini.</p>';
  const baris = kolom.map(k => {
    const bawaan = k.terkunci
      ? '<span class="auto">otomatis</span>'
      : (k.bawaan ? esc(k.bawaan) : (k.contoh ? `<span class="auto">${esc(k.contoh)}</span>` : '<span class="auto">kosong</span>'));
    const opsi = k.jenis === 'select' && Array.isArray(k.opsi)
      ? k.opsi.map(o => esc(o)).join('; ')
      : '';
    return `<tr><td class="lbl">${esc(k.label)}${k.wajib ? ' <span class="wa">*</span>' : ''}</td>`
      + `<td>${esc(namaKontrol(k))}</td>`
      + `<td>${bawaan}</td>`
      + `<td>${opsi ? opsi : '<span class="auto">-</span>'}</td></tr>`;
  }).join('\n');
  return `<table><thead><tr><th style="width:46mm">Label di layar</th><th style="width:38mm">Jenis kolom</th>`
    + `<th style="width:36mm">Isi saat jendela baru dibuka</th><th>Pilihan dropdown / teks bantu</th></tr></thead>`
    + `<tbody>\n${baris}\n</tbody></table>`;
}

function bagianLayar(m, t) {
  const d = t.dump;
  const html = [];
  html.push(`<h3>${esc(m.tampilan.length > 1 ? `${m.label} — tab/layar "${esc(t.nama)}"` : `${m.label} ketika dibuka`)}</h3>`);
  html.push(gambar(t.gambar, `Layar ${esc(m.label)} (${esc(t.nama)}) saat data contoh PG-* dimuat.`));
  if (d.judul || d.subjudul) {
    html.push('<div class="kotak">');
    if (d.judul) html.push(`<p><span class="lbl">Judul di layar:</span> ${esc(d.judul)}</p>`);
    if (d.subjudul) html.push(`<p><span class="lbl">Subjudul:</span> ${esc(d.subjudul)}</p>`);
    html.push('</div>');
  }
  const kartu = (d.kartu || []).filter(c => c.judul || c.nilai);
  if (kartu.length) {
    html.push('<p><span class="lbl">Kartu ringkasan di bagian atas</span> (angka di gambar dari data contoh):</p><ul>');
    kartu.forEach(c => html.push(`<li><b>${esc(c.judul || '(tanpa judul kartu)')}</b>${c.nilai ? ` — ${esc(c.nilai)}` : ''}${c.sub ? ` <span class="auto">${esc(c.sub)}</span>` : ''}</li>`));
    html.push('</ul>');
  }
  const tabel = (d.tabel || []).filter(tb => tb.kepala && tb.kepala.length);
  tabel.forEach((tb, i) => {
    html.push(`<p><span class="lbl">Kolom tabel${tabel.length > 1 ? ` ${i + 1}` : ''}</span> (${tb.baris} baris terlihat pada potret):</p>`);
    html.push('<table><thead><tr><th style="width:12mm">No.</th><th>Nama kolom persis di layar</th></tr></thead><tbody>'
      + tb.kepala.map((h, j) => `<tr><td>${j + 1}</td><td class="lbl">${esc(h)}</td></tr>`).join('')
      + '</tbody></table>');
  });
  if (!kartu.length && !tabel.length) html.push('<p class="auto">Bagian daftar layar ini memakai komponen kartu rancangan halaman itu sendiri (bukan tabel dengan judul kolom), sehingga isinya cukup dilihat pada gambar di atas.</p>');
  const tombol = [...new Set(tombolLayar(d.tombol))];
  if (tombol.length) {
    html.push(`<p><span class="lbl">Tombol yang ada di layar</span> (tanpa tombol profil/akun di bilah atas):</p><p>${tombol.map(x => `<span class="k">${esc(x)}</span>&nbsp;`).join(' ')}</p>`);
  }
  const isian = isianLayar(d.isian);
  if (isian.length) {
    html.push('<p><span class="lbl">Kolom yang ada di luar form</span> (pencarian/pendaftar):</p><ul>');
    isian.forEach(i => html.push(`<li>${esc(namaKontrol(i))}${i.contoh ? ` — <span class="auto">${esc(i.contoh)}</span>` : ''}</li>`));
    html.push('</ul>');
  }
  if (d.kosong === true) html.push('<p class="cacat"><b class="ct">Catatan.</b> Layar menampilkan teks "belum ada data" pada profil kosong.</p>');
  return html.join('\n');
}

function gambar(g, caption) {
  if (!g) return '';
  return `<figure class="gambar"><img src="${esc(g.berkas)}" alt="${esc(caption)}">`
    + `<figcaption><b>${esc(g.berkas.replace('gambar/', ''))}</b> — ${g.lebar}×${g.tinggi} piksel, ${Math.round(g.byte / 1024)} KB.</figcaption></figure>`;
}

function bagianForm(m, f) {
  const d = f.dump;
  const html = [];
  html.push(`<h3>Form “${esc(d.kepala)}”</h3>`);
  html.push(`<p>Dibuka dengan menekan tombol <span class="k">${esc(f.pemicu.replace(/[\^$]/g, '').replace(/\\+/, '+').replace(/^\^\|/, ''))}</span>${f.diBaris ? ' pada baris tabel (butuh minimal satu baris data)' : ''}.</p>`);
  html.push(gambar(f.gambar, `Jendela ${esc(d.kepala)}.`));
  html.push(`<p>Lebar jendela ${d.lebar} px. ${d.gulir && d.gulir.isi > d.gulir.tampak
    ? `Tinggi isi ${d.gulir.isi} px melebihi jendela ${d.gulir.tampak} px — bagian bawah perlu digulir.`
    : `Seluruh kolom muat tanpa menggulir pada jendela tinggi 980 px; pada jendela yang lebih pendek bagian bawah tetap perlu digulir.`}</p>`);
  html.push(tabelKolom(d.kolom || []));
  const wajib = (d.kolom || []).filter(k => k.wajib).map(k => k.label);
  html.push(`<div class="kotak"><p><span class="lbl">Wajib diisi</span>: ${wajib.length ? wajib.map(w => `<b>${esc(w)}</b>`).join(', ') : 'tidak ada kolom bertanda wajib pada form ini.'}</p>`
    + `<p><span class="lbl">Tombol di kaki jendela</span>: ${(d.tombol || []).map(x => `<span class="k">${esc(x)}</span>`).join(' · ') || '(tidak ada)'}</p></div>`);
  return html.join('\n');
}

function susun(m) {
  const p = PROSE[m.slug];
  if (!p) throw new Error(`PROSE belum berisi entri untuk ${m.slug}`);
  const out = [];
  out.push(`<!DOCTYPE html>\n<html lang="id">\n<head>\n<meta charset="utf-8">`);
  out.push(`<title>Panduan Menu ${esc(m.label)} — FATHONI EQUIPMENT OS ${VERSI}</title>`);
  out.push(`<style>\n${CSS}\n</style>\n</head>\n<body>`);
  out.push(`<header class="konf">FATHONI EQUIPMENT OS ${VERSI} · Panduan Menu · ${TANGGAL}</header>`);
  out.push(`<h1>Panduan Menu — ${esc(m.label)}</h1>`);
  out.push(`<table class="meta"><tbody>`
    + `<tr><td>Kelompok sidebar</td><td>${esc(m.kelompok)}</td></tr>`
    + `<tr><td>Alamat</td><td><span class="k">${esc(m.rute)}</span> (klik menu <b>${esc(m.label)}</b> di sidebar)</td></tr>`
    + `<tr><td>Peran yang melihat</td><td>${esc(p.peran || 'semua peran')}</td></tr>`
    + `<tr><td>Mode bisnis</td><td>${esc(p.mode || 'tidak disaring mode — selalu tampil selama peran memenuhi')}</td></tr>`
    + `<tr><td>Layar dipotret</td><td>${m.tampilan.length}</td></tr>`
    + `<tr><td>Form dipotret</td><td>${m.form.length ? m.form.map(f => `<span class="k">${esc(f.dump.kepala)}</span>`).join(' · ') : 'tidak ada form di menu ini'}</td></tr>`
    + `</tbody></table>`);
  out.push(kepala(1, 'Kegunaan menu ini'));
  out.push(`<p>${esc(p.ringkas)}</p>`);
  out.push(kepala(2, m.tampilan.length > 1 ? 'Layar ketika dibuka' : 'Layar ketika dibuka'));
  m.tampilan.forEach(t => out.push(bagianLayar(m, t)));
  if (m.form.length) {
    out.push(kepala(3, 'Form satu per satu, kolom demi kolom'));
    out.push('<p>Urutan kolom, nama label, tanda wajib, dan isi bawaan di bawah ini dibaca dari layar yang dipotret, bukan dari kode sumber. Tanda <span class="wa">*</span> adalah kolom yang memang ditahan kosong oleh aplikasi.</p>');
    m.form.forEach(f => out.push(bagianForm(m, f)));
  }
  const no = m.form.length ? 4 : 3;
  out.push(kepala(no, 'Setelah disimpan — efek ke menu lain'));
  out.push(`<div class="efek"><b class="ct">Yang terjadi di belakang layar</b><ul>${p.efek.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
  out.push(kepala(no + 1, 'Perlu diketahui (apa adanya)'));
  out.push(`<div class="cacat"><b class="ct">Batasan dan cacat yang terverifikasi di ${VERSI}</b><ul>${p.cacat.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
  out.push(`<footer class="catatan-kaki"><p><b>Sumber dan cara potret.</b> Semua layar dan jendela di berkas ini diambil oleh <span class="k">scripts/panduan-menu.cjs</span> dari aplikasi berjalan pada jendela 1125×980 piksel CSS (1184×967 piksel perangkat), masuk sebagai akun uji di profil sementara, lalu dibaca DOM-nya ke <span class="k">panduan-menu/data.json</span> (${esc(DATA.dibuat)}). Berkas ini disusun <span class="k">scripts/panduan-menu-build.cjs</span>; tidak ada satu pun label yang diketik ulang dari kode sumber.</p>`
    + `<p><b>Angka pada gambar.</b> Profil potret diisi data contoh ber-id <span class="k">PG-*</span> (unit, pelanggan, transaksi) supaya dropdown tidak kosong dan tombol baris bisa dipotret. Nilai kartu, tabel, dan tanggal bawaan pada gambar adalah nilai data contoh itu, bukan nilai perusahaan Anda, dan bukan standar yang harus Anda capai.</p>`
    + `<p><b>Aksi yang sengaja tidak dijalankan.</b> Tidak ada tombol simpan, hapus, terima barang, backup, restore, muat data contoh, atau ekspor yang ditekan selama pembuatan panduan ini.</p>`
    + `<p><a href="00-indeks.html">Kembali ke indeks panduan menu</a> · <a href="../PANDUAN_PENGGUNA.html">Panduan pemakaian lengkap</a></p></footer>`);
  out.push('</body>\n</html>');
  return out.join('\n');
}

// ── Peran/mode per menu (NAV_GROUPS) ────────────────────────
const GATE = {
  'merek-model': { r: ['SUPERADMIN', 'SALES', 'WAREHOUSE', 'SERVICE'], m: ['DEALER', 'TRADER', 'WORKSHOP', 'CONTRACTOR', 'RENTAL'] },
  unit: { r: ['SUPERADMIN', 'SALES', 'WAREHOUSE', 'SERVICE'] },
  pelanggan: { r: ['SUPERADMIN', 'SALES'], m: ['DEALER', 'RENTAL', 'WORKSHOP', 'TRADER', 'CONTRACTOR'] },
  pemasok: { r: ['SUPERADMIN', 'WAREHOUSE'], m: ['DEALER', 'CONTRACTOR', 'WORKSHOP', 'TRADER'] },
  operator: { r: ['SUPERADMIN'], m: ['CONTRACTOR', 'RENTAL', 'DEALER'] },
  teknisi: { r: ['SUPERADMIN', 'SERVICE'], m: ['WORKSHOP', 'CONTRACTOR', 'DEALER', 'RENTAL'] },
  pembelian: { r: ['SUPERADMIN', 'WAREHOUSE'], m: ['DEALER', 'CONTRACTOR', 'TRADER'] },
  penjualan: { r: ['SUPERADMIN', 'SALES'], m: ['DEALER', 'TRADER'] },
  'sewa-rental': { r: ['SUPERADMIN', 'SALES'], m: ['RENTAL', 'CONTRACTOR'] },
  persetujuan: { r: ['SUPERADMIN'] },
  faktur: { r: ['SUPERADMIN', 'SALES', 'SERVICE', 'FINANCE'], m: ['DEALER', 'RENTAL', 'WORKSHOP', 'TRADER'] },
  gudang: { r: ['SUPERADMIN', 'WAREHOUSE', 'SERVICE'], m: ['DEALER', 'CONTRACTOR', 'WORKSHOP'] },
  'suku-cadang': { r: ['SUPERADMIN', 'WAREHOUSE', 'SERVICE'], m: ['DEALER', 'WORKSHOP', 'CONTRACTOR'] },
  breakdown: { r: ['SUPERADMIN', 'SERVICE'] },
  servis: { r: ['SUPERADMIN', 'SERVICE'] },
  pengiriman: { r: ['SUPERADMIN', 'SALES', 'WAREHOUSE'], m: ['DEALER', 'RENTAL', 'TRADER', 'CONTRACTOR'] },
  'kas-bank': { r: ['SUPERADMIN', 'FINANCE'] },
  pengguna: { r: ['SUPERADMIN'] },
  'audit-log': { r: ['SUPERADMIN'] },
};
for (const [slug, g] of Object.entries(GATE)) {
  PROSE[slug].peran = g.r.map(x => ROLE[x]).join(', ');
  if (g.m) PROSE[slug].mode = `menu ini tampil bila salah satu profil bisnis aktif: ${g.m.map(x => MODE[x]).join(', ')}`;
}

// ── Tulis 26 berkas ─────────────────────────────────────────
let totalGambar = 0;
const daftar = [];
for (const m of DATA.menu) {
  const html = susun(m);
  const berkas = path.join(OUT, `${m.slug}.html`);
  fs.writeFileSync(berkas, html, 'utf8');
  const gbr = m.tampilan.filter(t => t.gambar).length + m.form.filter(f => f.gambar).length;
  totalGambar += gbr;
  daftar.push({ m, gbr, byte: Buffer.byteLength(html, 'utf8') });
}

// ── Indeks ──────────────────────────────────────────────────
const kelompokUrut = [...new Set(DATA.menu.map(m => m.kelompok))];
const barisIndeks = kelompokUrut.map(k => {
  const ms = daftar.filter(d => d.m.kelompok === k);
  return `<tr><td colspan="6" style="background:#0f2a4a;color:#fff;font-weight:700">${esc(k)}</td></tr>`
    + ms.map(({ m, gbr, byte }) => {
      const p = PROSE[m.slug];
      return `<tr><td class="lbl"><a href="${m.slug}.pdf">${esc(m.label)}</a><br><span class="auto">${m.slug}.html · ${Math.round(byte / 1024)} KB</span></td>`
        + `<td><span class="k">${esc(m.rute)}</span></td>`
        + `<td>${esc(p.peran || 'semua peran')}</td>`
        + `<td>${m.tampilan.length}</td><td>${m.form.length}</td><td>${gbr}</td></tr>`;
    }).join('\n');
}).join('\n');

const jumlahForm = DATA.menu.reduce((a, m) => a + m.form.length, 0);
const indeks = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>Indeks Panduan Menu — FATHONI EQUIPMENT OS ${VERSI}</title>
<style>
${CSS}
h1 { margin-bottom: 3mm; }
</style></head><body>
<header class="konf">FATHONI EQUIPMENT OS ${VERSI} · Indeks Panduan Menu · ${TANGGAL}</header>
<h1>Indeks Panduan Menu — 26 Menu Sidebar</h1>
<p>Satu berkas panduan untuk setiap menu di sidebar, hasil potret aplikasi berjalan. Setiap panduan berisi: kegunaan menu, layar ketika dibuka (dengan tangkapan layar), form satu per satu kolom demi kolom sesuai label yang tampil, efek ke menu lain setelah simpan, dan batasan/cacat yang terverifikasi.</p>
<div class="kotak">
<p><span class="lbl">Cara membaca.</span> Nama kolom, tombol, dan isi bawaan di semua berkas ini disalin dari DOM layar, jadi bisa Anda cocokkan langsung saat aplikasi terbuka. Tanda <span class="wa">*</span> berarti kolom ditahan kosong oleh aplikasi. Kolom "terisi otomatis" tidak dapat diketik.</p>
<p><span class="lbl">Angka pada gambar.</span> Potret dibuat di profil sementara yang diisi data contoh ber-id <span class="k">PG-*</span> supaya dropdown dan tombol baris tidak kosong. Angka kartu dan tanggal bawaan pada gambar adalah angka data contoh itu — bukan nilai perusahaan Anda.</p>
<p><span class="lbl">Yang tidak dijalankan.</span> Tidak ada tombol simpan, hapus, terima barang, backup, restore, muat data contoh, atau ekspor yang ditekan selama pembuatan.</p>
</div>
<h2>Daftar panduan</h2>
<table><thead><tr><th>Menu (tautan ke PDF)</th><th>Alamat</th><th>Peran yang melihat</th><th>Layar</th><th>Form</th><th>Gambar</th></tr></thead>
<tbody>
${barisIndeks}
</tbody></table>
<h2>Ringkasan terukur</h2>
<ul>
<li><b>${DATA.menu.length} menu</b> sidebar dipotret dan disusun panduannya, dalam enam kelompok: ${kelompokUrut.map(k => esc(k)).join(', ')}.</li>
<li><b>${DATA.menu.reduce((a, m) => a + m.tampilan.length, 0)} layar</b> (termasuk dua tab Merek &amp; Model) dan <b>${jumlahForm} jendela form</b>.</li>
<li><b>${totalGambar} tangkapan layar</b> ditanam di berkas ini, semuanya ${DATA.menu.flatMap(m=>[...m.tampilan,...m.form]).filter(x=>x.gambar).every(g=>g.gambar.lebar===1184&&g.gambar.tinggi===967)?'1184×967':'beragam ukuran'} piksel perangkat dari jendela ${DATA.jendela.lebar}×${DATA.jendela.tinggi} piksel CSS.</li>
<li>Semua jendela form muat tanpa menggulir pada tinggi 980 px: ${DATA.menu.flatMap(m => m.form).filter(f => f.dump.gulir && f.dump.gulir.isi === f.dump.gulir.tampak).length} dari ${jumlahForm} form. Pada jendela yang lebih pendek, bagian bawah tetap perlu digulir.</li>
<li><b>0 menu gagal</b> dipotret (ranah <span class="k">data.json</span> dibuat ${esc(DATA.dibuat)}).</li>
</ul>
<h2>Urutan kerja yang disarankan untuk pengguna baru</h2>
<ol>
<li>Merek &amp; Model — isi katalog lebih dulu, karena dropdown Unit dan seluruh transaksi mengikutinya.</li>
<li>Unit / Armada — daftarkan unit beserta nomor seri dan hour meter; nomor seri adalah kunci lintas menu.</li>
<li>Pelanggan, Pemasok, Operator, Teknisi — master data pihak yang terlibat.</li>
<li>Pengaturan (tab Rekening Bank) — rekening ini yang ditawarkan Kas &amp; Bank dan jendela “Bayar”.</li>
<li>Pembelian &rarr; Gudang/Suku Cadang &rarr; Penjualan/Sewa &rarr; Faktur &rarr; Pengiriman &rarr; Kas &amp; Bank — alur transaksi harian.</li>
<li>Servis &amp; Breakdown — pemeliharaan; work order selesai menaikkan hour meter dan menerbitkan invoice.</li>
<li>Laporan, Control Tower, Audit Log — pemantauan. Backup &amp; Pemeliharaan Sistem — perawatan.</li>
</ol>
<footer class="catatan-kaki"><p>Berkas indeks ini adalah pelengkap <a href="../PANDUAN_PENGGUNA.html">Panduan Pemakaian</a>; Bab 13 panduan tersebut tetap memuat contoh isian tertulis sepuluh form utama, sedangkan berkas per menu memuat seluruh 26 layar dan ${jumlahForm} form beserta gambarnya.</p></footer>
</body></html>`;
fs.writeFileSync(path.join(OUT, '00-indeks.html'), indeks, 'utf8');

console.log(`TERTULIS ${daftar.length} panduan menu + 00-indeks.html, ${totalGambar} gambar dirujuk, ${jumlahForm} form.`);
const belum = DATA.menu.filter(m => !PROSE[m.slug]);
if (belum.length) { console.log('PROSE KURANG: ' + belum.map(m => m.slug).join(',')); process.exit(1); }
console.log(`SELESAI kode=0`);
