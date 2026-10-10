// tests/harness/db-store-check.cjs
// Harness integrasi Fase 4: membuktikan store renderer benar-benar hidup di file
// SQLite, bukan di localStorage lagi. Dijalankan oleh db-store-run.cjs dalam tiga
// fase berurutan pada folder data sementara (HEMS_DATA_DIR):
//
//   seed    -> profil kosong, tulis database lama ke localStorage lalu matikan app
//   import  -> app di-boot dengan file SQLite baru: migrasi Fase 3 + impor sekali,
//              edit data lewat UI, lalu quit di tengah jendela debounce (handshake
//              flush main process yang menahan penutupan harus menyelamatkan
//              perubahan terakhir)
//   verify  -> boot ulang dari file yang sama: data terbaca dari SQLite, tanpa
//              impor/migrasi ulang, arsip localStorage tidak tersentuh
//
// Harness ini memuat dist-electron/main.js yang sungguhan (bukan tiruan), jadi
// preload, IPC, dan handshake quit semuanya ikut terpakai.
const { app } = require('electron');
const selesai = require('./selesai.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const esbuild = require('esbuild');

const PHASE = process.env.HEMS_HARNESS_PHASE;
const DATA_DIR = path.resolve(process.env.HEMS_DATA_DIR || '');
const STATE_FILE = path.join(DATA_DIR, 'harness-state.json');

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, extra) {
  if (cond) { pass++; lines.push('PASS ' + name); }
  else { fail++; lines.push('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
  console.log(lines[lines.length - 1]);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

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
function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`);
}
async function waitFor(wc, expr, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await ev(wc, `return !!(${expr});`);
    if (value) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(patch) {
  const next = Object.assign(readState(), patch);
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

// Data contoh asli dipakai sebagai bahan uji: yang sidik jarinya masih persis
// contoh harus dibuang migrasi, yang sudah disunting harus tetap ada.
function buildSeed() {
  const outfile = path.join(os.tmpdir(), `hems-dbseed-entry-${process.pid}.cjs`);
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
        { id: 'U-REAL-01', serialNumber: 'FATHONI-REAL-001', brand: 'SANY', model: 'SY215C', category: 'Excavator', status: 'AVAILABLE', hourMeter: 1234, location: 'Jobsite Morowali', year: '2022' },
      ],
      sales: [], rentals: [], services: [], invoices: [], kas: [],
    },
    legacyUnits: [{ id: 'OLD-1', serialNumber: 'FATHONI-LEGACY-9', brand: 'Komatsu', model: 'PC200-8', status: 'AVAILABLE', hourMeter: 5 }],
  };
}

// ── Buka halaman Unit lewat UI ──────────────────────────────────────────────
async function openUnits(wc) {
  await ev(wc, `window.location.hash = '#/units'; return true;`);
  return waitFor(wc, `/Manajemen Armada/.test(document.body.innerText)`, 'halaman Unit', 40000);
}

async function addUnit(wc, serial, model) {
  const clicked = await ev(wc, `const b = byText(/Tambah Unit/); if (b) b.click(); return b ? 'ok' : 'not-found';`);
  const modalUp = await waitFor(wc, `!!document.querySelector('.modal input[placeholder="Contoh: SY-SY215C-099"]')`, 'modal tambah unit');
  if (!modalUp) return { clicked, modalUp };
  await ev(wc, `
    setVal(document.querySelector('.modal input[placeholder="Contoh: SY-SY215C-099"]'), ${JSON.stringify(serial)});
    setVal(document.querySelector('.modal input[placeholder="Contoh: SY215C, PC200-8"]'), ${JSON.stringify(model)});
    return true;`);
  const saved = await ev(wc, `
    const s = byText(/Simpan Unit/, 'button');
    if (!s) return 'no-save-button';
    s.click();
    return 'clicked';`);
  return { clicked, modalUp, saved };
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
  return { login, up, mustChange: login.user && login.user.mustChangePassword === true };
}

async function loginAndOpenApp(wc) {
  const first = await openWithSession(wc, 'admin123');
  ok('login akun default berhasil', first.login && first.login.success === true, first.login);
  ok('akun default masih wajib ganti password', first.mustChange === true, first.login && first.login.user);
  const changed = await ev(wc, `return await window.electronAPI.changePassword(${JSON.stringify(first.login.token)}, 'admin123', 'BaruSekali12');`);
  ok('password default bisa diganti', changed && changed.success === true, changed);
  const second = await openWithSession(wc, 'BaruSekali12');
  ok('login dengan password baru membuka aplikasi', second.login && second.login.success === true && second.up === true, second);
  return second.up === true;
}

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev2, _lvl, msg) => {
    if (/error|uncaught|failed/i.test(msg)) console.log('RENDERER:', msg.slice(0, 300));
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
  await ev(wc, `window.confirm = () => true; window.alert = (m) => { window.__lastAlert = String(m); }; return true;`);

  if (PHASE === 'seed') return phaseSeed(wc);
  if (PHASE === 'import') return phaseImport(wc);
  if (PHASE === 'verify') return phaseVerify(wc);
  console.log('HARNESS ERROR: fase tidak dikenal -> ' + PHASE);
  selesai(app, 3);
}

// ── Fase 1: tanam database lama di localStorage ─────────────────────────────
async function phaseSeed(wc) {
  const { seed, legacyUnits, untouchedId } = buildSeed();
  const raw = JSON.stringify(seed);
  await ev(wc, `
    localStorage.setItem('hems_data_store_v1', ${JSON.stringify(raw)});
    localStorage.setItem('HEMS_UNITS', ${JSON.stringify(JSON.stringify(legacyUnits))});
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    localStorage.removeItem('hems_data_migration_v1');
    return true;`);
  writeState({ seedRaw: raw, untouchedId });

  const stored = await ev(wc, `return localStorage.getItem('hems_data_store_v1');`);
  ok('seed localStorage tertulis', stored === raw);
  // Boot pertama pada profil kosong menandai "sudah diimpor" di database;
  // orkestrator menghapus file database sesudah ini supaya fase import memulai
  // dari SQLite kosong seperti profil pengguna yang baru naik versi.
  const info = await ev(wc, `return await window.electronAPI.dbInfo();`);
  ok('info database terbaca lewat IPC', info && typeof info.file === 'string' && info.collections?.length === 18, info);
  const stats = await ev(wc, `return await window.electronAPI.dbStats();`);
  ok('database profil baru masih kosong', stats && stats.totalRows === 0, stats);

  await wait(1200); // biarkan localStorage tersimpan ke disk sebelum proses mati
  console.log('SEED-DONE');
  // app.quit() (bukan exit) supaya Chromium menutup profilnya dengan benar dan
  // seed yang barusan ditulis pasti sampai ke disk.
  app.quit();
  setTimeout(() => selesai(app, 0), 6000);
}

// ── Fase 2: boot dengan SQLite -> migrasi + impor sekali ────────────────────
async function phaseImport(wc) {
  const state = readState();
  ok('state fase seed tersedia', typeof state.seedRaw === 'string');

  // Boot menyalin isi localStorage ke SQLite secara async; tunggu sampai baris
  // warisan benar-benar ada di file sebelum menilai apa pun.
  const ready = await waitFor(wc,
    `(await window.electronAPI.dbLoad()).units.length >= 3`, 'impor localStorage selesai', 40000);
  ok('impor selesai saat boot', ready);

  const db = await ev(wc, `return await window.electronAPI.dbLoad();`);
  const units = Array.isArray(db.units) ? db.units : [];
  const serials = units.map(u => String(u.serialNumber || ''));

  const markerRaw = await ev(wc, `return localStorage.getItem('hems_data_migration_v1');`);
  const marker = markerRaw ? JSON.parse(markerRaw) : null;
  ok('marker migrasi terpasang setelah impor', !!marker && typeof marker.at === 'string', markerRaw);
  ok('impor ditandai di database', (await ev(wc, `return await window.electronAPI.dbInfo();`)).importedFromLocalStorage === true);

  ok('data asli dari localStorage masuk ke SQLite', serials.includes('FATHONI-REAL-001'), serials);
  ok('record contoh yang tak tersentuh dibuang', !units.some(u => u.id === state.untouchedId), units.map(u => u.id));
  ok('record contoh yang disunting pengguna dipertahankan', serials.includes('FATHONI-EDIT-001'), serials);
  ok('kunci warisan HEMS_UNITS diimpor', serials.includes('FATHONI-LEGACY-9'), serials);

  const rawAfter = await ev(wc, `return localStorage.getItem('hems_data_store_v1');`);
  ok('arsip localStorage lama tidak diubah sama sekali', rawAfter === state.seedRaw,
    { before: (state.seedRaw || '').length, after: (rawAfter || '').length });

  writeState({ markerAt: marker ? marker.at : null });

  // ── Edit lewat UI harus sampai ke file ──
  ok('aplikasi terbuka untuk akun login', await loginAndOpenApp(wc));
  ok('halaman Unit termuat', await openUnits(wc));

  const first = await addUnit(wc, 'FATHONI-DB-A1', 'SY215C');
  ok('unit pertama tersimpan lewat UI', first.saved === 'clicked', first);
  await wait(1600); // debounce autosave 800ms + perjalanan IPC
  const afterFirst = await ev(wc, `return await window.electronAPI.dbLoad();`);
  ok('unit hasil UI sudah ada di file SQLite',
    (afterFirst.units || []).some(u => u.serialNumber === 'FATHONI-DB-A1'),
    (afterFirst.units || []).map(u => u.serialNumber));

  const cardText = await ev(wc, `return document.querySelector('main')?.innerText || document.body.innerText;`);
  ok('daftar unit di layar menampilkan hasil dari database', /FATHONI-DB-A1/.test(cardText), cardText.slice(0, 200));

  const query = await ev(wc, `return await window.electronAPI.dbQuery({ collection: 'units', search: 'SANY SY215C' });`);
  ok('pencarian SQL menemukan SANY SY215C', query && query.total >= 1 && query.rows.some(r => r.serialNumber === 'FATHONI-REAL-001'), query && { total: query.total, rows: query.rows.map(r => r.serialNumber) });

  const stats = await ev(wc, `return await window.electronAPI.dbStats();`);
  ok('statistik database melaporkan baris nyata', stats && stats.totalRows > 3 && stats.sizeBytes > 0, stats && { totalRows: stats.totalRows, sizeBytes: stats.sizeBytes });

  // Perubahan terakhir dibuat lalu aplikasi langsung ditutup: hanya handshake
  // flush main process yang bisa menyelamatkannya (debounce belum sempat jalan).
  const second = await addUnit(wc, 'FATHONI-DB-A2', 'PC200-8');
  ok('unit kedua tersimpan lewat UI', second.saved === 'clicked', second);
  await wait(250);
  console.log(`FLUSH-MARK ${Date.now()}`);
  app.quit();
  setTimeout(() => { console.log('FAIL quit tertahan lebih dari 8 detik'); selesai(app, 4); }, 8000);
}

// ── Fase 3: boot ulang dari file yang sama ──────────────────────────────────
async function phaseVerify(wc) {
  const state = readState();

  const ready = await waitFor(wc,
    `(await window.electronAPI.dbLoad()).units.length >= 4`, 'database terbaca saat boot ulang', 40000);
  ok('boot ulang membaca file database', ready);

  const db = await ev(wc, `return await window.electronAPI.dbLoad();`);
  const units = Array.isArray(db.units) ? db.units : [];
  const serials = units.map(u => String(u.serialNumber || ''));

  ok('data terbaca dari SQLite saat boot', serials.includes('FATHONI-REAL-001'), serials);
  ok('perubahan terakhir sebelum quit terselamatkan (handshake flush)', serials.includes('FATHONI-DB-A2'), serials);
  ok('unit fase sebelumnya tetap ada', serials.includes('FATHONI-DB-A1'), serials);
  ok('impor tidak diulang (marker sama)',
    (await ev(wc, `return await window.electronAPI.dbInfo();`)).importedFromLocalStorage === true);

  const markerRaw = await ev(wc, `return localStorage.getItem('hems_data_migration_v1');`);
  const marker = markerRaw ? JSON.parse(markerRaw) : null;
  ok('migrasi tidak dijalankan ulang', marker && marker.at === state.markerAt, { now: marker && marker.at, dulu: state.markerAt });

  const rawAfter = await ev(wc, `return localStorage.getItem('hems_data_store_v1');`);
  ok('arsip localStorage masih utuh setelah boot kedua', rawAfter === state.seedRaw);

  // Token sesi hidup di memori main process, jadi boot ulang berarti login lagi —
  // kali ini dengan password hasil fase sebelumnya, tanpa layar wajib ganti.
  const reopened = await openWithSession(wc, 'BaruSekali12');
  ok('aplikasi terbuka setelah boot ulang',
    !!reopened.login && reopened.login.success === true && reopened.up === true, reopened);
  ok('wajib ganti password tidak muncul lagi', reopened.mustChange === false, reopened.login && reopened.login.user);
  ok('halaman Unit termuat', await openUnits(wc));
  const cards = await ev(wc, `return document.querySelector('main')?.innerText || document.body.innerText;`);
  ok('daftar unit di layar berisi hasil dari file',
    /FATHONI-DB-A1/.test(cards) && /FATHONI-DB-A2/.test(cards), cards.slice(0, 240));

  const integrity = await ev(wc, `return await window.electronAPI.dbIntegrity();`);
  ok('quick_check database sehat', integrity && integrity.ok === true, integrity && integrity.quickCheck);
  ok('tidak ada nomor seri ganda', integrity && (!integrity.duplicates || integrity.duplicates.length === 0), integrity && integrity.duplicates);

  // Simpanan berikutnya harus tetap di file meski jendela reload (tanpa handshake).
  const edited = await addUnit(wc, 'FATHONI-DB-A3', 'DX100LC');
  await wait(1600);
  const after = await ev(wc, `return await window.electronAPI.dbLoad();`);
  ok('unit ketiga masuk file lewat autosave',
    edited.saved === 'clicked' && (after.units || []).some(u => u.serialNumber === 'FATHONI-DB-A3'),
    (after.units || []).map(u => u.serialNumber));

  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

app.on('window-all-closed', () => { /* fase import yang menghentikan proses */ });

require('../../dist-electron/main.js');
