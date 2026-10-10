// tests/harness/compat-check.cjs
// Harness kompatibilitas Fase 4. Dua keadaan yang dulu membuat aplikasi desktop
// gagal naik kelas diuji dalam satu proses:
//
//   A. profil lama yang di-upgrade di tempat — berkas SQLite tanpa kolom turunan
//      terbaru dan dengan meta revisi lama (persis kondisi komputer pengguna yang
//      memasang build baru di atas data lama). Yang dibuktikan: database sembuh
//      sendiri SEBELUM layar pertama, lalu halaman benar-benar bisa membaca dan
//      menulis kolom yang tadinya tidak ada.
//   B. aplikasi tanpa electronAPI sama sekali (mode browser / build lama) —
//      semua halaman berpaginasi harus jatuh ke array store dan localStorage,
//      bukan crash atau menampilkan halaman kosong.
//
// Jalankan: HEMS_DATA_DIR boleh kosong (harness ini membuat foldernya sendiri
// dan mengisinya sebelum aplikasi dibuka).
//   npx electron tests/harness/compat-check.cjs

const { app, BrowserWindow } = require('electron');
const selesai = require('./selesai.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ── Profil "lama" disiapkan sebelum main.js dibuka ─────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hems-compat-'));
const PARTISI_BROWSER = 'fathoni-compat-browser';
process.env.HEMS_DATA_DIR = dir;
app.setPath('userData', dir);
app.disableHardwareAcceleration();

const Database = require('better-sqlite3');
const DB = require(path.join(__dirname, '../../dist-electron/db.js'));

const seedUnits = [
  { id: 'CMP-U1', serialNumber: 'SKIDBCMP1', brand: 'SANY', model: 'SY215C', year: 2022, status: 'AVAILABLE', purchaseDate: '2026-01-10', hourMeter: 120, purchasePrice: 1500000000 },
  { id: 'CMP-U2', serialNumber: 'SKIDBCMP2', brand: 'SANY', model: 'SY365C', year: 2023, status: 'RENTED', purchaseDate: '2026-02-11', hourMeter: 80, purchasePrice: 2100000000 },
];
const seedParts = [{
  id: 'CMP-P1', name: 'Filter oli warisan', sku: '1R-0716', category: 'FILTER',
  compatibleBrands: 'SANY SY215C', rackLocation: 'RACKLAMA1', stock: 3, minStock: 1,
  unit: 'Pcs', price: 150000, sellingPrice: 200000,
}];

function makeOldProfile() {
  DB.openDatabase(dir);
  DB.saveStore({ units: seedUnits, spareParts: seedParts });
  DB.closeDatabase();
  // Bentuk tabel seperti build sebelumnya: kolom turunan terbaru belum ada dan
  // revisi turunannya masih tua. Indeks harus dibuang lebih dulu karena SQLite
  // menolak DROP COLUMN pada kolom yang diindeks.
  const raw = new Database(path.join(dir, 'fathoni.db'));
  for (const col of ['rackLocation', 'category', 'compatibleBrands']) {
    raw.exec(`DROP INDEX IF EXISTS "ix_spareParts_${col}"`);
    raw.exec(`ALTER TABLE "spareParts" DROP COLUMN "${col}"`);
  }
  raw.prepare(`UPDATE db_meta SET value='0' WHERE key='schema_version'`).run();
  raw.prepare(`UPDATE db_meta SET value='1' WHERE key='derived_revision'`).run();
  raw.close();
}

// ── Bantuan renderer ────────────────────────────────────────────────────────
const HELPERS = `
  function setVal(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function setSelect(el, v) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function byText(re, tag) {
    return [...document.querySelectorAll(tag || 'button')].find(x => re.test(x.innerText));
  }
  function txt(sel) { return ((document.querySelector(sel) || {}).innerText) || ''; }
  function readLocal() {
    return JSON.parse(localStorage.getItem('hems_data_store_v1') || '{"units":[]}');
  }
  function rupiah(s) { const n = String(s).replace(/[^0-9]/g, ''); return n ? Number(n) : 0; }
`;

