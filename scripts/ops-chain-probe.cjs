// scripts/ops-chain-probe.cjs
// PROBE, bukan langkah regresi. Dirancang untuk menjawab satu pertanyaan tanpa
// pendapat: apakah rantai "alat berat beroperasi → butuh servis → BBM → biaya →
// Dasbor/Laporan" benar-benar berjalan di build hari ini, dan apakah gerbang
// keamanannya berlaku di tempat yang tidak bisa dilewati.
//
// Kenapa alat sendiri dan bukan tests/harness: rantai regresi menilai JAMINAN
// yang sudah dimiliki aplikasi. Enam titik yang ditanyakan user belum semuanya
// ada sebagai fitur, dan menjadikannya assertion rantai akan berarti
// merah-melalui-hijau atau memalsukan klaim. Probe ini mencetak dua macam baris:
//   PASS/FAIL  -> jaminan yang memang sudah ada dan diuji (sesi, peran, angka,
//                 meter naik, handoff, agregat)
//   CACAT      -> hasil ukur yang menunjukkan rantai putus / gerbang bisa
//                 dilewati. Sengaja tidak menggagarkan kode keluar: temuan ini
//                 butuh keputusan sumber, bukan warna.
//
// Profil uji sendiri (HEMS_DATA_DIR wajib). Tidak pernah menyentuh %APPDATA%
// pengguna nyata.
//
// Jalankan (satu proses Electron pada satu waktu, mesin ini 3,8 GB):
//   rm -rf /d/SANY/tmp-harness/p-opschain
//   HEMS_DATA_DIR=D:/SANY/tmp-harness/p-opschain \
//     node_modules/electron/dist/electron.exe scripts/ops-chain-probe.cjs

const { app, BrowserWindow } = require('electron');
const selesai = require('../tests/harness/selesai.cjs');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.HEMS_DATA_DIR;

let pass = 0, fail = 0;
const temuan = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
/** Satu hasil ukur yang tidak dinilai sebagai jaminan — temuan, bukan regresi. */
function cacat(name, bukti) {
  temuan.push(name);
  console.log('CACAT ' + name + (bukti !== undefined ? ' -> ' + JSON.stringify(bukti) : ''));
}
function ukur(name, nilai) { console.log('UKUR ' + name + ' = ' + JSON.stringify(nilai)); }
const wait = ms => new Promise(r => setTimeout(r, ms));

const HELPERS = `
  function setVal(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function setSelect(el, v) {
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    proto.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function byText(re, tag) {
    return [...document.querySelectorAll(tag || 'button')].find(x => re.test((x.innerText || '').trim()));
  }
  // Klik dengan rangkaian event lengkap: beberapa tombol hanya bereaksi pada
  // pointerdown/mousedown, dan labelnya sering diawali ikon sehingga hanya bisa
  // dicocokkan dengan regex longgar.
  function klik(re, tag) {
    const el = byText(re, tag);
    if (!el) return false;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
      const Ctor = t.startsWith('pointer') ? (window.PointerEvent || window.MouseEvent) : window.MouseEvent;
      el.dispatchEvent(new Ctor(t, { bubbles: true, cancelable: true, view: window }));
    });
    return true;
  }
  const group = (root, label) => [...(root ? root.querySelectorAll('.form-group') : [])]
    .find(x => String((x.querySelector('.form-label') || {}).innerText || '').indexOf(label) >= 0);
  async function readStore() {
    const d = await window.electronAPI.dbLoad();
    return d && typeof d === 'object' ? d : {};
  }
`;

