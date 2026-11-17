// tests/harness/integrity-check.cjs
// Harness Fase 6: atomisitas tulis, rollback di tengah tulisan, dan penolakan
// hapus record yang masih disebut dokumen lain.
//
//   node_modules/electron/dist/electron.exe tests/harness/integrity-check.cjs
//
// Folder data dibuat sendiri di temp (fs.mkdtempSync) jadi profil pengguna
// sungguhan tidak pernah dibuka. Butuh `npm run build:electron` lebih dulu
// karena yang diuji adalah lapisan main process hasil kompilasi.
//
// Kenapa harness ini ada: dua hal tidak terjaga sebelumnya.
//  1) Satu autosave patch bisa membawa beberapa collection, dan dulu tiap
//     collection punya transaksi sendiri — kegagalan di collection kedua
//     meninggalkan collection pertama sudah tertulis.
//  2) Skema SQLite aplikasi ini sengaja tidak memakai FOREIGN KEY (kunci antar
//     menu adalah nomor bisnis, bukan baris), sehingga hapus unit yang masih
//     punya Work Order dulu lolos dan meninggalkan dokumen yang menunjuk ke
//     record yang sudah tidak ada. Aturan rujukan sekarang hidup di
//     electron/referential.ts dan diuji di sini.

const { app } = require('electron');
const selesai = require('./selesai.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fathoni-integrity-'));
app.setPath('userData', dir);
app.disableHardwareAcceleration();

const DB = require(path.join(__dirname, '../../dist-electron/db.js'));
const REF = require(path.join(__dirname, '../../dist-electron/referential.js'));
const SCHEMA = require(path.join(__dirname, '../../dist-electron/dbSchema.js'));

// ── pembantu ───────────────────────────────────────────────────
const unit = (id, serial, extra) => Object.assign({
  id, serialNumber: serial, brand: 'SANY', model: 'SY215C', status: 'AVAILABLE',
  hourMeter: 1250, purchasePrice: 1500000000, purchaseDate: '2026-01-15', category: 'Excavator',
}, extra || {});

const hitLabel = (laporan, collection) => (laporan.hits || []).find(h => h.collection === collection) || null;

function reset(profil) {
  DB.closeDatabase();
  fs.readdirSync(dir).forEach(n => { if (/^fathoni\.db/.test(n)) fs.rmSync(path.join(dir, n), { force: true }); });
  DB.openDatabase(dir);
  DB.saveStore(profil);
}