function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`, true);
}

async function waitFor(wc, expr, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let value = false;
    try { value = await ev(wc, `return !!(${expr});`); } catch { value = false; }
    if (value) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

let captured = null;
const appErrors = [];
function watchErrors(wc, sink) {
  wc.on('console-message', (_e, level, msg) => {
    if (level >= 3 || /uncaught|is not a function|cannot read/i.test(msg)) sink.push(msg.slice(0, 200));
  });
}
app.on('web-contents-created', (_e, wc) => {
  // Jendela mode browser punya daftar error sendiri; keduanya tidak boleh
  // bercampur karena kesimpulannya berbeda.
  const milikBrowser = wc.session && wc.session.partition === PARTISI_BROWSER;
  if (captured && !milikBrowser) watchErrors(wc, appErrors);
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    watchErrors(wc, appErrors);
    wc.once('did-finish-load', () => run(wc).catch(err => {
      console.log('HARNESS ERROR', err && err.message, err && err.stack && err.stack.split('\n').slice(0, 3).join(' | '));
      selesai(app, 2);
    }));
  }
});

async function run(wc) {
  // ══ A. Profil lama di-upgrade di tempat ══════════════════════════════════
  // Database sudah dibuka oleh main.js saat halaman ini selesai dimuat.
  ok('A.1 aplikasi boot di atas profil lama tanpa error renderer',
    appErrors.length === 0, appErrors.slice(0, 3));

  const meta = { revisi: DB.getMeta('derived_revision'), skema: DB.getMeta('schema_version') };
  ok('A.2 kolom turunan dipulangkan sebelum layar pertama',
    Number(meta.revisi) > 1 && meta.skema === '1', meta);

  const kolom = DB.queryCollection({ collection: 'spareParts', where: { rackLocation: 'RACKLAMA1' } });
  ok('A.3 kolom yang dibuang build lama dibuat lagi dan isinya dihitung ulang dari payload',
    kolom.total === 1 && kolom.rows[0].id === 'CMP-P1', kolom);
  const blobLama = DB.queryCollection({ collection: 'spareParts', search: 'RACKLAMA1' });
  ok('A.4 blob pencarian ikut dibangun ulang sehingga rak lama bisa dicari', blobLama.total === 1, blobLama.total);

  const info = await ev(wc, `return await window.electronAPI.dbInfo();`);
  ok('A.5 main process melaporkan versi skema terbaru ke renderer',
    info && info.schemaVersion === 1 && info.collections.length === 18, info);

  // Buka aplikasi lewat-layar-login: akun bawaan wajib ganti password.
  const unlock = await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    const masuk = await window.electronAPI.login('admin', 'admin123');
    if (!masuk.success) return { step: 'login', masuk };
    let user = masuk.user;
    if (user && user.mustChangePassword) {
      const ganti = await window.electronAPI.changePassword(masuk.token, 'admin123', 'BaruSekali12');
      if (!ganti.success) return { step: 'ganti', ganti };
      const sesi = await window.electronAPI.session(masuk.token);
      if (sesi.success && sesi.user) user = sesi.user;
    }
    localStorage.setItem('hems_session_v2', JSON.stringify({ token: masuk.token, user }));
    return { step: 'ok', user };`);
  ok('A.6 login dan validasi sesi berjalan di profil hasil upgrade', unlock.step === 'ok', unlock);
  await wc.reload();
  ok('A.7 aplikasi terbuka (bukan layar login) setelah boot profil upgrade',
    await waitFor(wc, `!/Masuk ke FATHONI/.test(document.body.innerText) && document.body.innerText.length > 40`,
      'aplikasi terbuka', 40000));

  await ev(wc, `window.location.hash = '#/spareparts'; return true;`);
  ok('A.8 halaman Suku Cadang terbuka di profil hasil upgrade',
    await waitFor(wc, `!!document.querySelector('#spareparts-search')`, 'halaman suku cadang', 30000));
  ok('A.9 baris warisan tampil lengkap dengan kategori dan rak hasil perhitungan ulang',
    await waitFor(wc, `/RACKLAMA1/.test(txt('#spareparts-table'))`, 'rak lama tampil', 30000));

  // Tulis lewat UI: dulu ini gagal diam-diam karena CREATE TABLE IF NOT EXISTS
  // tidak menambahkan kolom, sehingga INSERT suku cadang ditolak SQLite.
  await ev(wc, `const b = byText(/Tambah Spare Part/); if (b) b.click(); return !!b;`);
  ok('A.10 form suku cadang terbuka', await waitFor(wc, `!!byText(/Simpan Spare Part/)`, 'form suku cadang', 20000));
  await ev(wc, `
    const byPlace = (re) => [...document.querySelectorAll('.modal input')].find(i => re.test(i.placeholder || ''));
    setVal(byPlace(/6736-51-5142/), 'PN-UPGRADE-1');
    setVal(byPlace(/Fuel Filter Cartridge/), 'Filter Hasil Upgrade');
    setVal(byPlace(/A1-02-04/), 'RACKUPG9');
    setSelect(document.querySelector('.modal select'), 'FILTER');
    const b = byText(/Simpan Spare Part/); if (b) b.click(); return !!b;`);
  ok('A.11 suku cadang baru dengan kolom hasil upgrade masuk ke file',
    await waitFor(wc, `/PN-UPGRADE-1/.test(txt('#spareparts-table'))`, 'baris baru tampil', 30000));
  const tersimpan = DB.queryCollection({ collection: 'spareParts', where: { rackLocation: 'RACKUPG9' } });
  ok('A.12 rak dan kategori tersimpan apa adanya di kolom yang baru dibuat',
    tersimpan.total === 1 && tersimpan.rows[0].category === 'FILTER', tersimpan);

  await ev(wc, `window.location.hash = '#/units'; return true;`);
  ok('A.13 halaman Unit terbuka', await waitFor(wc, `!!document.querySelector('#units-search')`, 'halaman unit', 30000));
  await ev(wc, `setVal(document.querySelector('#units-search'), 'SANY SY215C'); return true;`);
  ok('A.14 pencarian merek+model menemukan unit di profil hasil upgrade',
    await waitFor(wc, `/SKIDBCMP1/.test(txt('#units-grid'))`, 'hasil pencarian unit', 30000));

  // ══ B. Mode browser: tanpa electronAPI sama sekali ═══════════════════════
  // Seed store browser: 15 unit (melebihi satu halaman isi 12) + arus kas.
  const browserSeed = {
    units: Array.from({ length: 15 }, (_x, i) => ({
      id: 'BR-U' + (i + 1),
      serialNumber: 'BRIS' + String(i + 1).padStart(3, '0'),
      brand: i % 3 === 0 ? 'SANY' : 'TADANO',
      model: i % 3 === 0 ? 'SY215C' : 'AD10',
      status: 'AVAILABLE', year: 2021 + (i % 4),
      purchaseDate: '2026-10-0' + ((i % 8) + 1),
      hourMeter: i * 5, purchasePrice: 100000000 + i,
    })),
    spareParts: [{ id: 'BR-P1', name: 'Filter browser', sku: 'BR-SKU-1', stock: 2, minStock: 1, unit: 'Pcs', price: 100000 }],
    kas: [
      { id: 'BR-K1', tanggal: '2026-10-01', keterangan: 'DP Penjualan Uji', kategori: 'PENJUALAN', tipe: 'MASUK', jumlah: 2500000, rekening: 'Kas Tunai', referensi: 'SPK-BR-1' },
      { id: 'BR-K2', tanggal: '2026-10-02', keterangan: 'Beli filter', kategori: 'PEMBELIAN', tipe: 'KELUAR', jumlah: 400000, rekening: 'Kas Tunai', referensi: 'PO-BR-1' },
      { id: 'BR-K3', tanggal: '2026-10-03', keterangan: 'Servis unit', kategori: 'SERVIS', tipe: 'MASUK', jumlah: 750000, rekening: 'Kas Tunai', referensi: 'WO-BR-1' },
    ],
    invoices: [], customers: [], suppliers: [], sales: [], rentals: [], services: [],
    deliveries: [], warehouse: [], purchases: [], documents: [], bankAccounts: [],
    breakdowns: [], operators: [], technicians: [], approvals: [],
  };

  const browserErrors = [];
  const bw = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: {
      partition: PARTISI_BROWSER,
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  const bwc = bw.webContents;
  watchErrors(bwc, browserErrors);

  // Isi profil browser ditanam lewat halaman penanam, bukan lewat evaluate
  // setelah aplikasi berjalan: aplikasi yang baru boot punya store kosong dan
  // autosave-nya 800 ms kemudian menulis ulang kunci store itu, sehingga seed
  // yang dipasang belakangan hilang lagi. Halaman penanam memakai origin
  // file:// yang sama, jadi localStorage-nya sama dan aplikasi membacanya
  // SEBELUM kode aplikasi sempat menulis apa pun.
  const seedPage = path.join(dir, 'compat-seed.html');
  fs.writeFileSync(seedPage, '<!doctype html><meta charset="utf-8"><title>seed</title><body>menanam…<script>'
    + `localStorage.setItem('hems_data_store_v1', ${JSON.stringify(JSON.stringify(browserSeed))});`
    + `localStorage.setItem('hems_data_migration_v1', JSON.stringify({ at: '2026-10-09T00:00:00.000Z', removedSamples: {}, imported: {}, backfilledInvoices: 0, legacyRowsSeen: 0 }));`
    + `localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));`
    + `localStorage.removeItem('hems_session_v2');`
    + 'document.title = "seeded";</script>');
  await bwc.loadFile(seedPage);
  await bwc.loadFile(path.join(__dirname, '../../dist/index.html'));
  ok('B.1 jendela tanpa preload benar-benar tidak punya electronAPI',
    (await ev(bwc, `return typeof window.electronAPI;`)) === 'undefined');

  ok('B.2 halaman login ter-render tanpa database desktop',
    await waitFor(bwc, `!!document.querySelector('#login-username')`, 'form login browser', 30000));
  const petunjuk = await ev(bwc, `return txt('.login-demo');`);
  ok('B.3 mode demo ditandai dengan jelas', /Mode demo browser/i.test(petunjuk), petunjuk.slice(0, 120));

  await ev(bwc, `
    setVal(document.querySelector('#login-username'), 'admin');
    setVal(document.querySelector('#login-password'), 'apaadanya');
    const b = byText(/Masuk ke FATHONI/); if (b) b.click(); return !!b;`);
  ok('B.4 login demo tanpa main process membuka aplikasi',
    await waitFor(bwc, `!/Masuk ke FATHONI/.test(document.body.innerText) && document.body.innerText.length > 40`,
      'dashboard browser', 30000));

  await ev(bwc, `window.location.hash = '#/units'; return true;`);
  ok('B.5 halaman Unit terbuka tanpa electronAPI',
    await waitFor(bwc, `!!document.querySelector('#units-search')`, 'halaman unit browser', 30000));
  ok('B.6 halaman membaca array store (jalur cadangan), bukan SQLite',
    await waitFor(bwc, `/dari 15 record/.test(txt('#pager-info')) && document.querySelectorAll('#units-grid .card').length === 12`,
      'halaman 1 terisi 12 kartu dari 15 record', 30000));

  const pindah = await ev(bwc, `
    const b = document.querySelector('#pager-next');
    if (b && !b.disabled) b.click();
    return b ? { ada: true, disabled: b.disabled, teks: b.innerText.trim() } : { ada: false };`);
  ok('B.7 pindah halaman memotong array store dengan batas yang sama',
    await waitFor(bwc, `document.querySelectorAll('#units-grid .card').length === 3`, 'halaman 2 terisi 3 kartu', 20000),
    pindah);

  await ev(bwc, `setVal(document.querySelector('#units-search'), 'SANY SY215C'); return true;`);
  ok('B.8 pencarian di mode browser memakai aturan yang sama dengan SQL',
    await waitFor(bwc, `/dari 5 record/.test(txt('#pager-info'))`, 'hasil pencarian browser', 20000));
  await ev(bwc, `setVal(document.querySelector('#units-search'), ''); return true;`);
  await waitFor(bwc, `/dari 15 record/.test(txt('#pager-info'))`, 'pencarian dibersihkan', 20000);

  await ev(bwc, `window.location.hash = '#/finance'; return true;`);
  ok('B.9 halaman Kas terbuka', await waitFor(bwc, `!!document.querySelector('#finance-search')`, 'halaman kas browser', 30000));
  const kas = await ev(bwc, `
    const cards = [...document.querySelectorAll('.stat-card')].map(c => ({ judul: ((c.querySelector('.card-title') || {}).innerText) || '', nilai: rupiah((c.querySelector('.card-value') || {}).innerText) }));
    const masuk = cards.find(c => /Kas Masuk/i.test(c.judul));
    const keluar = cards.find(c => /Kas Keluar/i.test(c.judul));
    const baris = document.querySelectorAll('#finance-table tbody tr').length;
    return { masuk: masuk && masuk.nilai, keluar: keluar && keluar.nilai, baris };`);
  ok('B.10 total dihitung dari array store saat SQLite tidak ada',
    kas.masuk === 3250000 && kas.keluar === 400000 && kas.baris === 3, kas);

  await ev(bwc, `window.location.hash = '#/spareparts'; return true;`);
  ok('B.11 form suku cadang terbuka di mode browser',
    await waitFor(bwc, `!!document.querySelector('#spareparts-search')`, 'halaman suku cadang browser', 30000));
  await ev(bwc, `const b = byText(/Tambah Spare Part/); if (b) b.click(); return !!b;`);
  await waitFor(bwc, `!!byText(/Simpan Spare Part/)`, 'form tambah suku cadang', 20000);
  await ev(bwc, `
    const byPlace = (re) => [...document.querySelectorAll('.modal input')].find(i => re.test(i.placeholder || ''));
    setVal(byPlace(/6736-51-5142/), 'BR-BARU-1');
    setVal(byPlace(/Fuel Filter Cartridge/), 'Filter Browser');
    setVal(byPlace(/A1-02-04/), 'RACKBR1');
    const b = byText(/Simpan Spare Part/); if (b) b.click(); return !!b;`);
  ok('B.12 penulisan di mode browser masuk ke localStorage dan langsung tampil',
    await waitFor(bwc, `/BR-BARU-1/.test(txt('#spareparts-table'))`, 'baris baru di tabel browser', 30000));
  const diLocal = await ev(bwc, `
    const s = readLocal();
    const p = (s.spareParts || []).find(x => x.sku === 'BR-BARU-1');
    return { jumlah: (s.spareParts || []).length, rak: p && p.rackLocation, nama: p && p.name };`);
  ok('B.13 hasil tulis tersimpan utuh di penyimpanan browser',
    diLocal.jumlah === 2 && diLocal.rak === 'RACKBR1' && diLocal.nama === 'Filter Browser', diLocal);

  await ev(bwc, `window.location.hash = '#/backup'; return true;`);
  await wait(1200);
  const cadangan = await ev(bwc, `return { teks: document.body.innerText.slice(0, 400), adaAkar: document.getElementById('root').children.length > 0 };`);
  ok('B.14 halaman Backup & Restore tidak crashed tanpa desktop',
    cadangan.adaAkar === true && !/Minified React error|Unhandled/i.test(cadangan.teks), cadangan.teks.slice(0, 160));

  ok('B.15 tidak ada error renderer di mode browser', browserErrors.length === 0, browserErrors.slice(0, 3));
  ok('A.15 tidak ada error renderer di profil hasil upgrade', appErrors.length === 0, appErrors.slice(0, 3));

  bw.destroy();
  console.log(`\n=== compat-check: ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

makeOldProfile();
require('../../dist-electron/main.js');
