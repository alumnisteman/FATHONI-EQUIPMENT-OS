// tests/harness/perf-check.cjs
// Harness kinerja Fase 4. Yang diukur adalah apa yang dirasakan pengguna, jadi
// hampir semuanya dihitung dari DALAM renderer: berapa lama boot, berapa lama
// jeda antara mengetik dan hasil muncul, berapa lama halaman berganti. db-check
// sudah mengukur SQLite di main process; harness ini menutup selisihnya
// (IPC + debounce + render React) yang justru merupakan tempat aplikasi dulu
// terasa macet.
//
// Profil awal sengaja besar supaya "tetap ringan saat data bertambah" terbukti,
// bukan diasumsikan: 12.000 unit + 6.000 kas + 4.000 suku cadang + 3.000
// invoice. Bagian 9 kemudian menumbuhkan tabel unit sampai 50.000 lewat jalur
// tulis SQLite dan mengukur ulang waktu yang sama.
//
// Jalankan (folder datanya dibuat sendiri):
//   node_modules/electron/dist/electron.exe tests/harness/perf-check.cjs

const { app, BrowserWindow } = require('electron');
const selesai = require('./selesai.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

const AWAL_PROSES = Date.now();
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
function catat(name, nilai) { console.log('CATATAN ' + name + ': ' + nilai); }
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const median = (arr) => {
  const s = [...arr].filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const ratarata = (arr) => {
  const s = arr.filter(x => typeof x === 'number' && Number.isFinite(x));
  return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : Number.NaN;
};

// ── Profil besar disiapkan sebelum main.js membuka database ════════════════
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hems-perf-'));
process.env.HEMS_DATA_DIR = dir;
app.setPath('userData', dir);
app.disableHardwareAcceleration();

const DB = require(path.join(__dirname, '../../dist-electron/db.js'));

const JUMLAH_UNIT = 12000;
const JUMLAH_KAS = 6000;
// Kartu KPI Kas berlabel "Bulan Ini", jadi profil uji harus bertanggal bulan
// berjalan. Tanggal tetap akan membuat kartunya Rp 0 begitu bulan berganti dan
// P.21 berhenti membuktikan bahwa agregatnya dihitung SQLite, bukan renderer.
const BULAN_UJI = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
const JUMLAH_PART = 4000;
const JUMLAH_INVOICE = 3000;
// Bagian 11 (kapasitas 100.000/collection) hanya jalan kalau diminta: ia menulis
// 400.000 baris dan memakan menit, sementara rantai regresi harus tetap cepat.
const KAPASITAS = process.env.HEMS_PERF_KAPASITAS === '1';
const MEREK = ['SANY', 'TADANO', 'KOBELCO', 'HYUNDAI', 'XCMG'];
const MODEL = ['SY215C', 'AD10', 'SK200', 'LC130E', 'XE215C'];

function unitRow(i, prefix) {
  const k = i % MEREK.length;
  return {
    id: prefix + '-U' + (i + 1),
    serialNumber: prefix + 'ISN' + String(i + 1).padStart(6, '0'),
    brand: MEREK[k],
    model: MODEL[k],
    status: i % 7 === 0 ? 'RENTED' : 'AVAILABLE',
    year: 2015 + (i % 11),
    purchaseDate: '2026-10-01',
    hourMeter: i % 9000,
    purchasePrice: 500000000 + (i % 400) * 1000000,
    location: 'GUDANG-' + (i % 9),
    notes: 'unit uji kinerja ' + MEREK[k] + ' dengan catatan cukup panjang supaya payload tidak kecil',
  };
}

/** Baris tambahan untuk uji pertumbuhan; bentuknya sama, id berbeda. */
function unitBanyak(n, prefix) {
  return Array.from({ length: n }, (_x, i) => unitRow(i, prefix));
}

function partBanyak(n, prefix) {
  return Array.from({ length: n }, (_x, i) => ({
    id: prefix + '-P' + (i + 1),
    name: 'Filter uji kinerja ' + (i % 50),
    sku: prefix + 'SKU' + String(i + 1).padStart(5, '0'),
    category: 'FILTER',
    compatibleBrands: MEREK[i % MEREK.length] + ' ' + MODEL[i % MODEL.length],
    rackLocation: 'RAK-' + (i % 40),
    stock: i % 30, minStock: 3, unit: 'Pcs', price: 100000 + i, sellingPrice: 150000 + i,
  }));
}

function kasBanyak(n, prefix) {
  return Array.from({ length: n }, (_x, i) => ({
    id: prefix + '-K' + (i + 1),
    tanggal: `${BULAN_UJI}-${String(1 + (i % 8)).padStart(2, '0')}`,
    keterangan: i % 2 === 0 ? 'Pembayaran penjualan ' + i : 'Belai suku cadang ' + i,
    kategori: i % 2 === 0 ? 'PENJUALAN' : 'PEMBELIAN',
    tipe: i % 2 === 0 ? 'MASUK' : 'KELUAR',
    jumlah: 100000 + (i % 900) * 1000,
    rekening: 'Kas Tunai',
    referensi: 'REF-' + i,
  }));
}

function invoiceBanyak(n, prefix) {
  return Array.from({ length: n }, (_x, i) => ({
    id: prefix + '-INV' + (i + 1),
    nomor: 'INV-' + prefix + '-' + String(i + 1).padStart(5, '0'),
    pelanggan: 'Pelanggan ' + (i % 300),
    tanggal: '2026-10-0' + (1 + (i % 8)),
    jatuhTempo: '2026-11-01',
    total: 500000 + (i % 400) * 25000,
    status: i % 3 === 0 ? 'PAID' : 'UNPAID',
  }));
}

// Katalog merek/model ikut di-seed supaya jalur #R3 benar-benar terukur di profil
// besar: halaman Unit menghidrasi brands + models lewat store, dan angka P.12b di
// bawah harus bisa membedakan "hanya katalog yang lewat IPC" dari "armada ikut
// lewat". Tanpa isi katalog, delta baris jadi nol dan penjaga itu tidak membuktikan
// apa pun selain dirinya sendiri.
const KATALOG = MEREK.map((name, i) => ({
  id: 'PRF-B' + (i + 1), name, country: 'RRT', category: 'EXCAVATOR',
  description: 'merek uji kinerja ' + name,
}));
const KATALOG_MODEL = MEREK.map((name, i) => ({
  id: 'PRF-M' + (i + 1), brandName: name, modelCode: MODEL[i], category: 'EXCAVATOR',
  capacity: '1,2 m3', enginePower: '128 kW', operatingWeight: '21.900 kg',
}));
const BARIS_KATALOG = KATALOG.length + KATALOG_MODEL.length;

function seedProfil() {
  DB.openDatabase(dir);
  DB.saveStore({
    units: unitBanyak(JUMLAH_UNIT, 'PRF'),
    spareParts: partBanyak(JUMLAH_PART, 'PRF'),
    kas: kasBanyak(JUMLAH_KAS, 'PRF'),
    invoices: invoiceBanyak(JUMLAH_INVOICE, 'PRF'),
    brands: KATALOG,
    models: KATALOG_MODEL,
  });
  DB.closeDatabase();
}

// ── Bantuan renderer ────────────────────────────────────────────────────────
const HELPERS = `
  function setVal(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function byText(re, tag) { return [...document.querySelectorAll(tag || 'button')].find(x => re.test(x.innerText)); }
  function txt(sel) { return ((document.querySelector(sel) || {}).innerText) || ''; }
  function rupiah(s) { const n = String(s).replace(/[^0-9]/g, ''); return n ? Number(n) : 0; }
  function tick(ms) { return new Promise(r => setTimeout(r, ms)); }
  /**
   * Ukur satu aksi di DALAM renderer: waktu antara aksi dan layar berhenti
   * menampilkan 'memuat'. Dipakai dengan performance.now() supaya pengiriman
   * pesan IPC harness tidak ikut terhitung sebagai jeda.
   */
  async function ukur(aksi, selesai, batasMs) {
    const t = performance.now();
    aksi();
    let akhir = -1;
    const deadline = t + (batasMs || 20000);
    let menyala = false;
    while (performance.now() < deadline) {
      if (!menyala) {
        // loading harus menyala dulu; kalau tidak pernah menyala, aksinya
        // tidak memicu kueri sama sekali dan hasilnya tidak berarti
        if (selesai(true)) menyala = true;
        else if (performance.now() - t > 1500) return { ms: Number.NaN, menyala: false };
      } else if (selesai(false)) {
        akhir = performance.now() - t;
        break;
      }
      await tick(16);
    }
    return { ms: akhir < 0 ? Number.NaN : Math.round(akhir), menyala };
  }
`;

function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`, true);
}

async function waitFor(wc, expr, label, timeoutMs = 40000) {
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

const appErrors = [];
function watchErrors(wc) {
  wc.on('console-message', (_e, level, msg) => {
    if (level >= 3 || /uncaught|is not a function|cannot read/i.test(msg)) appErrors.push(msg.slice(0, 200));
  });
}

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  if (captured || wc.getType() !== 'window') return;
  captured = wc;
  watchErrors(wc);
  wc.once('did-finish-load', () => run(wc).catch(err => {
    console.log('HARNESS ERROR', err && err.message, err && err.stack && err.stack.split('\n').slice(0, 3).join(' | '));
    selesai(app, 2);
  }));
});

/** Memori per proses dari sudut pandang Chromium, bukan perkiraan renderer. */
function memoriProses() {
  const out = {};
  for (const p of app.getAppMetrics()) {
    const kb = p.memory && (p.memory.WorkingSetSize || p.memory.peakWorkingSetSize) || 0;
    const tipe = (p.type || 'lain').toLowerCase();
    out[tipe] = Math.max(out[tipe] || 0, Math.round(kb / 1024));
  }
  return out;
}

async function run(wc) {
  // ══ 1. Boot ══════════════════════════════════════════════════════════════
  const tLayar = Date.now();
  const adaLogin = await waitFor(wc, `!!document.querySelector('#login-username')`, 'layar login', 45000);
  const bootMs = Date.now() - tLayar;
  ok('P.1 aplikasi boot di atas profil 25.000 baris tanpa error renderer', appErrors.length === 0, appErrors.slice(0, 3));
  ok('P.2 layar login muncul dalam waktu boot yang wajar (< 15 s)', adaLogin, { bootMs });
  catat('waktu harness sampai layar login siap (ms)', bootMs);
  catat('waktu proses sejak electron dimulai sampai layar login siap (ms)', Date.now() - AWAL_PROSES);

  const paint = await ev(wc, `
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = (performance.getEntriesByType('paint') || []).find(p => p.name === 'first-contentful-paint');
    return { domReady: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0),
             fcp: fcp ? Math.round(fcp.startTime) : -1, sekarang: Math.round(performance.now()) };`);
  // Jendela harness bersembunyi (show: false), jadi Chromium tidak selalu
  // mengirim entri 'first-contentful-paint'. Yang tetap bisa ditegakkan adalah
  // dokumen selesai dimuat dan aplikasi sudah merespons sebelum pengukuran
  // berikutnya dimulai — keduanya angka renderer, bukan angka main process.
  ok('P.3 renderer menyelesaikan dokumen boot (< 12 s) sebelum ada interaksi',
    paint.domReady > 0 && paint.domReady < 12000 && paint.sekarang > paint.domReady, paint);
  catat('domContentLoaded renderer (ms)', paint.domReady);
  catat('loadEventEnd renderer (ms)', paint.load);
  catat('first-contentful-paint renderer (ms, -1 di jendela tersembunyi)', paint.fcp);

  // ══ 2. Muat penuh vs yang sebenarnya dibayar saat boot (#38) ══════════════
  // dbLoad() tanpa argument adalah jalur layar Backup dan impor. Sejak #38 boots
  // aplikasi tidak lagi memanggilnya: yang diminta hanya jumlah baris (db-info),
  // jadi waktu di bawah adalah batas terburuk yang sudah tidak dipakai, bukan
  // biaya yang dibayar pengguna saat membuka aplikasi.
  const bacaBoot = await ev(wc, `
    const s = await window.electronAPI.dbStats();
    return { reads: s.reads, totalRows: s.totalRows };`);
  ok('P.3b boot di profil besar tidak memindahkan satu baris pun lewat IPC',
    bacaBoot.reads.fullCalls === 0 && bacaBoot.reads.subsetCalls === 0 && bacaBoot.reads.rows === 0,
    bacaBoot);
  catat('jumlah baris di profil uji (tidak dilewati IPC saat boot)', bacaBoot.totalRows);

  const muat = await ev(wc, `
    const t = performance.now();
    const s = await window.electronAPI.dbLoad();
    const ms = Math.round(performance.now() - t);
    const bytes = JSON.stringify(s).length;
    return { ms, bytes, unit: (s.units || []).length, kas: (s.kas || []).length,
             part: (s.spareParts || []).length, invoice: (s.invoices || []).length };`);
  ok('P.4 muatan penuh berbentuk benar (seluruh store)', muat.unit === JUMLAH_UNIT && muat.kas === JUMLAH_KAS
    && muat.part === JUMLAH_PART && muat.invoice === JUMLAH_INVOICE, muat);
  ok('P.5 muatan penuh selesai dalam batas yang wajar (< 4 s)', muat.ms < 4000, muat);
  catat('dbLoad seluruh store dari renderer (ms)', muat.ms);
  catat('ukuran seluruh store yang melewati IPC (MB)', (muat.bytes / 1048576).toFixed(2));

  // Perbandingan yang menjadi inti Fase 4: satu halaman vs seluruh store.
  const banding = await ev(wc, `
    const q = await window.electronAPI.dbQuery({ collection: 'units', limit: 12, offset: 0 });
    const halaman = JSON.stringify(q.rows).length;
    const total = JSON.stringify(await window.electronAPI.dbLoad()).length;
    return { halaman, total, baris: q.rows.length, persen: Math.round(1000 * halaman / total) / 10 };`);
  ok('P.6 satu halaman hanya mengirim sebagian kecil dari isi store (< 5%)',
    banding.baris === 12 && banding.persen < 5, banding);
  catat('satu halaman unit vs seluruh store (%)', banding.persen);
  const bacaSesudah2 = await ev(wc, `return (await window.electronAPI.dbStats()).reads;`);

  // ══ 3. Buka aplikasi ═════════════════════════════════════════════════════
  const tBuka = Date.now();
  const buka = await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    const masuk = await window.electronAPI.login('admin', 'admin123');
    if (!masuk.success) return { step: 'login', masuk };
    let user = masuk.user;
    if (user && user.mustChangePassword) {
      const ganti = await window.electronAPI.changePassword(masuk.token, 'admin123', 'KinerjaSekali12');
      if (!ganti.success) return { step: 'ganti', ganti };
      const sesi = await window.electronAPI.session(masuk.token);
      if (sesi.success && sesi.user) user = sesi.user;
    }
    localStorage.setItem('hems_session_v2', JSON.stringify({ token: masuk.token, user }));
    return { step: 'ok' };`);
  ok('P.7 login di profil besar berhasil', buka.step === 'ok', buka);
  await wc.reload();
  const tSakai = Date.now();
  const terbuka = await waitFor(wc,
    `!/Masuk ke FATHONI/.test(document.body.innerText) && document.body.innerText.length > 40`,
    'kerangka aplikasi', 60000);
  ok('P.8 kerangka aplikasi tampil tanpa menunggu daftar besar', terbuka, { ms: Date.now() - tSakai });
  const siapMs = Date.now() - tBuka;
  ok('P.9 dari klik sampai aplikasi terbuka di bawah 10 detik', siapMs < 10000, { siapMs });
  catat('login + reload sampai kerangka tampil (ms)', siapMs);

  // ══ 4. Halaman Unit: halaman pertama ═════════════════════════════════════
  await ev(wc, `window.location.hash = '#/units'; return true;`);
  const unitSiap = await waitFor(wc, `!/memuat/.test(txt('#pager-info')) && /record/.test(txt('#pager-info'))`,
    'halaman unit terisi', 60000);
  const sampelUnit = await ev(wc, `return txt('#pager-info');`);
  ok('P.10 halaman Unit terisi dari SQLite di profil 12.000 unit', unitSiap, sampelUnit);
  const awalUnit = await ev(wc, `
    return { info: txt('#pager-info'), kartu: document.querySelectorAll('#units-grid .card').length };`);
  ok('P.11 hanya satu halaman kartu yang berada di DOM (<= 12)', awalUnit.kartu > 0 && awalUnit.kartu <= 12, awalUnit);
  ok('P.12 penanda halaman menyebut jumlah record yang sebenarnya', /dari 12000 record/.test(awalUnit.info), awalUnit);

  // #38: layar sebesar ini dulu dibayar dengan memindahkan seluruh collection ke
  // renderer. Sekarang halaman datang lewat dbQuery, jadi membuka menu tidak boleh
  // menggeser satu baris store pun — diukur sebagai delta sejak bagian 2, karena
  // bagian 2 sendiri sengaja memanggil jalur penuh dua kali.
  // #R3 menambahkan satu pengecualian yang sah dan terbatas: rute /units menghidrasi
  // katalog brands + models agar dropdown Merek/Model membaca halaman Merek & Model,
  // bukan daftar hardcoded di dalam formulir Unit. Jadi subsetCalls boleh naik dan
  // baris boleh lewat IPC — tetapi jumlahnya wajib persis isi katalog (10 baris),
  // bukan sebagian dari armada. Di profil 12.000 unit, satu collection units yang
  // ikut terseret menaikkan delta menjadi ribuan.
  const bacaSetelahUnit = await ev(wc, `return (await window.electronAPI.dbStats()).reads;`);
  const pindahUnit = {
    penuh: bacaSetelahUnit.fullCalls - bacaSesudah2.fullCalls,
    sebagian: bacaSetelahUnit.subsetCalls - bacaSesudah2.subsetCalls,
    koleksi: bacaSetelahUnit.subsetCollections - bacaSesudah2.subsetCollections,
    baris: bacaSetelahUnit.rows - bacaSesudah2.rows,
  };
  ok('P.12b membuka layar Unit di profil 12.000 unit hanya menghidrasi katalog ('
    + BARIS_KATALOG + ' baris), bukan armada',
    pindahUnit.penuh === 0 && pindahUnit.baris === BARIS_KATALOG
      && pindahUnit.sebagian <= 2 && pindahUnit.koleksi <= 2,
    { ...pindahUnit, BARIS_KATALOG, JUMLAH_UNIT });
  catat('baris store yang lewat IPC sejak login sampai layar Unit terbuka', pindahUnit.baris);

  // Menu Perawatan Sistem adalah rute yang paling mahal di aplikasi ini SAMPAI #77:
  // peta hidrasi memetakannya ke SEMUA_COLLECTION, jadi membukanya — yang hanya
  // menampilkan kesehatan, daftar cadangan dan pemakaian ruang dari query — memindahkan
  // seluruh isi file ke renderer. Aksi penyapu (muat data contoh) sekarang meminta
  // hidrasinya sendiri di handler tombolnya, jadi delta di bawah harus nol.
  await ev(wc, `window.location.hash = '#/maintenance'; return true;`);
  const maintSiap = await waitFor(wc,
    `document.body.innerText.includes('Muat Data Contoh')`, 'menu Perawatan Sistem terisi', 60000);
  const bacaSetelahMaint = await ev(wc, `return (await window.electronAPI.dbStats()).reads;`);
  const pindahMaint = {
    penuh: bacaSetelahMaint.fullCalls - bacaSetelahUnit.fullCalls,
    sebagian: bacaSetelahMaint.subsetCalls - bacaSetelahUnit.subsetCalls,
    baris: bacaSetelahMaint.rows - bacaSetelahUnit.rows,
  };
  ok('P.12c membuka menu Perawatan Sistem tidak memindahkan satu baris store pun',
    maintSiap && pindahMaint.penuh === 0 && pindahMaint.baris === 0, pindahMaint);
  const labelMaint = await ev(wc, `
    const b = [...document.querySelectorAll('button')].find(x => /Muat Data Contoh/.test(x.textContent));
    return b ? (b.getAttribute('disabled') === null ? 'aktif' : 'nonaktif') : 'tidak ada';`);
  ok('P.12d tombol muat contoh masih ada dan menunggu dalam keadaan jelas (bukan diam-diam)',
    labelMaint === 'aktif', labelMaint);
  catat('baris store yang lewat IPC hanya untuk membuka menu Perawatan Sistem', pindahMaint.baris);

  // Bagian 5 mengukur layar Unit, jadi kembali ke sana dan pastikan layarnya
  // benar-benar sudah ada sebelum mengukur — kalau tidak, setVal dapat null.
  await ev(wc, `window.location.hash = '#/units'; return true;`);
  const unitLagi = await waitFor(wc, `!!document.querySelector('#units-search')`, 'layar Unit terbuka lagi', 60000);
  ok('P.12e layar Unit dapat dibuka kembali sesudah menu Perawatan Sistem', unitLagi, unitLagi);

  // ══ 5. Respons pencarian dari DALAM renderer ═════════════════════════════
  const kueri = ['SANY SY215C', 'TADANO AD10', 'HYUNDAI LC130E', 'PRFISN000777', 'KOBELCO SK200'];
  const waktuCari = [];
  const hasilCari = [];
  for (const q of kueri) {
    const r = await ev(wc, `
      const hasil = await ukur(
        () => setVal(document.querySelector('#units-search'), ${JSON.stringify(q)}),
        (cekLoading) => {
          const s = txt('#pager-info');
          return cekLoading ? /memuat/.test(s) : (!/memuat/.test(s) && /record|Tidak ada/.test(s));
        }, 25000);
      return { ms: hasil.ms, menyala: hasil.menyala, info: txt('#pager-info'),
               kartu: document.querySelectorAll('#units-grid .card').length };`);
    waktuCari.push(r.ms);
    hasilCari.push({ q, ...r });
  }
  const medCari = median(waktuCari);
  ok('P.13 setiap pencarian mendapat jawaban (tidak ada yang menggantung)',
    hasilCari.every(r => Number.isFinite(r.ms) && r.kartu <= 12 && /record|Tidak ada/.test(r.info)), hasilCari);
  ok('P.14 pencarian yang cocok menampilkan halaman pertama, bukan seluruh hasil',
    hasilCari[0].kartu === 12 && /dari \d+ record/.test(hasilCari[0].info), hasilCari[0]);
  ok('P.15 median waktu pencarian di layar Unit < 800 ms (debounce 200 ms termasuk)', medCari < 800, { medCari, waktuCari });
  catat('median waktu cari layar Unit (ms)', medCari);
  catat('rata-rata waktu cari layar Unit (ms)', ratarata(waktuCari));

  // Bandingkan dengan IPC telanjang: sisanya adalah React + debounce, bukan SQL.
  const mentah = await ev(wc, `
    const arr = [];
    let total = 0;
    for (let i = 0; i < 11; i++) {
      const t = performance.now();
      const r = await window.electronAPI.dbQuery({ collection: 'units', search: 'SANY SY215C', sort: 'purchaseDate', limit: 12, offset: 0 });
      arr.push(Math.round(performance.now() - t));
      if (i === 0) total = r.total;
    }
    return { arr, total };`);
  const medMentah = median(mentah.arr);
  ok('P.16 kueri SQLite telanjang dari renderer < 150 ms pada 12.000 baris', medMentah < 150, { medMentah, arr: mentah.arr });
  ok('P.17 IPC membawa hasil yang sama seperti yang dibaca layar', mentah.total > 0 && mentah.total <= JUMLAH_UNIT, mentah.total);
  catat('median dbQuery telanjang (ms)', medMentah);
  catat('selisih layar vs IPC telanjang (ms)', medCari - medMentah);

  // ══ 6. Berganti halaman ══════════════════════════════════════════════════
  await ev(wc, `setVal(document.querySelector('#units-search'), ''); return true;`);
  await waitFor(wc, `!/memuat/.test(txt('#pager-info')) && /dari 12000 record/.test(txt('#pager-info'))`,
    'pencarian dibersihkan', 40000);
  const waktuHalaman = [];
  for (let i = 0; i < 6; i++) {
    const r = await ev(wc, `
      const sebelum = txt('#units-grid');
      const hasil = await ukur(
        () => { const b = document.querySelector('#pager-next'); if (b) b.click(); },
        (cekLoading) => {
          const s = txt('#pager-info');
          if (cekLoading) return /memuat/.test(s);
          return !/memuat/.test(s) && txt('#units-grid') !== sebelum;
        }, 25000);
      return { ms: hasil.ms, posisi: txt('#pager-position'), kartu: document.querySelectorAll('#units-grid .card').length };`);
    waktuHalaman.push(r.ms);
    if (i === 0) ok('P.18 tombol halaman berikutnya benar-benar memuat halaman baru', /Halaman 2 \/ /.test(r.posisi) && r.kartu === 12, r);
  }
  const medHalaman = median(waktuHalaman);
  ok('P.19 median waktu berganti halaman < 800 ms', medHalaman < 800, { medHalaman, waktuHalaman });
  catat('median waktu berganti halaman (ms)', medHalaman);

  // ══ 7. Agregat KPI di layar Kas ══════════════════════════════════════════
  // Yang dibandingkan adalah isi kartu "Bulan Ini" di layar, jadi patokannya
  // juga bulan berjalan — bukan total sepanjang waktu. Angka nol ditolak supaya
  // profil yang salah tanggal tidak lolos sebagai "cocok".
  const harapanKas = {
    masuk: DB.sumCollection('kas', 'jumlah', { tipe: 'MASUK', month: BULAN_UJI }),
    keluar: DB.sumCollection('kas', 'jumlah', { tipe: 'KELUAR', month: BULAN_UJI }),
  };
  await ev(wc, `window.location.hash = '#/finance'; return true;`);
  const kasSiap = await waitFor(wc, `/dari ${JUMLAH_KAS} record/.test(txt('#pager-info'))`, 'layar kas terisi', 60000);
  ok('P.20 layar kas terisi dengan penanda halaman 6.000 record', kasSiap);
  const kasLayar = await ev(wc, `
    const cards = [...document.querySelectorAll('.stat-card')].map(c => ({ judul: ((c.querySelector('.card-title') || {}).innerText) || '', nilai: rupiah((c.querySelector('.card-value') || {}).innerText) }));
    const masuk = cards.find(c => /Kas Masuk/i.test(c.judul));
    const keluar = cards.find(c => /Kas Keluar/i.test(c.judul));
    const baris = document.querySelectorAll('#finance-table tbody tr').length;
    return { masuk: masuk && masuk.nilai, keluar: keluar && keluar.nilai, baris, info: txt('#pager-info') };`);
  ok('P.21 KPI arus kas benar pada 6.000 baris (dihitung SQLite, bukan renderer)',
    harapanKas.masuk > 0 && harapanKas.keluar > 0
    && kasLayar.masuk === harapanKas.masuk && kasLayar.keluar === harapanKas.keluar && kasLayar.baris === 25,
    { kasLayar, harapanKas });
  const sumWaktu = await ev(wc, `
    const arr = [];
    for (let i = 0; i < 9; i++) {
      const t = performance.now();
      await window.electronAPI.dbSum('kas', 'jumlah', { tipe: i % 2 ? 'KELUAR' : 'MASUK' });
      arr.push(Math.round(performance.now() - t));
    }
    return arr;`);
  const medSum = median(sumWaktu);
  ok('P.22 agregat berindeks di atas 6.000 baris < 150 ms dari renderer', medSum < 150, { medSum, sumWaktu });
  catat('median dbSum kas (ms)', medSum);

  // ══ 8. Latensi tulis per baris ═══════════════════════════════════════════
  const tulis = await ev(wc, `
    const arr = [];
    const id = 'PRF-U1001';
    for (let i = 0; i < 9; i++) {
      const s = await window.electronAPI.dbQuery({ collection: 'units', where: { id }, limit: 1 });
      const baris = s.rows[0];
      baris.hourMeter = 1000 + i;
      const t = performance.now();
      await window.electronAPI.dbPatch({ units: { upsert: [baris], removeIds: [] } });
      arr.push(Math.round(performance.now() - t));
    }
    const cek = await window.electronAPI.dbQuery({ collection: 'units', where: { id }, limit: 1 });
    return { arr, hourMeter: cek.rows[0] && cek.rows[0].hourMeter };`);
  const medTulis = median(tulis.arr);
  ok('P.23 satu baris berubah lewat jalur patch dalam < 250 ms', medTulis < 250, { medTulis, arr: tulis.arr });
  ok('P.24 tulisan benar-benar sampai ke file sebelum waktu dihitung habis', tulis.hourMeter === 1008, tulis);
  catat('median tulis satu baris via db-patch (ms)', medTulis);

  // ══ 9. Pertumbuhan: 12.000 -> 50.000 unit ════════════════════════════════
  // Tambah lewat jalur tulis SQLite (collection utuh) — renderer tidak ikut
  // memuat 38.000 baris tambahan, dan justru itu yang hendak dibuktikan.
  await wait(1500);   // beri jeda debounce store supaya tidak menimpa pertumbuhan ini
  const tGrow = Date.now();
  const tumbuh = DB.saveStore({ units: unitBanyak(50000, 'PRF') });
  const growMs = Date.now() - tGrow;
  ok('P.25 penumbuhan 50.000 unit tertulis ke profil uji', DB.rowCount('units') === 50000, { tumbuh, growMs });
  catat('saveStore 50.000 unit dari main process, termasuk membekukan event loop (ms)', growMs);

  await ev(wc, `window.location.hash = '#/units'; return true;`);
  await ev(wc, `const b = document.querySelector('#pager-first'); if (b) b.click(); return !!b;`);
  const tumbuhSiap = await waitFor(wc, `/dari 50000 record/.test(txt('#pager-info'))`, 'penanda halaman ikut bertambah', 60000);
  ok('P.26 penanda halaman menyebut 50.000 record tanpa memuat ulang aplikasi', tumbuhSiap, await ev(wc, `return txt('#pager-info');`));

  const waktuCari50k = [];
  for (const q of kueri) {
    const r = await ev(wc, `
      const hasil = await ukur(
        () => setVal(document.querySelector('#units-search'), ${JSON.stringify(q)}),
        (cekLoading) => { const s = txt('#pager-info'); return cekLoading ? /memuat/.test(s) : (!/memuat/.test(s) && /record|Tidak ada/.test(s)); },
        25000);
      return { ms: hasil.ms, kartu: document.querySelectorAll('#units-grid .card').length, info: txt('#pager-info') };`);
    waktuCari50k.push(r.ms);
    if (q === 'SANY SY215C') ok('P.27 DOM tetap 12 kartu walau tabel tumbuh ke 50.000 baris', r.kartu === 12, r);
  }
  const med50k = median(waktuCari50k);
  ok('P.28 waktu pencarian di 50.000 baris tidak lebih dari 3x waktu di 12.000 baris',
    med50k < Math.max(800, medCari * 3), { med50k, medCari, waktuCari50k });
  catat('median waktu cari layar Unit pada 50.000 baris (ms)', med50k);

  const mentah50k = await ev(wc, `
    const arr = [];
    for (let i = 0; i < 9; i++) {
      const t = performance.now();
      const r = await window.electronAPI.dbQuery({ collection: 'units', search: 'SANY SY215C', limit: 12, offset: 12000 });
      arr.push(Math.round(performance.now() - t));
      if (i === 0) var total = r.total;
    }
    return { arr, total };`);
  ok('P.29 kueri telanjang di 50.000 baris tetap < 400 ms', median(mentah50k.arr) < 400, mentah50k);
  catat('median dbQuery telanjang pada 50.000 baris (ms)', median(mentah50k.arr));

  // ══ 10. Memori & kesehatan file ══════════════════════════════════════════
  const memori = memoriProses();
  const heap = await ev(wc, `
    const m = performance.memory || {};
    return { js: Math.round((m.usedJSHeapSize || 0) / 1048576), batas: Math.round((m.jsHeapSizeLimit || 0) / 1048576) };`);
  const stats = await ev(wc, `return await window.electronAPI.dbStats();`);
  const sehat = await ev(wc, `return await window.electronAPI.dbIntegrity();`);
  ok('P.30 statistik file melaporkan 50.000 unit dan mode WAL',
    stats && stats.journalMode === 'wal' && (stats.perCollection.find(c => c.name === 'units') || {}).rows === 50000,
    { mode: stats && stats.journalMode, unit: stats && stats.perCollection.find(c => c.name === 'units') });
  ok('P.31 integritas file tetap baik setelah semua uji kinerja', sehat && sehat.ok === true, sehat && sehat.quickCheck);
  ok('P.32 proses renderer dan main masing-masing di bawah 700 MB working set',
    (memori.tab || 0) < 700 && (memori.browser || 0) < 700, memori);
  ok('P.33 heap JavaScript renderer di bawah 400 MB setelah uji', heap.js > 0 && heap.js < 400, heap);
  catat('working set per proses (MB)', JSON.stringify(memori));
  catat('heap JS renderer (MB)', heap.js);
  catat('ukuran file SQLite (MB)', stats ? (stats.sizeBytes / 1048576).toFixed(2) : 'n/a');
  catat('total baris di seluruh collection', stats ? stats.totalRows : 'n/a');

  ok('P.34 tidak ada error renderer sepanjang uji kinerja', appErrors.length === 0, appErrors.slice(0, 4));
  ok('P.35 rantai dasar (sampai 50.000 baris) selesai < 5 menit', Date.now() - AWAL_PROSES < 300000, { detik: Math.round((Date.now() - AWAL_PROSES) / 1000) });

  // ══ 11. KAPASITAS: 100.000 baris per collection besar (HEMS_PERF_KAPASITAS=1) ══
  // Pertanyaan "database kuat tampung berapa banyak, dan tetap ringan?" dijawab
  // dengan angka, bukan asumsi: 100.000 unit + 100.000 kas + 100.000 suku cadang
  // + 100.000 invoice (400.000 baris) lalu boot, buka layar, cari, agregat KPI,
  // tulis satu baris dan kesehatan file diukur ulang. Semua angka dilaporkan apa
  // adanya di QA_REPORT §3; ambang di bawah sengaja longgar (±3x yang terukur)
  // supaya yang gagal nanti adalah regresi, bukan mesin yang kurang cepat.
  if (KAPASITAS) {
    const tK = Date.now();
    DB.saveStore({ units: unitBanyak(100000, 'KAP') });
    DB.saveStore({ kas: kasBanyak(100000, 'KAP') });
    DB.saveStore({ spareParts: partBanyak(100000, 'KAP') });
    DB.saveStore({ invoices: invoiceBanyak(100000, 'KAP') });
    const msTulisK = Date.now() - tK;
    const jumlahK = {
      units: DB.rowCount('units'), kas: DB.rowCount('kas'),
      spareParts: DB.rowCount('spareParts'), invoices: DB.rowCount('invoices'),
    };
    const totalK = Object.values(jumlahK).reduce((a, b) => a + b, 0);
    ok('P.36 400.000 baris (100.000 per collection besar) tertulis sampai ke file',
      jumlahK.units === 100000 && jumlahK.kas === 100000 && jumlahK.spareParts === 100000 && jumlahK.invoices === 100000,
      { jumlahK, msTulisK });
    catat('waktu main process menulis 400.000 baris (ms)', msTulisK);

    // Boot adalah angka yang paling menakutkan: di sinilah aplikasi dulu menyalin
    // seluruh isi file ke renderer. Kalau hidrasi per menu (#38) bekerja, biaya
    // boot tidak boleh tumbuh mengikuti jumlah baris.
    wc.reload();
    const tBoot = Date.now();
    const bootK = await waitFor(wc, `/Dasbor|Armada|Kontrol/i.test(document.body.innerText)`, 'boot pada 400.000 baris', 120000);
    const bootMs = Date.now() - tBoot;
    ok('P.37 boot pada 400.000 baris tetap < 20 s dan tanpa error',
      bootK === true && bootMs < 20000 && appErrors.length === 0, { bootMs, appErrors: appErrors.slice(0, 3) });
    catat('boot ulang pada 400.000 baris (ms)', bootMs);

    const bacaBoot = await ev(wc, `return (await window.electronAPI.dbStats()).reads;`);

    // LIKE '%…%' tidak bisa memakai indeks: SQLite memindai seluruh blob pencarian.
    // Kueri ini dijalankan SEBELUM ada kueri lain mengisi cache halaman berkas, jadi
    // inilah angka "dingin" yang benar-benar dilihat pengguna sesudah komputer nyala.
    const dinginMentah = await ev(wc, `
      const t = performance.now();
      const s = await window.electronAPI.dbQuery({ collection: 'units', search: 'SANY SY215C', limit: 12, offset: 0 });
      return { ms: Math.round(performance.now() - t), total: s.total };`);
    ok('P.37b kueri pencarian pertama sesudah boot di 100.000 unit dijawab < 20 s dan jumlahnya benar',
      dinginMentah.ms < 20000 && dinginMentah.total === 20000, dinginMentah);
    catat('dbQuery pencarian pertama sesudah boot pada 100.000 unit, cache dingin (ms)', dinginMentah.ms);
    await ev(wc, `window.location.hash = '#/dashboard'; return true;`);
    await wait(400);
    const bukaUnitK = await ev(wc, `
      const t = performance.now();
      window.location.hash = '#/units';
      let dapat = false;
      while (performance.now() - t < 60000) {
        if (/dari 100000 record/.test(txt('#pager-info'))) { dapat = true; break; }
        await tick(16);
      }
      return { ms: Math.round(performance.now() - t), dapat,
               kartu: document.querySelectorAll('#units-grid .card').length, info: txt('#pager-info') };`);
    ok('P.38 membuka layar Armada di 100.000 unit menampilkan halaman pertama < 4 s',
      bukaUnitK.dapat === true && bukaUnitK.ms < 4000 && bukaUnitK.kartu > 0 && bukaUnitK.kartu <= 12, bukaUnitK);
    ok('P.38b membuka layar Armada di 100.000 unit tidak memindahkan baris store',
      (await ev(wc, `return (await window.electronAPI.dbStats()).reads;`)).rows === bacaBoot.rows,
      { saatBoot: bacaBoot.rows, setelahBuka: (await ev(wc, `return (await window.electronAPI.dbStats()).reads;`)).rows });
    catat('waktu membuka layar Armada pada 100.000 unit (ms)', bukaUnitK.ms);

    // Tiap kueri HARUS dimulai dari daftar penuh. Kalau tidak, teks pager hasil
    // kueri sebelumnya terbaca sebagai jawaban baru — dan di data uji ini dua kueri
    // berbeda ('SANY SY215C' dan 'TADANO AD10') menghasilkan angka yang sama
    // persis (20.000), jadi "teks sudah berubah" tidak bisa dipakai sebagai tanda.
    const jalaniCari = async (q) => {
      await ev(wc, `setVal(document.querySelector('#units-search'), ''); return true;`);
      const bersih = await waitFor(wc, `/dari 100000 record/.test(txt('#pager-info'))`, 'kembali ke daftar penuh', 60000);
      if (!bersih) return { q, dapat: false, ms: -1, total: -1, harapan: -1, info: await ev(wc, `return txt('#pager-info');`) };
      const r = await ev(wc, `
        const t = performance.now();
        setVal(document.querySelector('#units-search'), ${JSON.stringify(q)});
        let dapat = false;
        while (performance.now() - t < 30000) {
          const s = txt('#pager-info');
          if (!/memuat/.test(s) && !/dari 100000 record/.test(s)) { dapat = true; break; }
          await tick(16);
        }
        return { ms: Math.round(performance.now() - t), dapat, info: txt('#pager-info') };`);
      const angka = r.info.match(/dari (\d+) record/);
      const total = angka ? Number(angka[1]) : (/Tidak ada/i.test(r.info) ? 0 : -1);
      // Paritas: jumlah yang dilihat pengguna harus sama dengan yang dihitung
      // SQLite untuk kueri yang sama — kalau tidak, pencariannya tidak diterapkan.
      const harapan = DB.queryCollection({ collection: 'units', search: q, limit: 12, offset: 0 }).total;
      return { q, ...r, total, harapan };
    };
    const KUER = ['SANY SY215C', 'KAPISN000777', 'TADANO AD10'];
    const dingin = [];
    for (const q of KUER) dingin.push(await jalaniCari(q));
    ok('P.39 pencarian di 100.000 unit dijawab dan jumlah recordnya sama dengan SQLite',
      dingin.every(r => r.dapat === true && r.total >= 0 && r.total === r.harapan), dingin);
    ok('P.39b setiap kueri pencarian di 100.000 unit dijawab < 3 s (dari daftar penuh)',
      dingin.every(r => r.ms >= 0 && r.ms < 3000), dingin.map(r => [r.q, r.ms]));
    catat('waktu cari per kueri pada 100.000 unit, lintasan pertama (ms)', JSON.stringify(dingin.map(r => [r.q, r.ms])));

    // Putaran kedua mengulang kueri yang sama. Perhatikan bahwa putaran PERTAMA pun
    // sudah hangat: setiap kueri didahului COUNT daftar penuh yang membaca blob
    // pencarian. Angka cache dingin yang sebenarnya ada di P.37b.
    const hangat = [];
    for (const q of KUER) hangat.push(await jalaniCari(q));
    const medHangat = median(hangat.map(r => r.ms));
    ok('P.39c kueri yang sama diulang (cache hangat) dijawab < 1.500 ms (median)',
      medHangat < 1500 && hangat.every(r => r.dapat === true && r.total === r.harapan), { medHangat, hangat: hangat.map(r => [r.q, r.ms]) });
    catat('median waktu cari per kueri pada 100.000 unit, lintasan kedua (ms)', medHangat);
    await ev(wc, `setVal(document.querySelector('#units-search'), ''); return true;`);

    const mentahK = await ev(wc, `
      const arr = [];
      for (let i = 0; i < 11; i++) {
        const t = performance.now();
        await window.electronAPI.dbQuery({ collection: 'units', search: 'SANY SY215C', sort: 'purchaseDate', limit: 12, offset: 0 });
        arr.push(Math.round(performance.now() - t));
      }
      return arr;`);
    ok('P.40 kueri berindeks di atas 100.000 baris tetap < 1,2 s (median)', median(mentahK) < 1200, { med: median(mentahK), mentahK });
    catat('median dbQuery telanjang pada 100.000 unit (ms)', median(mentahK));

    const harapanK = { masuk: DB.sumCollection('kas', 'jumlah', { tipe: 'MASUK' }) };
    const agregatK = await ev(wc, `
      const arr = [];
      for (let i = 0; i < 9; i++) {
        const t = performance.now();
        const s = await window.electronAPI.dbSum('kas', 'jumlah', { tipe: 'MASUK' });
        arr.push(Math.round(performance.now() - t));
        if (i === 0) window.__nilai = s;
      }
      return { arr, nilai: window.__nilai };`);
    ok('P.41 agregat KPI di atas 100.000 baris kas benar dan < 1,5 s (median)',
      agregatK.nilai === harapanK.masuk && median(agregatK.arr) < 1500, { nilai: agregatK.nilai, harapan: harapanK.masuk, med: median(agregatK.arr) });
    catat('median dbSum kas pada 100.000 baris (ms)', median(agregatK.arr));

    const tulisK = await ev(wc, `
      const arr = [];
      const id = 'KAP-U50000';
      for (let i = 0; i < 9; i++) {
        const s = await window.electronAPI.dbQuery({ collection: 'units', where: { id }, limit: 1 });
        const baris = s.rows[0];
        baris.hourMeter = 2000 + i;
        const t = performance.now();
        await window.electronAPI.dbPatch({ units: { upsert: [baris], removeIds: [] } });
        arr.push(Math.round(performance.now() - t));
      }
      const cek = await window.electronAPI.dbQuery({ collection: 'units', where: { id }, limit: 1 });
      return { arr, hourMeter: cek.rows[0] && cek.rows[0].hourMeter };`);
    ok('P.42 menyimpan SATU baris di profil 400.000 baris tetap < 400 ms dan sampai ke file',
      median(tulisK.arr) < 400 && tulisK.hourMeter === 2008, { med: median(tulisK.arr), hourMeter: tulisK.hourMeter });
    catat('median tulis satu baris pada 400.000 baris (ms)', median(tulisK.arr));

    const statsK = await ev(wc, `return await window.electronAPI.dbStats();`);
    const sehatK = await ev(wc, `return await window.electronAPI.dbIntegrity();`);
    const memoriK = memoriProses();
    const heapK = await ev(wc, `
      const m = performance.memory || {};
      return { js: Math.round((m.usedJSHeapSize || 0) / 1048576) };`);
    ok('P.43 file dan integritas tetap sehat pada 400.000 baris',
      sehatK && sehatK.ok === true && statsK && statsK.journalMode === 'wal' && statsK.totalRows >= 400000,
      { ok: sehatK && sehatK.ok, totalRows: statsK && statsK.totalRows, mode: statsK && statsK.journalMode });
    ok('P.44 memori tidak tumbuh mengikuti isi file (renderer < 500 MB, tiap proses < 1.100 MB)',
      heapK.js < 500 && (memoriK.tab || 0) < 1100 && (memoriK.browser || 0) < 1100, { heapK, memoriK });
    catat('ukuran file SQLite pada 400.000 baris (MB)', statsK ? (statsK.sizeBytes / 1048576).toFixed(2) : 'n/a');
    catat('total baris seluruh collection', statsK ? statsK.totalRows : 'n/a');
    catat('working set per proses pada 400.000 baris (MB)', JSON.stringify(memoriK));
    catat('heap JS renderer pada 400.000 baris (MB)', heapK.js);
    ok('P.45 tidak ada error renderer sepanjang uji kapasitas', appErrors.length === 0, appErrors.slice(0, 4));
    const detikK = Math.round((Date.now() - AWAL_PROSES) / 1000);
    ok('P.46 seluruh rantai plus uji kapasitas selesai < 5 menit', detikK < 300, { detikK });
    catat('total waktu harness termasuk uji kapasitas (detik)', detikK);
  }

  console.log(`\n=== perf-check: ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

seedProfil();
require('../../dist-electron/main.js');
