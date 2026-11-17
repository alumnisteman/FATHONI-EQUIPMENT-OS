// tests/harness/automation-check.cjs
// Harness UNIT untuk penjaga otomatisasi di electron/automation.ts.
//
//   npm run build:electron && node tests/harness/automation-check.cjs
//
// Tidak membuka Electron dan tidak menyentuh database: ketiga penjaga adalah
// fungsi murni (baris lama + baris baru masuk, pesan penolakan atau null keluar),
// jadi yang diuji di sini adalah aturannya sendiri. Jalur IPC yang benar-benar
// memakai fungsi ini dibuktikan terpisah di otorisasi-check.
//
// Setiap aturan diuji dua arah: kasus yang HARUS ditolak dan kasus yang HARUS
// lolos. Tanpa arah kedua, penjaga yang menolak segalanya akan tampak hijau.

const path = require('path');
const fs = require('fs');

const A = require('../../dist-electron/automation.js');
const SPECS = require('../../dist-electron/dbSchema.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else {
    console.log('FAIL ' + name + (extra !== undefined && extra !== null ? ' -> ' + JSON.stringify(extra) : ''));
    fail++;
  }
}

// ── 1. Nomor dokumen kembar ──────────────────────────────────────────────────
const unitLama = [
  { id: 'U-1', serialNumber: 'SY-001' },
  { id: 'U-2', serialNumber: ' sy-002 ' },
];
const kolomUnit = SPECS.SPEC_BY_NAME.units.duplicates;

ok('1.1 serial baru yang sama dengan baris lama ditolak',
  !!A.dokumenKembarCacat('units', kolomUnit, unitLama, [{ id: 'U-3', serialNumber: 'SY-001' }], []));
ok('1.2 pembandingnya tidak peduli huruf besar/kecil dan spasi tepi',
  !!A.dokumenKembarCacat('units', kolomUnit, unitLama, [{ id: 'U-3', serialNumber: 'SY-002' }], []));
ok('1.3 pesan menyebut collection, nomor, dan baris pemakai',
  (() => {
    const p = A.dokumenKembarCacat('units', kolomUnit, unitLama, [{ id: 'U-3', serialNumber: 'SY-001' }], []);
    return typeof p === 'string' && p.includes('"units"') && p.includes('SY-001') && p.includes('U-1');
  })());
ok('1.4 serial baru yang belum dipakai lolos',
  A.dokumenKembarCacat('units', kolomUnit, unitLama, [{ id: 'U-3', serialNumber: 'SY-003' }], []) === null);
ok('1.5 menyunting baris yang sudah ada tetap lolos (jalur perbaikan)',
  A.dokumenKembarCacat('units', kolomUnit, unitLama, [{ id: 'U-1', serialNumber: 'SY-001' }], []) === null);
ok('1.6 nomor kosong tidak dianggap bentrok',
  A.dokumenKembarCacat('units', kolomUnit, unitLama, [{ id: 'U-3', serialNumber: '' }, { id: 'U-4' }], []) === null);
ok('1.7 dua baris baru dengan nomor sama dalam SATU patch ditolak',
  !!A.dokumenKembarCacat('units', kolomUnit, unitLama,
    [{ id: 'U-3', serialNumber: 'SY-009' }, { id: 'U-4', serialNumber: 'sy-009' }], []));
ok('1.8 nomor milik baris yang dihapus pada patch yang sama boleh dipakai lagi',
  A.dokumenKembarCacat('units', kolomUnit, unitLama, [{ id: 'U-3', serialNumber: 'SY-001' }], ['U-1']) === null);
ok('1.9 collection tanpa kontrak duplicates tidak pernah menolak',
  A.dokumenKembarCacat('customers', undefined, [{ id: 'C-1', name: 'A' }], [{ id: 'C-2', name: 'A' }], []) === null);