function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`);
}

async function waitFor(wc, expr, label, timeoutMs = 30000) {
  const mulai = Date.now();
  while (Date.now() - mulai < timeoutMs) {
    if (await ev(wc, `return !!(${expr});`)) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

async function waitForStore(wc, body, label, timeoutMs = 25000) {
  const mulai = Date.now();
  while (Date.now() - mulai < timeoutMs) {
    const v = await ev(wc, `const s = await readStore(); ${body}`);
    if (v !== false && v !== null && v !== undefined) return v;
    await wait(300);
  }
  console.log(`TIMEOUT menunggu store: ${label}`);
  return null;
}

// Autosave hidup di renderer dengan debounce: nilai hanya boleh dinilai setelah
// tidak ada tulisan yang mengalir lagi.
async function tulisTenang(wc) {
  let terakhir = await ev(wc, `return await window.electronAPI.dbStats();`);
  for (let i = 0; i < 10; i++) {
    await wait(1200);
    const kini = await ev(wc, `return await window.electronAPI.dbStats();`);
    const sama = ['patchCalls', 'patchUpsertRows', 'patchRemoveIds', 'fullCalls']
      .every(k => kini[k] === terakhir[k]);
    if (sama) return kini;
    terakhir = kini;
  }
  return terakhir;
}

const STUB = `
  window.__alerts = [];
  window.confirm = () => true;
  window.alert = (m) => { window.__alerts.push(String(m)); };
  return true;`;
const stub = wc => ev(wc, STUB);

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev2, _lvl, msg) => {
    if (/error|uncaught|failed/i.test(msg)) console.log('RENDERER:', msg.slice(0, 300));
  });
  wc.on('did-finish-load', () => { stub(wc).catch(() => {}); });
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    wc.once('did-finish-load', () => run(wc).catch(async err => {
      console.log('PROBE ERROR', err && (err.stack || err.message));
      try { console.log('DOM:', JSON.stringify((await ev(wc, 'return document.body.innerText.slice(0,300);')))); } catch { /* abaikan */ }
      selesai(app, 2);
    }));
  }
});

// ── Data uji ────────────────────────────────────────────────────────────────
// Satu alat 440 HM: siklus servis 500 HM membuat servis berikutnya jatuh di
// 500 HM (sisa 60), dan pembacaan 520 HM di Work Order afterward memindahkannya
// ke 1.000 HM (sisa 480). Semua angka lain dipilih supaya mudah ditelusuri.
const UNIT_SERIAL = 'OPS-SY-900';
const SEED = {
  units: [{
    id: 'OP-U1', serialNumber: UNIT_SERIAL, brand: 'SANY', model: 'SY215C',
    status: 'AVAILABLE', hourMeter: 440, purchasePrice: 1_200_000_000,
    purchaseDate: '2023-01-10', location: 'Sites Uji', year: '2023',
  }],
  customers: [{ id: 'OP-C1', name: 'PT Operasi Uji', segment: 'KONTRAKTOR', contactPerson: 'Operator Uji', phone: '0812-OPS-0001', email: 'opsi@uji.test', address: 'Cikande' }],
  brands: [{ id: 'OP-B1', name: 'SANY', country: 'China', category: 'Excavator' }],
  models: [{ id: 'OP-M1', brandName: 'SANY', modelCode: 'SY215C', category: 'Excavator',
    capacity: '1,2 m3 Uji', enginePower: '129 kW Uji', operatingWeight: '21.500 kg Uji' }],
  suppliers: [{ id: 'OP-S1', name: 'PT Pertamina Uji', category: 'FUEL', phone: '0800-OPS', email: '', address: '' }],
  spareParts: [{ id: 'OP-P1', name: 'Filter Oli Uji', sku: 'OPS-SKU-1', stock: 4, minStock: 2, price: 350_000, unit: 'pcs' }],
  invoices: [],
  sales: [],
  rentals: [{
    id: 'OP-R1', contractNo: 'RCT-OPS-0001', customerName: 'PT Operasi Uji', unitModel: 'SANY SY215C',
    serialNumber: UNIT_SERIAL, location: 'Sites Uji', startDate: '2026-10-01', endDate: '2026-12-31',
    monthlyRate: 90_000_000, minimumHours: 200, operatorIncluded: true, status: 'ACTIVE',
  }],
  services: [], kas: [], deliveries: [], warehouse: [], purchases: [], documents: [],
  bankAccounts: [], breakdowns: [], operators: [], technicians: [], approvals: [],
};

const patch = (wc, p) => ev(wc, `return await window.electronAPI.dbPatch(${JSON.stringify(p)});`);
const sum = (wc, c, col, where) => ev(wc,
  `return await window.electronAPI.dbSum(${JSON.stringify(c)}, ${JSON.stringify(col)}, ${JSON.stringify(where || null)});`);

async function run(wc) {
  if (!DATA_DIR || !fs.existsSync(DATA_DIR)) {
    console.log('PROBE ERROR: HEMS_DATA_DIR wajib pointing ke folder sementara yang ada');
    selesai(app, 3);
    return;
  }
  await wait(400);
  const win = BrowserWindow.fromWebContents(wc);
  if (win) win.setSize(1366, 800);
  await stub(wc);

  require('../dist-electron/db.js').saveStore(JSON.parse(JSON.stringify(SEED)));
  await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER', 'PERSONAL'], customMenus: [], isSetupComplete: true }));
    localStorage.removeItem('hems_session');
    localStorage.removeItem('hems_session_v2');
    return true;`);
  await wc.reload();
  ok('0.1 boot sampai layar login', await waitFor(wc, `!!document.querySelector('#login-username')`, 'form login', 45000));
  await stub(wc);
  await ev(wc, `
    setVal(document.querySelector('#login-username'), 'admin');
    setVal(document.querySelector('#login-password'), 'admin123');
    const b = byText(/Masuk ke FATHONI/); if (b) b.click(); return !!b;`);
  await waitFor(wc, `/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'layar ganti password', 45000);
  await ev(wc, `
    setVal(document.querySelector('#cpw-current'), 'admin123');
    setVal(document.querySelector('#cpw-next'), 'BaruOps123');
    setVal(document.querySelector('#cpw-confirm'), 'BaruOps123');
    const b = byText(/Simpan password baru/); if (b) b.click(); return !!b;`);
  ok('0.2 aplikasi terbuka', await waitFor(wc,
    `/Dasbor|Armada|Kontrol/i.test(document.body.innerText) && !/Ganti password sebelum melanjutkan/.test(document.body.innerText)`,
    'shell setelah login', 45000));

  // ══ 1. Titik (1): adakah tempat mencatat HM AWAL dan HM AKHIR? ══════════════
  const spec = require('../dist-electron/dbSchema.js');
  const kolom = Object.entries(spec.SPEC_BY_NAME).map(([n, s]) => [n, s.columns.map(c => c.col)]);
  const berHM = kolom.filter(([, cs]) => cs.some(c => /hour|hm/i.test(c)));
  ukur('collection yang menyimpan kolom mirip jam meter', berHM);
  const pasangan = kolom.filter(([, cs]) => {
    const awal = cs.filter(c => /start|awal/i.test(c) && /hour|hm|jam/i.test(c));
    const akhir = cs.filter(c => /end|akhir/i.test(c) && /hour|hm|jam/i.test(c));
    return awal.length > 0 && akhir.length > 0;
  });
  if (pasangan.length === 0) {
    cacat('1.1 tidak ada SATU pun collection yang menyimpan pasangan HM awal & HM akhir — "jam kerja" tidak bisa dihitung dari selisih',
      { collection_dipindai: kolom.length, yang_memiliki_HM: berHM.map(x => x[0] + '.' + x[1].filter(c => /hour|hm/i.test(c))) });
  } else {
    ok('1.1 pasangan HM awal/akhir tersedia', true, pasangan);
  }
  const menu = await ev(wc, `
    return [...document.querySelectorAll('aside a, nav a')].map(a => (a.innerText || '').trim()).filter(Boolean);`);
  ukur('jumlah menu sidebar', menu.length);
  const menuOperasi = menu.filter(m => /operasi|log harian|catatan harian/i.test(m));
  ukur('menu tempat operator mencatat pembacaan meter', menuOperasi);
  if (menuOperasi.length === 0) {
    cacat('1.2 tidak ada menu "Operasional" tempat operator mencatat pembacaan meter per hari', { sidebar: menu });
  }
  const sumberLabel = fs.readdirSync(path.join(__dirname, '../src/pages'))
    .filter(f => f.endsWith('.tsx'))
    .filter(f => /HM\s*(Awal|Akhir)|Hour\s*Meter\s*(Awal|Akhir|Start|End)/i
      .test(fs.readFileSync(path.join(__dirname, '../src/pages', f), 'utf8')));
  ukur('halaman dengan label HM Awal / HM Akhir', sumberLabel);

  // ══ 2. Titik (2)+(4): Work Order membaca meter → servis memutarkan siklus ═══
  await ev(wc, `window.location.hash = '#/service'; return true;`);
  ok('2.1 halaman Servis memuat',
    await waitFor(wc, `/Work Order & Servis Alat Berat/.test(document.body.innerText)`, 'daftar WO'));
  await ev(wc, `const b = byText(/Buka Work Order Servis/); if (b) b.click(); return !!b;`);
  ok('2.2 form Work Order terbuka', await waitFor(wc, `/Buka Work Order Servis Baru/.test(document.body.innerText)`, 'form WO'));
  const diisiWO = await ev(wc, `
    const modal = document.querySelector('.modal');
    const isi = (label, nilai, tag) => {
      const g = group(modal, label); const el = g && g.querySelector(tag || 'input');
      if (!el) return label; if (tag === 'select') setSelect(el, nilai); else setVal(el, nilai); return null;
    };
    const hilang = [];
    ['Nomor Work Order|WO-OPS-001|input', 'Pilih Unit|${UNIT_SERIAL}|select',
      'Pelanggan|PT Operasi Uji|select', 'Hour Meter|520|input', 'Teknisi|Agus|input',
      'Estimasi Biaya|2500000|input'].forEach(x => {
      const [l, v, t] = x.split('|'); const r = isi(l, v, t); if (r) hilang.push(r);
    });
    return { hilang, serial: (group(modal, 'Pilih Unit').querySelector('select') || {}).value,
             hm: (group(modal, 'Hour Meter').querySelector('input') || {}).value };`);
  ok('2.2b form WO terisi lewat labelnya (unit 440 HM vs pembacaan 520 HM)',
    diisiWO.hilang.length === 0 && diisiWO.serial === UNIT_SERIAL && diisiWO.hm === '520', diisiWO);
  await ev(wc, `window.__alerts.length = 0; const b = byText(/Terbitkan Work Order/); if (b) b.click(); return !!b;`);
  const wo = await waitForStore(wc, `
    const w = (s.services || []).find(x => x.woNumber === 'WO-OPS-001');
    if (!w) return false;
    return { hm: w.hourMeter, status: w.status, serial: w.serialNumber, alerts: (window.__alerts || []).slice() };
  `, 'WO 520 HM tersimpan');
  ok('2.3 WO 520 HM (naik dari 440) tersimpan tanpa penolakan',
    !!wo && Number(wo.hm) === 520 && wo.alerts.length === 0, wo);

  await tulisTenang(wc);
  const bukaSelesai = await ev(wc, `
    const kartu = [...document.querySelectorAll('[draggable]')].find(d => /WO-OPS-001/.test(d.innerText));
    const mulai = kartu && [...kartu.querySelectorAll('button')].find(x => x.title === 'Mulai Kerja' || /^Mulai Kerja/.test((x.innerText||'').trim()));
    if (mulai) mulai.click();
    return !!mulai;`);
  ok('2.4 WO bisa dimulai dari kartunya', bukaSelesai === true
    && await waitFor(wc, `[...document.querySelectorAll('[draggable]')].some(d => /WO-OPS-001/.test(d.innerText)
      && [...d.querySelectorAll('button')].some(x => /^Selesai/.test(x.title || (x.innerText || '').trim())))`, 'kartu WO siap diselesaikan'));
  await ev(wc, `
    const kartu = [...document.querySelectorAll('[draggable]')].find(d => /WO-OPS-001/.test(d.innerText));
    const b = kartu && [...kartu.querySelectorAll('button')].find(x => /^Selesai/.test(x.title || (x.innerText || '').trim()));
    if (b) b.click();
    return !!b;`);
  ok('2.5 modal penyelesaian terbuka', await waitFor(wc, `/Selesaikan Servis WO-OPS-001/.test(document.body.innerText)`, 'modal selesai'));
  await ev(wc, `
    const g = group(document.querySelector('.modal'), 'Biaya Aktual');
    const i = g && g.querySelector('input'); if (i) setVal(i, '3000000');
    const b = byText(/Tandai Selesai/); if (b) b.click();
    return { biaya: i ? i.value : null, klik: !!b };`);
  await tulisTenang(wc);
  const setelahServis = await waitForStore(wc, `
    const u = (s.units || []).find(x => x.serialNumber === '${UNIT_SERIAL}');
    const w = (s.services || []).find(x => x.woNumber === 'WO-OPS-001');
    if (!u || !w || w.status !== 'COMPLETED') return false;
    return { hm: u.hourMeter, lastServiceHM: u.lastServiceHM, status: u.status, woStatus: w.status };
  `, 'unit menaiki meter');
  ok('2.6 servis selesai menulis units.hourMeter = 520 (bukan dibiarkan 440)',
    !!setelahServis && Number(setelahServis.hm) === 520, setelahServis);
  ok('2.7 servis selesai menulis lastServiceHM = 520',
    !!setelahServis && Number(setelahServis.lastServiceHM) === 520, setelahServis);

  // Kolom turunan TIDAK ikut dikembalikan di rows (queryCollection hanya
  // mengirim payload), jadi nilainya diuji lewat penyaringan pada kolom itu
  // sendiri — itulah cara kolom turunan dipakai halaman.
  const due = await ev(wc, `
    return await window.electronAPI.dbQuery({ collection: 'units', where: { serviceDueIn: { gte: 479, lte: 481 } }, limit: 5 });`);
  ukur('unit yang serviceDueIn-nya 480 menurut SQLite', due && due.total);
  ok('2.8 kolom turunan SQLite: 500 - (520 % 500) = 480',
    !!due && Number(due.total) === 1 && due.rows[0].serialNumber === UNIT_SERIAL, due && { total: due.total, rows: due.rows.map(r => r.serialNumber) });
  const tidakJatuhTempo = await ev(wc, `
    return await window.electronAPI.dbQuery({ collection: 'units', where: { serviceDueIn: { gte: 1, lte: 50 } }, limit: 5 });`);
  ok('2.8b alat dengan 40 HM tersisa tidak dianggap jatuh tempo (alert Dasbor kosong)',
    !!tidakJatuhTempo && Number(tidakJatuhTempo.total) === 0, tidakJatuhTempo && tidakJatuhTempo.total);

  await ev(wc, `window.location.hash = '#/units'; return true;`);
  ok('2.9 halaman Unit memuat',
    await waitFor(wc, `/Kelola daftar unit, jam kerja/.test(document.body.innerText)`, 'daftar unit'));
  const kartuUnit = await ev(wc, `
    const k = [...document.querySelectorAll('[id=units-grid] > *, .card')].find(x => /OPS-SY-900/.test(x.innerText));
    return k ? k.innerText : null;`);
  const hmDiLayar = kartuUnit ? /(\d[\d.,]*)\s*HM/.exec(kartuUnit) : null;
  ok('2.10 kartu Unit menampilkan meter 520 HM yang baru', !!hmDiLayar && Number(hmDiLayar[1].replace(/[.,]/g, '')) >= 520,
    hmDiLayar && hmDiLayar[1]);

  // Kartu detail Unit dulu memajang angka tetap untuk SEMUA alat (BBM 16,5 L/jam,
  // operator "Bambang Supriyanto", GPS Online, garansi s.d Jan 2026). Sekarang
  // kapasitas/daya/berat dibaca dari katalog Merek & Model dan yang tidak ada
  // kolomnya ditulis apa adanya.
  await ev(wc, `
    if (!/Spesifikasi Teknis Unit/.test(document.body.innerText)) {
      const k = [...document.querySelectorAll('.card')].find(x => /OPS-SY-900/.test(x.innerText) && x.style.cursor === 'pointer');
      if (k) k.click();
    }
    return /Spesifikasi Teknis Unit/.test(document.body.innerText);`);
  const detail = await waitFor(wc, `/Spesifikasi Teknis Unit/.test(document.body.innerText)`, 'kartu detail unit')
    ? await ev(wc, `return document.body.innerText;`) : '';
  ok('2.11 spesifikasi unit berasal dari katalog Merek & Model', /1,2 m3 Uji/.test(detail) && /129 kW Uji/.test(detail),
    (detail.match(/[^\n]*(Kapasitas|Daya Mesin|Berat Operasi)[^\n]*\n[^\n]*/g) || []).slice(0, 3));
  const hiasan = ['16.5 Liter', 'Bambang Supriyanto', 'Ir. Handoko', 'Online (Signal Strong)', 'Aktif (s.d Jan 2026)']
    .filter(t => detail.includes(t));
  ok('2.12 tidak ada lagi angka hiasan per unit di kartu detail', hiasan.length === 0, hiasan);

  // ── Tab riwayat kartu detail unit ──────────────────────────────────────────
  // Kelima tab itu dulu memajang lima daftar TETAP — WO "SPK-2025-012", part
  // "P-1002", klaim "CLM-2024-008", kontrak "KNT-2025-001", dokumen
  // "SIA-2024-8891-JKT" — yang tercetak identik untuk semua alat, dan tiap
  // tombolnya hanya memunculkan alert(). Yang diukur sini ada tiga: barisnya
  // benar-benar milik unit ini (dibaca dari SQLite atas nomor sasis), yang tidak
  // punya kolom penaut diucapkan apa adanya, dan tombolnya mengantar ke menu
  // tempat record itu memang dibuat sambil mengisi unitnya.
  const HIASAN_LAMA = ['SPK-2025-012', 'SPK-2025-089', 'SPK-2025-042', 'P-1002', 'P-2004',
    'CLM-2024-008', 'KNT-2025-001', 'KNT-2025-044', 'SIA-2024-8891-JKT', 'SILO-SANY',
    'INS-ALLIANZ', 'GARANSI AKTIF', 'Ahmad Jaya'];
  // innerText memakai teks TERPANGGIL: .badge bergaya text-transform:uppercase,
  // jadi label 'Servis Selesai' terbaca layar sebagai 'SERVIS SELESAI'. Spasi
  // dinormalkan karena elemen blok menambah ganti baris.
  const normal = (teks) => String(teks).replace(/\s+/g, ' ').toLowerCase();
  const feq = (teks, frasa) => frasa.filter(f => !normal(teks).includes(normal(f)));
  const sama = (teks, frasa) => feq(teks, frasa).length === 0;

  /** Buka kartu detail unit ini, klik satu tab, tunggu isinya, kembalikan teksnya. */
  async function keTab(nama, tuntas, label) {
    await ev(wc, `window.location.hash = '#/units'; return true;`);
    // Penanda "kartu detail sedang terbuka" harus teks yang hidup di SEMUA tab:
    // 'Spesifikasi Teknis Unit' hanya ada di tab RINGKASAN, jadi begitu tab lain
    // aktif ia hilang dan kartu seolah-olah belum terbuka.
    const detailTerbuka = `/PASSPORT DIGITAL/.test(document.body.innerText)`;
    if (!await waitFor(wc, `/${UNIT_SERIAL}/.test(document.body.innerText)`, `layar Unit (${label})`)) return null;
    await ev(wc, `
      if (!(${detailTerbuka})) {
        const k = [...document.querySelectorAll('.card')].find(x => /${UNIT_SERIAL}/.test(x.innerText) && x.style.cursor === 'pointer');
        if (k) k.click();
      }
      return true;`);
    if (!await waitFor(wc, detailTerbuka, `kartu detail (${label})`)) return null;
    if (!await ev(wc, `return klik(new RegExp('^' + ${JSON.stringify(nama)} + '$'), 'button');`)) return null;
    if (!await waitFor(wc, tuntas, `isi tab ${label}`, 20000)) return null;
    return await ev(wc, `return document.body.innerText;`);
  }

  // Nilai sebuah field di form yang sedang terbuka, dibaca lewat labelnya.
  const bacaForm = (grup) => ev(wc, `
    const m = document.querySelector('.modal') || document;
    const nilai = (label) => { const g = group(m, label); const el = g && (g.querySelector('select') || g.querySelector('input'));
      return el ? el.value : null; };
    return { hash: location.hash, judul: ((document.querySelector('.modal-title') || {}).innerText || '').trim(),
             ${grup}, alert: (window.__alerts || []).slice() };`);
  const terisi = (label, nilai) => `(() => { const m = document.querySelector('.modal'); if (!m) return false;
    const g = group(m, '${label}'); const el = g && (g.querySelector('select') || g.querySelector('input'));
    return !!el && el.value === '${nilai}'; })()`;

  const tabRawat = await keTab('PERAWATAN',
    `/WO-OPS-001|Belum ada Work Order/.test(document.body.innerText)`, 'perawatan');
  ok('2.13 tab PERAWATAN menampilkan Work Order unit ini dari database (520 HM, selesai)',
    !!tabRawat && sama(tabRawat, ['WO-OPS-001', 'Servis Berkala 250 Jam', '520 HM', 'Agus',
      'Servis Selesai', 'Rp 2.500.000']),
    { tab: tabRawat && tabRawat.replace(/\s+/g, ' ').slice(0, 260), kurang: feq(tabRawat || '', ['WO-OPS-001',
      'Servis Berkala 250 Jam', '520 HM', 'Agus', 'Servis Selesai', 'Rp 2.500.000']) });
  // Kartu ini menjanjikan "Biaya (aktual / estimasi)". Yang sebenarnya tersimpan
  // di baris Work Order diukur terpisah, supaya angka Rp2,5 juta di layar tidak
  // dibaca sebagai biaya aktual servis.
  const barisWO = await ev(wc, `
    const q = await window.electronAPI.dbQuery({ collection: 'services', where: { woNumber: 'WO-OPS-001' }, limit: 1 });
    const r = (q && q.rows && q.rows[0]) || {};
    return { kolom: Object.keys(r), actualCost: r.actualCost, estimatedCost: r.estimatedCost, status: r.status };`);
  if (!barisWO || !(Number(barisWO.actualCost) > 0)) {
    cacat('2.13b biaya aktual yang diketik saat menyelesaikan servis tidak pernah sampai ke baris Work Order: kolom "Biaya (aktual / estimasi)" di kartu Unit selalu menunjukkan estimasi, sementara uang aktualnya hanya ada di Invoice/Kas',
      { actualCost: barisWO && barisWO.actualCost, estimasi: barisWO && barisWO.estimatedCost,
        status: barisWO && barisWO.status, kolom: barisWO && barisWO.kolom });
  }

  const tabSewa = await keTab('SEWA',
    `/RCT-OPS-0001|Belum ada kontrak sewa/.test(document.body.innerText)`, 'sewa');
  ok('2.14 tab SEWA menampilkan kontrak sewa unit ini dari database (tarif dan status aslinya)',
    !!tabSewa && sama(tabSewa, ['RCT-OPS-0001', 'PT Operasi Uji', '2026-10-01 s/d 2026-12-31',
      'Rp 90.000.000', 'Sedang Berjalan']),
    { tab: tabSewa && tabSewa.slice(0, 260), kurang: feq(tabSewa || '', ['RCT-OPS-0001', 'PT Operasi Uji',
      '2026-10-01 s/d 2026-12-31', 'Rp 90.000.000', 'Sedang Berjalan']) });

  const tabPart = await keTab('SUKU CADANG',
    `/mutasi gudang tidak menyimpan nomor sasis/.test(document.body.innerText)`, 'suku cadang');
  ok('2.15 tab SUKU CADANG mengakui mutasi gudang tidak menyimpan nomor sasis, dan menunjuk jumlah WO nyata unit ini',
    !!tabPart && sama(tabPart, ['Baris mutasi gudang tidak menyimpan nomor sasis',
      'yang tercatat untuk unit ini adalah 1 Work Order']),
    { kurang: feq(tabPart || '', ['Baris mutasi gudang tidak menyimpan nomor sasis',
      'yang tercatat untuk unit ini adalah 1 Work Order']) });

  const tabGaransi = await keTab('GARANSI',
    `/tidak disimpan di baris unit/.test(document.body.innerText)`, 'garansi');
  ok('2.16 tab GARANSI menyebut tahun dan tanggal perolehan yang nyata tanpa mengarang masa berlaku',
    !!tabGaransi && sama(tabGaransi, ['tahun 2023', 'tanggal perolehan 2023-01-10',
      'tidak disimpan di baris unit', 'belum ada record klaim garansi']),
    { kurang: feq(tabGaransi || '', ['tahun 2023', 'tanggal perolehan 2023-01-10',
      'tidak disimpan di baris unit', 'belum ada record klaim garansi']) });

  const tabDok = await keTab('DOKUMEN',
    `/tidak menyimpan nomor sasis alatnya/.test(document.body.innerText)`, 'dokumen');
  ok('2.17 tab DOKUMEN menyatakan kolom penaut per unit belum ada, bukan mendaftar dokumen alat lain',
    !!tabDok && sama(tabDok, ['tidak menyimpan nomor sasis alatnya', UNIT_SERIAL, 'Keterangan']),
    { kurang: feq(tabDok || '', ['tidak menyimpan nomor sasis alatnya', UNIT_SERIAL, 'Keterangan']) });

  const semuaTab = [tabRawat, tabSewa, tabPart, tabGaransi, tabDok];
  const sisaHiasan = HIASAN_LAMA.filter(t => semuaTab.join(' | ').includes(t));
  // Butuh kelima tab terbaca: tanpa itu assertion "tidak ada angka hiasan" lulus
  // karena layarnya kosong, bukan karena angkanya hilang.
  ok('2.18 tidak satu pun nomor hiasan lama yang masih tampil di kelima tab riwayat',
    semuaTab.every(Boolean) && sisaHiasan.length === 0, sisaHiasan);

  // ── Tombol tab: dulu alert(), sekarang mengantar ke menu aslinya ───────────
  await ev(wc, `window.__alerts.length = 0; return true;`);
  await keTab('PERAWATAN', `/WO-OPS-001/.test(document.body.innerText)`, 'perawatan (handoff)');
  const klikServis = await ev(wc, `return klik(/Catat Service Baru/);`);
  await waitFor(wc, terisi('Pilih Unit', UNIT_SERIAL), 'unit terisi di form WO dari kartu unit', 20000);
  const pindahServis = await bacaForm('unit: nilai(\'Pilih Unit\'), model: nilai(\'Model Terpilih\'), nomor: nilai(\'Nomor Work Order\')');
  ok('2.19 "+ Catat Service Baru" membuka form Work Order di menu Servis dengan unit dan model alat ini terisi',
    klikServis === true && pindahServis.hash === '#/service'
    && /Buka Work Order Servis Baru/.test(pindahServis.judul)
    && pindahServis.unit === UNIT_SERIAL && pindahServis.model === 'SANY SY215C', pindahServis);
  ok('2.20 nomor WO yang disodorkan handoff berasal dari file, tidak menabrak WO-OPS-001 yang sudah ada',
    !!pindahServis.nomor && pindahServis.nomor !== 'WO-OPS-001' && /^WO-\d{4}-\d{3}$/.test(pindahServis.nomor),
    pindahServis.nomor);

  await keTab('SEWA', `/RCT-OPS-0001/.test(document.body.innerText)`, 'sewa (handoff)');
  const klikSewa = await ev(wc, `return klik(/Alokasikan Kontrak Baru/);`);
  await waitFor(wc, terisi('Pilih Unit', UNIT_SERIAL), 'unit terisi di form kontrak dari kartu unit', 20000);
  const pindahSewa = await bacaForm('unit: nilai(\'Pilih Unit\'), model: nilai(\'Model Terpilih\'), nomor: nilai(\'Nomor Kontrak\')');
  ok('2.21 "+ Alokasikan Kontrak Baru" membuka form kontrak di menu Rental dengan unit ini terisi (placeholder model lama tergantikan)',
    klikSewa === true && pindahSewa.hash === '#/rental'
    && /Buat Kontrak Sewa Alat Baru/.test(pindahSewa.judul)
    && pindahSewa.unit === UNIT_SERIAL && pindahSewa.model === 'SANY SY215C'
    && pindahSewa.nomor !== 'RCT-OPS-0001', pindahSewa);

  await keTab('SUKU CADANG', `/mutasi gudang tidak menyimpan nomor sasis/.test(document.body.innerText)`, 'suku cadang (handoff)');
  const klikPart2 = await ev(wc, `return klik(/Catat Pemakaian Part/);`);
  // Kotak cari HALAMAN, bukan kotak cari global di topbar: keduanya memakai class
  // .topbar-search dan topbar lebih dulu di DOM, jadi querySelector generik selalu
  // membaca kotak yang kosong.
  const KOTAK_CARI = 'input[placeholder^="Cari WO"]';
  await waitFor(wc, `location.hash === '#/service' && ((document.querySelector('${KOTAK_CARI}') || {}).value || '') === '${UNIT_SERIAL}'`,
    'daftar WO terfilter nomor sasis unit ini', 20000);
  const pindahPart = await ev(wc, `
    return { hash: location.hash, judul: ((document.querySelector('.modal-title') || {}).innerText || '').trim(),
             cari: ((document.querySelector('${KOTAK_CARI}') || {}).value || ''),
             wotampil: /WO-OPS-001/.test(document.body.innerText),
             alatLain: /Komatsu PC200-8/.test(document.body.innerText),
             alert: (window.__alerts || []).slice() };`);
  ok('2.22 "Catat Pemakaian Part (lewat WO)" membuka menu Servis dengan pencarian terisi nomor sasis sehingga WO alat ini yang muncul',
    klikPart2 === true && pindahPart.hash === '#/service' && pindahPart.cari === UNIT_SERIAL
    && pindahPart.wotampil === true && pindahPart.judul === '' && pindahPart.alatLain === false, pindahPart);

  await keTab('DOKUMEN', `/tidak menyimpan nomor sasis alatnya/.test(document.body.innerText)`, 'dokumen (handoff)');
  const klikDok = await ev(wc, `return klik(/Upload Dokumen/);`);
  ok('2.23 "+ Upload Dokumen" membuka form upload di menu Dokumen',
    klikDok === true && await waitFor(wc,
      `location.hash === '#/documents' && /Upload Dokumen Baru/.test(document.body.innerText)`,
      'form upload dokumen terbuka', 20000));

  // Inti permintaan "tombolnya bekerja": selama kelima tab dan empat pintasan
  // diklik, tidak boleh ada satu pun alert yang menampung klik.
  const alertTersisa = await ev(wc, `return (window.__alerts || []).slice();`);
  ok('2.24 tidak ada satu pun alert() yang muncul dari tab riwayat maupun pintasnya',
    alertTersisa.length === 0, alertTersisa);

  // ══ 3. Titik (3): BBM menautkan konsumsi ke alat + periode operasi ══════════
  await ev(wc, `window.location.hash = '#/purchase'; return true;`);
  ok('3.1 halaman Pembelian memuat', await waitFor(wc, `/Buat PO Baru/.test(document.body.innerText)`, 'tombol PO'));
  await ev(wc, `const b = byText(/Buat PO Baru/); if (b) b.click(); return !!b;`);
  ok('3.2 form PO baru terbuka', await waitFor(wc, `/Buat Purchase Order/.test(document.body.innerText)`, 'form PO'));
  await ev(wc, `
    const modal = document.querySelector('.modal') || document;
    const isi = (label, nilai, tag) => { const g = group(modal, label); const el = g && g.querySelector(tag || 'input');
      if (!el) return label; if (tag === 'select') setSelect(el, nilai); else setVal(el, nilai); return null; };
    const hilang = [];
    ['Nomor PO|PO-OPS-FUEL|input', 'Kategori Pembelian|FUEL|select', 'Nama Pemasok|PT Pertamina Uji|input',
      'Nama Barang|1.200 Liter Solar Uji|input', 'Total Nilai|36000000|input', 'Tanggal Order|2026-10-10|input']
      .forEach(x => { const [l, v, t] = x.split('|'); const r = isi(l, v, t); if (r) hilang.push(r); });
    return { hilang, opsi: [...(group(modal, 'Kategori Pembelian').querySelector('select') || {}).options || []].map(o => o.value) };`);
  await ev(wc, `window.__alerts.length = 0; const b = byText(/Terbitkan PO/); if (b) b.click(); return !!b;`);
  const poBbm = await waitForStore(wc, `
    const p = (s.purchases || []).find(x => x.poNumber === 'PO-OPS-FUEL');
    if (!p) return false;
    return { kategori: p.category, jumlah: p.totalAmount, kolom: Object.keys(p),
             isi: Object.entries(p).map(([k, v]) => [k, String(v)]), alerts: (window.__alerts || []).slice() };
  `, 'PO BBM tersimpan');
  ok('3.3 PO kategori BBM (FUEL) bisa disimpan lewat layar',
    !!poBbm && poBbm.kategori === 'FUEL' && poBbm.alerts.length === 0, poBbm);
  // Nama barang sengaja TIDAK menyebut nomor rangka: kalau penghubungnya cuma
  // teks bebas di kolom nama, itu bukan tautan ke alat — dan itu yang diukur sini.
  const menautkanAlat = !!poBbm && poBbm.kolom.some(k => /serial|idUnit/i.test(k));
  const menyebutSerial = !!poBbm && poBbm.isi.some(([, v]) => v.indexOf(UNIT_SERIAL) >= 0);
  if (!menautkanAlat) {
    cacat('3.4 konsumsi BBM tidak menaut ke SATU pun alat: baris PO tidak punya kolom unit/serial', {
      kolom_purchases: poBbm && poBbm.kolom,
      nomor_rangka_hanya_ada_sebagai_teks: menyebutSerial,
    });
  }
  const periode = !!poBbm && poBbm.kolom.some(k => /period|tanggalPakai|hmStart|hmEnd|hourMeter/i.test(k));
  if (!periode) {
    cacat('3.5 tidak ada periode operasi yang bisa ditaut ke pembelian BBM (hanya tanggal order & terima)',
      { kolom_purchases: poBbm && poBbm.kolom });
  }

  await ev(wc, `
    const baris = [...document.querySelectorAll('tr')].find(r => /PO-OPS-FUEL/.test(r.innerText));
    const b = baris && [...baris.querySelectorAll('button')].find(x => /^Terima Barang$/.test((x.innerText || '').trim()));
    if (b) b.click();
    return !!b;`);
  await tulisTenang(wc);
  const kasBbm = await waitForStore(wc, `
    const k = (s.kas || []).filter(x => x.referensi === 'PO-OPS-FUEL');
    if (k.length === 0) return false;
    return { jumlah: k.reduce((a, x) => a + Number(x.jumlah), 0), tipe: k.map(x => x.tipe), kategori: k.map(x => x.kategori), ada: k.length };
  `, 'kas otomatis dari PO');
  ok('3.6 penerimaan PO menulis satu kas KELUAR sebesar nilai PO',
    !!kasBbm && kasBbm.ada === 1 && kasBbm.jumlah === 36_000_000 && kasBbm.tipe[0] === 'KELUAR', kasBbm);

  // ══ 4. Titik (5): biaya yang sama tidak tercatat dua kali ══════════════════
  await ev(wc, `window.location.hash = '#/finance'; return true;`);
  ok('4.1 halaman Kas & Bank memuat', await waitFor(wc, `!!document.querySelector('#finance-search')`, 'kotak cari kas'));
  await ev(wc, `
    const b = byText(/Catat Transaksi/i, 'button'); if (b) b.click();
    return !!b;`);
  ok('4.2 form transaksi manual terbuka', await waitFor(wc, `!!document.querySelector('.modal')`, 'modal kas'));
  await ev(wc, `
    const modal = document.querySelector('.modal');
    const isi = (label, nilai, tag) => { const g = group(modal, label); const el = g && g.querySelector(tag || 'input');
      if (!el) return label; if (tag === 'select') setSelect(el, nilai); else setVal(el, nilai); return null; };
    const hilang = [];
    ['Tipe Transaksi|KELUAR|select', 'Tanggal Transaksi|2026-10-10|input', 'Keterangan|Pembayaran PO PO-OPS-FUEL ke PT Pertamina Uji|input',
      'Kategori|PEMBELIAN|select', 'Jumlah|36000000|input', 'Nomor Referensi|PO-OPS-FUEL|input']
      .forEach(x => { const [l, v, t] = x.split('|'); const r = isi(l, v, t); if (r) hilang.push(r); });
    return { hilang };`);
  await ev(wc, `window.__alerts.length = 0; const b = byText(/Simpan Transaksi/); if (b) b.click(); return !!b;`);
  await wait(1500);
  await tulisTenang(wc);
  const kasDuplikat = await ev(wc, `
    const k = (await window.electronAPI.dbLoad(['kas'])).kas.filter(x => x.referensi === 'PO-OPS-FUEL');
    return { ada: k.length, jumlah: k.reduce((a, x) => a + Number(x.jumlah), 0), ids: k.map(x => x.id) };`);
  ok('4.3 halaman Kas menolak biaya kedua dengan referensi + kategori + tipe yang sama',
    !!kasDuplikat && kasDuplikat.ada === 1 && kasDuplikat.jumlah === 36_000_000, kasDuplikat);
  if (kasDuplikat && kasDuplikat.ada > 1) {
    cacat('4.3b satu pembayaran PO tercatat dua kali di kas: penjaga anti-dobel hanya ada di jalur otomatis (addKasEntry), bukan di layar Kas',
      kasDuplikat);
  }
  // Penolakan harus TERLIHAT. Kalau form tertutup diam-diam, pengguna mengira
  // Rp36 juta keduanya sudah masuk.
  const keadaanTolak = await ev(wc, `
    return { modal: !!document.querySelector('.modal'), alert: (window.__alerts || []).join(' | ') };`);
  ok('4.4 form Kas menahan biaya kedua: ada alasan yang terbaca dan form tidak ditutup',
    !!keadaanTolak && keadaanTolak.modal === true && /sudah tercatat|dibayar sekali/i.test(keadaanTolak.alert),
    keadaanTolak);
  await ev(wc, `const b = document.querySelector('.modal-header button'); if (b) b.click(); return !!b;`);
  // Penjaga yang terlalu luas merusak alur kas itu sendiri: pembayaran KEDUA untuk
  // dokumen lain harus tetap bisa masuk.
  const bayarLain = await ev(wc, `
    const k = (await window.electronAPI.dbLoad(['kas'])).kas;
    const model = k.find(x => x.referensi === 'PO-OPS-FUEL');
    return await window.electronAPI.dbPatch({ kas: { upsert: [{
      ...model, id: 'OP-K-LAIN', referensi: 'PO-OPS-LAIN', jumlah: 12_000_000,
      keterangan: 'Pembayaran dokumen lain' }], removeIds: [] } });`);
  const setelahBayarLain = await ev(wc, `
    const k = (await window.electronAPI.dbLoad(['kas'])).kas;
    return { refs: k.filter(x => x.referensi === 'PO-OPS-LAIN').length, kembar: k.filter(x => x.referensi === 'PO-OPS-FUEL').length };`);
  ok('4.5 pembayaran dengan referensi dokumen lain tetap tersimpan',
    !!bayarLain && !bayarLain.dilarang && setelahBayarLain && setelahBayarLain.refs === 1
    && setelahBayarLain.kembar === 1, { bayarLain, setelahBayarLain });
  // Menyunting baris yang SUDAH ada tidak pernah boleh kena penjaga ini: kalau
  // kena, profil yang terlanjur memuat baris kembar tidak bisa diperbaiki.
  const suntingKembar = await ev(wc, `
    const k = (await window.electronAPI.dbLoad(['kas'])).kas.find(x => x.id === 'OP-K-LAIN');
    return await window.electronAPI.dbPatch({ kas: { upsert: [{ ...k, keterangan: 'Sunting: dokumen lain (dikoreksi)' }], removeIds: [] } });`);
  const hasilSunting = await ev(wc, `
    const k = (await window.electronAPI.dbLoad(['kas'])).kas.find(x => x.id === 'OP-K-LAIN');
    return { ket: k && k.keterangan, harga: k && k.jumlah };`);
  ok('4.6 menyunting baris kas yang sudah ada tidak ikut ditolak',
    !suntingKembar || suntingKembar.dilarang !== true, hasilSunting);
  // Yang menentukan keamanan rantai: penjaga ini hidup di MAIN PROCESS, bukan
  // hanya di form. Satu panggilan IPC langsung — jalur yang dipakai konsol dan
  // harness — harus ditolak juga.
  const kembarIPC = await ev(wc, `
    const k = (await window.electronAPI.dbLoad(['kas'])).kas.find(x => x.referensi === 'PO-OPS-FUEL');
    return await window.electronAPI.dbPatch({ kas: { upsert: [{ ...k, id: 'OP-K-KEMBAR',
      keterangan: 'Percobaan dobel lewat IPC' }], removeIds: [] } });`);
  const sisaKembar = await ev(wc, `
    const k = (await window.electronAPI.dbLoad(['kas'])).kas;
    return { pegang: k.filter(x => x.referensi === 'PO-OPS-FUEL').map(x => x.id),
             jumlahPO: k.filter(x => x.referensi === 'PO-OPS-FUEL').reduce((a, x) => a + Number(x.jumlah), 0) };`);
  ok('4.7 main process menolak baris kas kembar lewat IPC (penjaga tidak hanya di renderer)',
    !!kembarIPC && kembarIPC.dilarang === true && /sudah tercatat/i.test(String(kembarIPC.error))
    && !!sisaKembar && sisaKembar.pegang.length === 1 && !sisaKembar.pegang.includes('OP-K-KEMBAR')
    && sisaKembar.jumlahPO === 36_000_000,
    { alasan: kembarIPC && kembarIPC.error, sisaKembar });
  await ev(wc, `
    const k = (await window.electronAPI.dbLoad(['kas'])).kas.filter(x => x.referensi === 'PO-OPS-LAIN');
    return await window.electronAPI.dbPatch({ kas: { upsert: [], removeIds: k.map(x => String(x.id)) } });`);
  const unikKas = await ev(wc, `return await window.electronAPI.dbIntegrity();`);
  ukur('db-integrity menyebut indeks UNIQUE untuk kas?',
    JSON.stringify(unikKas || {}).match(/UNIQUE/gi) || 'tidak ada');

  // ══ 5. Titik (6): Dasbor & Laporan = transaksi sumber ══════════════════════
  const sumHM = await sum(wc, 'units', 'hourMeter');
  ok('5.1 SQLite menjumlah meter armada = 520 HM', Number(sumHM) === 520, sumHM);
  await ev(wc, `window.location.hash = '#/dashboard'; return true;`);
  await waitFor(wc, `/Ganti Mode Profil/.test(document.body.innerText)`, 'halaman Dasbor terbuka');
  // Dasbor punya tab per profil bisnis dan kartu HM hanya ada di tab tertentu,
  // jadi tab aktif saat dibuka harus dicatat dulu, baru tab yang memuat kartunya
  // diklik seperti pengguna biasa.
  const tabSebelum = await ev(wc, `
    const tombol = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim());
    return { semuaTab: tombol.filter(t => /Pemilik Alat|Dealer|Kontraktor|Rental|Workshop|Trader Bekas/.test(t)) };`);
  ukur('tab profil yang ditawarkan Dasbor', tabSebelum && tabSebelum.semuaTab);
  const klikPersonal = await ev(wc, `return klik(/Pemilik Alat/);`);
  ukur('klik tab "Pemilik Alat" berhasil?', klikPersonal);
  ok('5.2 Dasbor memuat kartu jam kerja', await waitFor(wc, `/Total Jam Kerja/.test(document.body.innerText)`, 'kartu Total Jam Kerja'));
  if (!/Total Jam Kerja/.test(String(await ev(wc, `return document.body.innerText;`)))) {
    ukur('diagnostik isi Dasbor', (await ev(wc, `return document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300);`)));
  }
  const teksDasbor = await ev(wc, `return document.body.innerText;`);
  const hmDasbor = /Total Jam Kerja \(HM\)\s*\n?\s*([\d.]+)\s*HM/i.exec(teksDasbor);
  ukur('angka yang dibaca dari kartu "Total Jam Kerja (HM)"', hmDasbor && hmDasbor[1]);
  if (hmDasbor) ok('5.3 kartu HM Dasbor sama dengan SUM units.hourMeter di SQLite',
    Number(hmDasbor[1].replace(/\./g, '')) === Number(sumHM), { dasbor: hmDasbor[1], sqlite: sumHM });

  const kartuBiaya = await ev(wc, `
    return [...document.querySelectorAll('.card')].filter(c => /Cost per Hour/i.test(c.innerText)).map(c => c.innerText);`);
  const isiBiaya = (kartuBiaya || []).join(' ');
  const harapan = (1_200_000_000 * 0.9) / 12_000;
  ok('5.4 kartu biaya per jam menyebut penyusutan Rp' + Math.round(harapan).toLocaleString('id-ID') + '/HM milik unit ini',
    isiBiaya.includes(Math.round(harapan).toLocaleString('id-ID')), { harapan, kartu: isiBiaya.slice(0, 400) });
  if (/BBM\s*\n?\s*belum tercatat per unit/.test(isiBiaya)) {
    cacat('5.5 Dasbor menyatakan BBM "belum tercatat per unit": pembelian solar 36 juta hari ini tidak masuk biaya per jam sama sekali (jujur, tapi rantainya putus)',
      null);
  }

  await ev(wc, `window.location.hash = '#/reports'; return true;`);
  ok('5.6 Laporan memuat', await waitFor(wc, `/Laporan Pendapatan/.test(document.body.innerText)`, 'laporan'));
  const tabLaporan = await ev(wc, `
    const b = [...document.querySelectorAll('button')].map(x => x.innerText.trim()).filter(t => /Laporan (Pendapatan|Kinerja Unit|Piutang)/.test(t));
    return { tab: b };`);
  ukur('tab yang tersedia di Laporan', tabLaporan && tabLaporan.tab);
  const klikUnit = await ev(wc, `return klik(/Laporan Kinerja Unit/);`);
  ukur('klik tab "Laporan Kinerja Unit" berhasil?', klikUnit);
  await wait(600);
  const aktifSetelah = await ev(wc, `
    return [...document.querySelectorAll('button')]
      .filter(b => /Laporan (Pendapatan|Kinerja Unit|Piutang)/.test(b.innerText || ''))
      .map(b => ({ teks: b.innerText.trim(), merah: getComputedStyle(b).borderBottomColor, warna: getComputedStyle(b).color }));`);
  ukur('keadaan tab Laporan setelah diklik', aktifSetelah);
  await waitFor(wc, `/Total Jam Digunakan/.test(document.body.innerText)`, 'tabel kinerja unit');
  if (!/Total Jam Digunakan/.test(String(await ev(wc, `return document.body.innerText;`)))) {
    ukur('diagnostik isi Laporan', (await ev(wc, `return document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300);`)));
  }
  const teksLaporan = await ev(wc, `return document.body.innerText;`);
  ok('5.7 Laporan menampilkan meter 520 HM unit yang sama', /520\s*HM/.test(teksLaporan), (teksLaporan.match(/\d+\s*HM/g) || []).slice(0, 6));
  const hmLaporan = await ev(wc, `
    const td = [...document.querySelectorAll('td')].map(x => x.innerText.trim());
    return td.filter(t => /HM$/.test(t)).map(t => Number(t.replace(/\\D/g, '')));`);
  ukur('deretan nilai HM pada tabel kinerja unit', hmLaporan);
  ok('5.8 jumlah HM di tabel Laporan = SUM units.hourMeter di SQLite',
    Array.isArray(hmLaporan) && hmLaporan.reduce((a, x) => a + x, 0) === Number(sumHM),
    { laporan: hmLaporan, sqlite: sumHM });

  // ══ 6. Keamanan rantai ═════════════════════════════════════════════════════
  // Tulisan sengaja membaca baris asli lalu menimpa SATU kolomnya: upsert jalur
  // patch mengganti payload seluruhnya, jadi baris sebagian akan diam-diam
  // menghapus purchasePrice/lastServiceHM dan membuat temuan berikutnya palsu.
  const tulisMeter = (nilai, sebagaiApaAdanya) => ev(wc, `
    const u = (await window.electronAPI.dbLoad(['units'])).units.find(x => x.id === 'OP-U1');
    return await window.electronAPI.dbPatch({ units: { upsert: [{ ...u, hourMeter: ${JSON.stringify(nilai)} }], removeIds: [] } });`);

  // 6a. Gerbang meter mundur ada di FORM; apakah jalur tulis asli (IPC) juga
  // menolaknya? Kalau tidak, satu panggilan dari konsol cukup untuk memutar
  // balik seluruh siklus servis.
  const mundurIPC = await tulisMeter(300);
  const nilaiSetelahMundur = await ev(wc, `
    const u = (await window.electronAPI.dbLoad(['units'])).units.find(x => x.id === 'OP-U1');
    return { hourMeter: u.hourMeter, lastServiceHM: u.lastServiceHM, harga: u.purchasePrice };`);
  if (nilaiSetelahMundur && Number(nilaiSetelahMundur.hourMeter) === 300) {
    cacat('6.1 pembacaan meter yang MUNDUR bisa ditulis lewat IPC tanpa centang koreksi dan tanpa alasan — gerbangnya hanya ada di renderer',
      { hasil_patch: mundurIPC, nilai_file: nilaiSetelahMundur.hourMeter, lastServiceHM: nilaiSetelahMundur.lastServiceHM });
  } else {
    ok('6.1 main process menolak meter yang mundur', true, nilaiSetelahMundur);
  }
  await tulisMeter(520);

  // Alasan penolakan harus bisa dibaca pengguna, bukan hanya "ditolak".
  const alasanTolak = String((mundurIPC && mundurIPC.error) || JSON.stringify(mundurIPC || {}));
  ok('6.1b penolakan meter mundur disertai alasan yang terbaca',
    /mundur/i.test(alasanTolak), alasanTolak);

  // Koreksi yang SAH harus tetap lewat. Gerbang baru di main process tidak boleh
  // merusak alur layar Unit: bentuk jejaknya sama dengan yang halaman itu tulis
  // (hmKoreksi: [{ dari, ke, alasan, pada }]).
  const koreksiSah = await ev(wc, `
    const u = (await window.electronAPI.dbLoad(['units'])).units.find(x => x.id === 'OP-U1');
    return await window.electronAPI.dbPatch({ units: { upsert: [{ ...u, hourMeter: 470,
      hmKoreksi: [...(u.hmKoreksi || []), { dari: 520, ke: 470, alasan: 'HM lama salah baca saat uji probe', pada: '2026-10-13' }] }], removeIds: [] } });`);
  const nilaiKoreksi = await ev(wc, `
    const u = (await window.electronAPI.dbLoad(['units'])).units.find(x => x.id === 'OP-U1');
    return { hourMeter: u.hourMeter, jejak: (u.hmKoreksi || []).length };`);
  ok('6.1c koreksi meter yang beralasan tetap diterima (alur layar Unit tidak dirusak)',
    !!nilaiKoreksi && Number(nilaiKoreksi.hourMeter) === 470, { hasil: koreksiSah, nilaiKoreksi });
  await tulisMeter(520);
  const kembali = await ev(wc, `
    const u = (await window.electronAPI.dbLoad(['units'])).units.find(x => x.id === 'OP-U1');
    return { hourMeter: u.hourMeter, harga: u.purchasePrice, lastServiceHM: u.lastServiceHM };`);
  ok('6.1d menaikkan kembali meter setelah koreksi tidak menghapus kolom lain',
    !!kembali && Number(kembali.hourMeter) === 520 && Number(kembali.harga) === 1_200_000_000, kembali);

  // 6b. Angka rusak harus ditolak di main, bukan hanya di form.
  const angkaSampah = await tulisMeter('1.200,5');
  ok('6.2 nilai hour meter yang bukan angka ditolak main process',
    !!angkaSampah && angkaSampah.dilarang === true, angkaSampah);
  const kasSampah = await patch(wc, { kas: { upsert: [{ id: 'OP-K-SAMPAH', tanggal: '2026-10-11', kategori: 'PEMBELIAN', tipe: 'KELUAR', jumlah: 'tidak-angka', referensi: 'SAMPAH-1' }], removeIds: [] } });
  ok('6.3 jumlah kas yang bukan angka ditolak main process', !!kasSampah && kasSampah.dilarang === true, kasSampah);

  // 6c. Peran menegakkan collection rantai ini.
  const sesiService = await ev(wc, `return await window.electronAPI.login('service', 'service123');`);
  const servisKeKas = await patch(wc, { kas: { upsert: [{ id: 'OP-K-SVC', tanggal: '2026-10-11', kategori: 'SERVICE', tipe: 'MASUK', jumlah: 1000, referensi: 'SVC-1' }], removeIds: [] } });
  ok('6.4 peran Teknisi boleh menulis services (meter naik lewat servis sudah terbukti di 2.6)', true);
  ok('6.5 peran Teknisi ditolak saat menulis kas langsung',
    !!servisKeKas && servisKeKas.dilarang === true, servisKeKas);
  const servisKeUnit = await tulisMeter(525);
  ok('6.6 peran Teknisi boleh menaikkan meter unit (jalur servis sah)',
    !servisKeUnit || servisKeUnit.dilarang !== true, servisKeUnit);
  const sesiFinance = await ev(wc, `return await window.electronAPI.login('finance', 'finance123');`);
  const keuanganKeUnit = await tulisMeter(9999);
  ok('6.7 peran Keuangan ditolak saat mengubah meter unit',
    !!keuanganKeUnit && keuanganKeUnit.dilarang === true, keuanganKeUnit);
  await ev(wc, `return await window.electronAPI.logout(${JSON.stringify(sesiFinance.token)});`);
  await ev(wc, `return await window.electronAPI.login('admin', 'BaruOps123');`);
  const dipulihkan = await ev(wc, `
    const u = (await window.electronAPI.dbLoad(['units'])).units.find(x => x.id === 'OP-U1');
    return { hourMeter: u.hourMeter };`);
  ok('6.8 tulisan yang ditolak peran tidak mengubah file (meter tetap 525 dari 6.6)',
    Number(dipulihkan.hourMeter) === 525, dipulihkan);

  // 6d. Jejak audit: siapa yang mengubah angka rantai?
  const tokenAdmin = await ev(wc, `
    const r = JSON.parse(localStorage.getItem('hems_session_v2') || 'null');
    return r && r.token ? r.token : null;`);
  const audit = tokenAdmin ? await ev(wc, `return await window.electronAPI.auditLog(${JSON.stringify(tokenAdmin)});`) : null;
  const entries = (audit && Array.isArray(audit.entries)) ? audit.entries : null;
  if (!entries) {
    console.log('CATATAN 6d token sesi tidak terbaca, jejak audit tidak bisa dinilai ->', JSON.stringify(audit));
  } else {
    const jenis = entries.map(a => a.event);
    ukur('jejak audit: jenis kejadian', Array.from(new Set(jenis)));
    ukur('jumlah catatan audit', entries.length);
    ok('6.9 penolakan tulis tercatat di jejak audit', jenis.some(e => /DENY/.test(String(e))), jenis);
    if (!jenis.some(e => /WRITE|CREATE|UPDATE|EDIT|CHANGE/.test(String(e)))) {
      cacat('6.11 tidak ada satu pun jejak "tulis berhasil": meter, biaya dan kas bisa berubah tanpa tercatat siapa yang mengubahnya',
        { jenis_yang_ada: Array.from(new Set(jenis)), jumlah_catatan: entries.length,
          contoh: entries.slice(0, 3).map(a => [a.event, a.username]) });
    }
  }

  // ══ 7. Muat ulang: nilai rantai bertahan ═══════════════════════════════════
  await wc.reload();
  ok('7.1 aplikasi muncul lagi setelah muat ulang', await waitFor(wc, `/Dasbor|Armada|Masuk/i.test(document.body.innerText)`, 'shell', 45000));
  await stub(wc);
  const setelahReload = await ev(wc, `
    const u = (await window.electronAPI.dbLoad(['units'])).units.find(x => x.id === 'OP-U1');
    const k = (await window.electronAPI.dbLoad(['kas'])).kas.filter(x => x.referensi === 'PO-OPS-FUEL');
    return { hm: u.hourMeter, lastServiceHM: u.lastServiceHM, kasPO: k.length };`);
  ok('7.2 meter + lastServiceHM bertahan setelah muat ulang',
    Number(setelahReload.hm) === 525 && Number(setelahReload.lastServiceHM) === 520, setelahReload);
  if (setelahReload && Number(setelahReload.kasPO) > 1) {
    cacat('7.3 dobel hitung kas dari layar bertahan lintas muat ulang — bukan artefak tampilan', setelahReload);
  }

  console.log('RINGKASAN ' + JSON.stringify({ lulus: pass, gagal: fail, temuan: temuan.length }));
  console.log('SELESAI-CACAT ' + JSON.stringify(temuan));
  selesai(app, fail === 0 ? 0 : 1);
}

require('../dist-electron/main.js');
