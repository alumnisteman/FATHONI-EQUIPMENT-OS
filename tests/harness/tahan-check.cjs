// tests/harness/tahan-check.cjs
// KETAHANAN dan SESI PANJANG, diukur dari kursi pengguna. File ini dijalankan
// tiga kali berturut-turut oleh tahan-run.cjs di atas SATU profil yang sama,
// karena salah satu stage-nya harus benar-benar membunuh prosesnya:
//
//   TAHAN_MODE=isi   sesi panjang: seluruh menu sidebar dibuka 4 x berturut-
//                    turut sambil mengukur waktu buka tiap menu dan mengambil
//                    napas CPU/RAM per putaran; lalu kanal data dimatikan
//                    (database ditutup) dan dipulihkan; terakhir menutup
//                    aplikasi secara WAJAR di tengah simpanan tertunda.
//   TAHAN_MODE=paksa menaruh satu perubahan di jendela debounce 800 ms lalu
//                    mencetak TAHAN-B SIAP dan diam — driver yang membunuh
//                    prosesnya tanpa kesempatan flush (tutup paksa).
//   TAHAN_MODE=bukti profil yang sama dibuka lagi dan diperiksa: file masih
//                    sehat, baris yang sempat masuk file masih ada, dan
//                    simpanan tertunda dari tutup wajar benar-benar masuk.
//
// Yang dijamin aplikasi bukan "tidak ada yang hilang saat dibunuh paksa", tapi
// (1) file tidak pernah rusak dan (2) tutup wajar tidak pernah membuang
// simpanan tertunda. Keduanya yang diuji di sini. PASS/FAIL dicetak apa adanya
// dan digabung oleh driver, jadi harness ini tidak mencetak ringkasannya
// sendiri.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
// Penutup proses tetap lewat pembantu bersama: keluar mentah dari Electron
// melompati before-quit electron/main.ts, jadi koneksi SQLite tertinggal saat
// Windows membongkar DLL-nya. Driver tahan-run.cjs yang mencetak ringkasan
// rantai, jadi penanda "SELESAI kode=N" dari tiap tahap di sini hanya dipakai
// sebagai bukti bahwa tahap itu keluar rapi.
const selesai = require('./selesai.cjs');

const MODE = process.env.TAHAN_MODE || 'isi';
const DATA_DIR = process.env.HEMS_DATA_DIR;

