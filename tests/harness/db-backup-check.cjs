// tests/harness/db-backup-check.cjs
// Harness Fase 4 untuk cadangan berbasis BERKAS SQLite. Dijalankan berurutan oleh
// db-backup-run.cjs di satu folder data sementara (HEMS_DATA_DIR wajib — tanpa it
// harness ini akan membuka dan menulis profil pengguna sungguhan):
//
//   seed      -> tanam database lama di localStorage, lalu matikan aplikasi
//   snapshots -> uji lapisan berkas: checksum, settings, penolakan key terlarang,
//                restore + quick_check, penolakan snapshot rusak, rotasi
//   page      -> uji halaman Backup & Restore lewat IPC sungguhan: ekspor .sanybak
//                berisi data LIVE (bukan arsip), restore tidak menimpa arsip,
//                snapshot dibuat/dipulihkan dari tombol di layar
//
// Harness ini memuat dist-electron/main.js yang asli, jadi preload, IPC, handshake
// flush, dan dialog simpan/buka semuanya ikut terpakai.
const { app, dialog } = require('electron');
const selesai = require('./selesai.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const esbuild = require('esbuild');

const PHASE = process.env.HEMS_HARNESS_PHASE;
const DATA_DIR = path.resolve(process.env.HEMS_DATA_DIR || '');
const STATE_FILE = path.join(DATA_DIR, 'harness-state.json');
const SNAP_ROOT = path.join(DATA_DIR, 'snapshots');
const EXPORT_FILE = path.join(DATA_DIR, 'export-uji.sanybak');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); fail++; }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Jendela Eksekusi IPC yang tidak pernah selesai membuat harness diam total
 *  sampai batas waktu proses habis, dan itu tidak mengatakan apa-apa. Setiap
 *  panggilan dibatasi supaya macet dilaporkan dengan nama tindakannya. */
function withWatchdog(promise, label, ms = 30000) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`macet ${ms} ms di: ${label}`)), ms);
    }),
  ]);
}