// Kontrak skema yang dijadikan dasar penjaga: kalau sebuah collection keluar
// dari daftar `duplicates`, uji ini yang memberi tahu.
const WAJIB_KEMBAR = ['units', 'invoices', 'sales', 'rentals', 'services', 'deliveries',
  'purchases', 'breakdowns', 'operators', 'technicians', 'approvals', 'brands', 'models', 'spareParts'];
const tidakDijaga = WAJIB_KEMBAR.filter(n => {
  const d = SPECS.SPEC_BY_NAME[n]?.duplicates;
  return !Array.isArray(d) || d.length === 0;
});
ok('1.10 semua collection bernomor tetap punya kontrak duplicates', tidakDijaga.length === 0, tidakDijaga);

// ── 2. Satu sumber, satu invoice ────────────────────────────────────────────
const invoiceLama = [
  { id: 'INV-SVC-WO-1', sourceType: 'SERVICE', sourceNumber: 'WO-1' },
  { id: 'INV-MANUAL-1', sourceType: '', sourceNumber: '' },
];
ok('2.1 invoice baru untuk sumber yang sudah ditagih ditolak',
  !!A.invoiceSumberKembarCacat(invoiceLama, [{ id: 'INV-LAIN', sourceType: 'SERVICE', sourceNumber: 'WO-1' }], []));
ok('2.2 pembanding sumber tidak peduli huruf besar/kecil',
  !!A.invoiceSumberKembarCacat(invoiceLama, [{ id: 'INV-LAIN', sourceType: 'service', sourceNumber: 'wo-1' }], []));
ok('2.3 pesan menyebut invoices, sumber, dan baris pemakai',
  (() => {
    const p = A.invoiceSumberKembarCacat(invoiceLama, [{ id: 'INV-LAIN', sourceType: 'SERVICE', sourceNumber: 'WO-1' }], []);
    return typeof p === 'string' && p.includes('"invoices"') && p.includes('WO-1') && p.includes('INV-SVC-WO-1');
  })());
ok('2.4 jenis sumber berbeda dengan nomor sama tetap boleh',
  A.invoiceSumberKembarCacat(invoiceLama, [{ id: 'INV-LAIN', sourceType: 'SALES', sourceNumber: 'WO-1' }], []) === null);
ok('2.5 invoice tanpa sumber (manual) tetap boleh',
  A.invoiceSumberKembarCacat(invoiceLama, [{ id: 'INV-MANUAL-2', sourceType: '', sourceNumber: '' }], []) === null);
ok('2.6 menyunting invoice yang sudah ada tetap lolos',
  A.invoiceSumberKembarCacat(invoiceLama, [{ id: 'INV-SVC-WO-1', sourceType: 'SERVICE', sourceNumber: 'WO-1' }], []) === null);
ok('2.7 sumber yang invoice-nya dihapus pada patch yang sama boleh ditagih lagi',
  A.invoiceSumberKembarCacat(invoiceLama, [{ id: 'INV-BARU', sourceType: 'SERVICE', sourceNumber: 'WO-1' }], ['INV-SVC-WO-1']) === null);

// ── 3. Sewa tumpang tindih ──────────────────────────────────────────────────
const sewaLama = [
  {
    id: 'R-1', contractNo: 'K-1', serialNumber: 'SY-001', status: 'ACTIVE',
    startDate: '2026-10-01', endDate: '2026-10-31',
  },
  { id: 'R-9', contractNo: 'K-9', serialNumber: 'SY-009', status: 'ACTIVE', startDate: '2026-10-01', endDate: '2026-10-31' },
  { id: 'R-8', contractNo: 'K-8', serialNumber: 'SY-001', status: 'CLOSED', startDate: '2026-10-01', endDate: '2026-10-31' },
];
const sewaBaru = (id, over) => [{
  id, contractNo: `K-${id}`, serialNumber: 'SY-001', status: 'ACTIVE',
  startDate: '2026-10-15', endDate: '2026-11-15', ...over,
}];