const PASSWORD_BARU = 'BaruTahan123';
const PUTARAN = 4;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else {
    fail++;
    console.log('FAIL ' + name + (extra !== undefined && extra !== null ? ' -> ' + JSON.stringify(extra).slice(0, 500) : ''));
  }
}
function catat(name, nilai) { console.log('CATATAN ' + name + ': ' + nilai); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const median = arr => {
  const s = [...arr].filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return Number.NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

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
  const mulai = Date.now();
  while (Date.now() - mulai < timeoutMs) {
    if (await ev(wc, `return !!(${expr});`)) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

const STUB = `
  window.__alerts = [];
  window.confirm = () => true;
  window.alert = (m) => { window.__alerts.push(String(m)); };
  return true;`;
async function stub(wc) { await ev(wc, STUB); }

// Simpanan renderer di-debounce 800 ms. Jejak tulis hanya boleh dinilai setelah
// tidak ada yang mengalir lagi.
async function tulisTenang(wc) {
  let terakhir = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);
  for (let i = 0; i < 12; i++) {
    await wait(1200);
    const kini = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);
    if (kini.patchCalls === terakhir.patchCalls && kini.patchUpsertRows === terakhir.patchUpsertRows
      && kini.patchRemoveIds === terakhir.patchRemoveIds && kini.fullCalls === terakhir.fullCalls) return kini;
    terakhir = kini;
  }
  return terakhir;
}

// ── Menu yang dilalui sesi panjang ──────────────────────────────────────────
// Label HARUS sama dengan teks item sidebar (src/components/Layout.tsx), karena
// "menu terbuka" diukur dari item sidebar yang aktif. Itu satu-satunya penanda
// yang unik per rute dan tidak bergantung pada judul halaman (sebagian halaman
// tidak memakai .page-title) maupun pada data uji.
const MENU = [
  ['#/dashboard', 'Dasbor'],
  ['#/control-tower', 'Control Tower'],
  ['#/brands', 'Merek & Model'],
  ['#/units', 'Unit / Armada'],
  ['#/customers', 'Pelanggan'],
  ['#/suppliers', 'Pemasok'],
  ['#/operators', 'Operator'],
  ['#/technicians', 'Teknisi'],
  ['#/purchase', 'Pembelian'],
  ['#/sales', 'Penjualan'],
  ['#/rental', 'Sewa / Rental'],
  ['#/approvals', 'Persetujuan (Approval)'],
  ['#/invoices', 'Faktur / Invoice'],
  ['#/warehouse', 'Gudang'],
  ['#/spareparts', 'Suku Cadang'],
  ['#/breakdown', 'Breakdown'],
  ['#/service', 'Servis & Work Order'],
  ['#/delivery', 'Pengiriman'],
  ['#/finance', 'Kas & Bank'],
  ['#/reports', 'Laporan'],
  ['#/settings', 'Pengaturan'],
  ['#/users', 'Pengguna'],
  ['#/documents', 'Dokumen Legal'],
  ['#/backup', 'Backup & Restore'],
  ['#/maintenance', 'Pemeliharaan Sistem'],
  ['#/audit-log', 'Audit Log'],
];

// Napas memori + CPU per jenis proses dari sudut pandang OS, bukan renderer.
function napasProses() {
  const out = {};
  for (const p of app.getAppMetrics()) {
    const tipe = (p.type || 'lain').toLowerCase();
    const m = p.memory || {};
    const kb = m.workingSetSize || m.WorkingSetSize || m.peakWorkingSetSize || 0;
    const cpu = (p.cpu && p.cpu.cpuPercent) || 0;
    const rekam = { mb: Math.round(kb / 1024), cpu: Math.round(cpu) };
    const lama = out[tipe];
    out[tipe] = lama ? { mb: Math.max(lama.mb, rekam.mb), cpu: Math.max(lama.cpu, rekam.cpu) } : rekam;
  }
  return out;
}

const SEED = {
  customers: [{ id: 'TH-C1', name: 'PT Tahan Uji', phone: '0811-TAHAN-01', address: 'Cikande', pic: 'Budi Tahan' }],
  units: [{ id: 'TH-U1', serialNumber: 'TAHAN-UNIT-0001', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE', hourMeter: 1234 }],
};

// Satu panggilan ke renderer: berpindah menu lalu menunggu sampai halaman itu
// benar-benar tampil, dan mengembalikan berapa lama ia butuh. Menunggu "item
// sidebar aktif berubah + spinner 'Memuat modul' hilang" adalah ukuran dari
// sisi pengguna: chunk lazy + gerbang hidrasi collection ikut terhitung.
async function bukaMenu(wc, hash, label) {
  return ev(wc, `
    const mulai = performance.now();
    window.location.hash = ${JSON.stringify(hash)};
    const label = ${JSON.stringify(label)};
    let siap = false;
    while (performance.now() - mulai < 20000) {
      const aktif = [...document.querySelectorAll('.sidebar-item.active')].map(e => e.innerText.trim());
      const teks = document.body.innerText;
      if (aktif.includes(label) && !/Memuat modul/.test(teks) && teks.length > 300) { siap = true; break; }
      await new Promise(r => setTimeout(r, 20));
    }
    return {
      ms: Math.round(performance.now() - mulai),
      siap,
      aktif: [...document.querySelectorAll('.sidebar-item.active')].map(e => e.innerText.trim()),
      rute: window.location.hash,
      dom: document.querySelectorAll('*').length,
      heap: Math.round(((performance.memory || {}).usedJSHeapSize || 0) / 1048576),
    };`);
}

// Profil bisnis harus dipilih lebih dulu: tanpa itu ProtectedRoute selalu
// melempar ke /setup, dan layar itu TIDAK punya sidebar — semua pengukuran
// "waktu buka menu" akan mengukur layar yang salah. Kueri .sidebar-item (bukan
// teks) dipakai di seluruh harness ini supaya tidak ada lagi kelulusan palsu
// karena kebetulan ada kata yang sama di layar setup.
//
// Ketiga mode dipakai karena sidebar menyembunyikan item yang requiredModes-nya
// tidak dipilih (/rental butuh RENTAL, dsb). Sesi panjang ini justru mengukur
// "setiap menu di sidebar bisa dibuka", jadi semuanyaharus benar-benar ada.
const SIELAH = `!!document.querySelector('.sidebar-item')`;
async function siapkanProfil(wc) {
  await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER', 'RENTAL', 'CONTRACTOR'], customMenus: [], isSetupComplete: true }));
    localStorage.removeItem('hems_session');
    return true;`);
  await wc.reload();
  await wait(400);
}

async function loginBaru(wc) {
  ok('S.1 layar login muncul', await waitFor(wc, `!!document.querySelector('#login-username')`, 'form login', 45000));
  await stub(wc);
  await ev(wc, `
    setVal(document.querySelector('#login-username'), 'admin');
    setVal(document.querySelector('#login-password'), 'admin123');
    const b = byText(/Masuk ke FATHONI/); if (b) b.click(); return !!b;`);
  ok('S.2 password bawaan wajib diganti', await waitFor(wc,
    `/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'layar ganti password', 45000));
  await ev(wc, `
    setVal(document.querySelector('#cpw-current'), 'admin123');
    setVal(document.querySelector('#cpw-next'), ${JSON.stringify(PASSWORD_BARU)});
    setVal(document.querySelector('#cpw-confirm'), ${JSON.stringify(PASSWORD_BARU)});
    const b = byText(/Simpan password baru/); if (b) b.click(); return !!b;`);
  return await waitFor(wc, SIELAH, 'shell setelah login', 45000);
}

async function masukLagi(wc) {
  for (let i = 0; i < 80; i++) {
    if (await ev(wc, `return !!document.querySelector('#login-username');`)) {
      await stub(wc);
      await ev(wc, `
        setVal(document.querySelector('#login-username'), 'admin');
        setVal(document.querySelector('#login-password'), ${JSON.stringify(PASSWORD_BARU)});
        const b = byText(/Masuk ke FATHONI/); if (b) b.click(); return true;`);
    } else if (await ev(wc, `return (${SIELAH});`)) {
      return true;
    } else if (await ev(wc, `return /Bagaimana Anda menggunakan FATHONI/.test(document.body.innerText);`)) {
      console.log('DIANGKAP: layar pemilihan profil menahan rute — profil bisnis belum dipilih');
      return false;
    }
    await wait(400);
  }
  return false;
}

// Ganti telepon pelanggan uji lewat form halaman, seperti pengguna mengetik.
async function editTelepon(wc, namaBaris, nilaiBaru) {
  const buka = await ev(wc, `
    const tr = [...document.querySelectorAll('tbody tr')].find(t => t.innerText.includes(${JSON.stringify(namaBaris)}));
    if (!tr) return 'tidak-ada';
    const b = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === 'Edit');
    if (!b) return 'tanpa-tombol-edit';
    b.click(); return 'ok';`);
  if (buka !== 'ok') return buka;
  const modal = await waitFor(wc, `/Edit Pelanggan/.test(document.body.innerText)`, 'modal edit', 15000);
  if (!modal) return 'modal-tidak-muncul';
  await ev(wc, `
    const g = [...document.querySelectorAll('.modal .form-group')]
      .find(x => (((x.querySelector('.form-label') || {}).innerText) || '').toLowerCase().includes('telepon'));
    setVal(g.querySelector('input'), ${JSON.stringify(nilaiBaru)});
    const b = byText(/^Simpan$/, 'button'); if (b) b.click(); return !!b;`);
  return 'ok';
}

// ══ TAHAP 1 — sesi panjang + kanal mati lalu pulih + tutup wajar ═════════════
async function tahapIsi(wc) {
  const win = BrowserWindow.fromWebContents(wc);
  if (win) win.setSize(1366, 800);
  await wait(400);
  await siapkanProfil(wc);
  ok('A.0 aplikasi masuk tanpaerror', await loginBaru(wc));

  const tanamHasil = await ev(wc, `
    const patch = {};
    for (const [k, rows] of Object.entries(${JSON.stringify(SEED)})) patch[k] = { upsert: rows, removeIds: [] };
    return await window.electronAPI.dbPatch(patch);`);
  ok('A.0b data uji ditanam', Object.keys(SEED).every(k => tanamHasil[k] && tanamHasil[k].inserted === 1), tanamHasil);
  await wc.reload();
  await stub(wc);
  ok('A.0c aplikasi dibuka ulang supaya daftar dibaca dari file', await masukLagi(wc));

  // ── 1. sesi panjang ───────────────────────────────────────────────────────
  const waktu = [];
  const perMenu = {};
  const napas = [napasProses()];
  const macet = [];
  const mulaiSesi = Date.now();
  for (let putaran = 1; putaran <= PUTARAN; putaran++) {
    for (const [hash, label] of MENU) {
      const hasil = await bukaMenu(wc, hash, label);
      waktu.push(hasil.ms);
      (perMenu[label] = perMenu[label] || []).push(hasil);
      if (!hasil.siap) macet.push(`${label} p${putaran} -> rute=${hasil.rute} aktif=${hasil.aktif.join('|')}`);
    }
    console.log(`PUTARAN ${putaran}/${PUTARAN} selesai setelah ${Math.round((Date.now() - mulaiSesi) / 1000)} s`);
    // cpuPercent Electron dihitung sejak panggilan sebelumnya, jadi sampling
    // per putaran memberi tahu berapa prosesor yang dipakai sesi ini.
    await wait(1500);
    napas.push(napasProses());
  }
  const awal = napas[1];
  const akhir = napas[napas.length - 1];
  const terburuk = Math.max(...waktu);
  const labelTerburuk = Object.entries(perMenu)
    .map(([l, arr]) => [l, Math.max(...arr.map(x => x.ms))]).sort((a, b) => b[1] - a[1])[0];
  const armadas = perMenu['Unit / Armada'];

  ok(`A.1 ${MENU.length * PUTARAN} navigasi menu semuanya terisi (tidak ada yang menggantung)`,
    macet.length === 0 && waktu.length === MENU.length * PUTARAN, { jumlah: waktu.length, macet: macet.slice(0, 5) });
  ok('A.2 waktu buka menu: median di bawah 2 s', median(waktu) < 2000, { median: median(waktu), terburuk });
  ok('A.3 tidak ada menu yang butuh lebih dari 8 s untuk tampil',
    terburuk < 8000, { terburuk, menu: labelTerburuk });
  ok('A.4 memori renderer tidak tumbuh tanpa batas selama sesi panjang',
    !!(awal.tab && akhir.tab) && (akhir.tab.mb - awal.tab.mb) < 150, { awal: awal.tab, akhir: akhir.tab });
  ok('A.5 memori proses utama tidak tumbuh tanpa batas',
    !!(awal.browser && akhir.browser) && (akhir.browser.mb - awal.browser.mb) < 120, { awal: awal.browser, akhir: akhir.browser });
  ok('A.6 heap JavaScript renderer tidak meningkat 3x lipat setelah 4 putaran',
    armadas[0].heap > 0 && armadas[PUTARAN - 1].heap < armadas[0].heap * 3 + 120,
    { awal: armadas[0].heap, akhir: armadas[PUTARAN - 1].heap });
  ok('A.7 simpul DOM pada menu yang sama tidak menumpuk antar putaran',
    armadas[PUTARAN - 1].dom <= armadas[0].dom * 1.6 + 200,
    { putaran1: armadas[0].dom, putaranTerakhir: armadas[PUTARAN - 1].dom });

  await ev(wc, `window.location.hash = '#/units'; return true;`);
  const masihHidup = await waitFor(wc, `document.body.innerText.includes('TAHAN-UNIT-0001')`,
    'data masih tampil setelah sesi panjang', 20000);
  ok('A.8 jendela masih hidup dan datanya masih tampil setelah sesi panjang',
    masihHidup === true && !wc.isCrashed(), { crash: wc.isCrashed() });

  catat('median waktu buka per menu (ms)',
    MENU.map(([, l]) => `${l}=${median(perMenu[l].map(x => x.ms))}`).join(' | '));
  catat('napas proses sesudah putaran 1 (MB + % CPU)', JSON.stringify(awal));
  catat('napas proses sesudah putaran terakhir', JSON.stringify(akhir));

  // ── 2. kanal data dimatikan, lalu dipulihkan ──────────────────────────────
  const db = require('../../dist-electron/db.js');
  await ev(wc, `window.location.hash = '#/customers'; return true;`);
  await waitFor(wc, `document.body.innerText.includes('PT Tahan Uji')`, 'daftar pelanggan');
  db.closeDatabase();
  const mati = await ev(wc, `return await window.electronAPI.dbStats();`);
  ok('A.9 kanalnya benar-benar mati: panggilan baca berikutnya dijawab gagal',
    mati && mati.success === false, mati);
  const editMati = await editTelepon(wc, 'PT Tahan Uji', '0811-MATI');
  ok('A.10 edit di layar tetap bisa dilakukan ketika kanal mati', editMati === 'ok', editMati);
  const banner = await waitFor(wc, `/TIDAK TERSIMPAN|TIDAK BISA|gagal dibaca/i.test(document.body.innerText)`,
    'banner kegagalan simpan', 20000);
  const teksBanner = await ev(wc, `
    const m = document.body.innerText.match(/[^\\n]*(TIDAK TERSIMPAN|TIDAK BISA|gagal dibaca)[^\\n]*/);
    return m ? m[0].slice(0, 200) : '';`);
  ok('A.11 kegagalan dilaporkan ke pengguna dengan banner, bukan didiamkan',
    banner === true && teksBanner.length > 10, teksBanner);
  ok('A.12 aplikasi tidak crash ketika kanalnya mati', !wc.isCrashed());

  db.openDatabase(app.getPath('userData'));
  const pulih = await ev(wc, `return await window.electronAPI.dbStats();`);
  ok('A.13 kanal hidup lagi setelah dipulihkan', pulih && pulih.totalRows > 0, pulih && pulih.totalRows);
  await editTelepon(wc, 'PT Tahan Uji', '0811-HIDUP');
  await tulisTenang(wc);
  const bersih = await ev(wc, `return !/TIDAK TERSIMPAN|TIDAK BISA/i.test(document.body.innerText);`);
  const sisaBanner = await ev(wc, `
    const m = document.body.innerText.match(/[^\\n]*(TIDAK TERSIMPAN|TIDAK BISA)[^\\n]*/);
    return m ? m[0].slice(0, 240) : '';`);
  ok('A.14 banner hilang begitu simpanan berhasil lagi', bersih === true, sisaBanner);
  const telepon = await ev(wc, `
    const s = await window.electronAPI.dbLoad(['customers']);
    return (s.customers.find(c => c.name === 'PT Tahan Uji') || {}).phone;`);
  ok('A.15 tulisan sesudah pemulihan benar-benar masuk ke file', telepon === '0811-HIDUP', telepon);

  // ── 3. tutup WAJAR di tengah simpanan tertunda ────────────────────────────
  await editTelepon(wc, 'PT Tahan Uji', '0811-ANGGUN');
  console.log('TAHAN-A MENUTUP');
  // Sengaja TIDAK menunggu debounce 800 ms: justru inilah yang diuji — penutupan
  // wajar harus menuntaskan simpanan yang masih tertunda (handshake flush di
  // electron/main.ts sebelum before-quit selesai).
  setTimeout(() => app.quit(), 150);
}

// ══ TAHAP 2 — ditutup paksa di tengah simpanan tertunda ═════════════════════
async function tahapPaksa(wc) {
  const win = BrowserWindow.fromWebContents(wc);
  if (win) win.setSize(1366, 800);
  await wait(400);
  await siapkanProfil(wc);
  ok('B.0 aplikasi masuk lagi setelah tahap sebelumnya', await masukLagi(wc));

  await ev(wc, `window.location.hash = '#/customers'; return true;`);
  await waitFor(wc, `document.body.innerText.includes('PT Tahan Uji')`, 'daftar pelanggan');
  await ev(wc, `document.querySelector('#btn-add-customer').click(); return true;`);
  await waitFor(wc, `/Tambah Pelanggan Baru/.test(document.body.innerText)`, 'modal tambah');
  await ev(wc, `
    const peta = { 'Nama Perusahaan': 'PT Tahan Kukuh', 'Telepon': '0811-KUKUH' };
    for (const [label, nilai] of Object.entries(peta)) {
      const g = [...document.querySelectorAll('.modal .form-group')]
        .find(x => (((x.querySelector('.form-label') || {}).innerText) || '').toLowerCase().includes(label.toLowerCase()));
      setVal(g.querySelector('input'), nilai);
    }
    const b = byText(/^Simpan$/, 'button'); if (b) b.click(); return true;`);
  await waitFor(wc, `document.body.innerText.includes('PT Tahan Kukuh')`, 'baris kukuh tampil');
  await tulisTenang(wc);
  const diFile = await ev(wc, `
    const s = await window.electronAPI.dbLoad(['customers']);
    return s.customers.filter(c => c.name === 'PT Tahan Kukuh').length;`);
  ok('B.1 baris kukuh sudah masuk file sebelum prosesnya dibunuh', diFile === 1, { diFile });

  // Perubahan terakhir: diketik, disimpan, lalu prosesnya dibunuh sebelum
  // debounce 800 ms sempat jalan. Yang membunuh adalah driver.
  await ev(wc, `
    const tr = [...document.querySelectorAll('tbody tr')].find(t => t.innerText.includes('PT Tahan Kukuh'));
    const b = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === 'Edit');
    b.click(); return true;`);
  const modal = await waitFor(wc, `/Edit Pelanggan/.test(document.body.innerText)`, 'modal edit', 15000);
  await ev(wc, `
    const g = [...document.querySelectorAll('.modal .form-group')]
      .find(x => (((x.querySelector('.form-label') || {}).innerText) || '').toLowerCase().includes('telepon'));
    setVal(g.querySelector('input'), '0811-TERTUNDA');
    const b = byText(/^Simpan$/, 'button'); if (b) b.click(); return true;`);
  ok('B.2 perubahan terakhir sudah diterima layar sebelum dibunuh', modal === true);
  console.log('TAHAN-B SIAP');
  // Di sini driver membunuh prosesnya. Sengaja tidak ada penutupan rapi:
  // tidak ada kesempatan flush, persis seperti listrik padam.
  setInterval(() => { /* ditahan sampai dibunuh */ }, 60000);
}

// ══ TAHAP 3 — dibuka kembali dan diperiksa ══════════════════════════════════
async function tahapBukti(wc) {
  const win = BrowserWindow.fromWebContents(wc);
  if (win) win.setSize(1366, 800);
  await wait(400);
  await siapkanProfil(wc);
  const masuk = await masukLagi(wc);
  ok('C.1 aplikasi dibuka lagi setelah ditutup paksa, bukan halaman kosong', masuk === true);
  await stub(wc);

  const sehat = await ev(wc, `return await window.electronAPI.dbIntegrity();`);
  ok('C.2 file database masih sehat (PRAGMA quick_check) setelah pembunuhan paksa',
    sehat && sehat.ok === true, sehat && sehat.quickCheck);
  const statistik = await ev(wc, `return await window.electronAPI.dbStats();`);
  ok('C.3 WAL dipulihkan dan collection bisa dibaca lagi',
    statistik && statistik.journalMode === 'wal' && statistik.totalRows > 0,
    statistik && { mode: statistik.journalMode, baris: statistik.totalRows });

  const isi = await ev(wc, `
    const s = await window.electronAPI.dbLoad(['customers', 'units']);
    return {
      jumlah: s.customers.length,
      kukuh: (s.customers.find(c => c.name === 'PT Tahan Kukuh') || {}).phone || '-',
      uji: (s.customers.find(c => c.name === 'PT Tahan Uji') || {}).phone || '-',
      unit: (s.units.find(u => u.serialNumber === 'TAHAN-UNIT-0001') || {}).hourMeter,
      rusak: s.customers.filter(c => typeof c.name !== 'string' || c.name.length < 3).length,
    };`);
  ok('C.4 baris yang sempat masuk file tetap ada dan utuh',
    isi.kukuh !== '-' && isi.unit === 1234, isi);
  ok('C.5 tidak ada record setengah jalan', isi.jumlah >= 2 && isi.rusak === 0, isi);
  // pasangan yang menentukan: tutup WAJAR harus menyimpan yang tertunda,
  // sedangkan hasil tutup paksa boleh salah satu — itu tidak dijamin, jadi
  // hanya dicatat sebagai bukti, tidak dijadikan assertion.
  catat('telepon PT Tahan Uji (0811-ANGGUN = flush saat tutup wajar berhasil)', isi.uji);
  catat('telepon PT Tahan Kukuh (0811-KUKUH = perubahan tertunda ikut hilang, 0811-TERTUNDA = sempat keburu)', isi.kukuh);
  ok('C.6 simpanan tertunda dari tutup WAJAR benar-benar tersimpan', isi.uji === '0811-ANGGUN', { uji: isi.uji });

  await ev(wc, `window.location.hash = '#/customers'; return true;`);
  const tampil = await waitFor(wc, `document.body.innerText.includes('PT Tahan Kukuh')`, 'daftar muncul di layar');
  ok('C.7 layar menampilkan isi file setelah dibuka kembali', tampil === true);

  const hitung = await ev(wc, `
    const a = await window.electronAPI.dbStats();
    const rujukan = await window.electronAPI.dbReferences('customers', 'TH-C1');
    return { baris: a.totalRows, rujukan: rujukan && rujukan.blocked };`);
  ok('C.8 penjaga rujukan masih berfungsi setelah pemulihan paksa',
    hitung.baris > 0 && hitung.rujukan === false, hitung);

  const bersih = await ev(wc, `
    const out = {};
    for (const k of ['customers', 'units']) {
      const s = await window.electronAPI.dbLoad([k]);
      out[k] = await window.electronAPI.dbPatch({ [k]: { upsert: [], removeIds: s[k].map(r => String(r.id)) } });
    }
    const sesudah = await window.electronAPI.dbStats();
    return { baris: sesudah.totalRows, out };`);
  ok('C.9 jejak uji dibersihkan', bersih.baris === 0, bersih);

  selesai(app, fail === 0 ? 0 : 1);
}

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev2, _lvl, msg) => {
    if (/error|uncaught|failed/i.test(msg)) console.log('RENDERER:', msg.slice(0, 300));
  });
  wc.on('did-finish-load', () => { stub(wc).catch(() => {}); });
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    wc.once('did-finish-load', () => {
      const jalan = MODE === 'paksa' ? tahapPaksa : MODE === 'bukti' ? tahapBukti : tahapIsi;
      jalan(wc).catch(async err => {
        console.log('HARNESS ERROR', err && (err.stack || err.message));
        try { console.log('DOM:', JSON.stringify(await ev(wc, 'return document.body.innerText.slice(0,300);'))); } catch { /* jendela mungkin sudah mati */ }
        selesai(app, 2);
      });
    });
  }
});

if (!DATA_DIR || !fs.existsSync(DATA_DIR)) {
  console.log('HARNESS ERROR: HEMS_DATA_DIR wajib pointing ke folder sementara yang ada');
  app.whenReady().then(() => selesai(app, 3));
} else {
  require('../../dist-electron/main.js');
}
