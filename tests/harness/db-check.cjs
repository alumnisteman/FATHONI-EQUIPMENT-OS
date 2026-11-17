// tests/harness/db-check.cjs
// Harness Fase 4 untuk lapisan SQLite: skema, tulis/baca, write-behind ber-diff,
// paginasi, kesamaan semantik pencarian SQL vs renderer, integritas, dan kapasitas.
//
// Jalankan: node_modules/electron/dist/electron.exe tests/harness/db-check.cjs
// Harness ini membuat folder datanya sendiri di temp dan tidak pernah menyentuh
// profil pengguna sungguhan.

const { app } = require('electron');
const selesai = require('./selesai.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const esbuild = require('esbuild');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hems-db-'));
app.setPath('userData', dir);
app.disableHardwareAcceleration();

const DB = require(path.join(__dirname, '../../dist-electron/db.js'));
const SCHEMA = require(path.join(__dirname, '../../dist-electron/dbSchema.js'));

const bundleOut = path.join(dir, 'search.entry.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'search.entry.ts')],
  bundle: true, format: 'cjs', platform: 'node', target: 'node18',
  outfile: bundleOut, logLevel: 'error',
});
const S = require(bundleOut);

// Sisi RENDERER dari penyaringan/pengelompokan ikut dibundle, supaya bagian 13
// bisa membandingkan hasil SQLite dengan hitungan JavaScript pada baris yang
// sama — bukan hanya membandingkan dua tulisan fungsi.
const totalsOut = path.join(dir, 'totals.entry.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'totals.entry.ts')],
  bundle: true, format: 'cjs', platform: 'node', target: 'node18',
  outfile: totalsOut, logLevel: 'error',
});
const T = require(totalsOut);

const unit = (i, brand, model, serial) => ({
  id: 'U' + i, serialNumber: serial, brand, model, status: 'AVAILABLE',
  hourMeter: i * 3, purchasePrice: 1e9 + i, purchaseDate: '2026-0' + ((i % 8) + 1) + '-15',
  notes: 'unit uji ' + i,
});