ok('3.1 kontrak aktif yang beririsan untuk unit yang sama ditolak',
  !!A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2'), []));
ok('3.2 pesan menyebut rentals, serial, dan kontrak pemakai',
  (() => {
    const p = A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2'), []);
    return typeof p === 'string' && p.includes('"rentals"') && p.includes('SY-001') && p.includes('K-1');
  })());
ok('3.3 batas tanggal dihitung inklusif (mulai pada hari terakhir kontrak lama)',
  !!A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2', { startDate: '2026-10-31', endDate: '2026-11-30' }), []));
ok('3.4 kontrak berurutan sehari setelah kontrak lama berakhir lolos',
  A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2', { startDate: '2026-11-01', endDate: '2026-11-30' }), []) === null);
ok('3.5 kontrak sebelum periode lama lolos',
  A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2', { startDate: '2026-09-01', endDate: '2026-09-30' }), []) === null);
ok('3.6 unit lain pada periode yang sama tetap boleh',
  A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2', { serialNumber: 'SY-002' }), []) === null);
ok('3.7 kontrak non-aktif tidak menahan kontrak baru',
  A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2', { serialNumber: 'SY-001', status: 'DRAFT' }), []) === null);
ok('3.8 kontrak tanpa tanggal tidak ditebak',
  A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2', { startDate: '', endDate: '' }), []) === null);
ok('3.9 kontrak tanpa serial tidak ditebak',
  A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2', { serialNumber: '' }), []) === null);
ok('3.10 menyunting kontrak yang sudah ada tetap lolos (jalur perbaikan)',
  A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-1'), []) === null);
ok('3.11 kontrak yang dihapus pada patch yang sama tidak lagi menahan',
  A.sewaTumpangTindihCacat(sewaLama, sewaBaru('R-2'), ['R-1']) === null);
ok('3.12 dua kontrak baru yang saling beririsan dalam SATU patch ditolak',
  !!A.sewaTumpangTindihCacat([], [
    sewaBaru('R-2')[0],
    sewaBaru('R-3', { startDate: '2026-10-20', endDate: '2026-10-25' })[0],
  ], []));

// ── 4. Penjaganya benar-benar terpasang di jalur tulis ──────────────────────
const mainSrc = fs.readFileSync(path.join(__dirname, '../../electron/main.ts'), 'utf8');
const potong = (mulai, akhir) => {
  const a = mainSrc.indexOf(mulai);
  const b = mainSrc.indexOf(akhir, a + 1);
  if (a < 0 || b < 0) throw new Error(`penanda tidak ditemukan: ${mulai} .. ${akhir}`);
  return mainSrc.slice(a, b);
};
const PATCH = potong("trustedHandle('db-patch'", "trustedHandle('db-references'");
const SAVE = potong("trustedHandle('db-save'", "trustedHandle('db-patch'");

ok('4.1 db-patch memanggil ketiga penjaga baru',
  PATCH.includes('dokumenKembarCacat(') && PATCH.includes('invoiceSumberKembarCacat(')
    && PATCH.includes('sewaTumpangTindihCacat('));
ok('4.2 ketiga penjaga menulis DATA_DENY sebelum menolak',
  ['nomor', 'sumber', 'bentrok'].every(variabel => {
    const i = PATCH.indexOf(`if (${variabel}) {`);
    if (i < 0) return false;
    const blok = PATCH.slice(i, i + 300);
    return blok.includes('DATA_DENY') && blok.includes(`return { error: ${variabel}, dilarang: true }`);
  }));
ok('4.3 jalur Restore/migrasi (db-save) tetap tidak dijaga nomor dokumen',
  !SAVE.includes('dokumenKembarCacat(') && !SAVE.includes('invoiceSumberKembarCacat(')
    && !SAVE.includes('sewaTumpangTindihCacat('));
ok('4.4 isi tabel dibaca sekali per collection, bukan sekali per penjaga',
  PATCH.includes('const cacheLama = new Map<string, any[]>()') && PATCH.includes('barisLama(p.name)'));

console.log(`\n=== automation-check: ${pass} lulus, ${fail} gagal ===`);
process.exitCode = fail === 0 ? 0 : 1;