const HELPERS = `
  function setVal(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function byText(re, tag) {
    return [...document.querySelectorAll(tag || 'button')].find(x => re.test(x.innerText));
  }
`;
function ev(wc, body, label = 'ev', ms = 45000) {
  return withWatchdog(
    wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`),
    label,
    ms
  );
}
/** Baca lewat IPC yang tahan saat halaman sedang dimuat ulang (konteks eksekusi
 *  ikut hancur di tengah polling) — coba lagi sampai halaman hidup lagi. */
async function evSafe(wc, body, tries = 40) {
  let terakhir;
  for (let i = 0; i < tries; i++) {
    try { return await ev(wc, body, 'evSafe', 15000); } catch (err) { terakhir = err; await wait(300); }
  }
  console.log('EVSAFE menyerah setelah ' + tries + ' percobaan -> ' + (terakhir && terakhir.message));
  return null;
}
const mark = label => console.log('MARK ' + label);
async function waitFor(wc, expr, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evSafe(wc, `return !!(${expr});`, 3);
    if (value) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

/** Stub dialog JS. confirm() asli membekukan thread renderer sampai ada yang
 *  menekan tombolnya, dan executeJavaScript tidak pernah kembali — jadi stub
 *  dipasang lagi tepat sebelum setiap klik, bukan hanya sekali di awal. */
const stubDialogs = wc => ev(wc, `
  window.confirm = () => true;
  window.alert = (m) => { window.__lastAlert = String(m); };
  return true;`, 'stub dialog');

async function clickWhenReady(wc, selector, label, timeoutMs = 60000) {
  const q = JSON.stringify(selector);
  const siap = await waitFor(wc, `!!document.querySelector(${q}) && !document.querySelector(${q}).disabled`, `${label} siap`, timeoutMs);
  if (!siap) return false;
  await stubDialogs(wc);
  // Klik ditunda ke task berikutnya: handler halaman sendiri yang menunggu, jadi
  // harness tetap bisa mencetak hasilnya walau renderer kemudian macet.
  await ev(wc, `setTimeout(() => document.querySelector(${q})?.click(), 0); return true;`, `klik ${selector}`);
  return true;
}

const logText = wc => evSafe(wc, `return document.querySelector('#backup-log')?.innerText || '';`);

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(patch) {
  const next = Object.assign(readState(), patch);
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

// ── Berkas snapshot dilihat dari sisi disk juga ─────────────────────────────
const snapMeta = name => {
  try { return JSON.parse(fs.readFileSync(path.join(SNAP_ROOT, name, 'meta.json'), 'utf8')); } catch { return null; }
};
const snapSettings = name => {
  try { return JSON.parse(fs.readFileSync(path.join(SNAP_ROOT, name, 'settings.json'), 'utf8')); } catch { return null; }
};
const sha1 = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
const snapDbFile = name => path.join(SNAP_ROOT, name, 'fathoni.db');
const dirNames = () => {
  try { return fs.readdirSync(SNAP_ROOT); } catch { return []; }
};
const countsOf = stats => {
  const out = {};
  ((stats && stats.perCollection) || []).forEach(c => { out[c.name] = c.rows; });
  return out;
};

// ── Seed: data lama bentuk localStorage ─────────────────────────────────────
// customers dan kas sengaja berisi baris: simpanan sebagian (autosave hanya
// mengirim collection yang berubah) tidak boleh menganggap key yang tidak
// dikirim sebagai "kosong" dan menghapus collection lain satu file.
function buildSeed() {
  const outfile = path.join(os.tmpdir(), `hems-backupseed-entry-${process.pid}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'migration.entry.ts')],
    bundle: true, format: 'cjs', platform: 'node', target: 'node18',
    outfile, logLevel: 'error',
  });
  const M = require(outfile);
  const sampleUnit = JSON.parse(JSON.stringify(M.SAMPLE_COLLECTIONS.units[0]));
  return {
    untouchedId: String(sampleUnit.id),
    seed: {
      units: [
        sampleUnit,
        { ...JSON.parse(JSON.stringify(sampleUnit)), id: 'U-EDITED-01', serialNumber: 'FATHONI-EDIT-001', hourMeter: 987654 },
        { id: 'U-REAL-01', serialNumber: 'FATHONI-REAL-001', brand: 'SANY', model: 'SY215C', category: 'Excavator', status: 'AVAILABLE', hourMeter: 1234 },
      ],
      customers: [
        { id: 'C-BK-1', name: 'PT Kontraktor Alpha', phone: '081200000001', segment: 'KONTRAKTOR' },
        { id: 'C-BK-2', name: 'PT Tambang Beta', phone: '081200000002', segment: 'TAMBANG' },
      ],
      kas: [
        { id: 'K-BK-1', tanggal: '2026-10-01', tipe: 'MASUK', kategori: 'Penjualan', jumlah: 1500000 },
        { id: 'K-BK-2', tanggal: '2026-10-02', tipe: 'KELUAR', kategori: 'Servis', jumlah: 250000 },
      ],
      sales: [], rentals: [], services: [], invoices: [],
    },
    legacyUnits: [{ id: 'OLD-1', serialNumber: 'FATHONI-LEGACY-9', brand: 'Komatsu', model: 'PC200-8', status: 'AVAILABLE', hourMeter: 5 }],
  };
}