function main() {
  // ── 1. Skema ────────────────────────────────────────────────
  const opened = DB.openDatabase(dir);
  ok('1.1 file database dibuat di folder data', opened.createdNow && fs.existsSync(opened.file), opened);
  const st = DB.stats();
  ok('1.2 semua 20 collection punya tabel',
    st.perCollection.length === DB.collectionNames().length && st.perCollection.length === 20, st.perCollection.length);
  ok('1.3 WAL aktif (wajib untuk baca-tulis tanpa mengunci)', st.journalMode === 'wal', st.journalMode);
  ok('1.4 versi skema tercatat', st.schemaVersion === 1, st.schemaVersion);
  ok('1.5 database baru masih kosong', st.totalRows === 0, st.totalRows);

  // ── 2. Tulis-baca utuh ──────────────────────────────────────
  const store = {
    units: [unit(1, 'SANY', 'SY215C', 'SKIDB001'), unit(2, 'KOMATSU', 'PC200-8', 'SKIDB002'), unit(3, 'SANY', 'SY365C', 'SKIDB003')],
    customers: [{ id: 'C1', name: 'PT Uji Satu', phone: '0811', address: 'Cikande' }],
    invoices: [{ id: 'I1', invoiceNo: 'INV/DB/1', customerName: 'PT Uji Satu', type: 'PENJUALAN', status: 'UNPAID', issueDate: '2026-09-01', totalAmount: 5e6, paidAmount: 0 }],
    kas: [{ id: 'K1', tanggal: '2026-09-02', keterangan: 'Uji', kategori: 'PENJUALAN', tipe: 'MASUK', jumlah: 5e6, rekening: 'BCA Uji - 1', referensi: 'INV/DB/1' }],
  };
  const wrote = DB.saveStore(store);
  ok('2.1 store tersimpan per collection', wrote.units.inserted === 3 && wrote.invoices.inserted === 1, wrote);
  const back = DB.loadStore();
  ok('2.2 muat-balik identik (tidak ada field yang hilang)',
    JSON.stringify(back.units[0]) === JSON.stringify(store.units[0]), back.units[0]);
  ok('2.3 collection tanpa data tetap array kosong, bukan undefined',
    Array.isArray(back.rentals) && back.rentals.length === 0, back.rentals);

  // ── 3. Write-behind hanya mengubah yang berubah ─────────────
  const again = DB.saveCollection('units', store.units);
  ok('3.1 simpan ulang tanpa perubahan tidak menulis apa pun',
    again.inserted === 0 && again.updated === 0 && again.deleted === 0, again);
  const changed = store.units.map((u, i) => (i === 0 ? { ...u, status: 'MAINTENANCE' } : u));
  const delta = DB.saveCollection('units', changed);
  ok('3.2 hanya baris yang berubah yang di-update', delta.updated === 1 && delta.inserted === 0, delta);
  const removed = DB.saveCollection('units', changed.slice(0, 2));
  ok('3.3 baris yang hilang ikut terhapus', removed.deleted === 1 && DB.rowCount('units') === 2, removed);

  // id rangkap di sumber tidak boleh membuat baris hilang
  const dup = [unit(7, 'SANY', 'SY215C', 'SKIDB007'), unit(7, 'SANY', 'SY215C', 'SKIDB007')];
  DB.saveCollection('breakdowns', [{ id: 'BD1', breakdownNumber: 'BD-1' }, { id: 'BD1', breakdownNumber: 'BD-2' }]);
  ok('3.4 dua baris ber-id sama keduanya tersimpan (tidak ada data hilang)', DB.rowCount('breakdowns') === 2, DB.rowCount('breakdowns'));
  const dupUnits = DB.saveCollection('units', dup);
  ok('3.5 simpan dengan id rangkap tidak gagal dan keduanya tersimpan',
    dupUnits.inserted === 2 && DB.rowCount('units') === 2, { dupUnits, count: DB.rowCount('units') });

  // ── 4. Query berpaginasi ────────────────────────────────────
  const many = [];
  for (let i = 0; i < 500; i++) many.push(unit(100 + i, i % 2 ? 'SANY' : 'TADANO', i % 2 ? 'SY215C' : 'AD10', 'MANY' + i));
  DB.saveCollection('units', many);
  const page = DB.queryCollection({ collection: 'units', limit: 50, offset: 0 });
  ok('4.1 halaman pertama berisi 50 baris dari total 500', page.rows.length === 50 && page.total === 500, { rows: page.rows.length, total: page.total });
  const page2 = DB.queryCollection({ collection: 'units', limit: 50, offset: 50 });
  ok('4.2 offset tidak menghasilkan baris ganda',
    page2.rows[0].serialNumber !== page.rows[0].serialNumber, { a: page.rows[0], b: page2.rows[0] });
  const filtered = DB.queryCollection({ collection: 'units', where: { brand: 'SANY' } });
  ok('4.3 filter kolom turunan bekerja', filtered.total === 250, filtered.total);
  const badSort = DB.queryCollection({ collection: 'units', sort: 'payload; DROP TABLE units', limit: 5 });
  ok('4.4 nama sort di luar daftar kolom diabaikan (tidak jadi SQL injection)',
    badSort.rows.length === 5 && DB.rowCount('units') === 500, badSort.rows.length);
  const bigLimit = DB.queryCollection({ collection: 'units', limit: 100000 });
  ok('4.5 batas halaman ditegakkan di sisi main process', bigLimit.rows.length <= DB.MAX_PAGE_LIMIT, bigLimit.rows.length);
  let rejected = false;
  let rejectedWrite = false;
  try { DB.queryCollection({ collection: 'tidakada' }); } catch { rejected = true; }
  try { DB.saveCollection('sqlite_master', []); } catch { rejectedWrite = true; }
  ok('4.6 collection tak dikenal ditolak, bukan dipakai apa adanya', rejected && rejectedWrite, { rejected, rejectedWrite });

  // ── 5. Pencarian SQL == pencarian renderer ──────────────────
  const fieldsFor = (row, collection) => S.SPEC_BY_NAME[collection].search.map(f => row[f]);
  const corpus = [
    'SANY SY215C', 'sany sy215', 'SY215C', 'SKIDB', 'TADANO', 'PC200-8', 'sany  sy215c',
    'SY21', 'unit uji 105', 'tidakada', 'COMATSU',
  ];
  const all = DB.queryCollection({ collection: 'units', limit: DB.MAX_PAGE_LIMIT, sort: 'serialNumber' });
  const stored = DB.loadCollection('units');
  let samaSemua = true, contohBeda = null;
  for (const q of corpus) {
    const sqlSet = DB.queryCollection({ collection: 'units', search: q, limit: DB.MAX_PAGE_LIMIT }).rows
      .map(r => r.serialNumber).sort().join('|');
    const jsSet = stored.filter(r => S.matchesQuery(fieldsFor(r, 'units'), q)).map(r => r.serialNumber).sort().join('|');
    if (sqlSet !== jsSet) { samaSemua = false; contohBeda = { q, sql: sqlSet.slice(0, 120), js: jsSet.slice(0, 120) }; }
  }
  ok('5.1 hasil pencarian SQL identik dengan matchesQuery untuk 11 kueri uji', samaSemua, contohBeda);
  const ketemu = DB.queryCollection({ collection: 'units', search: 'SANY SY215C', limit: 10 });
  ok('5.2 pencarian dua kata "SANY SY215C" menemukan unit', ketemu.total > 0 && ketemu.rows.every(r => r.brand === 'SANY'), { total: ketemu.total });
  ok('5.3 blob pencarian digabung per kolom, bukan seadanya',
    S.searchBlob({ brand: 'SANY', model: 'SY215C' }, ['brand', 'model']) === 'sany sy215c', S.searchBlob({ brand: 'SANY', model: 'SY215C' }, ['brand', 'model']));

  // ── 6. Integritas ───────────────────────────────────────────
  DB.saveCollection('units', dup);
  const integ = DB.integrity();
  ok('6.1 quick_check menyatakan file sehat', integ.ok === true, integ.quickCheck);
  ok('6.2 nomor seri ganda terdeteksi dan dilaporkan',
    integ.duplicates.some(d => d.collection === 'units' && d.column === 'serialNumber'), integ.duplicates.slice(0, 3));
  ok('6.3 nama collection asing ditolak layer DB',
    SCHEMA.isCollectionName('units') === true && SCHEMA.isCollectionName('sqlite_master') === false);

  // ── 7. Kapasitas dan kecepatan (pertanyaan "sampai berapa baris?") ──
  const t0 = Date.now();
  const bulk = [];
  for (let i = 0; i < 50000; i++) bulk.push(unit(5000 + i, i % 4 ? 'SANY' : 'HITACHI', 'SY' + (200 + (i % 40)), 'CAP' + i));
  DB.saveCollection('units', bulk);
  const tWrite = Date.now() - t0;

  const t1 = Date.now();
  const car = DB.queryCollection({ collection: 'units', search: 'SANY SY215', limit: 50 });
  const tSearchDingin = Date.now() - t1;

  // Pencarian diulang lima kali dan yang dinilai adalah MEDIAN-nya, setelah
  // passage pertama menghangatkan cache. Dua alasan:
  // 1. Yang dijamin di sini adalah jalur tanya itu sendiri (SQL + serialisasi),
  //    bukan keadaan cache Windows. Baca pertama atas 26,8 MB halaman database
  //    bisa 4x lebih lambat hanya karena RAM mesin sedang dipakai aplikasi lain.
  // 2. Ambang 1 detik pernah diukur 572 ms dan 1408 ms untuk KODE YANG SAMA pada
  //    dua menit yang berbeda di mesin 3,8 GB ini — gerbang yang duduk persis di
  //    batas variabilitas mesin akan menuduh regresi secara acak, dan rantai yang
  //    kadang merah tidak dipakai sebagai bukti rilis.
  // Regresi sejati (mis. filter per-baris di JavaScript) bertahan di median lima
  // passage, jadi penyaring ini tidak dilonggarkan sampai buta.
  const hangat = [];
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    DB.queryCollection({ collection: 'units', search: 'SANY SY215', limit: 50 });
    hangat.push(Date.now() - t);
  }
  hangat.sort((a, b) => a - b);
  const tSearch = hangat[2];

  const t2 = Date.now();
  const ubah = bulk.map((u, i) => (i % 5000 === 0 ? { ...u, status: 'MAINTENANCE' } : u));
  const hasilDiff = DB.saveCollection('units', ubah);
  const tDiff = Date.now() - t2;

  const t3 = Date.now();
  const sum = DB.sumCollection('units', 'purchasePrice', { brand: 'SANY' });
  const tSum = Date.now() - t3;

  const size = DB.stats().sizeBytes;
  console.log(`CATATAN kapasitas 50.000 unit: simpan=${tWrite}ms, pencarian=${tSearch}ms `
    + `(dingin ${tSearchDingin}ms, hangat ${hangat.join('/')} ms, ${car.total} cocok), `
    + `ubah-10-baris=${tDiff}ms, agregat=${tSum}ms, file=${(size / 1048576).toFixed(1)} MB, `
    + `RAM bebas saat diukur=${(os.freemem() / 1048576).toFixed(0)} MB dari ${(os.totalmem() / 1048576).toFixed(0)} MB`);
  ok('7.1 50.000 baris tersimpan di bawah 10 detik', tWrite < 10000, tWrite);
  ok('7.2 pencarian di atas 50.000 baris di bawah 1 detik (median 5x cache hangat)',
    tSearch < 1000, { median: tSearch, dingin: tSearchDingin, hangat, bebasMB: Math.round(os.freemem() / 1048576) });
  ok('7.3 simpan ulang 50.000 baris dengan sedikit perubahan hanya menulis baris yang berubah',
    hasilDiff.inserted === 0 && hasilDiff.updated === 10 && hasilDiff.deleted === 0,
    { hasilDiff, tWrite, tDiff });
  ok('7.4 agregasi jumlah dilakukan di SQLite dan hasilnya benar', sum > 0 && Number.isFinite(sum), sum);

  // ── 8. Buka ulang: data tetap ada, pernyataan lama dibuang ──
  DB.closeDatabase();
  DB.openDatabase(dir);
  const after = DB.loadCollection('units');
  ok('8.1 data bertahan setelah database ditutup dan dibuka lagi',
    after.length === 50000 && after.some(r => r.serialNumber === 'CAP12345'), after.length);
  ok('8.2 meta bertahan', DB.getMeta('schema_version') === '1', DB.getMeta('schema_version'));

  // ── 9. Patch per baris (jalur tulis halaman berpaginasi) ────
  const pelangganSebelum = DB.rowCount('customers');
  const tambah = DB.saveRows('customers', { upsert: [{ id: 'C9', name: 'PT Patch Baru', phone: '0812' }] });
  ok('9.1 patch hanya menyisipkan baris yang disebut',
    tambah.inserted === 1 && tambah.updated === 0 && tambah.deleted === 0
      && DB.rowCount('customers') === pelangganSebelum + 1, { tambah, pelangganSebelum });

  const ulangi = DB.saveRows('customers', { upsert: [{ id: 'C9', name: 'PT Patch Baru', phone: '0812' }] });
  ok('9.2 patch baris yang tidak berubah tidak menulis apa pun',
    ulangi.inserted === 0 && ulangi.updated === 0 && ulangi.skipped === 1, ulangi);

  const ubahDanHapus = DB.saveRows('customers', {
    upsert: [{ id: 'C9', name: 'PT Patch Baru', phone: '0812', segment: 'KONTRAKTOR' }],
    removeIds: ['C1', 'TIADAK'],
  });
  const pelanggan = DB.loadCollection('customers');
  ok('9.3 patch mengubah baris yang ditarget dan menghapus hanya kunci yang disebut',
    ubahDanHapus.updated === 1 && ubahDanHapus.deleted === 1
      && !pelanggan.some(c => c.id === 'C1') && pelanggan.some(c => c.segment === 'KONTRAKTOR'),
    { ubahDanHapus, pelanggan: pelanggan.map(c => c.id) });

  ok('9.4 patch satu collection tidak menyentuh collection lain',
    DB.rowCount('units') === 50000, DB.rowCount('units'));

  let patchDitolak = false;
  try { DB.saveRows('sqlite_master', { upsert: [] }); } catch { patchDitolak = true; }
  ok('9.5 nama collection asing ditolak jalur patch', patchDitolak);

  const tanpaId = DB.saveRows('customers', { upsert: [{ name: 'tanpa id' }] });
  ok('9.6 baris tanpa id tidak ditulis diam-diam',
    tanpaId.skipped === 1 && tanpaId.inserted === 0 && DB.rowCount('customers') === pelanggan.length, tanpaId);

  // ── 10. Kolom turunan dan blob pencarian mengikuti field record ──
  DB.saveRows('units', {
    upsert: [{
      id: 'U-YEAR', serialNumber: 'YEAR-1', brand: 'SANY', model: 'SY215C', year: 2021,
      status: 'AVAILABLE', purchaseDate: '2026-01-01',
    }],
  });
  const cariTahun = DB.queryCollection({ collection: 'units', search: 'SY215C 2021', limit: 10 });
  ok('10.1 tahun produksi ikut dicari (halaman Unit mencari field ini)',
    cariTahun.rows.some(r => r.id === 'U-YEAR'), cariTahun.rows.map(r => r.serialNumber));

  DB.saveCollection('warehouse', [
    { id: 'W1', trxNo: 'GR-PO-WH-1', type: 'INBOUND', warehouseName: 'Gudang Uji', itemDescription: 'Filter oli', qty: 3, unit: 'Pcs', referenceDoc: 'PO-WH-1', date: '2026-01-05', pic: 'Rudi' },
    { id: 'W2', trxNo: 'GI-WO-WH-2', type: 'OUTBOUND', warehouseName: 'Yard Cikande', itemDescription: 'SANY SY215C', qty: 1, unit: 'Unit', referenceDoc: 'WO-WH-2', date: '2026-03-09', pic: 'Danu' },
  ]);
  const cariReferensi = DB.queryCollection({ collection: 'warehouse', search: 'PO-WH-1' });
  ok('10.2 blob pencarian gudang memakai referenceDoc, bukan referensi yang tak ada',
    cariReferensi.total === 1 && cariReferensi.rows[0].id === 'W1', cariReferensi);

  const terbaru = DB.queryCollection({ collection: 'warehouse', sort: 'tanggal', desc: true, limit: 2 });
  ok('10.3 kolom tanggal gudang diisi dari field date sehingga urutan terbaru benar',
    terbaru.rows[0] && terbaru.rows[0].id === 'W2', terbaru.rows.map(r => r.id));

  const masuk = DB.queryCollection({ collection: 'warehouse', where: { type: 'INBOUND' } });
  ok('10.4 filter tipe lewat kolom turunan menyaring di sisi SQL',
    masuk.total === 1 && masuk.rows[0].id === 'W1', masuk.total);

  // Kolom turunan tidak ikut ditulis ulang oleh saveCollection bila payload-nya
  // sama, jadi revisi dbSchema harus dipaksa terhitung ulang saat dibuka lagi.
  DB.setMeta('derived_revision', '1');
  DB.closeDatabase();
  const Database = require('better-sqlite3');
  const raw = new Database(path.join(dir, 'fathoni.db'));
  raw.prepare(`UPDATE units SET "search" = 'sengaja dibuat basi' WHERE id = 'U-YEAR'`).run();
  raw.prepare(`UPDATE warehouse SET "tanggal" = '' WHERE id = 'W2'`).run();
  raw.close();
  DB.openDatabase(dir);
  ok('10.5 pembukaan dengan revisi turunan baru menghitung ulang kolom dan blob dari payload',
    DB.queryCollection({ collection: 'units', search: 'SY215C 2021' }).rows.some(r => r.id === 'U-YEAR')
      && DB.queryCollection({ collection: 'warehouse', sort: 'tanggal', desc: true, limit: 1 }).rows[0].id === 'W2',
    { units: DB.queryCollection({ collection: 'units', search: 'U-YEAR' }).total });
  const revisi = DB.getMeta('derived_revision');
  ok('10.6 revisi turunan tersimpan sebagai angka', revisi !== null && Number(revisi) > 1, revisi);

  // Boot berikutnya tidak boleh menuliskan ulang seluruh tabel: kolom basi
  // dibiarkan apa adanya selama revisinya sama, dan itu yang membuktikan
  // perhitungan ulang hanya sekali per revisi.
  const rawBasi = new Database(path.join(dir, 'fathoni.db'));
  rawBasi.prepare(`UPDATE units SET "search" = 'sengaja dibuat basi kedua' WHERE id = 'U-YEAR'`).run();
  rawBasi.close();
  DB.closeDatabase();
  DB.openDatabase(dir);
  ok('10.7 pembukaan biasa tidak menghitung ulang turunan',
    DB.queryCollection({ collection: 'units', search: 'SY215C 2021' }).rows.length === 0
      && DB.queryCollection({ collection: 'units', search: 'YEAR-1' }).rows.length === 0,
    DB.queryCollection({ collection: 'units', search: 'YEAR-1' }).total);

  // ── 11. Profil lama naik kelas: kolom baru dari dbSchema dibuat ulang ──
  // CREATE TABLE IF NOT EXISTS tidak memperbaiki tabel yang sudah berdiri.
  // Tanpa ALTER TABLE, profil pengguna yang sudah ada gagal menyimpan suku
  // cadang begitu halaman memakai kolom kategori/rak.
  DB.saveCollection('spareParts', [
    {
      id: 'P-1', name: 'Filter oli', sku: '1R-0716', stock: 4, minStock: 2, price: 150000, unit: 'Pcs',
      category: 'FILTER', compatibleBrands: 'SANY SY215C', rackLocation: 'RACKUJIA1',
    },
  ]);
  const rakAwal = DB.queryCollection({ collection: 'spareParts', where: { rackLocation: 'RACKUJIA1' } });
  ok('11.1 kolom lokasi rak dapat disaring di sisi SQL', rakAwal.total === 1, rakAwal.total);

  const rawLama = new Database(path.join(dir, 'fathoni.db'));
  rawLama.exec('DROP INDEX IF EXISTS "ix_spareParts_rackLocation"');
  rawLama.exec('ALTER TABLE "spareParts" DROP COLUMN "rackLocation"');
  rawLama.close();
  DB.closeDatabase();
  DB.openDatabase(dir);

  const rakBaru = DB.queryCollection({ collection: 'spareParts', where: { rackLocation: 'RACKUJIA1' } });
  ok('11.2 kolom yang belum ada ditambahkan saat database dibuka', rakBaru.total === 1, rakBaru);
  const cariRak = DB.queryCollection({ collection: 'spareParts', search: 'RACKUJIA1' });
  ok('11.3 blob pencarian barisan kolom baru langsung terisi dari payload',
    cariRak.total === 1, cariRak.total);

  const tambahan = DB.saveRows('spareParts', {
    upsert: [{
      id: 'P-2', name: 'Filter solar', sku: '6736-51-5142', stock: 1, price: 200000, unit: 'Pcs',
      category: 'FILTER', rackLocation: 'RACKUJIB2',
    }],
  });
  ok('11.4 penulisan baris baru pada tabel hasil migrasi berhasil',
    tambahan.inserted === 1 && DB.queryCollection({ collection: 'spareParts', where: { rackLocation: 'RACKUJIB2' } }).total === 1,
    tambahan);

  // ── 12. Nilai asing tidak bisa menjadi SQL (keamanan jalur baca/tulis) ──
  // Halaman berpaginasi mengirim `where`, `sort`, `column` dan `search` dari
  // state React. Satu bug kecil di satu menu tidak boleh bisa menjatuhkan
  // query atau — lebih buruk — mengubah bentuk statement SQL.
  const totalUnit = DB.rowCount('units');
  const percobaan = [
    ['kolom asing yang berisi potongan SQL', { '"status" = "x" OR 1=1 --': 'UNPAID' }],
    ['nama tabel di dalam nama kolom', { 'units"."payload': 'x' }],
    ['Set dari state renderer (bentuk yang tidak dikenali)', { brand: new Set(['SANY']) }],
    ['objek pembangun kueri (bukan kunci operator)', { status: { columnName: 'status', operator: '=', value: 'AVAILABLE' } }],
    ['nilai berupa fungsi', { model: () => 'SY215C' }],
    ['bigint / symbol yang ditolak better-sqlite3', { brand: 10n }],
  ];
  for (const [label, where] of percobaan) {
    let hasil = null, error = null;
    try { hasil = DB.queryCollection({ collection: 'units', where, limit: 5 }); } catch (err) { error = err.message; }
    ok(`12.1 ${label} tidak menggagalkan query`, hasil !== null && hasil.rows.length === 5, { error });
  }
  const butaSaring = DB.queryCollection({ collection: 'units', where: { brand: new Set(['SANY']) }, limit: 1 });
  ok('12.2 penyaringan yang tidak dikenali DILEWATI, bukan dipakai seadanya',
    butaSaring.total === totalUnit, { total: butaSaring.total, totalUnit });

  // Kolom turunan diisi dengan konversi tipe; nilai penyaringan harus dikonversi
  // dengan cara yang sama, kalau tidak filter { isActive: true } tidak pernah
  // cocok dengan kolom TEXT yang terisi 'true'.
  DB.saveCollection('bankAccounts', [
    { id: 'BA1', namaBank: 'BCA Uji', nomorRekening: '123', mataUang: 'IDR', isActive: true },
    { id: 'BA2', namaBank: 'Mandiri Uji', nomorRekening: '456', mataUang: 'IDR', isActive: false },
  ]);
  const aktif = DB.queryCollection({ collection: 'bankAccounts', where: { isActive: true } });
  ok('12.3 boolean pada kolom TEXT cocok dengan cara penulis mengisi kolom',
    aktif.total === 1 && aktif.rows[0].id === 'BA1', { total: aktif.total, id: aktif.rows[0] && aktif.rows[0].id });
  const qtyString = DB.queryCollection({ collection: 'warehouse', where: { qty: '3' } });
  ok('12.4 angka dalam string (dari form HTML) tetap menyaring kolom INTEGER',
    qtyString.total === 1 && qtyString.rows[0].id === 'W1', qtyString.total);
  const sortAsing = DB.queryCollection({ collection: 'units', sort: 'search" = ""', limit: 3 });
  ok('12.5 nama sort asing dijatuhkan ke urutan baku tanpa error', sortAsing.rows.length === 3, sortAsing.rows.length);
  const sumAsing = DB.sumCollection('units', 'purchasePrice", 0 AS x FROM units WHERE 1=1 --');
  ok('12.6 nama kolom agregat di luar daftar putih menghasilkan 0, bukan SQL', sumAsing === 0, sumAsing);
  const sumBoolean = DB.sumCollection('bankAccounts', 'isActive');
  ok('12.7 menjumlahkan kolom teks ditolak (harus kolom angka)', sumBoolean === 0, sumBoolean);

  // Karakter LIKE tidak bisa diselundupkan lewat pencarian: normalisasi yang sama
  // dengan renderer membuang semuanya, dan kueri tanpa token berarti "tanpa
  // penyaringan" — persis seperti matchesQuery, bukan pembocor seluruh tabel.
  const persen = DB.queryCollection({ collection: 'units', search: '%_%', limit: 3 });
  const persenJs = DB.loadCollection('units').filter(r => S.matchesQuery(fieldsFor(r, 'units'), '%_%'));
  ok('12.8 pencarian simbol saja diberi hasil yang sama oleh SQL dan renderer',
    persen.total === persenJs.length && persen.total === totalUnit, { sql: persen.total, js: persenJs.length });
  // Bila potongan itu sempat menjadi SQL, hasilnya "semua baris"; di sini ia
  // hanya dua kata yang harus cocok dengan blob, jadi hasilnya tetap sedikit.
  const kueriKutip = `' OR 1=1--`;
  const kutip = DB.queryCollection({ collection: 'units', search: kueriKutip, limit: 3 });
  const kutipJs = DB.loadCollection('units').filter(r => S.matchesQuery(fieldsFor(r, 'units'), kueriKutip));
  ok('12.9 kutip dan komentar SQL diperlakukan sebagai teks biasa, bukan pembuka semua baris',
    kutip.total === kutipJs.length && kutip.total < totalUnit, { sql: kutip.total, js: kutipJs.length, totalUnit });
  const panjang = DB.queryCollection({ collection: 'units', search: 'x'.repeat(5000), limit: 3 });
  ok('12.10 pencarian 5.000 karakter dilayani tanpa error', panjang.total === 0, panjang.total);

  // Kunci hapus dari patch hanya pernah menyentuh tabelnya sendiri, dan bentuk
  // kuncinya tidak bisa dilebarkan menjadi klausa SQL.
  const pelangganSebelum12 = DB.rowCount('customers');
  const gudangSebelum12 = DB.rowCount('warehouse');
  const hapusLintas = DB.saveRows('units', { removeIds: ['C9', 'W1', "' OR '1'='1", '1=1', '', null, undefined, {}] });
  ok('12.11 removeIds tidak menghapus baris collection lain',
    DB.rowCount('customers') === pelangganSebelum12 && DB.rowCount('warehouse') === gudangSebelum12,
    { customers: DB.rowCount('customers'), warehouse: DB.rowCount('warehouse') });
  ok('12.12 kunci hapus yang tidak ada hanya dilewati, tidak dihitung menghapus',
    hapusLintas.deleted === 0, hapusLintas);

  // Muatan raksasa pada satu baris tidak boleh merusak baris lain atau membuat
  // halaman keluar dari batasnya.
  const gajah = { id: 'U-GIGANT', serialNumber: 'GIGANT-1', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE', notes: 'n'.repeat(200000) };
  DB.saveRows('units', { upsert: [gajah] });
  const halamanGajah = DB.queryCollection({ collection: 'units', search: 'GIGANT', limit: 5 });
  ok('12.13 baris 200 KB tersimpan dan tetap ditemukan',
    halamanGajah.total === 1 && halamanGajah.rows[0].notes.length === 200000, { total: halamanGajah.total });
  const satuHalaman = DB.queryCollection({ collection: 'units', limit: 12 }).rows.length;
  ok('12.14 satu baris raksasa tidak mengubah jumlah baris satu halaman',
    satuHalaman === 12 && DB.rowCount('units') === totalUnit + 1, { satuHalaman, rows: DB.rowCount('units') });
  DB.saveRows('units', { removeIds: ['U-GIGANT'] });
  ok('12.15 baris raksasa yang dihapus kembali ke jumlah semula',
    DB.rowCount('units') === totalUnit, DB.rowCount('units'));

  // Nama collection lewat jalur prototype: daftar putih diperiksa dengan
  // hasOwnProperty, jadi '__proto__'/'constructor' tidak pernah jadi tabel.
  let protoDitolak = false, ctorDitolak = false;
  try { DB.queryCollection({ collection: '__proto__' }); } catch { protoDitolak = true; }
  try { DB.saveRows('constructor', { upsert: [] }); } catch { ctorDitolak = true; }
  ok('12.16 nama collection warisan prototype ditolak', protoDitolak && ctorDitolak, { protoDitolak, ctorDitolak });

  const boleh = DB.collectionNames().concat('db_meta').sort();
  const tabel = new Database(path.join(dir, 'fathoni.db'))
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name).sort();
  ok('12.17 tidak ada tabel baru selain 20 collection + meta',
    JSON.stringify(tabel) === JSON.stringify(boleh), { tabel });
  ok('12.18 file tetap sehat sesudah semua percobaan penyuntikan', DB.integrity().ok === true, DB.integrity().quickCheck);

  // ── 13. Agregat lahir di SQLite: kolom turunan baru, operator, kelompok ──
  // Dasbor dan Laporan pindah ke query, jadi angkanya sekarang dihitung oleh
  // kolom turunan (month, serviceDueIn, stockShortfall), operator WHERE, dan
  // groupCollection. Setiap hasil di bawah dibandingkan dengan hitungan
  // JavaScript LAMA yang dipakai halaman sebelum pindah — termasuk versi
  // renderer-nya (T), karena mode browser masih memakainya.
  const idsOf = rows => rows.map(r => r.id).sort().join(',');

  const unitsAgg = [
    { id: 'A-U1', serialNumber: 'AGG-1', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE', hourMeter: 120, purchaseDate: '2026-01-10' },
    { id: 'A-U2', serialNumber: 'AGG-2', brand: 'SANY', model: 'SY215C', status: 'ON_PROJECT', hourMeter: 470, purchaseDate: '2026-02-10' },
    { id: 'A-U3', serialNumber: 'AGG-3', brand: 'KOMATSU', model: 'PC200-8', status: 'MAINTENANCE', hourMeter: 500, purchaseDate: '2026-03-10' },
    { id: 'A-U4', serialNumber: 'AGG-4', brand: 'SANY', model: 'SY365C', status: 'BREAKDOWN', hourMeter: 499.6, purchaseDate: '2026-04-10' },
    { id: 'A-U5', serialNumber: 'AGG-5', brand: 'TADANO', model: 'GR-100N', status: 'AVAILABLE', purchaseDate: '2026-05-10' },
    { id: 'A-U6', serialNumber: 'AGG-6', brand: 'SANY', model: 'SY75C', status: 'AVAILABLE', hourMeter: -10, purchaseDate: '2026-06-10' },
  ];
  DB.saveCollection('units', unitsAgg);

  const rawKolom = new Database(path.join(dir, 'fathoni.db'));
  const dueTerisi = Object.fromEntries(
    rawKolom.prepare('SELECT id, "serviceDueIn" AS d FROM units').all().map(r => [r.id, r.d])
  );
  rawKolom.close();
  ok('13.1 serviceDueIn terisi dari hourMeter saat baris ditulis',
    dueTerisi['A-U1'] === 380 && dueTerisi['A-U2'] === 30 && dueTerisi['A-U3'] === 500
      && dueTerisi['A-U4'] === 1 && dueTerisi['A-U5'] === 500 && dueTerisi['A-U6'] === null,
    dueTerisi);

  // Aturan kartu alert Dasbor: sisa HM <= 50 dan > 0.
  const dueJs = u => { const hm = Number(u.hourMeter) || 0; return 500 - (hm % 500); };
  const alertJs = unitsAgg.filter(u => { const r = dueJs(u); return r <= 50 && r > 0; }).map(u => u.id).sort().join(',');
  const alertSql = DB.queryCollection({ collection: 'units', where: { serviceDueIn: { gte: 1, lte: 50 } }, limit: 500 });
  ok('13.2 jendela alert servis memberi baris yang sama lewat SQL dan JavaScript',
    idsOf(alertSql.rows) === alertJs && alertSql.total === 2, { sql: idsOf(alertSql.rows), js: alertJs });

  const partsAgg = [
    { id: 'A-P1', name: 'Filter oli', sku: 'AGG-S1', stock: 3, minStock: 5, price: 150000, unit: 'Pcs' },
    { id: 'A-P2', name: 'Filter solar', sku: 'AGG-S2', stock: 5, minStock: 5, price: 200000, unit: 'Pcs' },
    { id: 'A-P3', name: 'Oli hidrolik', sku: 'AGG-S3', stock: 9, minStock: 5, price: 300000, unit: 'Pcs' },
    { id: 'A-P4', name: 'Kabel putus', sku: 'AGG-S4', price: 0, unit: 'Pcs' },
  ];
  DB.saveCollection('spareParts', partsAgg);
  const rendahJs = partsAgg.filter(p => Number(p.stock) <= Number(p.minStock)).map(p => p.id).sort().join(',');
  const rendahSql = DB.queryCollection({ collection: 'spareParts', where: { stockShortfall: { lte: 0 } }, limit: 500 });
  ok('13.3 stok di bawah titik aman memakai kolom turunan sehingga bisa disaring di SQL',
    idsOf(rendahSql.rows) === rendahJs, { sql: idsOf(rendahSql.rows), js: rendahJs });
  const nilaiRendah = DB.sumCollection('spareParts', 'price', { stockShortfall: { lte: 0 } });
  ok('13.4 agregat nilai persediaan kritis dihitung tanpa memuat barisnya',
    nilaiRendah === 350000, nilaiRendah);

  const invAgg = [];
  const jenisAgg = ['RENTAL', 'PENJUALAN', 'SERVICE'];
  for (let i = 0; i < 30; i++) {
    const bulan = ['2026-08', '2026-09', '2026-10'][i % 3];
    invAgg.push({
      id: 'A-I' + i, invoiceNo: 'AGG/INV/' + i, customerName: 'PT Agg ' + (i % 4),
      type: jenisAgg[i % 3], status: i % 5 === 0 ? 'PAID' : 'UNPAID',
      issueDate: bulan + '-' + String(1 + (i % 27)).padStart(2, '0'),
      totalAmount: 1000000 * (1 + i), paidAmount: i % 5 === 0 ? 1000000 * (1 + i) : 0,
    });
  }
  invAgg.push({ id: 'A-IBAD', invoiceNo: 'AGG/INV/BAD', customerName: 'PT Agg 0', type: 'PENJUALAN', status: 'UNPAID', issueDate: 'bukan tanggal', totalAmount: 750000, paidAmount: 0 });
  invAgg.push({ id: 'A-INULL', invoiceNo: 'AGG/INV/NUL', customerName: 'PT Agg 1', type: 'RENTAL', status: 'PAID', totalAmount: 250000, paidAmount: 250000 });
  DB.saveCollection('invoices', invAgg);

  const sptAgg = name => SCHEMA.COLLECTION_SPECS.find(s => s.name === name);
  const colAgg = (name, col) => sptAgg(name).columns.find(c => c.col === col) || {};

  const bulanSql = DB.queryCollection({ collection: 'invoices', where: { month: '2026-09' }, limit: 500 });
  const bulanJs = invAgg.filter(r => String(r.issueDate || '').startsWith('2026-09'));
  ok('13.5 kolom bulan terisi dari issueDate dan memberi hasil sama dengan startsWith lama',
    bulanSql.total === bulanJs.length && bulanSql.total === 10, { sql: bulanSql.total, js: bulanJs.length });

  const kelompokBulan = DB.groupCollection({ collection: 'invoices', by: ['month'], sum: 'totalAmount' }).groups;
  const perBulan = Object.fromEntries(kelompokBulan.map(g => [g.key, g]));
  const jsBulan = {};
  for (const r of invAgg) {
    const m = /^(\d{4})-(\d{2})/.exec(String(r.issueDate || ''));
    const k = m ? m[0] : '';
    jsBulan[k] = jsBulan[k] || { count: 0, sum: 0 };
    jsBulan[k].count += 1;
    jsBulan[k].sum += Number(r.totalAmount) || 0;
  }
  ok('13.6 pendapatan per bulan sama dengan hitungan JavaScript',
    ['2026-08', '2026-09', '2026-10'].every(k => perBulan[k] && perBulan[k].count === jsBulan[k].count && perBulan[k].sum === jsBulan[k].sum),
    { sql: kelompokBulan, js: jsBulan });
  ok('13.7 tanggal yang tidak terbaca tidak menumpuk di bulan mana pun',
    perBulan[''] && perBulan[''].count === 2 && perBulan[''].sum === 1000000, perBulan['']);
  ok('13.8 kelompok datang dalam urutan kunci yang pasti (pola yang sama dipakai sisi renderer)',
    JSON.stringify(kelompokBulan.map(g => g.key)) === JSON.stringify(['', '2026-08', '2026-09', '2026-10']),
    kelompokBulan.map(g => g.key));
  const jsJsBulan = T.groupLocally({ collection: 'invoices', by: ['month'], sum: 'totalAmount' }, invAgg);
  ok('13.9 fallback mode browser memberi kelompok identik dengan SQLite',
    JSON.stringify(jsJsBulan.map(g => [g.key, g.count, g.sum])) === JSON.stringify(kelompokBulan.map(g => [g.key, g.count, g.sum])),
    { js: jsJsBulan, sql: kelompokBulan });

  // Grafik pendapatan Dasbor: kelompok per (bulan, tipe) harus sama dengan
  // revenueByMonth yang selama ini dipakai halaman.
  const duaKolom = DB.groupCollection({ collection: 'invoices', by: ['month', 'type'], sum: 'totalAmount' }).groups;
  const revJs = T.revenueByMonth(invAgg, T.lastMonthKeys(3, new Date(2026, 9, 1)));
  const cocokJenis = revJs.every(row => ['RENTAL', 'PENJUALAN', 'SERVICE'].every(t => {
    const g = duaKolom.find(x => x.keys[0] === row.key && x.keys[1] === t);
    const nilai = row[t === 'RENTAL' ? 'rental' : t === 'PENJUALAN' ? 'penjualan' : 'service'];
    return (g ? g.sum : 0) === nilai;
  }));
  ok('13.10 kelompok dua kolom == revenueByMonth untuk sewa / penjualan / servis',
    cocokJenis && duaKolom.every(g => g.keys.length === 2 && g.key === g.keys.join(' ')),
    { groups: duaKolom.length, revJs });

  const empatKolom = DB.groupCollection({ collection: 'invoices', by: ['month', 'type', 'status', 'customerName'], sum: 'totalAmount' }).groups;
  ok('13.11 lebih dari tiga kolom kelompok dipotong ke tiga, bukan menolak query',
    empatKolom.length > 0 && empatKolom.every(g => g.keys.length === 3), empatKolom[0]);
  const kolomAsing = DB.groupCollection({ collection: 'invoices', by: ['payload" OR "id" LIKE "%'] }).groups;
  ok('13.12 kolom kelompok asing menghasilkan kelompok kosong, bukan SQL', kolomAsing.length === 0, kolomAsing);
  const tanpaBy = DB.groupCollection({ collection: 'invoices', by: [] }).groups;
  const collectionAsing = DB.groupCollection({ collection: '__proto__', by: ['month'] }).groups;
  ok('13.13 permintaan tanpa kolom / collection asing ditolak tanpa error',
    tanpaBy.length === 0 && collectionAsing.length === 0, { tanpaBy, collectionAsing });
  const sumTeks = DB.groupCollection({ collection: 'invoices', by: ['type'], sum: 'invoiceNo' }).groups;
  ok('13.14 menjumlahkan kolom teks diabaikan tetapi jumlah barisnya tetap benar',
    sumTeks.length === 3 && sumTeks.every(g => g.sum === 0 && g.count > 0), sumTeks);
  const empatKelompok = DB.groupCollection({ collection: 'invoices', by: ['month'], limit: 4 }).groups;
  const batasKelompok = DB.groupCollection({ collection: 'invoices', by: ['customerName'], limit: 99999 }).groups;
  ok('13.15 batas jumlah kelompok dihormati dan tidak pernah melewati satu halaman',
    empatKelompok.length === 4 && batasKelompok.length <= DB.MAX_PAGE_LIMIT, { empat: empatKelompok.length, batas: batasKelompok.length });
  const kelompokSaring = DB.groupCollection({ collection: 'invoices', by: ['type'], sum: 'totalAmount', where: { status: 'UNPAID' } }).groups;
  const jsSaring = {};
  for (const r of invAgg) if (r.status === 'UNPAID') jsSaring[r.type] = (jsSaring[r.type] || 0) + Number(r.totalAmount);
  ok('13.16 kelompok menghormati penyaringan equality',
    kelompokSaring.length === 3 && kelompokSaring.every(g => g.sum === jsSaring[g.key]),
    { sql: kelompokSaring, js: jsSaring });
  const kelompokCari = DB.groupCollection({ collection: 'invoices', by: ['month'], search: 'AGG/INV/7' }).groups;
  const jsCari = invAgg.filter(r => String(r.invoiceNo).toLowerCase().replace(/[^a-z0-9]/g, '') === 'agginv7');
  ok('13.17 kelompok menghormati pencarian pada blob',
    kelompokCari.length === jsCari.length && kelompokCari[0].key === '2026-09' && kelompokCari[0].count === 1,
    { sql: kelompokCari, js: jsCari.map(r => r.id) });

  // Operator mana pun yang tidak ada di daftar putih tidak boleh mengubah
  // bentuk statement: entri itu DILEWATI, bukan dipakai seadanya.
  const semuaUnit = DB.rowCount('units');
  const percasOperator = [
    ['operator LIKE asing', { status: { op: 'LIKE', value: '%AV%' } }],
    ['operator = sebagai kunci', { status: { '=': 'AVAILABLE' } }],
    ['bentuk pembangun kueri', { status: { column: 'status', compare: 'eq', value: 'AVAILABLE' } }],
    ['kunci prototype', { status: { __proto__: 'AVAILABLE' } }],
    ['operator asing di samping yang dikenal', { hourMeter: { gt: 0, between: [1, 2, 3] } }],
    ['daftar kosong (belum ada yang dipilih)', { brand: [] }],
    ['nin dengan daftar kosong', { status: { nin: [] } }],
    ['nilai non-bindable di dalam daftar', { brand: ['SANY', {}, () => 1] }],
    ['kolom asing dengan bentuk operator', { zzz: { gte: 1 } }],
  ];
  for (const [label, where] of percasOperator) {
    let hasil = null, error = null;
    try { hasil = DB.queryCollection({ collection: 'units', where, limit: 500 }); } catch (err) { error = err.message; }
    const diharapkan = label === 'operator asing di samping yang dikenal'
      ? 4
      : label === 'nilai non-bindable di dalam daftar'
        ? unitsAgg.filter(u => u.brand === 'SANY').length
        : semuaUnit;
    ok(`13.18 ${label}: query tetap melayani dan hanya entri yang dikenal yang menyaring`,
      hasil !== null && hasil.total === diharapkan, { error, total: hasil && hasil.total, diharapkan });
  }

  const operatorTable = [
    ['ne teks', { status: { ne: 'AVAILABLE' } }],
    ['gt angka', { hourMeter: { gt: 470 } }],
    ['lt angka (NULL ikut terbuang)', { hourMeter: { lt: 500 } }],
    ['gte + lte sekaligus', { hourMeter: { gte: 120, lte: 470 } }],
    ['bentuk panjang op/value', { status: { op: 'eq', value: 'ON_PROJECT' } }],
    ['IN lewat kunci in', { brand: { in: ['SANY', 'TADANO'] } }],
    ['IN lewat daftar', { brand: ['KOMATSU', 'TADANO'] }],
    ['nin teks (semua kecuali)', { status: { nin: ['AVAILABLE', 'BREAKDOWN'] } }],
    ['BETWEEN tanggal teks', { purchaseDate: { between: ['2026-02-01', '2026-04-01'] } }],
    ['ne terhadap null', { serialNumber: { ne: null } }],
    ['urutan teks tanggal', { purchaseDate: { lte: '2026-03-10' } }],
  ];
  for (const [label, where] of operatorTable) {
    const sql = DB.queryCollection({ collection: 'units', where, limit: 500 });
    const js = unitsAgg.filter(r => T.matchesWhere(r, where, 'units'));
    ok(`13.19 operator ${label} memberi baris yang sama di SQL dan sisi renderer`,
      idsOf(sql.rows) === idsOf(js), { sql: idsOf(sql.rows), js: idsOf(js) });
  }

  // 'nin' hanya dipakai pada kolom TEXT (status "aktif" di Dasbor): SQL menyimpan
  // '' untuk field yang hilang, jadi baris tanpa status tetap ikut — dan sisi
  // renderer harus memperlakukan baris yang sama persis seperti itu.
  const doAgg = [
    { id: 'A-D1', doNumber: 'AGG-D1', customerName: 'A', status: 'IN_TRANSIT', deliveryDate: '2026-07-01' },
    { id: 'A-D2', doNumber: 'AGG-D2', customerName: 'B', status: 'DELIVERED', deliveryDate: '2026-07-02' },
    { id: 'A-D3', doNumber: 'AGG-D3', customerName: 'C', deliveryDate: '2026-07-03' },
  ];
  DB.saveCollection('deliveries', doAgg);
  const ninWhere = { status: { nin: ['DELIVERED', 'CANCELLED'] } };
  const ninSql = DB.queryCollection({ collection: 'deliveries', where: ninWhere, limit: 500 });
  const ninJs = doAgg.filter(r => T.matchesWhere(r, ninWhere, 'deliveries'));
  ok('13.19b nin pada kolom TEXT ikut memuat baris tanpa status, sama seperti SQL',
    idsOf(ninSql.rows) === idsOf(ninJs) && ninSql.total === 2, { sql: idsOf(ninSql.rows), js: idsOf(ninJs) });

  // Kolom turunan harus diisi dengan konversi yang SAMA di kedua sisi; kalau
  // tidak, mode browser dan mode desktop menampilkan angka berbeda.
  const edgeTanggal = ['2026-05-07', '2026-5-7', '', null, undefined, 'bukan tanggal', 20260507];
  const bulanCocok = Object.keys(T.MONTH_SOURCE).every(coll => {
    const spec = sptAgg(coll);
    const sumber = T.MONTH_SOURCE[coll];
    if (!spec.columns.some(c => c.col === 'month')) return false;
    return edgeTanggal.every(v => {
      const row = { issueDate: '1999-12-05', orderDate: '1999-12-05', startDate: '1999-12-05', openDate: '1999-12-05', tanggal: '1999-12-05' };
      row[sumber] = v;
      return colAgg(coll, 'month').get(row) === T.columnValueOf(coll, 'month', row);
    });
  });
  ok('13.20 kolom bulan renderer memakai field sumber dan konversi yang sama dengan dbSchema',
    bulanCocok, T.MONTH_SOURCE);

  const edgeJam = [120, 470, 499.6, 500, 0, -10, undefined, null, '', 'x', NaN, 1000000];
  const serviceCocok = edgeJam.every(hm => {
    const row = { hourMeter: hm };
    return colAgg('units', 'serviceDueIn').get(row) === T.columnValueOf('units', 'serviceDueIn', row);
  });
  const stokCocok = [[3, 5], [5, 5], [9, 5], [undefined, 2], [4, undefined], [2.7, 1.2], ['', 0], ['x', 1]].every(([s, m]) => {
    const row = { stock: s, minStock: m };
    return colAgg('spareParts', 'stockShortfall').get(row) === T.columnValueOf('spareParts', 'stockShortfall', row);
  });
  ok('13.21 serviceDueIn dan stockShortfall terhitung identik di kedua sisi',
    serviceCocok && stokCocok, { serviceCocok, stokCocok });

  // Profil lama: kolom bulan yang belum ada harus dibuat DAN diisi dari payload
  // sebelum query pertama dilayani, kalau tidak Dasbor menampilkan nol.
  const rawHilang13 = new Database(path.join(dir, 'fathoni.db'));
  rawHilang13.exec('DROP INDEX IF EXISTS "ix_invoices_month"');
  rawHilang13.exec('ALTER TABLE "invoices" DROP COLUMN "month"');
  rawHilang13.close();
  DB.setMeta('derived_revision', '1');
  DB.closeDatabase();
  DB.openDatabase(dir);
  const pulihBulan = DB.groupCollection({ collection: 'invoices', by: ['month'], sum: 'totalAmount' }).groups;
  ok('13.22 kolom turunan baru pada profil lama dibuat dan dihitung ulang saat dibuka',
    pulihBulan.some(g => g.key === '2026-09' && g.count === 10)
      && Number(DB.getMeta('derived_revision')) === DB.DERIVED_REVISION,
    { groups: pulihBulan, revisi: DB.getMeta('derived_revision'), sekarang: DB.DERIVED_REVISION });
  ok('13.23 file tetap sehat sesudah seluruh percobaan agregat', DB.integrity().ok === true, DB.integrity().quickCheck);

  // Jejak jalur tulis: satu perubahan harus tercatat sebagai patch satu baris.
  // fullRows yang tumbuh tiap aksi kecil berarti renderer kembali mengirim
  // collection penuh — bentuk yang di halaman berpaginasi menghapus baris yang
  // tidak dimuatnya (dijaga pula dari dalam aplikasi oleh handoff-check 7.12/7.14).
  const jejakSebelum = DB.stats().writes;
  DB.saveRows('units', {
    upsert: [{ id: 'A-U1', serialNumber: 'AGG-1', brand: 'SANY', model: 'SY215C', status: 'ON_PROJECT', hourMeter: 131, purchaseDate: '2026-01-10' }],
    removeIds: ['A-U6'],
  });
  DB.saveCollection('deliveries', doAgg);
  const jejakSesudah = DB.stats().writes;
  ok('13.24 jejak tulis memisahkan patch per baris dari penulisan collection penuh',
    jejakSesudah.patchCalls === jejakSebelum.patchCalls + 1
      && jejakSesudah.patchUpsertRows === jejakSebelum.patchUpsertRows + 1
      && jejakSesudah.patchRemoveIds === jejakSebelum.patchRemoveIds + 1
      && jejakSesudah.fullCalls === jejakSebelum.fullCalls + 1
      && jejakSesudah.fullRows === jejakSebelum.fullRows + doAgg.length,
    { sebelum: jejakSebelum, sesudah: jejakSesudah });

  // ── 14. Laporan, Control Tower, Equipment Passport ──────────────────────────
  // Ketiga halaman ini menghitung angkanya di SQLite sejak agregatnya pindah.
  // Setiap assertion membandingkan query yang dikirim halaman dengan JavaScript
  // LAMA halaman itu, dan dengan cermin renderer (T.matchesWhere) yang dipakai
  // mode browser — tiga jalan harus memberi angka yang sama.
  const semua = collection => DB.queryCollection({ collection, limit: DB.MAX_PAGE_LIMIT }).rows;
  const unitDiDb = semua('units');
  const invDiDbAwal = semua('invoices');

  // Passport membuka unit dari id di URL. Seit Collection units tidak pernah
  // dimuat seluruhnya ke renderer lagi, kunci 'id' yang tidak dikenal akan
  // diam-diam mengembalikan SEMUA unit: bentuk kesalahan paling berbahaya di
  // halaman ini, karena tampilannya terlihat benar.
  const idSatu = DB.queryCollection({ collection: 'units', where: { id: 'A-U1' }, limit: 500 });
  const idAsing = DB.queryCollection({ collection: 'units', where: { id: 'A-U-TIDAK-ADA' }, limit: 500 });
  const idKosong = DB.queryCollection({ collection: 'units', where: { id: '' }, limit: 500 });
  const idCermin = unitDiDb.filter(r => T.matchesWhere(r, { id: 'A-U1' }, 'units'));
  ok('14.1 kunci id dikenali lapisan query: satu baris, bukan seluruh collection',
    idSatu.total === 1 && idSatu.rows[0].id === 'A-U1'
      && idAsing.total === 0 && idKosong.total === 0
      && idCermin.length === 1 && idCermin[0].id === 'A-U1',
    { satu: idSatu.total, asing: idAsing.total, kosong: idKosong.total, cermin: idCermin.length, ada: unitDiDb.length });

  // Control Tower: empat kartu armada sebagai COUNT, bukan units.forEach.
  const menara = [
    ['operating', { status: { in: ['ON_PROJECT', 'RENTED'] } }, u => u.status === 'ON_PROJECT' || u.status === 'RENTED'],
    ['idle', { status: 'AVAILABLE' }, u => u.status === 'AVAILABLE'],
    ['maintenance', { status: 'MAINTENANCE' }, u => u.status === 'MAINTENANCE'],
    ['breakdown', { status: 'BREAKDOWN' }, u => u.status === 'BREAKDOWN'],
  ];
  const menaraSalah = menara.map(([label, where, js]) => {
    const sql = DB.queryCollection({ collection: 'units', where, limit: 1 }).total;
    const cermin = unitDiDb.filter(r => T.matchesWhere(r, where, 'units')).length;
    return sql === unitDiDb.filter(js).length && cermin === sql ? null : { label, sql, cermin, js: unitDiDb.filter(js).length };
  }).filter(Boolean);
  ok('14.2 kartu armada Control Tower == hitungan loop JavaScript pada baris yang sama',
    menaraSalah.length === 0 && DB.queryCollection({ collection: 'units', limit: 1 }).total === unitDiDb.length,
    { menaraSalah, totalDb: DB.queryCollection({ collection: 'units', limit: 1 }).total });

  // Piutang: halaman memakai IN untuk 'belum lunas' dan dueDate ketat sebelum
  // hari ini. Invoice tanpa tanggal jatuh tempo tidak boleh ikut jatuh tempo:
  // kolom TEXT menyimpan '' dan '' < '2026-..' akan membuatnya ikut kalau
  // batas bawah gt: '' dihapus.
  DB.saveRows('invoices', {
    upsert: [
      { id: 'A-IP1', invoiceNo: 'AGG/INV/P1', customerName: 'PT Agg 1', type: 'RENTAL', status: 'PARTIAL', issueDate: '2026-09-05', dueDate: '2026-09-20', totalAmount: 4000000, paidAmount: 1500000 },
      { id: 'A-IP2', invoiceNo: 'AGG/INV/P2', customerName: 'PT Agg 2', type: 'SERVICE', status: 'PARTIAL', issueDate: '2026-10-01', dueDate: '2099-01-01', totalAmount: 2000000, paidAmount: 500000 },
      { id: 'A-IP3', invoiceNo: 'AGG/INV/P3', customerName: 'PT Agg 3', type: 'PENJUALAN', status: 'UNPAID', issueDate: '2026-10-02', totalAmount: 3000000, paidAmount: 0 },
      { id: 'A-ISP', invoiceNo: 'AGG/INV/SP', customerName: 'PT Agg 0', type: 'SPAREPART', status: 'UNPAID', issueDate: '2026-09-10', dueDate: '2026-09-30', totalAmount: 999000, paidAmount: 0 },
    ],
    removeIds: [],
  });
  const invDiDb = semua('invoices');
  const hariIni = T.isoDay(0);
  const wherePiutang = { status: { in: ['UNPAID', 'PARTIAL'] } };
  const whereJatuhTempo = { ...wherePiutang, dueDate: { gt: '', lt: hariIni } };
  const jsPiutang = invDiDb.filter(i => i.status === 'UNPAID' || i.status === 'PARTIAL');
  const jsJatuhTempo = jsPiutang.filter(i => i.dueDate && i.dueDate < hariIni);
  const sisa = rows => rows.reduce((a, i) => a + (Number(i.totalAmount) || 0) - (Number(i.paidAmount) || 0), 0);
  const sqlSisa = where => DB.sumCollection('invoices', 'totalAmount', where) - DB.sumCollection('invoices', 'paidAmount', where);
  const queryJatuhTempo = DB.queryCollection({ collection: 'invoices', where: whereJatuhTempo, limit: 500 });
  ok('14.3 kartu piutang Laporan: jumlah baris dan selisih tagihan sama dengan reduce lama',
    DB.queryCollection({ collection: 'invoices', where: wherePiutang, limit: 1 }).total === jsPiutang.length
      && sqlSisa(wherePiutang) === sisa(jsPiutang)
      && queryJatuhTempo.total === jsJatuhTempo.length
      && sqlSisa(whereJatuhTempo) === sisa(jsJatuhTempo),
    { piutang: jsPiutang.length, sql: DB.queryCollection({ collection: 'invoices', where: wherePiutang, limit: 1 }).total, jatuhTempo: jsJatuhTempo.length });
  ok('14.4 invoice tanpa tanggal jatuh tempo tidak pernah ikut jatuh tempo',
    !idsOf(queryJatuhTempo.rows).includes('A-IP3') && !idsOf(queryJatuhTempo.rows).includes('A-INULL')
      && idsOf(queryJatuhTempo.rows) === idsOf(invDiDb.filter(r => T.matchesWhere(r, whereJatuhTempo, 'invoices'))),
    { sql: idsOf(queryJatuhTempo.rows) });

  // Tabel pendapatan bulanan: bentuk WHERE yang dikirim halaman (bulan BETWEEN
  // + tipe IN), dibandingkan dengan revenueByMonth yang selama ini dipakai.
  const bulanLap = T.lastMonthKeys(3, new Date(2026, 9, 1));
  const whereBulan = {
    month: { between: [bulanLap[0].key, bulanLap[bulanLap.length - 1].key] },
    type: { in: ['RENTAL', 'PENJUALAN', 'SERVICE'] },
  };
  const kelompokLap = DB.groupCollection({ collection: 'invoices', by: ['month', 'type'], sum: 'totalAmount', where: whereBulan }).groups;
  const cerminLap = T.groupLocally({ collection: 'invoices', by: ['month', 'type'], sum: 'totalAmount', where: whereBulan }, invDiDb);
  const revLap = T.revenueByMonth(invDiDb, bulanLap);
  const nilaiLap = (key, jenis) => {
    const g = kelompokLap.find(x => x.keys[0] === key && x.keys[1] === jenis);
    return g ? g.sum : 0;
  };
  const cocokLap = revLap.every(row =>
    row.rental === nilaiLap(row.key, 'RENTAL')
      && row.penjualan === nilaiLap(row.key, 'PENJUALAN')
      && row.service === nilaiLap(row.key, 'SERVICE')
      && row.total === nilaiLap(row.key, 'RENTAL') + nilaiLap(row.key, 'PENJUALAN') + nilaiLap(row.key, 'SERVICE'));
  ok('14.5 tabel pendapatan Laporan == revenueByMonth atas isi database yang sama, SPAREPART tidak ikut',
    cocokLap
      && JSON.stringify(kelompokLap.map(g => [g.key, g.count, g.sum])) === JSON.stringify(cerminLap.map(g => [g.key, g.count, g.sum]))
      && !kelompokLap.some(g => g.keys[1] === 'SPAREPART')
      && nilaiLap('2026-09', 'RENTAL') > 0,
    { sql: kelompokLap, cermin: cerminLap, revLap });

  // Passport: riwayat, biaya dan pendapatan satu unit, disaring pada nomor sasis.
  DB.saveCollection('services', [
    { id: 'A-S1', woNumber: 'AGG-WO-1', serialNumber: 'AGG-1', status: 'COMPLETED', openDate: '2026-08-01', estimatedCost: 500000 },
    { id: 'A-S2', woNumber: 'AGG-WO-2', serialNumber: 'AGG-1', status: 'IN_PROGRESS', openDate: '2026-09-02', estimatedCost: 250000 },
    { id: 'A-S3', woNumber: 'AGG-WO-3', serialNumber: 'AGG-2', status: 'OPEN', openDate: '2026-09-05' },
    { id: 'A-S4', woNumber: 'AGG-WO-4', serialNumber: 'AGG-1', openDate: '2026-10-01', estimatedCost: 100000 },
  ]);
  DB.saveCollection('rentals', [
    { id: 'A-R1', contractNo: 'AGG-RC-1', customerName: 'PT Agg 1', serialNumber: 'AGG-1', status: 'ACTIVE', startDate: '2026-08-01', endDate: '2026-11-01', monthlyRate: 5000000 },
    { id: 'A-R2', contractNo: 'AGG-RC-2', customerName: 'PT Agg 2', serialNumber: 'AGG-2', status: 'ACTIVE', startDate: '2026-09-01', endDate: '2026-10-01', monthlyRate: 3000000 },
  ]);
  DB.saveCollection('sales', [
    { id: 'A-SO1', orderNo: 'AGG-SO-1', customerName: 'PT Agg 3', serialNumber: 'AGG-1', status: 'COMPLETED', orderDate: '2026-07-01', totalPrice: 200000000 },
    { id: 'A-SO2', orderNo: 'AGG-SO-2', customerName: 'PT Agg 4', serialNumber: 'AGG-3', status: 'PENDING', orderDate: '2026-07-02' },
  ]);
  const riwayatSatu = { serialNumber: 'AGG-1' };
  const svcDiDb = semua('services');
  const jsRiwayat = svcDiDb.filter(s => s.serialNumber === 'AGG-1');
  const halRiwayat = DB.queryCollection({ collection: 'services', where: riwayatSatu, sort: 'openDate', desc: true, limit: 30 });
  const jsBiaya = jsRiwayat.reduce((a, s) => a + (Number(s.estimatedCost) || 0), 0);
  ok('14.6 riwayat maintenance passport: jumlah catatan dan total biaya per nomor sasis',
    halRiwayat.total === jsRiwayat.length
      && DB.sumCollection('services', 'estimatedCost', riwayatSatu) === jsBiaya
      && halRiwayat.rows[0].woNumber === 'AGG-WO-4',
    { total: halRiwayat.total, js: jsRiwayat.length, biaya: DB.sumCollection('services', 'estimatedCost', riwayatSatu), pertama: halRiwayat.rows[0] });

  // 'Service Due' di Menara Pengawas adalah WO yang belum selesai. Record tanpa
  // status sama sekali harus ikut (kolom TEXT menyimpan ''), sama seperti
  // `s.status !== 'COMPLETED'` pada JavaScript.
  const whereWoAktif = { status: { nin: ['COMPLETED'] } };
  ok('14.7 alert servis dan pendapatan unit passport mengikuti hitungan lama termasuk baris tak lengkap',
    DB.queryCollection({ collection: 'services', where: whereWoAktif, limit: 1 }).total
      === svcDiDb.filter(s => s.status !== 'COMPLETED').length
      && DB.sumCollection('rentals', 'monthlyRate', riwayatSatu) === 5000000
      && DB.sumCollection('sales', 'totalPrice', { serialNumber: 'AGG-3' }) === 0
      && DB.queryCollection({ collection: 'sales', where: { serialNumber: 'AGG-3' }, limit: 1 }).total === 1,
    { woAktif: DB.queryCollection({ collection: 'services', where: whereWoAktif, limit: 1 }).total, jsAktif: svcDiDb.filter(s => s.status !== 'COMPLETED').length });

  // Pembulatan 'hari ini' harus lokal: kunci UTC membuat invoice yang jatuh
  // tempo pagi ini masih dihitung belum jatuh tempo, atau sebaliknya, sesuai
  // jam zona waktu mesin — bukan sesuai tanggal di layar.
  const tengahMalamLokal = new Date(2026, 0, 1, 0, 0, 0, 0);
  ok('14.8 isoDay sisi renderer adalah tanggal lokal dan geser hari melintas bulan',
    T.isoDay(0, new Date(2026, 9, 10)) === '2026-10-10'
      && T.isoDay(0, tengahMalamLokal) === '2026-01-01'
      && T.isoDay(1, new Date(2026, 0, 31)) === '2026-02-01'
      && T.isoDay(-1, new Date(2026, 2, 1)) === '2026-02-28',
    { lokal: T.isoDay(0, tengahMalamLokal), utc: tengahMalamLokal.toISOString().slice(0, 10) });

  ok('14.9 file tetap sehat sesudah seluruh percobaan agregat halaman',
    DB.integrity().ok === true, DB.integrity().quickCheck);

  // ── 15. Hidrasi tertunda + penjaga tulis (#38) ──────────────────────────────
  // Boot tidak lagi memindahkan seluruh isi file ke renderer. Itu hanya aman bila
  // (a) main process bisa membaca SEBAGIAN collection tanpa menyentuh sisanya,
  // (b) jejak baca membuktikan jalur penuh tidak dipakai diam-diam, dan
  // (c) penjaga di sisi renderer benar-benar menolak menulis collection yang belum
  //     termuat sebagai collection penuh. (c) diuji di sini sebagai fungsi murni:
  //     kehilangan data bentuk itu tidak bisa dilihat dari layar.
  const bacaSebelum = DB.stats().reads;
  const sebagian = DB.loadStore(['units']);
  const utuh = DB.loadStore();
  const bacaSesudah = DB.stats().reads;
  ok('15.1 loadStore([nama]) hanya mengembalikan collection yang disebut',
    Object.keys(sebagian).length === 1 && Array.isArray(sebagian.units)
      && sebagian.units.length === DB.queryCollection({ collection: 'units', limit: 1 }).total
      && !('invoices' in sebagian) && !('kas' in sebagian),
    { kunci: Object.keys(sebagian), baris: sebagian.units && sebagian.units.length });
  ok('15.2 jejak baca memisahkan muatan sebagian dari muatan seluruh store',
    bacaSesudah.subsetCalls === bacaSebelum.subsetCalls + 1
      && bacaSesudah.subsetCollections === bacaSebelum.subsetCollections + 1
      && bacaSesudah.fullCalls === bacaSebelum.fullCalls + 1
      && bacaSesudah.rows === bacaSebelum.rows + sebagian.units.length + DB.stats().totalRows,
    { sebelum: bacaSebelum, sesudah: bacaSesudah });
  ok('15.3 jumlah baris per collection sama dengan yang dilihat stats()',
    DB.rowCounts().totalRows === DB.stats().totalRows
      && DB.rowCounts().perCollection.length === DB.collectionNames().length
      && DB.rowCounts().perCollection.find(c => c.name === 'units').rows === sebagian.units.length,
    DB.rowCounts());

  // Foto base64 lama hanya bisa dipindahkan tanpa memuat seluruh fleet bila
  // kandidatnya bisa ditanya ke SQLite. Kolom turunan inlinePhoto adalah satu-
  // satunya jalan itu; kalau ia salah, migrasi berhenti diam-diam dan base64
  // tetap menempel di payload selamanya.
  DB.saveRows('units', {
    upsert: [
      { id: 'P-1', serialNumber: 'FOTO-1', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE', hourMeter: 10, purchaseDate: '2026-05-01', photo: 'data:image/jpeg;base64,AAAA' },
      { id: 'P-2', serialNumber: 'FOTO-2', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE', hourMeter: 20, purchaseDate: '2026-05-02', photoId: 'sany-2.jpg' },
      { id: 'P-3', serialNumber: 'FOTO-3', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE', hourMeter: 30, purchaseDate: '2026-05-03' },
    ],
    removeIds: [],
  });
  const kandidat = DB.queryCollection({ collection: 'units', where: { inlinePhoto: 1 }, limit: DB.MAX_PAGE_LIMIT });
  const unitSemua15 = semua('units');
  const jsKandidat = unitSemua15.filter(u => T.inlinePhotoOf(u.photo) === 1);
  const idKandidat = idsOf(kandidat.rows).split(',');
  ok('15.4 inlinePhoto memberi kandidat foto base64 yang sama di SQLite dan di cermin renderer',
    idsOf(kandidat.rows) === idsOf(jsKandidat)
      && idKandidat.includes('P-1')
      && !idKandidat.includes('P-2') && !idKandidat.includes('P-3'),
    { sql: idKandidat, js: idsOf(jsKandidat) });
  ok('15.5 columnValueOf sisi renderer meniru kolom turunan untuk baris yang sama',
    unitSemua15.every(u => T.columnValueOf('units', 'inlinePhoto', u) === (kandidat.rows.some(k => k.id === u.id) ? 1 : 0)),
    unitSemua15.map(u => [u.id, T.columnValueOf('units', 'inlinePhoto', u)]));

  // Penjaga tulis. Empat bentuk yang harus dibedakan: collection belum termuat
  // dengan diff yang bisa dipercaya, belum termuat dengan diff yang TIDAK bisa
  // dipercaya, sudah termuat, dan sudah termuat tapi diff-nya rusak.
  const barisA = { id: 'G-1', name: 'a' }, barisB = { id: 'G-2', name: 'b' };
  const muat = (prev, next, loaded) => T.rencanakanTulis(['x'], { x: prev }, { x: next }, { x: loaded });

  // Belum termuat + ada penghapusan: id yang hilang dari memori BISA saja masih
  // ada di file (belum terbaca), jadi hapus dilarang dan jumlah yang dibuang
  // dilaporkan supaya pengguna tahu ada yang belum tuntas.
  const belumMuatHapus = muat([barisA, barisB], [barisA], false);
  ok('15.6 collection belum termuat: upsert jalan, penghapusan dibuang dan dilaporkan',
    belumMuatHapus.patches.x.removeIds.length === 0
      && belumMuatHapus.patches.x.upsert.length === 0
      && belumMuatHapus.buangan.x === 1
      && Object.keys(belumMuatHapus.full).length === 0
      && belumMuatHapus.tertahan.length === 0,
    belumMuatHapus);

  // Belum termuat + ada perubahan baris: hanya baris itu yang boleh ditulis.
  const belumMuatUbah = muat([barisA], [{ ...barisA, name: 'a2' }], false);
  ok('15.7 collection belum termuat: baris yang berubah tetap tersimpan',
    belumMuatUbah.patches.x.upsert.length === 1 && belumMuatUbah.patches.x.upsert[0].name === 'a2'
      && belumMuatUbah.patches.x.removeIds.length === 0
      && Object.keys(belumMuatUbah.full).length === 0,
    belumMuatUbah);

  // Diff tidak bisa dipercaya (baris tanpa id) pada collection yang belum termuat:
  // satu-satunya cara lama adalah mengirim collection penuh, dan itu menghapus
  // baris yang belum terbaca. Jadi perubahan ini TAHAN, bukan ditulis setengah.
  const belumMuatRusak = muat([{ id: 'G-3' }, { name: 'tanpa-id' }], [{ id: 'G-3' }], false);
  ok('15.8 diff tak tepercaya pada collection belum termuat ditahan seluruhnya',
    belumMuatRusak.tertahan.join() === 'x'
      && Object.keys(belumMuatRusak.patches).length === 0
      && Object.keys(belumMuatRusak.full).length === 0,
    belumMuatRusak);

  // Sudah termuat: perilaku lama tetap utuh, termasuk penghapusan dan jalur penuh.
  const sudahMuat = muat([barisA, barisB], [barisA], true);
  const sudahMuatRusak = muat([{ id: 'G-3' }, { name: 'tanpa-id' }], [{ id: 'G-3' }], true);
  ok('15.9 collection sudah termuat boleh memakai patch berisi removeIds dan jalur penuh',
    sudahMuat.patches.x.removeIds.join() === 'G-2' && sudahMuat.tertahan.length === 0
      && Object.keys(sudahMuatRusak.full).join() === 'x'
      && Object.keys(sudahMuatRusak.patches).length === 0,
    { patch: sudahMuat, penuh: Object.keys(sudahMuatRusak.full) });
  ok('15.10 diff membandingkan identitas baris, bukan isi',
    T.diffRows([barisA], [barisA]).upsert.length === 0
      && T.diffRows([barisA], [{ ...barisA }]).upsert.length === 1
      && T.diffRows([barisA], [barisA, barisA]) === null
      && T.rowKey({ id: 0 }) === '0' && T.rowKey({}) === null,
    T.diffRows([barisA], [barisA, barisA]));

  // Peta kebutuhan rute: rute yang angkanya lahir di query tidak boleh meminta
  // array penuh, dan rute yang tidak dikenal harus meminta SEMUANYA (lebih baik
  // memuat berlebih daripada menulis array yang belum pernah dibacakan).
  // `/maintenance` sekarang kosong: halamannya hanya membaca query, dan satu-satunya
  // aksi yang menyapu semua collection (muat data contoh) memanggil ensureLoaded di
  // handler tombolnya — dijaga statis validation §26.
  ok('15.11 peta rute hanya memuat collection yang benar-benar dibaca halamannya',
    T.needsForPath('/warehouse').length === 0
      && T.needsForPath('/dashboard').length === 0
      && T.needsForPath('/sales').includes('units') && T.needsForPath('/sales').includes('kas')
      && T.needsForPath('/maintenance').length === 0
      // Katalog merek/model dibaca penuh oleh dua layar: halamannya sendiri
      // (menyimpan array penuh) dan form Unit (daftar merek + saran kode model).
      && T.needsForPath('/brands').join() === 'brands,models'
      && T.needsForPath('/units').join() === 'brands,models'
      && T.needsForPath('/rute-baru-yang-belum-didaftarkan').length === T.COLLECTION_KEYS.length
      && T.routeKeys().length >= 20 && T.STORAGE_KEY === 'hems_data_store_v1',
    { units: T.needsForPath('/units'), brands: T.needsForPath('/brands'), sales: T.needsForPath('/sales'), maintenance: T.needsForPath('/maintenance'), kunci: T.routeKeys().length });
  const petaSort = [...T.COLLECTION_KEYS].sort().join();
  const fileSort = DB.collectionNames().sort().join();
  ok('15.12 daftar collection peta sama persis dengan tabel yang ada di file',
    petaSort === fileSort && T.COLLECTION_KEYS.length === DB.collectionNames().length,
    { hanyaDiPeta: T.COLLECTION_KEYS.filter(n => !DB.collectionNames().includes(n)),
      hanyaDiFile: DB.collectionNames().filter(n => !T.COLLECTION_KEYS.includes(n)) });

  ok('15.13 file tetap sehat sesudah seluruh percobaan hidrasi dan penjaga tulis',
    DB.integrity().ok === true, DB.integrity().quickCheck);

  console.log(`\n=== db-check: ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

app.whenReady().then(() => {
  try { main(); } catch (err) {
    console.log('HARNESS ERROR', err && err.message, err && err.stack && err.stack.split('\n').slice(0, 4).join(' | '));
    selesai(app, 2);
  }
});
