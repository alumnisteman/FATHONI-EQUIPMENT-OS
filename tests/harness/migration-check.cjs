// tests/harness/migration-check.cjs
// Verifikasi Fase 3: pembuangan data contoh, impor kunci warisan, backfill invoice,
// marker migrasi, dan agregasi pendapatan bulanan.
//
// Jalankan: node tests/harness/migration-check.cjs
// Harness ini murni Node (tanpa Electron) dan memakai localStorage tiruan di memory,
// jadi tidak pernah menyentuh profil pengguna sungguhan.

const path = require('path');
const fs = require('fs');
const os = require('os');
const esbuild = require('esbuild');

// ── localStorage tiruan ────────────────────────────────────────
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
}
const storage = new MemoryStorage();
globalThis.localStorage = storage;

// ── Bundel modul TS ke CJS ─────────────────────────────────────
const outfile = path.join(os.tmpdir(), `hems-migration-entry-${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'migration.entry.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile,
  logLevel: 'error',
});
const M = require(outfile);

// ── Kerangka pemeriksaan ───────────────────────────────────────
let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS  ' + name);
  } else {
    failed += 1;
    console.log('FAIL  ' + name + (detail === undefined ? '' : '  -> ' + JSON.stringify(detail)));
  }
}
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── 1. Data contoh vs data pengguna ────────────────────────────
const sampleUnit = clone(M.SAMPLE_COLLECTIONS.units[0]);
const editedUnit = { ...clone(sampleUnit), hourMeter: 987654 };
const realUnit = { id: 'U-REAL', serialNumber: 'FATHONI-REAL-001', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE', hourMeter: 12 };

{
  const { store, report } = M.migrateStore({
    units: [sampleUnit, editedUnit, realUnit],
    sales: [], rentals: [], services: [], invoices: [],
  });
  check('1.1 record contoh yang tak tersentuh dibuang', store.units.length === 2, store.units.map(u => u.id));
  check('1.2 record contoh yang sudah disunting dipertahankan', store.units.some(u => u.id === editedUnit.id && u.hourMeter === 987654));
  check('1.3 data asli pengguna tidak pernah dibuang', store.units.some(u => u.id === 'U-REAL'));
  check('1.4 report mencatat jumlah contoh yang dibuang', report.removedSamples.units === 1, report.removedSamples);
}

// Sidik jari mengabaikan timestamp: record contoh dengan updatedAt berbeda tetap dibuang.
{
  const { store } = M.migrateStore({
    units: [{ ...clone(sampleUnit), updatedAt: '2020-01-01T00:00:00.000Z', createdAt: '2019-01-01' }],
  });
  check('1.5 perbedaan timestamp bukan suntingan pengguna', store.units.length === 0, store.units);
}

// ── 2. Impor kunci warisan HEMS_* ──────────────────────────────
storage.setItem('HEMS_PURCHASES', JSON.stringify([
  { id: 'p1', poNumber: 'PO-2026-001', supplierName: 'PT United Tractors', itemName: '20 Filter Oli', totalAmount: 5_700_000, status: 'ORDERED' },
  { id: 'p2', poNumber: 'PO-2026-002', supplierName: 'PT Kioton', itemName: '1 Undercarriage Set', totalAmount: 185_000_000, status: 'RECEIVED' },
  { id: 'p3', poNumber: '  ', supplierName: 'Tanpa Nomor', itemName: 'X', totalAmount: 1, status: 'DRAFT' },
  'bukan-object',
  null,
]));
storage.setItem('HEMS_SUPPLIERS', JSON.stringify([
  { id: 's1', name: 'PT United Tractors', category: 'SPAREPART' },
  { id: 's2', name: 'pt united tractors ', category: 'UNIT' },
]));
storage.setItem('HEMS_WAREHOUSE', JSON.stringify([
  { id: 'w1', trxNo: 'GR-2026-001', type: 'INBOUND', itemDescription: '20 Filter Oli' },
]));

{
  const { store, report } = M.migrateStore({ purchases: [], suppliers: [], warehouse: [] });
  check('2.1 PO warisan masuk ke collection purchases', store.purchases.length === 3, store.purchases.length);
  // legacyRowsSeen = baris yang terbaca sebagai object (3 + 2 + 1); string/null diabaikan parser.
  check('2.2 baris cacat (bukan object) dilewati', report.legacyRowsSeen === 6, report.legacyRowsSeen);
  check('2.3 pemasok duplikat natural-key tidak ganda', store.suppliers.length === 1, store.suppliers.map(s => s.name));
  check('2.4 mutasi gudang warisan masuk', store.warehouse.length === 1 && store.warehouse[0].trxNo === 'GR-2026-001');
  check('2.5 report imported menghitung per collection', report.imported.purchases === 3 && report.imported.suppliers === 1, report.imported);
}

// Baris warisan tidak boleh menimpa record yang sudah ada di store aktif.
{
  const existing = { id: 'own-1', poNumber: 'PO-2026-001', supplierName: 'PT United Tractors', itemName: 'EDI BY USER', status: 'RECEIVED' };
  const { store } = M.migrateStore({ purchases: [existing] });
  const po = store.purchases.filter(p => String(p.poNumber).trim().toLowerCase() === 'po-2026-001');
  check('2.6 data aktif dimenangkan atas warisan', po.length === 1 && po[0].id === 'own-1' && po[0].itemName === 'EDI BY USER', po);
  check('2.7 kunci warisan asli tidak dihapus dari profil', storage.getItem('HEMS_PURCHASES') !== null);
}

// ── 3. Backfill invoice ────────────────────────────────────────
// Data contoh (DEMO_*) sengaja bukan bahan uji backfill: step 1 membuangnya
// lebih dulu, jadi hanya transaksi nyata yang boleh menagih.
{
  const untouchedDemo = {
    sales: clone(M.DEMO_SALES), rentals: clone(M.DEMO_RENTALS), services: clone(M.DEMO_SERVICES), invoices: [],
  };
  const demoRun = M.migrateStore(untouchedDemo);
  check('3.0 data contoh tidak meninggalkan invoice fiktif',
    demoRun.store.invoices.length === 0 && demoRun.report.backfilledInvoices === 0,
    demoRun.report);
}

const sales = [
  { id: 'RS-1', orderNo: 'SO-2026-701', customerName: 'PT Riset Nyata Satu', unitModel: 'SANY SY215C', serialNumber: 'SY-701',
    orderDate: '2026-08-11', totalPrice: 1_750_000_000, downPayment: 500_000_000, paymentScheme: 'LEASING', status: 'CONFIRMED', salesPerson: 'Budi' },
  { id: 'RS-2', orderNo: 'SO-2026-702', customerName: 'PT Riset Nyata Dua', unitModel: 'Komatsu PC200-8', serialNumber: 'KMT-702',
    orderDate: '2026-09-03', totalPrice: 1_850_000_000, downPayment: 1_850_000_000, paymentScheme: 'CASH', status: 'COMPLETED', salesPerson: 'Sari' },
];
const rentals = [
  { id: 'RR-1', contractNo: 'RNT-2026-701', customerName: 'PT Riset Nyata Satu', unitModel: 'Komatsu PC200-8', serialNumber: 'KMT-702',
    startDate: '2026-09-01', endDate: '2027-02-28', location: 'Morowali', monthlyRate: 95_000_000, minimumHours: 200, operatorIncluded: false, status: 'ACTIVE' },
];
const services = [
  { id: 'RW-1', woNumber: 'WO-2026-701', unitModel: 'Komatsu PC200-8', serialNumber: 'KMT-702', customerOrProject: 'PT Riset Nyata Satu',
    serviceType: 'PERIODIC_500H', mechanicName: 'Agus', hourMeter: 4850, openDate: '2026-09-14', completedDate: '2026-09-16', estimatedCost: 8_500_000, status: 'COMPLETED', complaintNotes: 'Ganti oli' },
  { id: 'RW-2', woNumber: 'WO-2026-702', unitModel: 'SANY SY215C', serialNumber: 'SY-701', customerOrProject: 'Yard Cikande',
    serviceType: 'BREAKDOWN', mechanicName: 'Hendra', hourMeter: 120, openDate: '2026-10-01', estimatedCost: 28_000_000, status: 'IN_PROGRESS', complaintNotes: 'Hose pecah' },
];

{
  const { store, report } = M.migrateStore({ sales, rentals, services, invoices: [] });

  const saleInv = store.invoices.find(i => i.sourceNumber === sales[0].orderNo);
  check('3.1 setiap penjualan mendapat invoice', store.invoices.filter(i => i.sourceType === 'SALES').length === sales.length,
    store.invoices.map(i => i.invoiceNo));
  check('3.2 nomor invoice penjualan memakai pola INV/SALE/<orderNo>', saleInv && saleInv.invoiceNo === 'INV/SALE/' + sales[0].orderNo, saleInv && saleInv.invoiceNo);
  check('3.3 DP tercatat sebagai pembayaran, status menyesuaikan',
    !!saleInv && saleInv.paidAmount === sales[0].downPayment && saleInv.status === 'PARTIAL',
    saleInv && { paid: saleInv.paidAmount, status: saleInv.status });

  const cashSale = store.invoices.find(i => i.sourceNumber === sales[1].orderNo);
  check('3.4 penjualan tunai DP=penuh berlabel PAID, bukan UNPAID', cashSale && cashSale.status === 'PAID', cashSale && cashSale.status);

  check('3.5 rental mendapat invoice tipe RENTAL', store.invoices.filter(i => i.type === 'RENTAL').length === rentals.length);
  const completedWo = services.filter(s => s.status === 'COMPLETED');
  check('3.6 hanya servis COMPLETED ditagihkan', store.invoices.filter(i => i.sourceType === 'SERVICE').length === completedWo.length,
    { expected: completedWo.length, got: store.invoices.filter(i => i.sourceType === 'SERVICE').length });
  check('3.7 invoice servis memakai harga aktual/estimasi, bukan nol',
    store.invoices.some(i => i.sourceType === 'SERVICE' && i.totalAmount === completedWo[0].estimatedCost));

  check('3.8 report backfilledInvoices cocok jumlah invoice baru', report.backfilledInvoices === store.invoices.length,
    { report: report.backfilledInvoices, invoices: store.invoices.length });

  // Idempoten: menjalankan migrasi di atas hasilnya sendiri tidak menambah invoice.
  const second = M.migrateStore(clone(store));
  check('3.9 migrasi kedua tidak menduplikasi invoice', second.report.backfilledInvoices === 0 && second.store.invoices.length === store.invoices.length,
    second.report.backfilledInvoices);

  // Invoice lama tanpa sourceType tetap dikenali dari nomor invoice.
  const legacyInvoice = { id: 'x', invoiceNo: 'INV/' + rentals[0].contractNo, type: 'RENTAL', totalAmount: 1, paidAmount: 0, status: 'UNPAID' };
  const third = M.migrateStore({ sales, rentals, services, invoices: [legacyInvoice, ...clone(store.invoices)] });
  check('3.10 invoice lama tanpa sourceType dikenali (tidak dobel)',
    third.report.backfilledInvoices === 0 && third.store.invoices.length === store.invoices.length + 1,
    { backfilled: third.report.backfilledInvoices, total: third.store.invoices.length });
}

// ── 4. Marker migrasi ──────────────────────────────────────────
{
  storage.removeItem(M.MIGRATION_MARKER_KEY);
  check('4.1 belum ada marker => readMigrationMarker null', M.readMigrationMarker() === null);
  const empty = { at: new Date().toISOString(), removedSamples: {}, imported: {}, backfilledInvoices: 0, legacyRowsSeen: 0 };
  M.writeMigrationMarker(empty);
  const readBack = M.readMigrationMarker();
  check('4.2 marker dibaca kembali utuh', readBack && readBack.at === empty.at);
  check('4.3 marker rusak dianggap belum migrasi', (() => {
    storage.setItem(M.MIGRATION_MARKER_KEY, '{bukan json');
    return M.readMigrationMarker() === null;
  })());
  M.writeMigrationMarker(empty);
  check('4.4 laporan kosong tidak layak ditampilkan', M.hasMigrationWork(M.readMigrationMarker()) === false);
  M.writeMigrationMarker({ ...empty, backfilledInvoices: 3 });
  check('4.5 laporan berisi pekerjaan terdeteksi', M.hasMigrationWork(M.readMigrationMarker()) === true);
  check('4.6 marker null tidak melempar error', M.hasMigrationWork(null) === false);
}

// ── 5. Kunci arsip beku ────────────────────────────────────────
{
  check('5.1 HEMS_DATA_BACKUPS dikecualikan dari backup', M.isLegacyArchiveKey('HEMS_DATA_BACKUPS') === true);
  check('5.2 HEMS_HEALTH_LOGS dikecualikan dari backup', M.isLegacyArchiveKey('HEMS_HEALTH_LOGS') === true);
  check('5.3 kunci sumber warisan dikecualikan', M.isLegacyArchiveKey('HEMS_PURCHASES') === true);
  check('5.4 database aktif tidak dikecualikan', M.isLegacyArchiveKey('hems_data_store_v1') === false);
  check('5.5 kunci pengaturan tidak dikecualikan', M.isLegacyArchiveKey('hems_settings') === false);
}

// ── 6. Agregasi pendapatan bulanan ─────────────────────────────
{
  const months = M.lastMonthKeys(6, new Date('2026-10-09T00:00:00Z'));
  check('6.1 enam bulan, urut dari tertua', months.length === 6 && months[0].key === '2026-05' && months[5].key === '2026-10',
    months.map(m => m.key));
  check('6.2 label bulan berbahasa Indonesia', months[5].label === 'Okt 26', months[5].label);
  check('6.3 melintas tahun dihitung benar', M.lastMonthKeys(3, new Date('2026-01-15T00:00:00Z')).map(m => m.key).join(',') === '2025-11,2025-12,2026-01');

  const invoices = [
    { type: 'PENJUALAN', issueDate: '2026-10-02', totalAmount: 100 },
    { type: 'RENTAL', issueDate: '2026-10-20', totalAmount: 200 },
    { type: 'SERVICE', issueDate: '2026-09-01', totalAmount: 50 },
    { type: 'RENTAL', issueDate: '', totalAmount: 999 },
    { type: 'RENTAL', totalAmount: 999 },
    { type: 'SPAREPART', issueDate: '2026-10-05', totalAmount: 77 },
  ];
  const rows = M.revenueByMonth(invoices, M.lastMonthKeys(3, new Date('2026-10-09T00:00:00Z')));
  check('6.4 kelompok bulan memisahkan tipe pendapatan',
    rows[2].penjualan === 100 && rows[2].rental === 200 && rows[2].total === 300, rows[2]);
  check('6.5 bulan tanpa transaksi tetap muncul dengan nilai nol',
    rows.length === 3 && rows[0].key === '2026-08' && rows[0].total === 0, rows.map(r => [r.key, r.total]));
  check('6.6 invoice tanpa tanggal diabaikan', rows.every(r => r.total !== 999 && r.rental !== 999), rows.map(r => r.rental));
  check('6.7 tipe di luar tiga sumber pendapatan tidak ikut terhitung', rows[2].service === 0);
  check('6.8 servis ditagihkan ke bulan issueDate-nya sendiri', rows[1].key === '2026-09' && rows[1].service === 50 && rows[1].total === 50, rows[1]);
  check('6.9 labelForMonthKey menahan input buruk',
    M.labelForMonthKey('bukan-bulan') === 'bukan-bulan' && M.labelForMonthKey('2026-13') === '2026-13' && M.labelForMonthKey('26-01') === '26-01',
    M.labelForMonthKey('bukan-bulan'));
}

// ── 7. Store kosong ────────────────────────────────────────────
storage.removeItem('HEMS_PURCHASES');
storage.removeItem('HEMS_SUPPLIERS');
storage.removeItem('HEMS_WAREHOUSE');
{
  const { store, report } = M.migrateStore({});
  check('7.1 profil baru tidak melempar error', Array.isArray(store.invoices) && store.invoices.length === 0);
  check('7.2 profil baru menghasilkan laporan kosong', M.hasMigrationWork(report) === false, report);
  check('7.3 collection wajib selalu ada', ['invoices', 'sales', 'rentals', 'services'].every(k => Array.isArray(store[k])));
}

// ── 8. buildSampleStore hanya dipakai atas permintaan ──────────
{
  const samples = M.buildSampleStore();
  check('8.1 paket contoh berisi unit & pelanggan', samples.units.length > 0 && samples.customers.length > 0);
  check('8.2 paket contoh memulai invoice kosong (dibuat lewat transaksi)', Array.isArray(samples.invoices) && samples.invoices.length === 0);
  check('8.3 paket contoh tidak berisi pemasok/PO/gudang fiktif',
    samples.suppliers.length === 0 && samples.purchases.length === 0 && samples.warehouse.length === 0);
}

fs.rmSync(outfile, { force: true });

console.log('');
console.log(`migration-check: ${passed} lulus, ${failed} gagal`);
process.exit(failed === 0 ? 0 : 1);
