// tests/harness/cetak-check.cjs
// Bukti RUNTIME jalur cetak dokumen (#78). Sebelum harness ini ada, klaim
// "dokumen cetak aman" hanya ditopang uji STATIS di validation-check §24
// (memeriksa bahwa handler memanggil printDocument, bukan window.open). Yang
// tidak pernah diuji: apa jendela cetak yang dibuat main process benar-benar
// muncul, apa isinya dokumen dan bukan antarmuka aplikasi, apa kolom daftar
// dari baris lama/hasil restore tidak meruntuhkan templatenya, dan apa
// penjaga ukuran di main process menolak muatan yang terlalu besar.
//
// Harness ini adalah main process sungguhan (memakai dist-electron/main.js),
// jadi ia bisa menangkap jendela cetak yang dibuat printHtmlDocument — jendela
// itu sandbox, tanpa preload, dan dimuat dari data:text/html. Setiap jendela
// yang muncul dibaca isi DOM-nya, lalu ditutup.
//
// Catatan jujur soal dialog: renderer selalu mengirim `silent: false`, jadi di
// mesin nyata webContents.print() membuka dialog cetak sistem. Di mesin uji
// tanpa operator, method print pada webContents jendela cetak ditimpa (shadow)
// dengan pencatat panggilan — karena itu harness ini membuktikan bahwa print()
// DIPANGGIL dengan opsi yang benar, bukan bahwa kertas keluar dari printer.
// Isi dokumennya sendiri dibaca sungguh-sungguh dari DOM jendela cetak.
//
// Jalankan (profil sementara dibuat sendiri, tidak menyentuh data pengguna):
//   node_modules/electron/dist/electron.exe tests/harness/cetak-check.cjs

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

// ── profil terisolasi ══════════════════════════════════════════════════════
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hems-cetak-'));
process.env.HEMS_DATA_DIR = dir;
app.setPath('userData', dir);
app.disableHardwareAcceleration();

const HELPERS = `
  function setVal(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function byText(re, tag) {
    return [...document.querySelectorAll(tag || 'button')].find(x => re.test((x.innerText || '').trim()));
  }
  function tombolCetak(b) {
    return /print|cetak/i.test((b.getAttribute('title') || '') + ' ' + (b.textContent || ''));
  }
  // Baris/kartu yang bisa dicetak: memuat nomor dokumennya, punya tombol cetak
  // di dalamnya, dan cukup kecil untuk disebut satu baris — bukan seluruh
  // halaman yang kebetulan juga memuat teks itu.
  function barisCetak(penanda) {
    const panjang = [];
    for (const el of document.querySelectorAll('tr, li, .card, div')) {
      const t = el.innerText || '';
      if (t.length > 4000 || !t.includes(penanda)) continue;
      if ([...el.querySelectorAll('button')].some(tombolCetak)) panjang.push(t.length);
    }
    return { ada: panjang.length > 0, terkecil: panjang.length ? Math.min(...panjang) : -1 };
  }
  // Cari tombol cetak pada baris/kartu yang paling sempit memuat nomor dokumen.
  // Paling sempit itu penting: tombol "Cetak Semua" di kepala halaman juga punya
  // leluhur yang memuat nomornya (yaitu seluruh halaman), dan itulah yang harus
  // DIHINDARI, bukan diklik.
  function klikCetak(penanda) {
    const tombol = [...document.querySelectorAll('button')].filter(tombolCetak);
    const temu = [];
    for (const b of tombol) {
      let terbaik = null;
      for (let el = b.parentElement; el && el !== document.body; el = el.parentElement) {
        const t = el.innerText || '';
        if (t.includes(penanda) && (!terbaik || t.length < terbaik.panjang)) {
          terbaik = { wadah: el, panjang: t.length };
        }
      }
      if (terbaik) {
        temu.push({ b, panjang: terbaik.panjang, label: terbaik.wadah.tagName + '.' + String(terbaik.wadah.className || '').slice(0, 24) });
      }
    }
    if (temu.length === 0) return { klik: false, jumlahTombol: tombol.length };
    temu.sort((x, y) => x.panjang - y.panjang);
    temu[0].b.click();
    return { klik: true, wadah: temu[0].label, panjang: temu[0].panjang, kandidat: temu.length };
  }
`;