async function openWithSession(wc, password) {
  await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    localStorage.removeItem('hems_session');
    return true;`);
  const login = await ev(wc, `return await window.electronAPI.login('admin', ${JSON.stringify(password)});`);
  if (!login || login.success !== true) return { login };
  await ev(wc, `
    localStorage.setItem('hems_session_v2', JSON.stringify({ token: ${JSON.stringify(login.token)}, user: ${JSON.stringify(login.user)} }));
    return true;`);
  await wc.reload();
  const up = await waitFor(wc, `!/Masuk ke FATHONI/.test(document.body.innerText) && document.body.innerText.length > 60`, 'aplikasi terbuka', 40000);
  await stubDialogs(wc);
  return { login, up, mustChange: login.user && login.user.mustChangePassword === true };
}

async function loginAndOpenApp(wc) {
  const first = await openWithSession(wc, 'admin123');
  ok('login akun default berhasil', first.login && first.login.success === true, first.login);
  const changed = await ev(wc, `return await window.electronAPI.changePassword(${JSON.stringify(first.login.token)}, 'admin123', 'BaruCadangan12');`);
  ok('password default bisa diganti', changed && changed.success === true, changed);
  const second = await openWithSession(wc, 'BaruCadangan12');
  ok('aplikasi terbuka untuk halaman backup', second.login && second.login.success === true && second.up === true, second);
  return second.up === true;
}

// Tambah satu unit langsung lewat IPC: harness menguji lapisan cadangan, dan
// store di renderer tidak ikut berubah (tidak ada collection dirty) sehingga
// tidak ada autosave yang menimpa tulisan harness.
async function addUnitRow(wc, id, serial) {
  await ev(wc, `
    const s = await window.electronAPI.dbLoad();
    const units = (s.units || []).concat([{ id: ${JSON.stringify(id)}, serialNumber: ${JSON.stringify(serial)}, brand: 'SANY', model: 'SY215C', category: 'Excavator', status: 'AVAILABLE', hourMeter: 7 }]);
    return await window.electronAPI.dbSave({ units });`);
  const serials = (await ev(wc, `return await window.electronAPI.dbLoad();`)).units.map(u => u.serialNumber);
  return serials;
}

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev2, _lvl, msg) => {
    if (/error|uncaught|failed/i.test(msg)) console.log('RENDERER:', msg.slice(0, 300));
  });
  // confirm() dan alert() asli membekukan renderer sampai ada manusia yang
  // menekan tombol, dan setiap reload membuang stub yang dipasang di run().
  // Dipasang lagi setiap halaman selesai dimuat supaya tidak ada fase yang
  // menggantung diam sampai batas waktu proses habis.
  wc.on('did-finish-load', () => {
    stubDialogs(wc).catch(err => console.log('MARK stub dialog gagal: ' + err.message));
  });
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    wc.once('did-finish-load', () => run(wc).catch(async err => {
      console.log('HARNESS ERROR', err && (err.stack || err.message));
      try { console.log('DOM:', JSON.stringify((await ev(wc, 'return document.body.innerText.slice(0,300);')))); } catch { /* abaikan */ }
      selesai(app, 2);
    }));
  }
});

async function run(wc) {
  if (!DATA_DIR || !fs.existsSync(DATA_DIR)) {
    console.log('HARNESS ERROR: HEMS_DATA_DIR wajib pointing ke folder sementara yang ada');
    selesai(app, 3);
    return;
  }
  await wait(400);
  await stubDialogs(wc);

  if (PHASE === 'seed') return phaseSeed(wc);
  if (PHASE === 'snapshots') return phaseSnapshots(wc);
  if (PHASE === 'page') return phasePage(wc);
  console.log('HARNESS ERROR: fase tidak dikenal -> ' + PHASE);
  selesai(app, 3);
}

// ── Fase 1: tanam database lama ─────────────────────────────────────────────
async function phaseSeed(wc) {
  const { seed, legacyUnits, untouchedId } = buildSeed();
  const raw = JSON.stringify(seed);
  await ev(wc, `
    localStorage.setItem('hems_data_store_v1', ${JSON.stringify(raw)});
    localStorage.setItem('HEMS_UNITS', ${JSON.stringify(JSON.stringify(legacyUnits))});
    localStorage.setItem('HEMS_DATA_BACKUPS', ${JSON.stringify(JSON.stringify([{ lama: true }]))});
    localStorage.setItem('hems_settings', JSON.stringify({ company: { name: 'PT Uji Cadangan' } }));
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    localStorage.removeItem('hems_data_migration_v1');
    return true;`);
  writeState({ seedRaw: raw, untouchedId, settingsAwal: JSON.stringify({ company: { name: 'PT Uji Cadangan' } }) });

  ok('seed localStorage tertulis', (await ev(wc, `return localStorage.getItem('hems_data_store_v1');`)) === raw);
  await wait(1200);
  console.log('SEED-DONE');
  app.quit();
  setTimeout(() => selesai(app, 0), 6000);
}

// ── Fase 2: lapisan berkas snapshot ─────────────────────────────────────────
async function phaseSnapshots(wc) {
  const state = readState();

  const ready = await waitFor(wc, `(await window.electronAPI.dbLoad()).units.length >= 3`, 'impor localStorage selesai', 40000);
  ok('impor selesai sebelum snapshot dibuat', ready);

  const counts = countsOf(await ev(wc, `return await window.electronAPI.dbStats();`));
  ok('pelanggan dan kas ikut termigrasi ke SQLite', counts.customers === 2 && counts.kas === 2, counts);

  const serials = await addUnitRow(wc, 'U-BK-A1', 'FATHONI-BK-A1');
  ok('baris uji masuk ke database', serials.includes('FATHONI-BK-A1'), serials);

  // Inilah bentuk nyata autosave renderer: hanya collection yang berubah dikirim.
  // Kalau key yang tidak dikirim dianggap kosong, satu simpanan unit akan
  // menghapus seluruh pelanggan dan kas dari file.
  const partial = await ev(wc, `return await window.electronAPI.dbSave({ units: (await window.electronAPI.dbLoad()).units });`);
  const sesudahPartial = countsOf(await ev(wc, `return await window.electronAPI.dbStats();`));
  ok('simpan sebagian hanya membalas collection yang dikirim', Object.keys(partial).join() === 'units', Object.keys(partial));
  ok('simpan sebagian membiarkan collection lain utuh',
    sesudahPartial.customers === counts.customers
      && sesudahPartial.kas === counts.kas
      && sesudahPartial.units === counts.units + 1, { counts, sesudahPartial });

  // ── buat snapshot ──
  const created = await ev(wc, `
    return await window.electronAPI.dbSnapshotCreate({
      reason: 'manual',
      settings: {
        'hems_settings': localStorage.getItem('hems_settings'),
        'hems_business_modes': localStorage.getItem('hems_business_modes'),
      },
    });`);
  ok('snapshot dibuat lewat IPC', created.ok === true, created);
  const name = created.snapshot && created.snapshot.name;
  ok('nama snapshot berpola aman', /^\d{8}T\d{6}-manual(-\d{1,3})?$/.test(String(name)), name);
  ok('checksum sha1 tercatat', /^[0-9a-f]{40}$/.test(String(created.snapshot && created.snapshot.checksum)), created.snapshot);
  ok('ukuran berkas snapshot tercatat', created.snapshot.bytes > 0, created.snapshot.bytes);
  const totalRows = (await ev(wc, `return await window.electronAPI.dbStats();`)).totalRows;
  ok('jumlah baris snapshot sama dengan database', created.snapshot.totalRows === totalRows, { snapshot: created.snapshot.totalRows, db: totalRows });

  const meta = snapMeta(name);
  ok('meta.json tertulis di disk', meta && meta.name === name, meta);
  ok('berkas database snapshot ada di disk', fs.existsSync(snapDbFile(name)));
  ok('sha1 berkas sama dengan meta', fs.existsSync(snapDbFile(name)) && sha1(snapDbFile(name)) === meta.checksum, { disk: sha1(snapDbFile(name)), meta: meta && meta.checksum });
  ok('berkas snapshot adalah database SQLite sungguhan',
    fs.readFileSync(snapDbFile(name)).slice(0, 15).toString() === 'SQLite format 3', undefined);
  ok('snapshot berdiri sendiri tanpa -wal', !fs.existsSync(snapDbFile(name) + '-wal'));

  const settings = snapSettings(name);
  ok('settings ikut tersimpan di snapshot', !!(settings && settings.hems_settings && settings.hems_business_modes), settings);
  ok('isi database TIDAK diselundupkan sebagai settings', settings && !('hems_data_store_v1' in settings), settings && Object.keys(settings));

  // ── penolakan ──
  const rejectStore = await ev(wc, `return await window.electronAPI.dbSnapshotCreate({ reason:'manual', settings:{ 'hems_data_store_v1': '{}' } });`);
  ok('snapshot menolak arsip hems_data_store_v1', rejectStore.ok === false && /tidak boleh ikut cadangan/.test(String(rejectStore.error)), rejectStore);
  const rejectSession = await ev(wc, `return await window.electronAPI.dbSnapshotCreate({ reason:'manual', settings:{ 'hems_session_v2': '{}' } });`);
  ok('snapshot menolak key sesi', rejectSession.ok === false, rejectSession);
  const rejectJunk = await ev(wc, `return await window.electronAPI.dbSnapshotCreate({ reason:'manual', settings:{ 'hems_settings': 'bukan json' } });`);
  ok('snapshot menolak nilai yang bukan JSON', rejectJunk.ok === false, rejectJunk);
  ok('snapshot ditolak tidak meninggalkan folder', dirNames().filter(n => n === name).length === 1, dirNames());

  const evil = await ev(wc, `return await window.electronAPI.dbSnapshotRestore('../../evil', {});`);
  ok('restore menolak nama di luar folder snapshot', evil.ok === false && /tidak dikenali/.test(String(evil.error)), evil);
  ok('tidak ada berkas yang terbentuk di luar folder', !fs.existsSync(path.resolve(SNAP_ROOT, '../../evil.db')));
  const unknown = await ev(wc, `return await window.electronAPI.dbSnapshotRestore('20200101T000000-manual', {});`);
  ok('restore menolak snapshot yang tidak ada', unknown.ok === false, unknown);

  // ── restore: keadaan kembali + settings ikut + snapshot pengaman ──
  const before = await ev(wc, `return localStorage.getItem('hems_settings');`);
  await addUnitRow(wc, 'U-BK-B2', 'FATHONI-BK-B2');
  await ev(wc, `localStorage.setItem('hems_settings', JSON.stringify({ company: { name: 'PT Sesudah Restore' } })); return true;`);

  const restored = await ev(wc, `
    return await window.electronAPI.dbSnapshotRestore(${JSON.stringify(name)}, { 'hems_settings': ${JSON.stringify(before)} });`);
  ok('restore snapshot berhasil', restored.ok === true, restored);
  ok('quick_check pasca restore bersih', String(restored.quickCheck || '') === 'ok', restored.quickCheck);
  ok('settings dari snapshot ikut kembali',
    restored.settings && JSON.parse(restored.settings.hems_settings).company.name === 'PT Uji Cadangan', restored.settings);

  const afterUnits = (await ev(wc, `return await window.electronAPI.dbLoad();`)).units.map(u => u.serialNumber);
  ok('perubahan sesudah snapshot hilang lagi', afterUnits.includes('FATHONI-BK-A1') && !afterUnits.includes('FATHONI-BK-B2'), afterUnits);
  const countsRestore = countsOf(await ev(wc, `return await window.electronAPI.dbStats();`));
  ok('collection lain ikut kembali dari snapshot',
    countsRestore.customers === 2 && countsRestore.kas === 2, countsRestore);
  const list = await ev(wc, `return (await window.electronAPI.dbSnapshotList()).snapshots;`);
  ok('snapshot pengaman pra-restore tercatat', list.some(s => s.reason === 'pra-restore'), list.map(s => s.reason));
  ok('arsip localStorage tidak tersentuh restore',
    (await ev(wc, `return localStorage.getItem('hems_data_store_v1');`)) === state.seedRaw);

  const rawAfterRestore = await ev(wc, `return await window.electronAPI.dbIntegrity();`);
  ok('database hasil restore lolos quick_check', rawAfterRestore && rawAfterRestore.ok === true, rawAfterRestore && rawAfterRestore.quickCheck);

  // ── snapshot rusak ditolak, database tidak berubah ──
  const victim = await ev(wc, `return await window.electronAPI.dbSnapshotCreate({ reason:'auto', settings:{} });`);
  ok('snapshot beralasan auto diterima', victim.ok === true, victim);
  ok('alasan auto tercatat di meta', snapMeta(victim.snapshot.name).reason === 'auto', snapMeta(victim.snapshot.name));
  fs.writeFileSync(snapDbFile(victim.snapshot.name), Buffer.concat([
    fs.readFileSync(snapDbFile(victim.snapshot.name)).slice(0, 4096),
    Buffer.from('KERUSAKKAN'),
  ]));
  const refused = await ev(wc, `return await window.electronAPI.dbSnapshotRestore(${JSON.stringify(victim.snapshot.name)}, {});`);
  ok('restore menolak snapshot dengan checksum tidak cocok',
    refused.ok === false && /checksum/i.test(String(refused.error)), refused);
  ok('snapshot rusak tidak mengubah database hidup',
    (await ev(wc, `return await window.electronAPI.dbLoad();`)).units.map(u => u.serialNumber).includes('FATHONI-BK-A1'));

  // ── rotasi ──
  await wait(1100);
  let last = null;
  for (let i = 0; i < 9; i++) {
    last = await ev(wc, `return await window.electronAPI.dbSnapshotCreate({ reason:'manual', settings:{} });`);
  }
  const afterRotation = await ev(wc, `return (await window.electronAPI.dbSnapshotList()).snapshots;`);
  ok('rotasi membatasi jumlah snapshot', afterRotation.length === 7, afterRotation.length);
  ok('folder di disk ikut dibersihkan', dirNames().length === 7, dirNames());
  ok('snapshot paling baru dipertahankan',
    afterRotation.length > 0 && afterRotation[0].name === last.snapshot.name, { pertama: afterRotation[0] && afterRotation[0].name, terakhir: last.snapshot.name });
  ok('snapshot paling tua yang dibuang', !afterRotation.some(s => s.name === name), afterRotation.map(s => s.name));

  writeState({ rotationTerakhir: last.snapshot.name });
  console.log(`\n=== fase snapshots: ${pass} lulus, ${fail} gagal ===`);
  app.quit();
  setTimeout(() => { console.log('FAIL quit fase snapshots tertahan'); selesai(app, 4); }, 8000);
}

// ── Fase 3: halaman Backup & Restore lewat dialog asli ──────────────────────
async function phasePage(wc) {
  const state = readState();

  const ready = await waitFor(wc, `(await window.electronAPI.dbLoad()).units.length >= 3`, 'database terbaca saat boot', 40000);
  ok('boot membaca file database hasil fase sebelumnya', ready);

  // Dialog dipasangi jalur keluar/masuk yang ditentukan harness supaya halaman
  // bisa dipakai tanpa interaksi manusia.
  let openQueue = [];
  dialog.showSaveDialog = async (_w, opts) => ({ canceled: false, filePath: EXPORT_FILE });
  dialog.showOpenDialog = async () => (openQueue.length ? { canceled: false, filePaths: [openQueue.shift()] } : { canceled: true });

  ok('aplikasi terbuka untuk akun login', await loginAndOpenApp(wc));
  mark('login + boot aplikasi selesai');

  // Baris yang HANYA ada di SQLite: inilah pembeda data live vs arsip lama.
  const serials = await addUnitRow(wc, 'U-PAGE-1', 'FATHONI-PAGE-1');
  ok('baris live masuk ke database', serials.includes('FATHONI-PAGE-1'), serials);

  await ev(wc, `window.location.hash = '#/backup'; return true;`);
  const pageUp = await waitFor(wc, `/Backup & Restore/.test(document.body.innerText) && !!document.querySelector('#btn-backup')`, 'halaman Backup', 40000);
  ok('halaman Backup & Restore termuat', pageUp);

  const body = await ev(wc, `return document.body.innerText;`);
  // Kartu ini bersyarat (hanya di desktop), jadi dicari lewat id-nya: innerText
  // halaman panjang dan mudah terpotong saat dibaca terlalu cepat.
  const cardAda = await waitFor(wc, `!!document.querySelector('#snapshot-card')`, 'kartu snapshot', 40000);
  // innerText memakai text-transform CSS, jadi judul .card-title bisa terbaca
  // seluruhnya kapital — pencocokan tidak boleh peka huruf.
  ok('kartu snapshot berkas tampil', cardAda && /snapshot database lokal/i.test(
    (await ev(wc, `return document.querySelector('#snapshot-card')?.innerText || '';`))));
  ok('penggunaan storage melaporkan file database', /tanpa batas tetap|file database/.test(body), (body.match(/.*storage.*/i) || [''])[0]);
  ok('arsip lama tidak diminta sebagai sumber data', !/HEMS_DATA_BACKUPS/.test(body));

  // ── tombol snapshot ──
  ok('tombol snapshot dapat diklik', await clickWhenReady(wc, '#btn-snapshot', 'tombol snapshot'));
  const snapLogged = await waitFor(wc, `/Snapshot \\d{8}T\\d{6}-manual/.test(document.body.innerText)`, 'log snapshot dibuat', 60000);
  ok('tombol membuat snapshot berkas', snapLogged);
  const rowsListed = await ev(wc, `return document.querySelector('#snapshot-list')?.innerText || '';`);
  ok('daftar snapshot menampilkan baris + ukuran + checksum', /baris/.test(rowsListed) && /MB|KB/.test(rowsListed) && /sha1/.test(rowsListed), rowsListed.slice(0, 200));
  ok('tombol pulihkan tersedia per snapshot', !!(await ev(wc, `return !!document.querySelector('#btn-snapshot-restore');`)));

  // ── ekspor .sanybak dari data live ──
  ok('tombol backup dapat diklik', await clickWhenReady(wc, '#btn-backup', 'tombol backup'));
  const exported = await waitFor(wc,
    `/Backup berhasil disimpan/.test(document.querySelector('#backup-log')?.innerText || '')`, 'ekspor selesai', 90000);
  ok('ekspor backup selesai', exported, { log: String(await logText(wc)).slice(-500) });
  ok('file ekspor tertulis di disk', fs.existsSync(EXPORT_FILE));

  const parsed = fs.existsSync(EXPORT_FILE) ? JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8')) : {};
  const store = (parsed.data || {})['hems_data_store_v1'] || {};
  const unitSerials = (store.units || []).map(u => String(u.serialNumber || ''));
  ok('ekspor mengambil database dari SQLite (baris live ikut)', unitSerials.includes('FATHONI-PAGE-1'), unitSerials);
  ok('ekspor mencatat sumber sqlite', parsed._meta && parsed._meta.source === 'sqlite', parsed._meta);
  ok('ekspor tidak berisi arsip beku',
    !('HEMS_DATA_BACKUPS' in (parsed.data || {})) && !('HEMS_UNITS' in (parsed.data || {})), Object.keys(parsed.data || {}));
  ok('ekspor tidak berisi key sesi', !('hems_session_v2' in (parsed.data || {})) && !('hems_session' in (parsed.data || {})));
  ok('ekspor punya versi skema', parsed._meta && typeof parsed._meta.version === 'string', parsed._meta && parsed._meta.version);
  ok('ekspor menyertakan settings', !!(parsed.data || {})['hems_settings'], undefined);
  ok('ekspor membawa collection lain dari SQLite',
    (store.customers || []).length === 2 && (store.kas || []).length === 2,
    { customers: (store.customers || []).length, kas: (store.kas || []).length });

  // ── restore dari file ekspor: arsip tidak boleh ditimpa ──
  mark('restore dari file: menanam baris pasca-ekspor');
  await addUnitRow(wc, 'U-PAGE-2', 'FATHONI-PAGE-2');
  mark('baris pasca-ekspor masuk, menyiapkan dialog buka file');
  openQueue = [EXPORT_FILE];
  ok('tombol restore dapat diklik', await clickWhenReady(wc, '#btn-restore', 'tombol restore'));
  mark('tombol restore diklik, menunggu tulisan log restore');
  const restoredLog = await waitFor(wc,
    `/Database SQLite sudah berisi data hasil restore/.test(document.querySelector('#backup-log')?.innerText || '')`,
    'restore file selesai', 90000);
  ok('restore dari file ekspor menulis SQLite', restoredLog, { log: String(await logText(wc)).slice(-500) });

  const archiveAfter = await evSafe(wc, `return localStorage.getItem('hems_data_store_v1');`);
  ok('arsip localStorage tidak ditimpa oleh restore', archiveAfter === state.seedRaw,
    { sebelum: (state.seedRaw || '').length, sesudah: (archiveAfter || '').length });
  ok('restore membuat snapshot pengaman pra-restore',
    dirNames().some(n => /pra-restore/.test(n)), dirNames());
  const guardMeta = snapMeta(dirNames().filter(n => /pra-restore/.test(n)).sort().reverse()[0]);
  ok('snapshot pengaman berisi baris hasil kerja terbaru', guardMeta && guardMeta.totalRows >= 1, guardMeta);

  const afterReload = await waitFor(wc,
    `!(await window.electronAPI.dbLoad()).units.map(u => String(u.serialNumber||'')).includes('FATHONI-PAGE-2')`,
    'baris pasca-ekspor hilang lagi', 60000);
  ok('restore menggantikan isi database', afterReload);

  const finalUnits = ((await evSafe(wc, `return await window.electronAPI.dbLoad();`)) || {}).units
    || [];
  const serialAkhir = finalUnits.map(u => String(u.serialNumber || ''));
  ok('data dari file ekspor terbaca di database', serialAkhir.includes('FATHONI-PAGE-1'), serialAkhir);
  ok('data hasil migrasi fase sebelumnya tetap ada', serialAkhir.includes('FATHONI-BK-A1'), serialAkhir);
  ok('aplikasi tidak menampilkan peringatan belum tersimpan',
    !(await evSafe(wc, `return document.body.innerText.includes('TIDAK TERSIMPAN');`)));

  console.log(`\n=== fase page: ${pass} lulus, ${fail} gagal ===`);
  app.quit();
  setTimeout(() => { console.log('FAIL quit fase page tertahan'); selesai(app, 4); }, 8000);
}

app.on('window-all-closed', () => { /* fase menjalankan app.quit() sendiri */ });

require('../../dist-electron/main.js');