function main() {
  DB.openDatabase(dir);
  ok('database terbuka di folder temp', DB.databaseFile().startsWith(dir), DB.databaseFile());

  // ════ 1. ATOMISITAS TULIS ═══════════════════════════════════════════════
  // Baris "racun": payload yang tidak bisa dijadikan JSON. prepareRow memanggil
  // JSON.stringify DI DALAM transaksi (saveRows), jadi tulisannya sudah berjalan
  // ketika kegagalan terjadi — inilah ujian rollback yang sebenarnya.
  const racun = { id: 'K-RACUN', tanggal: '2026-02-01', jumlah: 10n };

  {
    const awal = DB.rowCount('units');
    let error = null;
    try {
      DB.saveRows('units', { upsert: [unit('U-A', 'SERIAL-A'), unit('U-B', 'SERIAL-B'), racun], removeIds: [] });
    } catch (e) { error = e; }
    ok('patch beracun benar-benar gagal', !!error, error && String(error.message));
    ok('rollback penuh: dua baris baik ikut batal', DB.rowCount('units') === awal, { akhir: DB.rowCount('units') });
    ok('baris pertama tidak tertinggal', DB.rowCount('units') === 0);
    ok('file tetap sehat setelah rollback', DB.integrity().ok === true, DB.integrity().quickCheck);
  }

  {
    // Rollback harus fakta di DISK, bukan hanya di koneksi yang belum di-flush.
    DB.closeDatabase();
    DB.openDatabase(dir);
    ok('setelah dibuka ulang tetap kosong', DB.rowCount('units') === 0, { jumlah: DB.rowCount('units') });
  }

  {
    // Transaksi terpisah = setengah tersimpan. Inilah bentuk lama kanal db-patch.
    let error = null;
    try {
      DB.saveRows('units', { upsert: [unit('U-C', 'SERIAL-C')], removeIds: [] });
      DB.saveRows('kas', { upsert: [racun], removeIds: [] });
    } catch (e) { error = e; }
    ok('tanpa pembungkus: tulisan kedua gagal', !!error);
    ok('tanpa pembungkus: tulisan pertama TERLANJUR tersimpan (alasan db-patch dibungkus)',
      DB.rowCount('units') === 1, { units: DB.rowCount('units') });
  }

  {
    // Bentuk yang dipakai kanal db-patch sekarang: satu transaksi untuk semua collection.
    DB.saveStore({ units: [], kas: [] });
    ok('profil dibersihkan untuk uji transact', DB.rowCount('units') === 0 && DB.rowCount('kas') === 0);
    let error = null;
    try {
      DB.transact(() => {
        DB.saveRows('units', { upsert: [unit('U-D', 'SERIAL-D'), unit('U-E', 'SERIAL-E')], removeIds: [] });
        DB.saveRows('kas', { upsert: [{ id: 'K-OK', tanggal: '2026-02-02', jumlah: 5 }, racun], removeIds: [] });
      });
    } catch (e) { error = e; }
    ok('transact: kesalahan diteruskan ke pemanggil', !!error);
    ok('transact: collection pertama ikut batal', DB.rowCount('units') === 0, { units: DB.rowCount('units') });
    ok('transact: collection kedua kosong', DB.rowCount('kas') === 0, { kas: DB.rowCount('kas') });
    ok('transact: file tetap sehat', DB.integrity().ok === true);
  }

  {
    // Jalur collection penuh: saveStore sudah satu transaksi, buktikan bersarang.
    DB.saveStore({ customers: [{ id: 'C-1', name: 'Mitra Teknik Prima' }], suppliers: [{ id: 'S-1', name: 'PT Suku Cadang Jaya' }] });
    const sebelum = DB.rowCount('customers');
    let error = null;
    try {
      DB.saveStore({
        customers: [{ id: 'C-2', name: 'Konstruksi Alam Lestari' }],
        suppliers: [{ id: 'S-2', name: 'Bengkel Maju Bersama', jumlah: 10n }],
      });
    } catch (e) { error = e; }
    ok('saveStore beracun: gagal', !!error);
    ok('saveStore beracun: collection pertama tidak tertulis', DB.rowCount('customers') === sebelum,
      { customers: DB.rowCount('customers') });
  }

  {
    // Setelah semua kegagalan itu, aplikasi harus tetap bisa menulis.
    const hasil = DB.saveRows('units', { upsert: [unit('U-OK', 'SERIAL-OK')], removeIds: [] });
    ok('tulis setelah rollback berhasil', hasil.inserted === 1 && DB.rowCount('units') === 1, hasil);
    const hapus = DB.saveRows('units', { upsert: [], removeIds: ['U-OK'] });
    ok('hapus setelah rollback berhasil', hapus.deleted === 1 && DB.rowCount('units') === 0, hapus);
    ok('transaksi sarang tidak meninggalkan savepoint terbuka', DB.integrity().ok === true);
  }

  // ════ 2. ATURAN RUJUKAN ═════════════════════════════════════════════════
  // Rujukan antar menu di aplikasi ini lewat KUNCI BISNIS. Profil di bawah
  // meniru bentuk hasil handoff Fase 3 (PO diterima -> gudang + kas, servis
  // selesai -> invoice sourceType SERVICE, penjualan DP -> kas).
  const profil = {
    units: [
      unit('U-1', 'SY215C-001'),
      unit('U-2', 'PC200-88'),      // serial sama persis dengan WO-2
      unit('U-3', 'LAIN-HATI'),     // tidak dirujuk siapa pun
      unit('U-4', ''),              // tanpa serial: tidak mungkin dirujuk
    ],
    customers: [{ id: 'C-1', name: 'Mitra Teknik Prima' }, { id: 'C-9', name: 'PT X' }],
    suppliers: [{ id: 'S-1', name: 'PT Suku Cadang Jaya' }],
    spareParts: [{ id: 'P-1', name: 'Filter Oli HYUNDAI', sku: 'FO-123', stock: 8, minStock: 2, price: 150000, unit: 'pcs' }],
    sales: [{ id: 'SO-1', orderNo: 'SO-2026-001', customerName: 'Mitra Teknik Prima', serialNumber: 'SY215C-001', status: 'CONFIRMED', orderDate: '2026-03-01', totalPrice: 1800000000, downPayment: 200000000 }],
    rentals: [{ id: 'RN-1', contractNo: 'RNT-2026-004', customerName: 'Mitra Teknik Prima', serialNumber: 'SY215C-001', status: 'ACTIVE', startDate: '2026-04-01', endDate: '2026-07-01', monthlyRate: 90000000 }],
    services: [
      { id: 'WO-1', woNumber: 'WO-2026-007', serialNumber: 'sy215c 001', unitModel: 'SY215C', mechanicName: 'Agus Sutrisno & Tim', status: 'OPEN', openDate: '2026-05-02' },
      { id: 'WO-2', woNumber: 'WO-2026-009', serialNumber: 'PC200-88', unitModel: 'PC200-8', status: 'COMPLETED', openDate: '2026-05-05' },
      // Nama satu kata di bawah ambang token: sengaja tidak bisa ditahan.
      { id: 'WO-3', woNumber: 'WO-2026-013', serialNumber: 'TIDAKADA-WO3', unitModel: 'X', mechanicName: 'Budi Setiawan', status: 'OPEN', openDate: '2026-05-08' },
    ],
    deliveries: [{ id: 'DO-1', doNumber: 'DO-2026-011', customerName: 'Mitra Teknik Prima', serialNumber: 'SY215C-001', driverName: 'Supomo', status: 'DELIVERED', deliveryDate: '2026-03-05', salesOrderRef: 'SO-2026-001' }],
    breakdowns: [{ id: 'BD-1', breakdownNumber: 'BD-2026-002', unitSerialNumber: 'SY215C-001', unitModel: 'SY215C', assignedTechnician: 'Agus Sutrisno', severity: 'HIGH', status: 'OPEN', reportedAt: '2026-05-06' }],
    warehouse: [
      { id: 'WH-1', trxNo: 'GR-PO-2026-003', type: 'INBOUND', warehouseName: 'Yard Cikande', itemDescription: '10 Filter Oli HYUNDAI (FO-123)', date: '2026-05-01', qty: 10 },
      { id: 'WH-2', trxNo: 'GI-WO-2026-007', type: 'OUTBOUND', warehouseName: 'Yard Cikande', itemDescription: '2 Filter Oli HYUNDAI (FO-123)', date: '2026-05-02', qty: 2 },
    ],
    purchases: [{ id: 'PO-1', poNumber: 'PO-2026-003', supplierName: 'PT Suku Cadang Jaya', category: 'SPAREPART', status: 'RECEIVED', orderDate: '2026-04-20', totalAmount: 1500000, itemName: '10 Filter Oli HYUNDAI (FO-123)' }],
    invoices: [
      { id: 'INV-1', invoiceNo: 'INV-2026-001', customerName: 'Mitra Teknik Prima', type: 'PENJUALAN', status: 'PAID', issueDate: '2026-03-02', dueDate: '2026-04-02', totalAmount: 1800000000, paidAmount: 200000000, sourceType: 'SALES', sourceNumber: 'SO-2026-001' },
      { id: 'INV-2', invoiceNo: 'INV-2026-002', customerName: 'Mitra Teknik Prima', type: 'SERVIS', status: 'UNPAID', issueDate: '2026-05-03', dueDate: '2026-06-03', totalAmount: 25000000, paidAmount: 0, sourceType: 'SERVICE', sourceNumber: 'WO-2026-007' },
      // Nomor yang sama, tipe lain: tidak boleh ikut menahan hapus WO-2026-007.
      { id: 'INV-3', invoiceNo: 'INV-2026-003', customerName: 'Lain', type: 'PENJUALAN', status: 'UNPAID', issueDate: '2026-05-04', dueDate: '2026-06-04', totalAmount: 1, paidAmount: 0, sourceType: 'SALES', sourceNumber: 'WO-2026-009' },
    ],
    kas: [
      { id: 'K-1', tanggal: '2026-03-02', kategori: 'PENJUALAN', tipe: 'MASUK', jumlah: 200000000, rekening: 'Kas Tunai', referensi: 'SO-2026-001' },
      { id: 'K-2', tanggal: '2026-03-10', kategori: 'PENJUALAN', tipe: 'MASUK', jumlah: 1600000000, rekening: 'BCA 123', referensi: 'INV-2026-001 · Bayar 1.600.000.000' },
      { id: 'K-3', tanggal: '2026-04-25', kategori: 'PEMBELIAN', tipe: 'KELUAR', jumlah: 1500000, rekening: 'Kas Tunai', referensi: 'PO-2026-003' },
    ],
    bankAccounts: [{ id: 'BA-1', namaBank: 'BCA', nomorRekening: '123', mataUang: 'IDR', isActive: 'AKTIF' }],
    operators: [
      { id: 'OP-1', operatorNumber: 'OP-001', name: 'Joko', status: 'ACTIVE', assignedUnit: 'SY215C-001', totalHours: 120 },
      { id: 'OP-2', operatorNumber: 'OP-002', name: 'Supomo', status: 'ACTIVE', assignedUnit: 'PC200-88', totalHours: 80 },
      { id: 'OP-3', operatorNumber: 'OP-003', name: 'Bagas Pratama', status: 'ACTIVE', totalHours: 10 },
    ],
    technicians: [
      { id: 'TECH-1', technicianNumber: 'TECH-001', name: 'Agus Sutrisno', status: 'ACTIVE', totalHours: 300 },
      { id: 'TECH-2', technicianNumber: 'TECH-002', name: 'Rizal Firmansyah', status: 'ACTIVE', totalHours: 40 },
      { id: 'TECH-3', technicianNumber: 'TECH-003', name: 'Budi', status: 'ACTIVE', totalHours: 5 },
    ],
    documents: [{ id: 'DOC-1', jenisDokumen: 'Faktur', nomorDokumen: 'F-1', statusLegalitas: 'LENGKAP', masaBerlaku: '2027-01-01' }],
    // Katalog: SANY/SY215C dipakai unit U-1..U-3, Kobelco hanya dipakai sebuah
    // model katalog (tidak ada unitnya), dan Volvo tidak dipakai apa pun.
    brands: [
      { id: 'BR-1', name: 'SANY', country: 'Tiongkok', category: 'Excavator' },
      { id: 'BR-2', name: 'Kobelco', country: 'Jepang', category: 'Crane' },
      { id: 'BR-3', name: 'Volvo', country: 'Swedia', category: 'Wheel Loader' },
    ],
    models: [
      { id: 'MD-1', brandName: 'SANY', modelCode: 'SY215C', category: 'Excavator 20 Ton' },
      { id: 'MD-2', brandName: 'Kobelco', modelCode: 'CKK900', category: 'Crawler Crane' },
    ],
  };
  DB.saveStore(profil);
  ok('profil rujukan tertanam', DB.rowCounts().totalRows > 20, DB.rowCounts().totalRows);

  // 2a. unit yang dirujuk WO dengan huruf kecil + spasi berbeda harus tetap tertahan
  {
    const r = DB.rowReferences('units', 'U-1');
    ok('unit dirujuk: ditolak', r.blocked === true, r);
    const harus = ['sales', 'rentals', 'services', 'deliveries', 'breakdowns'];
    for (const c of harus) ok(`unit SY215C-001 tertahan oleh ${c}`, !!hitLabel(r, c), r.hits);
    ok('contoh nomor dokumen ikut dibawa',
      (hitLabel(r, 'services') || {}).contoh?.includes('WO-2026-007') === true,
      hitLabel(r, 'services'));
  }
  {
    const r = DB.rowReferences('units', 'U-2');
    ok('penulisan serial yang sama persis tetap tertahan (U-2 / WO-2)',
      r.blocked === true && !!hitLabel(r, 'services'), r.hits);
  }
  {
    const r = DB.rowReferences('units', 'U-3');
    ok('unit tanpa rujukan boleh dihapus', r.blocked === false && r.hits.length === 0, r);
  }
  {
    const r = DB.rowReferences('units', 'U-4');
    ok('unit tanpa serial number tidak bisa dirujuk', r.blocked === false, r.hits);
  }

  // 2b. pelanggan, pemasok, suku cadang, rekening
  {
    const r = DB.rowReferences('customers', 'C-1');
    ok('pelanggan tertahan pesanan + invoice + surat jalan',
      ['sales', 'rentals', 'invoices', 'deliveries'].every(c => !!hitLabel(r, c)), r.hits);
    const lain = DB.rowReferences('customers', 'C-9');
    ok('pelanggan tanpa dokumen boleh dihapus', lain.blocked === false, lain.hits);
  }
  {
    const r = DB.rowReferences('suppliers', 'S-1');
    ok('pemasok tertahan PO', !!hitLabel(r, 'purchases') && hitLabel(r, 'purchases').contoh[0] === 'PO-2026-003', r.hits);
  }
  {
    const r = DB.rowReferences('spareParts', 'P-1');
    const gudang = hitLabel(r, 'warehouse');
    ok('suku cadang tertahan mutasi gudang (nama disebut di itemDescription)', !!gudang, r.hits);
    ok('contoh mutasi gudang ikut ditampilkan',
      !!gudang && gudang.contoh.includes('GR-PO-2026-003') && gudang.contoh.includes('GI-WO-2026-007'), gudang);
  }
  {
    const r = DB.rowReferences('bankAccounts', 'BA-1');
    ok('rekening bank tertahan mutasi kas', !!hitLabel(r, 'kas'), r.hits);
  }

  // 2c. dokumen sumber -> turunannya (nomor bisnis + prefix)
  {
    const r = DB.rowReferences('sales', 'SO-1');
    ok('penjualan tertahan surat jalan', !!hitLabel(r, 'deliveries'), r.hits);
    ok('penjualan tertahan invoice SALES', !!hitLabel(r, 'invoices'), r.hits);
    ok('penjualan tertahan kas DP', !!hitLabel(r, 'kas'), r.hits);
  }
  {
    const r = DB.rowReferences('services', 'WO-1');
    ok('work order tertahan invoice SERVICE', !!hitLabel(r, 'invoices'), r.hits);
    ok('work order tertahan mutasi GI-<nomor WO>',
      !!hitLabel(r, 'warehouse') && hitLabel(r, 'warehouse').contoh.includes('GI-WO-2026-007'), r.hits);
  }
  {
    // Ujian tanda kurung: invoice INV-3 memakai sourceNumber WO-2026-009 tapi
    // sourceType SALES. Penghapusan servis WO-2026-009 tidak boleh tertahan oleh
    // invoice itu — dan memang tidak ada yang menyebutnya sebagai servis.
    const r = DB.rowReferences('services', 'WO-2');
    ok('syarat sourceType hanya menghitung invoice servis (kurung OR/AND)',
      !hitLabel(r, 'invoices'), r.hits);
  }
  {
    const r = DB.rowReferences('purchases', 'PO-1');
    ok('PO tertahan mutasi GR-<poNumber>',
      !!hitLabel(r, 'warehouse') && hitLabel(r, 'warehouse').contoh.includes('GR-PO-2026-003'), r.hits);
    ok('PO tertahan kas pembayaran', !!hitLabel(r, 'kas'), r.hits);
  }
  {
    const r = DB.rowReferences('invoices', 'INV-1');
    const kas = hitLabel(r, 'kas');
    ok('invoice tertahan kas yang menyebut nomornya (prefix)', !!kas, r.hits);
    const bebas = DB.rowReferences('invoices', 'INV-2');
    ok('invoice tanpa pembayaran kas boleh dihapus', bebas.blocked === false, bebas.hits);
  }
  {
    const r = DB.rowReferences('rentals', 'RN-1');
    ok('kontrak rental tidak dirujuk invoice servis/sales', r.blocked === false, r.hits);
  }

  // 2d. orang: teknisi dan operator dirujuk dengan NAMA, dan namanya hanya bisa
  //     ditemukan di blob pencarian (mechanicName, assignedTechnician, driverName
  //     tidak dijadikan kolom turunan).
  {
    const r = DB.rowReferences('technicians', 'TECH-1');
    ok('teknisi tertahan work order yang menulis namanya dengan imbuhan',
      !!hitLabel(r, 'services') && hitLabel(r, 'services').contoh.includes('WO-2026-007'), r.hits);
    ok('teknisi tertahan laporan kerusakan yang menugaskannya',
      !!hitLabel(r, 'breakdowns') && hitLabel(r, 'breakdowns').contoh.includes('BD-2026-002'), r.hits);
    const bebas = DB.rowReferences('technicians', 'TECH-2');
    ok('teknisi tanpa dokumen boleh dihapus', bebas.blocked === false && !bebas.error, bebas);
  }
  {
    const r = DB.rowReferences('operators', 'OP-2');
    ok('operator tertahan surat jalan yang menyebut namanya sebagai driver',
      r.blocked === true && !!hitLabel(r, 'deliveries') && hitLabel(r, 'deliveries').contoh.includes('DO-2026-011'), r.hits);
    const lain = DB.rowReferences('operators', 'OP-3');
    ok('operator tanpa surat jalan boleh dihapus', lain.blocked === false && !lain.error, lain.hits);
  }
  {
    // Batas yang diketahui dan sengaja: kunci sepanjang < PANJANG_TOKEN_MIN (6)
    // terlalu mudah terselip di kolom lain, jadi nama satu kata tidak bisa
    // ditahan. Ini karakterisasi, bukan harapan — kalau ambangnya berubah,
    // di sinilah itu pertama kali terlihat.
    const teknisi = DB.rowReferences('technicians', 'TECH-3');
    ok('nama satu kata ("Budi") diketahui tidak tertahan, tanpa error',
      teknisi.blocked === false && !teknisi.error, teknisi);
    const operator = DB.rowReferences('operators', 'OP-1');
    ok('nama satu kata ("Joko") diketahui tidak tertahan, tanpa error',
      operator.blocked === false && !operator.error, operator);
  }

  // 2d-katalog. Merek & Model dirujuk dengan NAMA MEREK dan KODE MODEL, sama
  // seperti cara unit mencatatnya. Menghapus entri yang masih dipakai membuat
  // layar Unit menampilkan merek yang tidak ada di katalog lagi — dan koreksi
  // namanya tidak bisa dilakukan dari daftar unit.
  {
    const r = DB.rowReferences('brands', 'BR-1');
    ok('merek tertahan model katalog yang dibuat di bawahnya',
      r.blocked === true && !!hitLabel(r, 'models') && hitLabel(r, 'models').contoh.includes('SY215C'), r.hits);
    ok('merek tertahan unit yang mencatat mereknya',
      !!hitLabel(r, 'units') && hitLabel(r, 'units').contoh.includes('SY215C-001'), r.hits);
    const cumaModel = DB.rowReferences('brands', 'BR-2');
    ok('merek tanpa unit tapi berpindah model tetap tertahan',
      cumaModel.blocked === true && !!hitLabel(cumaModel, 'models') && !hitLabel(cumaModel, 'units'), cumaModel.hits);
    const bebas = DB.rowReferences('brands', 'BR-3');
    ok('merek yang belum dipakai apa pun boleh dihapus', bebas.blocked === false && !bebas.error, bebas);

    const kode = DB.rowReferences('models', 'MD-1');
    ok('kode model tertahan unit yang memakainya',
      kode.blocked === true && !!hitLabel(kode, 'units') && hitLabel(kode, 'units').contoh.includes('SY215C-001'), kode.hits);
    const kodeBebas = DB.rowReferences('models', 'MD-2');
    ok('kode model yang belum menjadi unit boleh dihapus (mereknya sendiri yang tertahan)',
      kodeBebas.blocked === false && !kodeBebas.error, kodeBebas);
  }

  // 2e. daun tanpa aturan: hapusnya tidak pernah meninggalkan rujukan
  for (const [collection, id] of [['documents', 'DOC-1'], ['deliveries', 'DO-1'], ['warehouse', 'WH-1'], ['breakdowns', 'BD-1']]) {
    const r = DB.rowReferences(collection, id);
    ok(`${collection} tidak menahan apa pun (record daun)`, r.blocked === false && (r.hits || []).length === 0, r);
  }

  // 2f. bentuk masukan yang tidak boleh membuat pemeriksaan mati
  {
    const asing = DB.rowReferences('tidakAda', 'X');
    ok('collection asing dilaporkan sebagai error, bukan dilewati', !!asing.error && asing.blocked === false, asing);
    const kosong = DB.rowReferences('units', '');
    ok('id kosong dilaporkan sebagai error', !!kosong.error, kosong);
    const hilang = DB.rowReferences('units', 'U-TIDAK-ADA');
    ok('record yang tidak ada tidak diblokir', hilang.blocked === false && !hilang.error, hilang);
    const nullId = DB.rowReferences('units', null);
    ok('id null dilaporkan sebagai error', !!nullId.error, nullId);
  }

  // 2g. daftar aturan harus tetap sesuai skema: satu nama kolom yang salah tulis
  //     akan menjadi query atas kolom yang tidak ada, dan itu membuat hapus
  //     berhenti dengan error, bukan menolak dengan alasan yang benar.
  {
    const kolomTabel = (collection) => {
      const spec = SCHEMA.SPEC_BY_NAME[collection];
      const out = new Set(['id', 'search', 'pk', 'payload', 'hash']);
      (spec ? spec.columns : []).forEach(c => out.add(c.col));
      return out;
    };
    const blobTabel = (collection) => new Set((SCHEMA.SPEC_BY_NAME[collection] || {}).search || []);
    const salah = [];
    for (const [nama, aturan] of Object.entries(REF.REFERENCE_RULES)) {
      if (!SCHEMA.isCollectionName(nama)) { salah.push(`${nama} bukan collection`); continue; }
      for (const r of aturan) {
        if (!SCHEMA.isCollectionName(r.child)) { salah.push(`${nama} -> ${r.child} bukan collection`); continue; }
        const punya = kolomTabel(r.child);
        for (const k of [r.column, r.show, r.where && r.where.column].filter(Boolean)) {
          if (!punya.has(k)) salah.push(`${nama} -> ${r.child}.${k} bukan kolom turunan`);
        }
        // Aturan blob: field-nya harus ikut ditulis ke "search" anak, dan tidak
        // boleh bersamaan dengan column (yang mana yang dicari jadi tidak jelas).
        if (r.blobField && !blobTabel(r.child).has(r.blobField)) {
          salah.push(`${nama} -> ${r.child}.${r.blobField} tidak ditulis ke blob pencarian`);
        }
        if (r.blobField && r.column) salah.push(`${nama} -> ${r.child}: column dan blobField bersama`);
        if (!r.blobField && !r.column) salah.push(`${nama} -> ${r.child}: tidak punya kunci`);
        const induk = kolomTabel(nama);
        for (const k of [r.parentField].concat(r.parentFields || []).filter(Boolean)) {
          // Kunci rujukan diambil dari payload record induk. Kalau namanya bukan
          // kolom turunan yang dikenal, field itu pasti selalu kosong dan aturan
          // tersebut diam-diam tidak pernah menahan apa pun.
          if (!induk.has(k)) salah.push(`${nama}: kunci ${k} bukan kolom turunan collection itu`);
        }
      }
    }
    ok('semua aturan rujukan menyebut collection dan kolom yang benar-benar ada', salah.length === 0, salah);
  }

  // ════ 3. DELETE YANG DITOLAK TIDAK MENGUBAH APA PUN ═════════════════════
  // Penjaga penolakan hidup di removeRow (renderer); yang dijamin di sini adalah
  // pemeriksaan itu sendiri tidak menulis apa pun ke file. Sengaja dijalankan
  // SEBELUM bagian 4: bagian itu menimpa services dengan data besar.
  {
    const sebelumKas = DB.rowCount('kas');
    const sebelumServis = DB.rowCount('services');
    const r = DB.rowReferences('services', 'WO-1');
    ok('WO-1 masih dirujuk (invoice servis + mutasi GI)', r.blocked === true, r.hits);
    ok('pemeriksaan bersifat baca-saja',
      DB.rowCount('kas') === sebelumKas && DB.rowCount('services') === sebelumServis,
      { kas: DB.rowCount('kas'), services: DB.rowCount('services') });
  }

  // ════ 4. BIAYA PEMERIKSAAN PADA DATA BESAR ══════════════════════════════
  // Pemeriksaan ini berjalan di jalan hapus yang ditunggu pengguna. Blob pencarian
  // tidak berindeks untuk LIKE, jadi yang diukur adalah scans terburuk: record
  // yang TIDAK dirujuk siapa pun (semua aturan jatuh ke fallback blob).
  {
    const N = 12000;
    const gudang = [];
    const servis = [];
    for (let i = 0; i < N; i++) {
      gudang.push({ id: 'WH' + i, trxNo: 'GI-' + i, type: 'OUTBOUND', warehouseName: 'Yard', itemDescription: 'Part ' + i, date: '2026-06-01', qty: 1 });
      servis.push({ id: 'WO' + i, woNumber: 'WO-BESAR-' + i, serialNumber: 'TIDAKKADA-' + i, unitModel: 'X', status: 'OPEN', openDate: '2026-06-01' });
    }
    DB.saveStore({ warehouse: gudang, services: servis });
    DB.saveRows('units', { upsert: [unit('U-PERF', 'SY215C-PERF-9')] });

    const mulai = Date.now();
    const r = DB.rowReferences('units', 'U-PERF');
    const ms = Date.now() - mulai;
    ok(`pemeriksaan rujukan pada ${N * 2} baris anak selesai < 250ms`, r.blocked === false && ms < 250, { ms });
    console.log(`INFO biaya pemeriksaan: ${ms}ms untuk ${N * 2} baris anak`);
  }

  // ════ 5. ID GANDA WARISAN ═══════════════════════════════════════════════
  // Dua baris dengan id yang sama disimpan sebagai pk 'id' dan 'id#2'. Pemeriksaan
  // harus melihat KEDUANYA — kalau hanya baris pertama yang dibaca, unit yang
  // sebenarnya masih punya Work Order bisa terhapus.
  {
    reset({
      units: [unit('U-DUP', 'SERIAL-DUP-A'), unit('U-DUP', 'SERIAL-DUP-B')],
      services: [{ id: 'WO-DUP', woNumber: 'WO-DUP-1', serialNumber: 'SERIAL-DUP-B', unitModel: 'X', status: 'OPEN', openDate: '2026-07-01' }],
    });
    ok('id ganda tersimpan sebagai dua baris', DB.rowCount('units') === 2, DB.rowCount('units'));
    const r = DB.rowReferences('units', 'U-DUP');
    ok('rujukan pada baris kedua ikut menahan hapus', r.blocked === true && !!hitLabel(r, 'services'), r.hits);
    const bebas = DB.rowReferences('units', 'U-TIDAK-DI-DUPLIKAT');
    ok('record yang tidak ada tetap bebas', bebas.blocked === false, bebas);
  }

  DB.closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n=== integritas: ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

app.whenReady().then(main).catch(err => {
  console.log('HARNESS ERROR', err && err.stack);
  selesai(app, 2);
});