function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`);
}

// ── penangkap jendela cetak ════════════════════════════════════════════════
// Jendela pertama yang dibuat main.js adalah jendela aplikasi; setiap jendela
// 'window' sesudahnya adalah jendela cetak (popup renderer diblokir hardening,
// jadi tidak ada sumber lain). Property print di-shadow SEBELUM Electron
// sempat memanggil yang asli, sehingga dialog sistem tidak pernah menahan
// mesin uji; kita tetap mencatat opsi yang diberikan renderer.
let wcAplikasi = null;
const antreanCetak = [];
app.on('web-contents-created', (_e, wc) => {
  if (!wcAplikasi) {
    wcAplikasi = wc;
    wc.once('did-finish-load', () => run(wc).catch(err => bail(wc, err)));
    return;
  }
  const item = { wc, panggilan: [], selesaikan: null, muat: null, rusak: null };
  item.muat = new Promise((res) => wc.once('did-finish-load', () => res(true)));
  item.gagal = new Promise((res) => wc.once('did-fail-load', (_c, code, desc) => res({ code, desc })));
  wc.print = (opts, cb) => { item.panggilan.push(opts); item.selesaikan = cb; };
  antreanCetak.push(item);
});
app.on('window-all-closed', () => { /* harness yang memutuskan */ });

async function bail(wc, err) {
  console.log('HARNESS ERROR', err && err.message);
  try { console.log('DOM:', JSON.stringify((await ev(wc, 'return document.body.innerText.slice(0,300);')).slice(0, 300))); } catch { /* abaikan */ }
  selesai(app, 2);
}

async function waitFor(wc, expr, label, timeoutMs = 30000) {
  const mulai = Date.now();
  while (Date.now() - mulai < timeoutMs) {
    let nilai = false;
    try { nilai = await ev(wc, `return !!(${expr});`); } catch { nilai = false; }
    if (nilai) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

// Baca isi jendela cetak. innerText butuh layout; jendela cetak dibuat
// show:false, jadi kalau innerText kosong (tidak ada layout yang terjadi)
// harness jatuh ke tag-text yang sudah dibersihkan dari style/script.
async function bacaJendelaCetak(item) {
  const siap = await Promise.race([
    item.muat.then(() => 'muat'),
    item.gagal.then((g) => ({ gagal: g })),
    wait(20000).then(() => 'waktu-habis'),
  ]);
  if (siap !== 'muat') return { siap, isi: null };
  await wait(120);
  const isi = await item.wc.executeJavaScript(`
    const teksDokumen = () => {
      const b = document.body;
      if (!b) return '';
      const t = b.innerText || '';
      if (t.trim().length > 30) return t;
      return b.innerHTML.replace(/<[^>]*>/g, ' ');
    };
    const meta = document.querySelector('meta[http-equiv]');
    ({
      judul: document.title,
      teks: teksDokumen(),
      jumlahTag: document.querySelectorAll('*').length,
      skrip: document.querySelectorAll('script').length,
      img: document.querySelectorAll('img').length,
      csp: meta ? String(meta.getAttribute('content') || '') : '',
      adaElectronAPI: typeof window.electronAPI,
      adaReactAkar: !!document.querySelector('#root'),
      bocor: typeof window.__cetakBocor,
      urlAwal: String(location.href).slice(0, 26),
      ukuran: String(location.href).length,
    })`);
  return { siap: 'muat', isi };
}

async function tutupJendelaCetak(item) {
  // Panggil balik print() yang tadi ditahan: main process menganggap cetak
  // selesai, menutup jendelanya, dan renderer tidak sempat menampilkan alert
  // "Gagal mencetak" yang akan mengotori uji berikutnya.
  if (item.selesaikan) { try { item.selesaikan(true, 'actioned'); } catch { /* sudah tertutup */ } }
  const mulai = Date.now();
  while (Date.now() - mulai < 8000) {
    if (item.wc.isDestroyed()) return true;
    await wait(100);
  }
  return false;
}

// Satu skenario: buka rute, pastikan barisnya tampil, klik Print, tangkap
// jendela cetaknya, kembalikan assertion mentah untuk diperiksa pemanggil.
// Beberapa halaman punya lebih dari satu tampilan dan TIDAK menyematkan tombol
// cetak di tampilan defaultnya (Rental membuka Timeline duluan; cetaknya ada di
// balik pengalih "Tabel"). Kalau baris tidak ditemukan, harness mencoba satu
// pengalih tampilan yang masuk akal lalu mencari lagi — dan mencatat bahwa ia
// memang harus pindah tampilan, supaya temuan itu tidak hilang diam-diam.
async function cetak(app_, hash, penanda) {
  const cari = `barisCetak(${JSON.stringify(penanda)}).ada === true`;
  await ev(app_, `window.location.hash = '${hash}'; return true;`);
  let tampil = await waitFor(app_, cari, `baris cetak ${penanda} tampil`, 8000);
  let alihan = null;
  if (!tampil) {
    alihan = await ev(app_, `
      const b = [...document.querySelectorAll('button')].find(x => /\\bTabel\\b|\\bList\\b|\\bDaftar\\b/.test((x.textContent || '').trim()));
      if (b) { b.click(); return (b.textContent || '').trim().slice(0, 20); }
      return null;`);
    tampil = await waitFor(app_, cari, `baris cetak ${penanda} tampil sesudah pengalih ${alihan}`, 25000);
    if (alihan) console.log(`CATATAN ${penanda}: tombol cetak tidak ada di tampilan default, baru muncul setelah pengalih "${alihan}"`);
  }
  if (!tampil) return { tampil: false, alihan, hasil: null, panggilan: [] };

  const sebelum = antreanCetak.length;
  const klik = await ev(app_, `return klikCetak(${JSON.stringify(penanda)});`);
  const mulai = Date.now();
  while (antreanCetak.length === sebelum && Date.now() - mulai < 20000) await wait(80);
  if (antreanCetak.length === sebelum) return { tampil: true, alihan, klik, hasil: null, panggilan: [] };

  const item = antreanCetak[antreanCetak.length - 1];
  const baca = await bacaJendelaCetak(item);
  const hasil = {
    ...(baca.isi || {}),
    siap: baca.siap,
    panggilan: item.panggilan,
    tertutup: await tutupJendelaCetak(item),
  };
  const alert = await ev(app_, `return window.__alert.slice();`);
  return { tampil: true, alihan, klik, hasil, alert };
}

const PERUSAHAAN = 'PT Uji Cetak Nusantara';

// ── data uji ══════════════════════════════════════════════════════════════
// Semua baris memakai nomor berkata-CTK supaya jendela cetak bisa ditautkan
// ke satu record. Bentuknya disamakan dengan SEED usable-check (kolom yang
// memang dibaca tiap template cetak).
const SATUSERIA = {
  sales: [{ id: 'CTK-SO1', orderNo: 'SO/CTK/0001', customerName: PERUSAHAAN, unitModel: 'SANY SY215C', serialNumber: 'SDPCTK0001', orderDate: '2026-10-01', totalPrice: 1_750_000_000, downPayment: 350_000_000, paymentScheme: 'LEASING', status: 'CONFIRMED', salesPerson: 'Budi Hartono' }],
  purchases: [{ id: 'CTK-PO1', poNumber: 'PO/CTK/0001', supplierName: 'PT Pemasok Uji Sentosa', itemName: 'Filter Oli Uji 250 Jam', category: 'SPAREPART', orderDate: '2026-10-02', deliveryExpectedDate: '2026-10-20', totalAmount: 4_620_000, status: 'ORDERED', notes: 'Catatan PO uji' }],
  rentals: [{ id: 'CTK-RT1', contractNo: 'RCT-CTK-0001', customerName: PERUSAHAAN, unitModel: 'SANY SY215C', serialNumber: 'SDPCTK0001', startDate: '2026-10-01', endDate: '2026-12-31', location: 'Proyek Uji Seksi 1', monthlyRate: 55_000_000, minimumHours: 180, operatorIncluded: true, status: 'ACTIVE' }],
  invoices: [{ id: 'CTK-INV1', invoiceNo: 'INV/CTK/0001', customerName: PERUSAHAAN, unitOrDesc: 'SANY SY215C', type: 'SALES', issueDate: '2026-10-03', dueDate: '2026-11-03', totalAmount: 1_750_000_000, paidAmount: 0, status: 'UNPAID' }],
  deliveries: [{ id: 'CTK-DO1', doNumber: 'DO/CTK/0001', salesOrderRef: 'SO/CTK/0001', customerName: PERUSAHAAN, unitModel: 'SANY SY215C', serialNumber: 'SDPCTK0001', deliveryDate: '2026-10-05', destination: 'Proyek Uji Seksi 1', driverName: 'Sutarjo Wibowo', truckPlate: 'B 9214 KXA', status: 'MENUNGGU', notes: 'Catatan SJ uji' }],
  services: [{ id: 'CTK-WO1', woNumber: 'WO/CTK/0001', unitModel: 'SANY SY215C', serialNumber: 'SDPCTK0001', customerOrProject: PERUSAHAAN, serviceType: 'PERIODIC_500H', mechanicName: 'Agus Supriyatno', openDate: '2026-10-02', hourMeter: 4210, estimatedCost: 8_500_000, status: 'OPEN', complaintNotes: 'Getaran pada boom saat swing' }],
  breakdowns: [{
    id: 'CTK-BD1', breakdownNumber: 'BD/CTK/0001', unitSerialNumber: 'SDPCTK0001', unitModel: 'SANY SY215C', location: 'Proyek Uji Seksi 1', reportedBy: 'Agus Supriyatno', reportedAt: '2026-10-05', severity: 'MAJOR', status: 'REPAIRING', description: 'Kebocoran oli silinder boom kanan', assignedTechnician: 'Bambang Riyadi', estimatedRepairCost: 42_500_000, actualRepairCost: 40_000_000, downtimeHours: 26, startTime: '2026-10-05T08:00:00', endTime: '2026-10-06T10:00:00', diagnosis: 'Seal kit aus', resolutionNotes: 'Penggantian seal kit',
    partsUsed: [{ partName: 'Seal Kit Boom', quantity: 2, cost: 3_500_000 }, { partName: 'O Ring Set', quantity: 6, cost: 450_000 }],
  }],
  operators: [{
    id: 'CTK-OP1', operatorNumber: 'OP/CTK/0001', name: 'Sutarjo Wibowo', email: 'sutarjo@uji.test', phone: '0813-2233-4455', nik: '3671012398000012', status: 'ACTIVE',
    certifications: [{ name: 'SIO Kelas II', issueDate: '2024-05-10', expiryDate: '2027-05-10' }, { name: 'Safety Riding', issueDate: '2025-01-10', expiryDate: '2028-01-10' }],
    assignedUnit: 'SDPCTK0001', assignedProject: 'Proyek Uji Seksi 1', totalHours: 3180, startDate: '2023-02-01', licenseNumber: 'SIO/CTK/0001', licenseExpiry: '2027-05-10', notes: 'Catatan operator uji',
  }],
  technicians: [{
    id: 'CTK-TC1', technicianNumber: 'TECH/CTK/0001', name: 'Bambang Riyadi', email: 'bambang@uji.test', phone: '0812-9988-7766', nik: '3671012398000099', status: 'ACTIVE',
    specializations: ['Hidrolik', 'Engine Overhaul', 'Kelistrikan Alat Berat'], skills: ['SANY SY215C', 'Komatsu PC200-8'],
    certifications: [{ name: 'Hydraulic System Specialist', issueDate: '2023-07-01', expiryDate: '2026-07-01' }],
    totalWorkOrders: 214, totalHours: 5230, startDate: '2021-08-16', notes: 'Catatan teknisi uji',
  }],
  approvals: [{ id: 'CTK-AP1', requestNumber: 'APR/CTK/0001', type: 'MAINTENANCE_REQUEST', title: 'Perbaikan silinder boom kanan', description: 'Estimasi 42,5 juta termasuk seal kit asli', requestedBy: 'Agus Supriyatno', requestedAt: '2026-10-06', amount: 42_500_000, status: 'PENDING', approverLevel: 1, currentApprover: 'admin', notes: 'Catatan approval uji' }],
  warehouse: [{ id: 'CTK-WH1', trxNo: 'MTS/CTK/0001', type: 'OUTBOUND', warehouseName: 'Gudang Cikande Induk', itemDescription: 'Seal Kit Boom SANY SY215C', qty: 2, unit: 'SET', referenceDoc: 'WO/CTK/0001', date: '2026-10-06', pic: 'Agus Supriyatno', notes: 'Pemakaian untuk perbaikan boom' }],
};

// Baris rusak: kolom daftar berbentuk TEKS, bukan array. Persis bentuk yang
// dihasilkan baris lama atau hasil restore sebagian — dan justru di situ
// template cetak dulu melempar. Tujuannya membuktikan penjaga Array.isArray.
const RUSAK = {
  operators: [{ id: 'CTK-OP2', operatorNumber: 'OP/CTK/0002', name: 'Operator Baris Lama', phone: '0813-0000-1111', status: 'ACTIVE', certifications: 'SIO Kelas II', assignedUnit: 'SDPCTK0001', assignedProject: 'Proyek Uji', totalHours: 900, startDate: '2022-01-05' }],
  technicians: [{ id: 'CTK-TC2', technicianNumber: 'TECH/CTK/0002', name: 'Teknisi Baris Lama', phone: '0812-0000-2222', status: 'ACTIVE', specializations: 'Hidrolik', skills: 'SANY SY215C', certifications: 'Hydraulic Specialist', totalWorkOrders: 88, totalHours: 1200, startDate: '2020-03-01' }],
  breakdowns: [{ id: 'CTK-BD2', breakdownNumber: 'BD/CTK/0002', unitSerialNumber: 'SDPCTK0002', unitModel: 'KOMATSU PC200-8', location: 'Proyek Uji Seksi 2', reportedBy: 'Agus', reportedAt: '2026-10-07', severity: 'MINOR', status: 'REPORTED', description: 'Asap tebal saat beban penuh', assignedTechnician: 'Bambang', estimatedRepairCost: 9_000_000, downtimeHours: 4, partsUsed: 'Filter Udara' }],
};
// teknisi ketiga: kolom daftar HILANG sama sekali (bukan teks) — jalur `?? []`
RUSAK.technicians.push({ id: 'CTK-TC3', technicianNumber: 'TECH/CTK/0003', name: 'Teknisi Tanpa Daftar', phone: '0812-0000-3333', status: 'INACTIVE', totalWorkOrders: 12, totalHours: 300, startDate: '2019-06-01' });

const BOCOR = {
  operators: [{ id: 'CTK-OP9', operatorNumber: 'OP/CTK/0009', name: '<script>window.__cetakBocor=1</script>', email: '<img src=x onerror="window.__cetakBocor=2">', phone: '0813-7777-8888', status: 'ACTIVE', certifications: [{ name: '<img src=x onerror="window.__cetakBocor=3">', issueDate: '2025-02-02', expiryDate: '2028-02-02' }], assignedUnit: 'SDPCTK0001', assignedProject: 'Proyek Uji', totalHours: 100, startDate: '2024-01-01', notes: '<script>window.__cetakBocor=4</script>' }],
};

// Daftar yang harus dicetak: [rute, nomor dokumen, label]
const DOKUMEN = [
  ['#/sales', 'SO/CTK/0001', 'SPK Penjualan'],
  ['#/purchase', 'PO/CTK/0001', 'Purchase Order'],
  ['#/rental', 'RCT-CTK-0001', 'Kontrak Rental'],
  ['#/delivery', 'DO/CTK/0001', 'Surat Jalan'],
  ['#/invoices', 'INV/CTK/0001', 'Invoice'],
  ['#/service', 'WO/CTK/0001', 'Work Order'],
  ['#/breakdown', 'BD/CTK/0001', 'Breakdown Report'],
  ['#/operators', 'OP/CTK/0001', 'Operator Profile'],
  ['#/technicians', 'TECH/CTK/0001', 'Technician Profile'],
  ['#/approvals', 'APR/CTK/0001', 'Approval Request'],
  ['#/warehouse', 'MTS/CTK/0001', 'Bukti Mutasi Gudang'],
];
const DOKUMEN_RUSAK = [
  ['#/operators', 'OP/CTK/0002', 'Operator Profile (certifications berupa teks)'],
  ['#/technicians', 'TECH/CTK/0002', 'Technician Profile (specializations/skills/certifications berupa teks)'],
  ['#/technicians', 'TECH/CTK/0003', 'Technician Profile (kolom daftar hilang)'],
  ['#/breakdown', 'BD/CTK/0002', 'Breakdown Report (partsUsed berupa teks)'],
];

async function run(wc) {
  await wait(600);

  // ── 1. login lewat UI, lalu netralkan dialog ═════════════════════════════
  const login = await waitFor(wc, `!!document.querySelector('#login-username')`, 'form login', 40000);
  ok('C.1 layar login muncul', login === true, login);
  await ev(wc, `
    setVal(document.querySelector('#login-username'), 'admin');
    setVal(document.querySelector('#login-password'), 'admin123');
    const b = byText(/Masuk ke FATHONI/); if (b) b.click(); return !!b;`);
  const gate = await waitFor(wc, `/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'gate ganti password', 45000);
  await ev(wc, `
    setVal(document.querySelector('#cpw-current'), 'admin123');
    setVal(document.querySelector('#cpw-next'), 'BaruCetak123');
    setVal(document.querySelector('#cpw-confirm'), 'BaruCetak123');
    const b = byText(/Simpan password baru/); if (b) b.click(); return !!b;`);
  const shell = await waitFor(wc, `/Dasbor|Armada|Kontrol/i.test(document.body.innerText) && !/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'shell sesudah login', 45000);
  ok('C.2 aplikasi terbuka (login + ganti password lewat UI)', gate === true && shell === true, { gate, shell });

  // confirm() cetak dibuat selalu 'ya' (handler cetak memang berpintu confirm),
  // alert() dikumpulkan supaya kegagalan cetak bisa dilihat, bukan hilang.
  await ev(wc, `
    window.__alert = [];
    window.alert = (m) => { window.__alert.push(String(m)); };
    window.confirm = () => true;
    return true;`);

  // ── 2. seed dokumen uji, lalu boot ulang ═════════════════════════════════
  const SEMUA = { ...SATUSERIA };
  for (const [k, rows] of Object.entries(RUSAK)) SEMUA[k] = (SEMUA[k] || []).concat(rows);
  for (const [k, rows] of Object.entries(BOCOR)) SEMUA[k] = (SEMUA[k] || []).concat(rows);
  const seed = await ev(wc, `
    const patch = {};
    for (const [k, rows] of Object.entries(${JSON.stringify(SEMUA)})) patch[k] = { upsert: rows, removeIds: [] };
    const r = await window.electronAPI.dbPatch(patch);
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER', 'RENTAL', 'CONTRACTOR'], customMenus: [], isSetupComplete: true }));
    localStorage.setItem('hems_settings', JSON.stringify({ name: ${JSON.stringify(PERUSAHAAN)}, address: 'Jl. Uji No. 1, Cikande' }));
    return { sales: r.sales && r.sales.inserted, operators: r.operators && r.operators.inserted, technicians: r.technicians && r.technicians.inserted, breakdowns: r.breakdowns && r.breakdowns.inserted, warehouse: r.warehouse && r.warehouse.inserted };`);
  ok('C.3 dokumen uji tertulis lewat jalur patch',
    seed.sales === 1 && seed.operators === 3 && seed.technicians === 3 && seed.breakdowns === 2 && seed.warehouse === 1, seed);
  await wc.reload();
  const shell2 = await waitFor(wc, `/Dasbor|Armada|Kontrol/i.test(document.body.innerText)`, 'shell sesudah reload', 45000);
  ok('C.4 aplikasi boot ulang membawa dokumen uji', shell2 === true, shell2);
  await ev(wc, `
    window.__alert = [];
    window.alert = (m) => { window.__alert.push(String(m)); };
    window.confirm = () => true;
    return true;`);

  // ── 3. tiap dokumen cetak benar-benar dihasilkan ═════════════════════════
  const ringkas = [];
  for (const [hash, penanda, label] of DOKUMEN) {
    const r = await cetak(wc, hash, penanda);
    const h = r.hasil || {};
    const teks = String(h.teks || '');
    const panggilan = h.panggilan || [];
    ok(`C.5 cetak ${label}: jendela cetak muncul dan dokumennya terisi`,
      r.tampil === true && r.klik && r.klik.klik === true && h.siap === 'muat'
      && teks.includes(penanda) && h.jumlahTag > 12,
      { tampil: r.tampil, alihan: r.alihan, klik: r.klik, siap: h.siap, jumlahTag: h.jumlahTag, potongan: teks.slice(0, 90) });
    ok(`C.6 cetak ${label}: isi dokumen, bukan antarmuka aplikasi`,
      teks.includes(PERUSAHAAN) && h.adaReactAkar === false && String(h.urlAwal || '').startsWith('data:text/html'),
      { url: h.urlAwal, adaReactAkar: h.adaReactAkar, perusahaan: teks.includes(PERUSAHAAN) });
    ok(`C.7 cetak ${label}: webContents.print dipanggil sekali dengan opsi A4 + latar`,
      panggilan.length === 1 && panggilan[0].pageSize === 'A4' && panggilan[0].printBackground === true,
      panggilan);
    ok(`C.8 cetak ${label}: jendela cetak ditutup lagi dan tidak ada alert kegagalan`,
      h.tertutup === true && !(r.alert || []).some(a => /Gagal mencetak/i.test(a)),
      { tertutup: h.tertutup, alert: r.alert });
    // Baris bersih tidak boleh menyisakan teks mentah hasil template yang gagal.
    ok(`C.9 cetak ${label}: tidak ada artefak template (undefined / [object)`,
      teks.length > 0 && !/\[object|\bundefined\b/.test(teks),
      { artefak: (teks.match(/.{0,30}(undefined|\[object).{0,30}/g) || []).slice(0, 2) });
    ringkas.push({ label, ukuran: h.ukuran, tag: h.jumlahTag });
    console.log(`INFO cetak ${label}: ${h.jumlahTag} elemen, dokumen ${(h.ukuran || 0) / 1024} KB (base64)`);
  }

  // ── 3b. bukti gudang: tombol ini dulu hanya memunculkan alert ════════════
  // C.5 saja tidak cukup untuk kasus ini: alert lama juga membuat barisnya
  // "bisa ditekan". Yang harus dibuktikan adalah jendela cetaknya muncul TANPA
  // satu pun alert dan isinya formulir serah terima, bukan layar aplikasi.
  const gudang = await cetak(wc, '#/warehouse', 'MTS/CTK/0001');
  const gt = String((gudang.hasil || {}).teks || '');
  ok('C.9b Bukti Mutasi Gudang mencetak formulir serah terima, bukan kotak dialog',
    gudang.tampil === true && (gudang.alert || []).length === 0
    && gudang.klik && gudang.klik.klik === true
    && /BUKTI SERAH TERIMA MUTASI BARANG/.test(gt) && gt.includes('MTS/CTK/0001')
    && /Penerima Barang/.test(gt) && (gudang.hasil || {}).jumlahTag > 20,
    { tampil: gudang.tampil, klik: gudang.klik, alert: gudang.alert, potongan: gt.slice(0, 120) });

  // ── 4. hardening jendela cetak ═══════════════════════════════════════════
  const contoh = await cetak(wc, '#/operators', 'OP/CTK/0001');
  const ch = contoh.hasil || {};
  ok('C.10 jendela cetak membawa CSP default-src none (isi dokumen tak bisa memuat sumber)',
    /default-src 'none'/.test(String(ch.csp || '')) && /style-src 'unsafe-inline'/.test(String(ch.csp || '')),
    { csp: String(ch.csp || '').slice(0, 160) });
  ok('C.11 jendela cetak tidak punya akses IPC sama sekali (tanpa preload)',
    ch.adaElectronAPI === 'undefined', { adaElectronAPI: ch.adaElectronAPI });

  // ── 5. kolom daftar yang rusak tidak meruntuhkan dokumen ══════════════════
  for (const [hash, penanda, label] of DOKUMEN_RUSAK) {
    const r = await cetak(wc, hash, penanda);
    const h = r.hasil || {};
    const teks = String(h.teks || '');
    ok(`C.12 dokumen tetap tercetak untuk baris rusak: ${label}`,
      r.tampil === true && h.siap === 'muat' && teks.includes(penanda)
      && (h.panggilan || []).length === 1,
      { tampil: r.tampil, klik: r.klik, siap: h.siap, potongan: teks.slice(0, 90) });
  }

  // ── 6. isi dokumen tidak pernah bisa menjalankan skrip ════════════════════
  const xss = await cetak(wc, '#/operators', 'OP/CTK/0009');
  const x = xss.hasil || {};
  ok('C.13 nama bernilai tag HTML tercetak sebagai teks, bukan sebagai elemen',
    x.siap === 'muat' && x.skrip === 0 && x.img === 0 && x.bocor === 'undefined',
    { skrip: x.skrip, img: x.img, bocor: x.bocor, potongan: String(x.teks || '').slice(0, 120) });

  // ── 7. penjaga muatan di main process ════════════════════════════════════
  const jendelaSebelumPenjaga = antreanCetak.length;
  const penjaga = await ev(wc, `
    const kosong = await window.electronAPI.printDocument('', 'Kosong');
    const bukanString = await window.electronAPI.printDocument({ html: 'x' }, 'Objek');
    const kebesaran = await window.electronAPI.printDocument('<p>' + 'A'.repeat(1100000) + '</p>', 'Kebesaran');
    return { kosong, bukanString, kebesaran };`);
  ok('C.14 main process menolak dokumen kosong dan dokumen bukan teks',
    penjaga.kosong && penjaga.kosong.success === false && /kosong/i.test(penjaga.kosong.error || '')
    && penjaga.bukanString && penjaga.bukanString.success === false,
    penjaga);
  ok('C.15 main process menolak dokumen di atas 1 MB dengan pesan yang menjelaskan',
    penjaga.kebesaran && penjaga.kebesaran.success === false
    && /1 MB/.test(String(penjaga.kebesaran.error || '')),
    penjaga.kebesaran);
  await wait(600);
  ok('C.15b muatan yang ditolak tidak sempat membuat jendela cetak',
    antreanCetak.length === jendelaSebelumPenjaga,
    { sebelum: jendelaSebelumPenjaga, sesudah: antreanCetak.length });

  // ── 8. tidak ada jendela yang tertinggal ═════════════════════════════════
  await wait(400);
  const jendela = BrowserWindow.getAllWindows().map(b => b.getTitle());
  ok('C.16 hanya satu jendela yang tersisa setelah seluruh dokumen dicetak',
    jendela.length === 1, { jendela });
  const hidup = await waitFor(wc, `/Dasbor|Armada|Kontrol/i.test(document.body.innerText) && !/(sesuatu salah|error boundary|terjadi kesalahan)/i.test(document.body.innerText)`, 'aplikasi masih sehat', 15000);
  ok('C.17 aplikasi tetap berfungsi setelah belasan kali mencetak (tidak ada error boundary)', hidup === true, hidup);
  const sisaAlert = await ev(wc, `return window.__alert.slice();`);
  ok('C.18 tidak ada satu pun alert kegagalan cetak selama harness',
    sisaAlert.length === 0, sisaAlert);
  console.log('INFO jendela cetak yang ditangkap: ' + antreanCetak.length);
  console.log('INFO ringkasan dokumen: ' + JSON.stringify(ringkas));

  console.log(`\n=== cetak-check: ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

require('../../dist-electron/main.js');
app.whenReady().then(() => { /* main.js yang membuka jendela */ });
