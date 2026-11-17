// tests/harness/migration-dryrun.cjs
// Kering-run migrasi Fase 3 di atas SALINAN profil pengguna sungguhan.
// Hanya membaca: tidak ada satu pun kunci localStorage yang ditulis, dan hasil
// migrasi tidak pernah disimpan. Fungsinya menjawab "apa yang akan terjadi pada
// data saya saat aplikasi boot".
//
// Jalankan:
//   HEMS_DATA_DIR=D:/SANY/tmp-harness/livecopy node_modules/electron/dist/electron.exe tests/harness/profile-inspect.cjs
//   node tests/harness/migration-dryrun.cjs D:/SANY/tmp-harness/livecopy/localStorage-dump.json

const path = require('path');
const fs = require('fs');
const os = require('os');
const esbuild = require('esbuild');

const dumpPath = process.argv[2];
if (!dumpPath || !fs.existsSync(dumpPath)) {
  console.error('Pakai: node tests/harness/migration-dryrun.cjs <localStorage-dump.json>');
  console.error('Dump dibuat oleh profile-inspect.cjs dari salinan profil, bukan profil asli.');
  process.exit(1);
}

const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));

class MemoryStorage {
  constructor(init) { this.map = new Map(Object.entries(init || {})); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem() { throw new Error('DRY-RUN: tidak boleh menulis localStorage'); }
  removeItem() { throw new Error('DRY-RUN: tidak boleh menghapus localStorage'); }
  clear() { this.map.clear(); }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
}
globalThis.localStorage = new MemoryStorage(dump);

const outfile = path.join(os.tmpdir(), `hems-dryrun-${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'migration.entry.ts')],
  bundle: true, format: 'cjs', platform: 'node', target: 'node18',
  outfile, logLevel: 'error',
});
const M = require(outfile);

const current = JSON.parse(dump['hems_data_store_v1'] || '{}');
const result = M.migrateStore(current);
const report = result.report;

const before = {};
console.log('Isi database saat ini dan sesudah migrasi (hems_data_store_v1):');
for (const name of new Set([...Object.keys(current), ...Object.keys(result.store)])) {
  const b = Array.isArray(current[name]) ? current[name].length : 0;
  const a = Array.isArray(result.store[name]) ? result.store[name].length : 0;
  before[name] = b;
  if (b || a) console.log(`  ${name.padEnd(14)} ${String(b).padStart(4)} -> ${String(a).padStart(4)} baris` +
    (M.SAMPLE_COLLECTIONS[name] ? `   (paket contoh: ${M.SAMPLE_COLLECTIONS[name].length})` : ''));
}

console.log(`\nMarker migrasi : ${M.readMigrationMarker() ? 'SUDAH ADA -> migrasi dilewati' : 'belum ada -> migrasi akan berjalan'}`);
if (M.readMigrationMarker()) process.exit(0);

console.log('\nLaporan yang akan dicetak aplikasi:');
console.log(`  data contoh dibuang : ${JSON.stringify(report.removedSamples)}`);
console.log(`  data warisan diimpor: ${JSON.stringify(report.imported)}`);
console.log(`  invoice dibuat      : ${report.backfilledInvoices}`);
console.log(`  baris warisan terlihat: ${report.legacyRowsSeen}`);

const removedIds = [];
for (const name of Object.keys(before)) {
  const kept = new Set((result.store[name] || []).map(r => r && r.id));
  for (const row of (current[name] || [])) {
    if (row && !kept.has(row.id)) removedIds.push(`${name}/${row.id}${row.name ? ' ' + row.name : ''}${row.model ? ' ' + row.model : ''}`);
  }
}
console.log(`\nBaris yang hilang (hanya data contoh yang tak pernah disentuh):\n  ${removedIds.join('\n  ') || '(tidak ada)'}`);

const newInv = (result.store.invoices || []).filter(i => !new Set((current.invoices || []).map(x => x.id)).has(i.id));
console.log(`\nInvoice baru (${newInv.length}):`);
for (const inv of newInv) {
  console.log(`  ${inv.invoiceNo.padEnd(24)} ${String(inv.status).padEnd(8)} ${inv.totalAmount} dibayar ${inv.paidAmount} — ${inv.customerName}`);
}

console.log('\nKesimpulan: tidak ada satu pun kunci profil yang ditulis oleh kering-run ini.');
process.exit(0);
