// tests/harness/handoff-check.cjs
// Verifikasi Fase 3 lewat aplikasi nyata (Electron + UI React): migrasi saat boot,
// lalu handoff Pembelian→Gudang/Pemasok/Kas, Servis→Part/Invoice, dan
// Invoice→Kas. Semua berjalan di profil terisolasi (HEMS_DATA_DIR wajib).
//
// Sejak sumber data aplikasi menjadi file SQLite (Fase 4), data uji dituliskan
// langsung ke database sebelum halaman dimuat ulang; seluruh kondisi dibaca dari
// database lewat IPC, bukan dari localStorage lagi.
//
// Jalankan:
//   HEMS_DATA_DIR=D:/SANY/tmp-harness/handoff npx electron tests/harness/handoff-check.cjs

const { app } = require('electron');
const selesai = require('./selesai.cjs');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

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
  async function readStore() {
    const d = await window.electronAPI.dbLoad();
    return d && typeof d === 'object' ? d : {};
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

// Kondisi dibaca dari localStorage, bukan DOM: penyimpanan di-debounce, jadi
// hasilnya harus dipoll sampai snapshot berikutnya masuk. `body` adalah isi
// fungsi dan wajib memanggil `return`.
async function waitForStore(wc, body, label, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await ev(wc, `const s = await readStore(); ${body}`);
    if (value !== false && value !== null && value !== undefined) return value;
    await wait(300);
  }
  console.log(`TIMEOUT menunggu store: ${label}`);
  return null;
}

const bodyText = (wc) => ev(wc, `return document.body.innerText;`);

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev2, _lvl, msg) => {
    if (/error|uncaught|failed/i.test(msg)) console.log('RENDERER:', msg.slice(0, 300));
  });
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    wc.once('did-finish-load', () => run(wc).catch(err => bail(wc, err)));
  }
});

async function bail(wc, err) {
  console.log('HARNESS ERROR', err && err.message);
  try {
    console.log('DOM:', JSON.stringify((await ev(wc, 'return document.body.innerText.slice(0,300);'))));
  } catch { /* abaikan */ }
  selesai(app, 2);
}

// ── Data seed: semuanya record fiktif-uji yang BUKAN data contoh aplikasi ──
const SEED = {
  units: [
    { id: 'H-U1', serialNumber: 'HAND-SY-001', brand: 'SANY', model: 'SY215C', status: 'MAINTENANCE', hourMeter: 120, purchasePrice: 1_500_000_000 },
    { id: 'H-U2', serialNumber: 'HAND-PC-002', brand: 'KOMATSU', model: 'PC200-8', status: 'AVAILABLE', hourMeter: 4000, purchasePrice: 1_800_000_000 },
  ],
  customers: [{ id: 'H-C1', name: 'PT Hand Uji Konstruksi', segment: 'KONTRAKTOR', contactPerson: 'Uji', phone: '0812', email: 'uji@example.com', address: 'Cikande' }],
  suppliers: [],
  spareParts: [{ id: 'H-SP1', name: 'Filter Oli Uji', sku: 'HAND-SKU-1', stock: 10, minStock: 2, price: 300_000, unit: 'pcs' }],
  invoices: [],
  sales: [{
    id: 'H-SO1', orderNo: 'SO-HAND-001', customerName: 'PT Hand Uji Konstruksi', unitModel: 'SANY SY215C',
    serialNumber: 'HAND-SY-001', orderDate: '2026-09-05', totalPrice: 1_000_000_000, downPayment: 200_000_000,
    paymentScheme: 'LEASING', status: 'CONFIRMED', salesPerson: 'Budi',
  }],
  rentals: [],
  services: [
    {
      id: 'H-WO1', woNumber: 'WO-HAND-001', unitModel: 'SANY SY215C', serialNumber: 'HAND-SY-001',
      customerOrProject: 'PT Hand Uji Konstruksi', serviceType: 'BREAKDOWN', mechanicName: 'Agus',
      hourMeter: 120, openDate: '2026-10-01', estimatedCost: 5_000_000, status: 'IN_PROGRESS', complaintNotes: 'Uji handoff',
    },
    {
      id: 'H-WO2', woNumber: 'WO-HAND-002', unitModel: 'Komatsu PC200-8', serialNumber: 'HAND-PC-002',
      customerOrProject: 'PT Hand Uji Konstruksi', serviceType: 'PERIODIC_500H', mechanicName: 'Hendra',
      hourMeter: 4000, openDate: '2026-08-02', completedDate: '2026-08-04', estimatedCost: 7_500_000, status: 'COMPLETED', complaintNotes: 'Servis selesai lama',
    },
  ],
  kas: [],
  deliveries: [],
  warehouse: [],
  purchases: [{
    id: 'H-PO1', poNumber: 'PO-HAND-001', supplierName: 'PT Pemasok Uji', itemName: '6 Filter Oli Uji',
    category: 'SPAREPART', orderDate: '2026-09-01', deliveryExpectedDate: '2026-09-20', totalAmount: 1_800_000,
    status: 'ORDERED', notes: 'Uji handoff penerimaan',
  }],
  documents: [],
  bankAccounts: [{ id: 'H-B1', namaBank: 'BCA Uji', nomorRekening: '999888777', namaPemilik: 'PT Uji', cabang: 'Cikande', mataUang: 'IDR', isActive: true, keterangan: '' }],
  breakdowns: [], operators: [], technicians: [], approvals: [],
};

const LEGACY_SUPPLIERS = [
  { id: 'LS1', name: 'PT Pemasok Warisan', category: 'SPAREPART', phone: '0800' },
  { id: 'LS2', name: 'PT Pemasok Warisan', category: 'SPAREPART', phone: '0800' },
];

// Sejak Fase 4 sumber data adalah file SQLite. Harness menjalankan modul
// migrasi asli aplikasi atas data uji, lalu menulis hasilnya ke database yang
// sedang dipakai aplikasi (harness dan main process memakai instance modul yang
// sama). Jalur impor localStorage -> SQLite diuji terpisah oleh db-store-run.
const path = require('path');
const os = require('os');
const fs = require('fs');
const esbuild = require('esbuild');

function migrateSeedInProcess() {
  class MemoryStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
  }
  const shim = new MemoryStorage();
  shim.setItem('hems_data_store_v1', JSON.stringify(SEED));
  shim.setItem('HEMS_SUPPLIERS', JSON.stringify(LEGACY_SUPPLIERS));

  const outfile = path.join(os.tmpdir(), `hems-handoff-entry-${process.pid}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'migration.entry.ts')],
    bundle: true, format: 'cjs', platform: 'node', target: 'node18',
    outfile, logLevel: 'error',
  });
  const previous = globalThis.localStorage;
  globalThis.localStorage = shim;
  try {
    return require(outfile).migrateStore(JSON.parse(JSON.stringify(SEED)));
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
    fs.rmSync(outfile, { force: true });
  }
}

async function seedDatabase(wc) {
  const migrated = migrateSeedInProcess();
  require('../../dist-electron/db.js').saveStore(migrated.store);
  await ev(wc, `
    localStorage.setItem('hems_data_migration_v1', ${JSON.stringify(JSON.stringify(migrated.report))});
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    localStorage.setItem('HEMS_SUPPLIERS', ${JSON.stringify(JSON.stringify(LEGACY_SUPPLIERS))});
    localStorage.removeItem('hems_session');
    localStorage.removeItem('hems_session_v2');
    return true;`);
  await wc.reload();
  return migrated;
}

async function run(wc) {
  ok('0.1 aplikasi boot sampai layar login',
    await waitFor(wc, `!!document.querySelector('#login-username')`, 'form login', 40000));

  const migrated = await seedDatabase(wc);
  ok('0.2 aplikasi boot ulang dengan data uji di SQLite',
    await waitFor(wc, `!!document.querySelector('#login-username')`, 'form login setelah seed', 40000));

  // ── 1. Login + layar wajib ganti password (profile baru => kredensial default) ──
  await ev(wc, `
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    return true;`);
  await ev(wc, `
    setVal(document.querySelector('#login-username'), 'admin');
    setVal(document.querySelector('#login-password'), 'admin123');
    const b = byText(/Masuk ke FATHONI/); if (b) b.click();
    return !!b;`);
  ok('1.1 login awal mencapai layar ganti password',
    await waitFor(wc, `/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'gate', 45000));

  await ev(wc, `
    setVal(document.querySelector('#cpw-current'), 'admin123');
    setVal(document.querySelector('#cpw-next'), 'BaruHand123');
    setVal(document.querySelector('#cpw-confirm'), 'BaruHand123');
    const b = byText(/Simpan password baru/); if (b) b.click();
    return !!b;`);
  ok('1.2 aplikasi terbuka setelah ganti password',
    await waitFor(wc, `/Dasbor|Armada|Kontrol/i.test(document.body.innerText) && !/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'dashboard', 45000));

  // ── 2. Hasil migrasi (modul asli aplikasi) terbaca dari SQLite oleh UI ──
  const marker = await ev(wc, `
    const raw = localStorage.getItem('hems_data_migration_v1');
    return raw ? JSON.parse(raw) : null;`);
  ok('2.1 marker migrasi dibaca aplikasi', marker && typeof marker.at === 'string', marker);
  ok('2.2 backfill menagihkan 1 penjualan + 1 servis selesai', marker && marker.backfilledInvoices === 2, marker);
  ok('2.2b pemasok warisan tercatat diimpor', marker && marker.imported.suppliers === 1, marker && marker.imported);

  const dump = await ev(wc, `
    const s = await readStore();
    return {
      size: (localStorage.getItem('hems_data_store_v1') || '').length,
      counts: Object.entries(s).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v]),
      hasUnsaved: document.body.innerText.includes('TIDAK TERSIMPAN'),
    };`);
  console.log('DUMP-SETELAH-LOGIN ' + JSON.stringify(dump));

  const afterBoot = await waitForStore(wc, `
    const inv = (s.invoices || []).find(i => String(i.invoiceNo || '').includes('SO-HAND-001'));
    if (!inv) return false;
    return {
      purchases: (s.purchases||[]).map(p => [p.poNumber, p.status]),
      suppliers: (s.suppliers||[]).map(x => x.name),
      invoices: (s.invoices||[]).map(i => [i.invoiceNo, i.type, i.paidAmount, i.status]),
      warehouse: (s.warehouse||[]).length,
      kas: (s.kas||[]).map(k => [k.kategori, k.tipe, k.jumlah, k.referensi]),
      legacyStillThere: localStorage.getItem('HEMS_SUPPLIERS') !== null,
    };
  `, 'hasil migrasi terbaca dari database');

  const boot = afterBoot || { purchases: [], suppliers: [], invoices: [], warehouse: 0, kas: [], legacyStillThere: null };
  ok('2.0 hasil migrasi benar-benar tersimpan', afterBoot !== null, afterBoot);
  const saleInv = (boot.invoices || []).find(i => String(i[0]).includes('SO-HAND-001'));
  ok('2.3 penjualan hasil migrasi punya invoice INV/SALE/...', saleInv && /^INV\/SALE\/SO-HAND-001$/.test(saleInv[0]), saleInv);
  ok('2.4 DP dianggap sebagai pembayaran, status PARTIAL', saleInv && saleInv[2] === 200_000_000 && saleInv[3] === 'PARTIAL', saleInv);
  const svcInv = (boot.invoices || []).find(i => String(i[0]).includes('WO-HAND-002'));
  ok('2.5 servis COMPLETED di-backfill, servis berjalan tidak', svcInv && svcInv[1] === 'SERVICE', boot.invoices);
  ok('2.6 WO IN_PROGRESS tidak ditagihkan',
    !(boot.invoices || []).some(i => String(i[0]).includes('WO-HAND-001')), boot.invoices);
  ok('2.7 pemasok warisan terimpor tanpa duplikat',
    (boot.suppliers || []).filter(n => n === 'PT Pemasok Warisan').length === 1, boot.suppliers);
  ok('2.8 kunci warisan asli tetap ada di profil (tidak dihapus)', boot.legacyStillThere === true);

  // ── 3. Handoff Pembelian → Gudang + Pemasok + Kas + stok part ──
  await ev(wc, `window.location.hash = '#/purchase'; return true;`);
  ok('3.1 halaman Pembelian memuat', await waitFor(wc, `/Terima Barang/.test(document.body.innerText)`, 'tombol terima', 30000));
  await ev(wc, `const b = byText(/^Terima Barang$/); if (b) b.click(); return !!b;`);

  const afterReceive = await waitForStore(wc, `
    const p = (s.purchases || []).find(x => x.poNumber === 'PO-HAND-001');
    if (!p || p.status !== 'RECEIVED') return false;
    return {
      status: p.status, received: !!p.receivedDate,
      warehouse: (s.warehouse || []).filter(w => w.referenceDoc === 'PO-HAND-001'),
      suppliers: (s.suppliers || []).map(x => x.name),
      part: (s.spareParts || []).find(x => x.id === 'H-SP1'),
      kas: (s.kas || []).filter(k => k.referensi === 'PO-HAND-001'),
    };
  `, 'penerimaan PO tersimpan');

  ok('3.2 PO berubah menjadi RECEIVED beserta tanggal terima', afterReceive && afterReceive.status === 'RECEIVED' && afterReceive.received, afterReceive);
  const inbound = (afterReceive && afterReceive.warehouse || []).filter(w => w.type === 'INBOUND');
  ok('3.3 mutasi gudang INBOUND tercatat dengan qty dari nama barang',
    inbound.length === 1 && inbound[0].qty === 6, inbound);
  ok('3.4 nomor dokumen gudang terhubung ke PO',
    inbound.length === 1 && /^GR-.*PO-HAND-001/.test(String(inbound[0].trxNo)), inbound && inbound[0] && inbound[0].trxNo);
  ok('3.5 pemasok PO terhubung ke master Pemasok',
    afterReceive && (afterReceive.suppliers || []).includes('PT Pemasok Uji'), afterReceive && afterReceive.suppliers);
  ok('3.6 stok suku cadang bertambah 6 (10 → 16)',
    afterReceive && afterReceive.part && afterReceive.part.stock === 16, afterReceive && afterReceive.part);
  ok('3.7 uang keluar tercatat di kas sebagai PEMBELIAN',
    afterReceive && afterReceive.kas.length === 1 && afterReceive.kas[0].tipe === 'KELUAR' && afterReceive.kas[0].jumlah === 1_800_000,
    afterReceive && afterReceive.kas);

  // ── 3b. Hapus PO yang sudah diterima harus DITOLAK dari menunya ──
  // Aturan rujukan sudah dibuktikan di integrity-check dan lewat IPC di gui-check;
  // yang di sini adalah sambungannya: halaman Pembelian harus memakai removeRow
  // (yang menanyakan aturan ke main process) dan bukan menyaring array di memori,
  // karena array yang disaring akan tertulis sebagai collection penuh — PO-nya
  // hilang, mutasi GR- di gudang tetap ada.
  const klikHapus = await ev(wc, `
    window.__alerts.length = 0;
    const baris = [...document.querySelectorAll('tr')].find(r => /PO-HAND-001/.test(r.innerText));
    const b = baris && [...baris.querySelectorAll('button')].find(x => /^Hapus$/.test((x.innerText || '').trim()));
    if (b) b.click();
    return { adaBaris: !!baris, adaTombol: !!b };`);
  ok('3.8 baris PO yang sudah diterima masih punya tombol hapus untuk diuji',
    klikHapus.adaBaris === true && klikHapus.adaTombol === true, klikHapus);
  const setelahHapus = await waitForStore(wc, `
    const alert = (window.__alerts || []).join(' | ');
    if (!alert) return false;
    return {
      alert,
      poMasihAda: (s.purchases || []).some(p => p.poNumber === 'PO-HAND-001'),
      mutasi: (s.warehouse || []).filter(w => w.referenceDoc === 'PO-HAND-001').length,
      domMasihMenampilkan: /PO-HAND-001/.test(document.body.innerText),
    };`, 'penolakan hapus PO', 25000);
  ok('3.9 hapus PO yang sudah diterima ditolak dengan alasan yang menyebut mutasi gudang dan kas',
    setelahHapus && /masih dipakai/i.test(setelahHapus.alert)
      && /Mutasi Gudang/i.test(setelahHapus.alert) && /Mutasi Kas/i.test(setelahHapus.alert),
    setelahHapus);
  ok('3.10 PO yang ditolak benar-benar tidak hilang (database dan layar)',
    setelahHapus && setelahHapus.poMasihAda === true && setelahHapus.domMasihMenampilkan === true
      && setelahHapus.mutasi === 1, setelahHapus);
  // Alert penolakan ini sengaja, jadi diambil lagi dari antreannya: bagian 4 dan
  // seterusnya memeriksa "tidak ada alert validasi yang tertahan", dan satu alert
  // dari sini akan membacanya sebagai cacat.
  await ev(wc, `window.__alerts.length = 0; return true;`);

  // ── 4. Handoff Servis → part terpakai + gudang OUTBOUND + Invoice SERVICE ──
  await ev(wc, `window.location.hash = '#/service'; return true;`);
  ok('4.1 halaman Servis memuat', await waitFor(wc, `/WO-HAND-001/.test(document.body.innerText)`, 'daftar WO', 30000));

  // Kartu WO punya tombol "Selesai (catat part & biaya)" yang membuka modal.
  const clicked = await ev(wc, `
    const b = document.querySelector('button[title^="Selesai"]');
    if (b) b.click();
    return !!b;
  `);
  ok('4.2 tombol selesai pada kartu WO tersedia', clicked === true);
  ok('4.3 modal penyelesaian servis terbuka',
    await waitFor(wc, `/Selesaikan Servis WO-HAND-001/.test(document.body.innerText)`, 'modal servis'));
  ok('4.4 perpindahan status tidak lagi langsung selesai (modal dulu)',
    await waitFor(wc, `/Suku Cadang Terpakai/.test(document.body.innerText)`, 'form part'));

  await ev(wc, `const b = byText(/Tambah Part/); if (b) b.click(); return !!b;`);
  ok('4.4a baris pemakaian part bertambah',
    await waitFor(wc, `!!document.querySelector('.modal select')`, 'dropdown part'));

  const filled = await ev(wc, `
    const sel = document.querySelector('.modal select');
    setSelect(sel, 'H-SP1');
    const qty = document.querySelector('.modal input[type=number]');
    setVal(qty, '4');
    return { sel: sel.value, qty: qty.value };`);
  ok('4.4b part dan jumlah terpilih terbaca di form', filled.sel === 'H-SP1' && filled.qty === '4', filled);
  await ev(wc, `
    const cost = [...document.querySelectorAll('.modal input[type=number]')].pop();
    setVal(cost, '2400000');
    const b = byText(/Tandai Selesai/); if (b) b.click();
    return { cost: cost.value, clicked: !!b };`);

  const afterService = await waitForStore(wc, `
    const w = (s.services || []).find(x => x.id === 'H-WO1');
    if (!w || w.status !== 'COMPLETED') return false;
    return {
      wo: w,
      part: (s.spareParts || []).find(x => x.id === 'H-SP1'),
      unit: (s.units || []).find(x => x.id === 'H-U1'),
      out: (s.warehouse || []).filter(x => x.referenceDoc === 'WO-HAND-001'),
      inv: (s.invoices || []).filter(i => String(i.invoiceNo || '').includes('WO-HAND-001')),
      alerts: window.__alerts.slice(),
    };
  `, 'servis selesai tersimpan');

  ok('4.5 WO menjadi COMPLETED beserta tanggal selesai',
    afterService && afterService.wo.status === 'COMPLETED' && !!afterService.wo.completedDate,
    afterService && afterService.alerts);
  ok('4.6 stok part berkurang 4 (16 → 12)', afterService && afterService.part && afterService.part.stock === 12, afterService && afterService.part);
  ok('4.7 mutasi gudang OUTBOUND tercatat per part',
    afterService && afterService.out.length === 1 && afterService.out[0].qty === 4, afterService && afterService.out);
  ok('4.8 unit kembali AVAILABLE setelah servis',
    afterService && afterService.unit && afterService.unit.status === 'AVAILABLE', afterService && afterService.unit);
  ok('4.9 Invoice SERVICE terbit dengan biaya aktual',
    afterService && afterService.inv.length === 1 && afterService.inv[0].totalAmount === 2_400_000 && afterService.inv[0].type === 'SERVICE',
    afterService && afterService.inv);
  ok('4.10 tidak ada alert validasi yang tertahan',
    afterService && afterService.alerts.length === 0, afterService && afterService.alerts);

  // ── 5. Handoff Invoice → Kas ──
  await ev(wc, `window.location.hash = '#/invoices'; return true;`);
  ok('5.1 halaman Invoice memuat', await waitFor(wc, `/INV\\/SERVICE\\/WO-HAND-001|WO-HAND-001/.test(document.body.innerText)`, 'invoice servis', 30000));
  await ev(wc, `
    const row = [...document.querySelectorAll('tbody tr')].find(tr => /WO-HAND-001/.test(tr.innerText) && /Bayar/.test(tr.innerText));
    const b = row ? [...row.querySelectorAll('button')].find(x => /^Bayar$/.test((x.innerText||'').trim())) : null;
    if (b) b.click();
    return !!b;`);
  ok('5.2 modal pencatatan pembayaran terbuka',
    await waitFor(wc, `/Catat Penerimaan Pembayaran/.test(document.body.innerText)`, 'modal bayar'));

  const rekening = await ev(wc, `
    const sel = document.querySelector('.modal select');
    return sel ? [...sel.options].map(o => o.value) : [];`);
  ok('5.3 rekening diambil dari master Bank (bukan hardcode)',
    rekening.includes('BCA Uji - 999888777'), rekening);

  await ev(wc, `
    const amount = document.querySelector('.modal input[type=number]');
    setVal(amount, '900000');
    const b = byText(/Simpan Pembayaran/); if (b) b.click();
    return { amount: amount.value, clicked: !!b };`);

  const afterPay = await waitForStore(wc, `
    const inv = (s.invoices || []).find(i => String(i.invoiceNo || '').includes('WO-HAND-001'));
    const k = (s.kas || []).filter(x => String(x.referensi || '').includes('WO-HAND-001'));
    if (!inv || k.length !== 1) return false;
    return { inv, k };
  `, 'pembayaran invoice masuk kas');

  ok('5.4 invoice berubah status setelah pembayaran sebagian',
    afterPay && afterPay.inv.paidAmount === 900_000 && afterPay.inv.status === 'PARTIAL', afterPay && afterPay.inv);
  ok('5.5 entri kas masuk memakai kategori SERVICE yang dikenali',
    afterPay && afterPay.k[0].kategori === 'SERVICE' && afterPay.k[0].tipe === 'MASUK' && afterPay.k[0].jumlah === 900_000,
    afterPay && afterPay.k);
  ok('5.6 rekening pembayaran tersimpan di entri kas',
    afterPay && afterPay.k[0].rekening === 'BCA Uji - 999888777', afterPay && afterPay.k[0]);

  // ── 6. Halaman turunan tidak menampilkan angka palsu/rusak ──
  await ev(wc, `window.location.hash = '#/reports'; return true;`);
  ok('6.1 halaman Laporan memuat', await waitFor(wc, `/Laporan & Analitik/.test(document.body.innerText)`, 'laporan', 30000));
  const reportsText = await bodyText(wc);
  ok('6.2 tabel pendapatan menampilkan baris bulanan', /Okt 26/.test(reportsText), reportsText.slice(0, 120));
  ok('6.3 tidak ada NaN di halaman Laporan', !/NaN/.test(reportsText), reportsText.match(/.{0,40}NaN.{0,40}/) || null);

  // Kartu pendapatan kini GROUP BY di SQLite, bukan reduce atas seluruh isi
  // invoices di renderer. Yang dijaga: angka pada kartu adalah angka yang
  // dikirim database untuk penyaringan yang sama — kalau `where` atau kolom
  // kelompoknya rusak, kartu tetap terisi tapi isinya salah.
  // Judul kartu ditulis dengan CSS text-transform: uppercase, jadi innerText-nya
  // huruf besar semua; label dibandingkan dalam bentuk itu.
  let kpiDiag = null;
  let mulaiKpi = Date.now();
  while (Date.now() - mulaiKpi < 25000) {
    kpiDiag = await ev(wc, `
      const norm = t => String(t || '').replace(/\\s+/g, ' ');
      const U = t => String(t).toUpperCase();
      const fmt = n => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
      const halaman = norm(document.body.innerText);
      const grup = await window.electronAPI.dbGroup({ collection: 'invoices', by: ['type'], sum: 'totalAmount' });
      const per = k => (grup.groups || []).filter(g => g.key === k).reduce((a, g) => a + g.sum, 0);
      const harapan = { rental: per('RENTAL'), penjualan: per('PENJUALAN'), service: per('SERVICE') };
      const hilang = [];
      for (const [label, nilai] of [['Total Pendapatan Rental', harapan.rental], ['Total Penjualan Unit', harapan.penjualan], ['Pendapatan Jasa Service', harapan.service]]) {
        if (halaman.indexOf(U(label) + ' ' + fmt(nilai)) < 0) hilang.push(label);
      }
      return { cocok: hilang.length === 0, hilang: hilang, harapan: harapan };
    `);
    if (kpiDiag && kpiDiag.cocok) break;
    await wait(300);
  }
  ok('6.3b kartu pendapatan Laporan sama dengan GROUP BY type di SQLite',
    kpiDiag && kpiDiag.cocok === true, kpiDiag);

  await ev(wc, `const b = byText(/Laporan Piutang/); if (b) b.click(); return !!b;`);
  ok('6.3c tab piutang terbuka', await waitFor(wc, `/Piutang Beredar/i.test(document.body.innerText)`, 'tab piutang'));

  let piutangDiag = null;
  let mulaiPiutang = Date.now();
  while (Date.now() - mulaiPiutang < 25000) {
    piutangDiag = await ev(wc, `
      const norm = t => String(t || '').replace(/\\s+/g, ' ');
      const U = t => String(t).toUpperCase();
      const fmt = n => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
      const belum = { status: { in: ['UNPAID', 'PARTIAL'] } };
      const halaman = norm(document.body.innerText);
      const q = await window.electronAPI.dbQuery({ collection: 'invoices', where: belum, limit: 1 });
      const tagihan = await window.electronAPI.dbSum('invoices', 'totalAmount', belum);
      const terbayar = await window.electronAPI.dbSum('invoices', 'paidAmount', belum);
      const rows = document.querySelectorAll('tbody tr').length;
      const harapan = U('Total Piutang Beredar') + ' ' + fmt(tagihan - terbayar) + ' ' + q.total + ' Invoice Belum Lunas';
      return {
        cocok: q.total > 0 && halaman.indexOf(harapan) >= 0 && rows === Math.min(q.total, 25),
        harapan: harapan, total: q.total, rows: rows, pager: norm((document.querySelector('#pager-info') || {}).innerText),
      };
    `);
    if (piutangDiag && piutangDiag.cocok) break;
    await wait(300);
  }
  ok('6.3d kartu piutang = selisih dua SUM atas baris yang sama, tabelnya hanya satu halaman',
    piutangDiag && piutangDiag.cocok === true, piutangDiag);

  await ev(wc, `const b = byText(/Laporan Kinerja Unit/); if (b) b.click(); return !!b;`);
  ok('6.3e tab kinerja unit terbuka', await waitFor(wc, `/Jam Digunakan/i.test(document.body.innerText)`, 'tab unit'));
  const unitDiag = await ev(wc, `
    const q = await window.electronAPI.dbQuery({ collection: 'units', limit: 1 });
    const rows = document.querySelectorAll('tbody tr').length;
    const info = String((document.querySelector('#pager-info') || {}).innerText).replace(/\\s+/g, ' ');
    return { cocok: info.indexOf('dari ' + q.total + ' record') >= 0 && rows === Math.min(q.total, 25), total: q.total, rows: rows, info: info };
  `);
  ok('6.3f daftar unit Laporan dibatasi satu halaman dan totalnya datang dari COUNT database',
    unitDiag && unitDiag.cocok === true, unitDiag);

  await ev(wc, `window.location.hash = '#/'; return true;`);
  ok('6.4 Dasbor memuat ulang', await waitFor(wc, `/Dasbor|Armada|Kontrol/i.test(document.body.innerText)`, 'dasbor', 30000));
  const dashText = await bodyText(wc);
  ok('6.5 tidak ada NaN di Dasbor', !/NaN/.test(dashText), dashText.match(/.{0,40}NaN.{0,40}/) || null);

  // Kartu profil dihitung SQLite, bukan dengan menelusuri store di renderer.
  // Angkanya harus SAMA dengan hitungan penuh atas isi database (cara lama),
  // jadi perbandingan ini menjaga seluruh perpindahan agregat Dasbor.
  let dealerCocok = null;
  const mulaiDasbor = Date.now();
  while (Date.now() - mulaiDasbor < 25000) {
    dealerCocok = await ev(wc, `
      const s = await readStore();
      const uu = s.units || [], so = s.sales || [];
      const tersedia = uu.filter(x => x.status === 'AVAILABLE').length;
      const total = uu.length;
      const selesai = so.filter(x => x.status === 'COMPLETED').length;
      const aktif = so.filter(x => x.status !== 'COMPLETED' && x.status !== 'CANCELLED').length;
      const t = document.body.innerText.replace(/\\s+/g, ' ');
      const pola = [
        'Stok Unit Tersedia ' + tersedia + ' Unit Total: ' + total + ' Unit',
        'Penjualan Selesai ' + selesai + ' Unit',
        'SPK Aktif ' + aktif + ' SPK'
      ];
      const hilang = pola.filter(p => t.indexOf(p) < 0);
      return { cocok: hilang.length === 0, hilang: hilang, tersedia: tersedia, total: total, selesai: selesai, aktif: aktif };
    `);
    if (dealerCocok && dealerCocok.cocok) break;
    await wait(300);
  }
  ok('6.5b angka kartu DEALER sama dengan hitungan penuh isi database',
    dealerCocok && dealerCocok.cocok === true, dealerCocok);

  // Penyaringan agregat yang rusak (where diabaikan) membuat Alert Center muncul
  // berisi peringatan palsu; tanpa masalah di database bagiannya memang tidak ada.
  const alertDiag = await ev(wc, `
    const s = await readStore();
    const uu = s.units || [], sp = s.spareParts || [], rr = s.rentals || [];
    const brk = uu.filter(x => x.status === 'BREAKDOWN').length;
    const due = uu.filter(x => { const hm = Number(x.hourMeter) || 0; const rem = 500 - (hm % 500); return rem <= 50 && rem > 0; }).length;
    const low = sp.filter(x => x.stock <= x.minStock).length;
    const exp = rr.filter(x => { if (!x.endDate) return false; const d = Math.ceil((new Date(x.endDate).getTime() - Date.now()) / 86400000); return d <= 7 && d > 0; }).length;
    return { ada: /ALERT CENTER/.test(document.body.innerText), harapan: brk + due + low + exp, brk: brk, due: due, low: low, exp: exp };
  `);
  ok('6.5c Alert Center hanya muncul bila database memang punya masalah',
    alertDiag && (alertDiag.harapan > 0) === alertDiag.ada, alertDiag);

  await ev(wc, `window.location.hash = '#/finance'; return true;`);
  // Tunggu judul halaman, bukan sekadar kata "Kas" yang sudah ada di menu samping:
  // halaman dimuat sebagai chunk terpisah, teksnya baru muncul setelah chunk tiba.
  ok('6.6 halaman Kas memuat', await waitFor(wc, `/Kas & Bank/.test(document.body.innerText)`, 'kas', 30000));
  // Chunk-nya tiba sebelum tabel terisi; tanpa jeda ini baris dibacanya terlalu
  // awal dan arus kas terlihat kosong walau database berisi.
  await waitFor(wc, `document.querySelectorAll('tbody tr').length > 0`, 'tabel kas terisi', 30000);
  const financeText = await bodyText(wc);
  const financeDiag = await ev(wc, `
    const rows = [...document.querySelectorAll('tbody tr')].map(r => r.innerText.replace(/\\s+/g, ' ').slice(0, 120));
    return { stored: ((await readStore()).kas || []).length, rows, tabel: rows.length, cocok: /WO-HAND-001/.test(document.querySelector('tbody') ? document.querySelector('tbody').innerText : '') };
  `);
  ok('6.7 pembayaran invoice terlihat di arus kas',
    financeDiag && financeDiag.cocok === true, { stored: financeDiag && financeDiag.stored, rows: financeDiag && financeDiag.rows });

  await ev(wc, `window.location.hash = '#/warehouse'; return true;`);
  ok('6.8 halaman Gudang memuat', await waitFor(wc, `/GR-|GI-|PO-HAND-001|WO-HAND-001/.test(document.body.innerText)`, 'mutasi gudang', 30000));

  // ── 6.8b Menara Pengawas: kartu armada sebagai COUNT, bukan loop atas array ──
  await ev(wc, `window.location.hash = '#/control-tower'; return true;`);
  ok('6.8b halaman Control Tower memuat', await waitFor(wc, `/FLEET OVERVIEW/.test(document.body.innerText)`, 'control tower', 30000));
  let menaraDiag = null;
  let mulaiMenara = Date.now();
  while (Date.now() - mulaiMenara < 25000) {
    menaraDiag = await ev(wc, `
      const norm = t => String(t || '').replace(/\\s+/g, ' ');
      const jumlah = async where => (await window.electronAPI.dbQuery({ collection: 'units', where: where, limit: 1 })).total;
      const harapan = {
        fleet: await jumlah(undefined),
        operating: await jumlah({ status: { in: ['ON_PROJECT', 'RENTED'] } }),
        idle: await jumlah({ status: 'AVAILABLE' }),
        maintenance: await jumlah({ status: 'MAINTENANCE' }),
        breakdown: await jumlah({ status: 'BREAKDOWN' }),
      };
      const pola = harapan.fleet + ' FLEET ' + harapan.operating + ' OPERATING ' + harapan.idle + ' IDLE '
        + harapan.maintenance + ' MAINTENANCE ' + harapan.breakdown + ' BREAKDOWN';
      const teks = norm(document.body.innerText);
      const mulai = teks.indexOf('FLEET OVERVIEW');
      return { cocok: teks.indexOf(pola) >= 0, pola: pola, teks: mulai < 0 ? teks.slice(0, 200) : teks.slice(mulai, mulai + 220) };
    `);
    if (menaraDiag && menaraDiag.cocok) break;
    await wait(300);
  }
  ok('6.8c lima kartu fleet adalah lima COUNT atas collection units yang sama',
    menaraDiag && menaraDiag.cocok === true, menaraDiag);

  // ── 6.8d Equipment Passport: unit dan riwayatnya dicari lewat query, bukan array store ──
  // Sejak boot tidak lagi memuat seluruh collection, '#/equipment-passport/<id>'
  // hanya bisa dibuka bila lapisan query mengenal kunci id. Bila kunci itu
  // dilewati diam-diam, halaman ini mengembalikan SEMUA unit dan menampilkan
  // unit pertama — terlihat benar, padahal salah unit.
  await ev(wc, `window.location.hash = '#/equipment-passport/H-U1'; return true;`);
  ok('6.8d passport terbuka lewat tautan id', await waitFor(wc, `/Digital Equipment Passport/.test(document.body.innerText)`, 'passport', 30000));
  let pasporDiag = null;
  let mulaiPaspor = Date.now();
  while (Date.now() - mulaiPaspor < 25000) {
    pasporDiag = await ev(wc, `
      const norm = t => String(t || '').replace(/\\s+/g, ' ');
      const jumlah = async (coll, where) => (await window.electronAPI.dbQuery({ collection: coll, where: where, limit: 1 })).total;
      const unit = (await window.electronAPI.dbQuery({ collection: 'units', where: { id: 'H-U1' }, limit: 1 })).rows[0] || {};
      const bySerial = { serialNumber: unit.serialNumber };
      const harapan = {
        service: await jumlah('services', bySerial),
        rental: await jumlah('rentals', bySerial),
        sales: await jumlah('sales', bySerial),
        serial: unit.serialNumber,
      };
      const teks = norm(document.body.innerText);
      const hilang = [];
      if (teks.indexOf('Total Service ' + harapan.service + ' kali') < 0) hilang.push('service');
      if (teks.indexOf('Total Rental ' + harapan.rental + ' kali') < 0) hilang.push('rental');
      if (teks.indexOf('Total Sales ' + harapan.sales + ' kali') < 0) hilang.push('sales');
      if (teks.indexOf('Asset ID: ' + harapan.serial) < 0) hilang.push('serial');
      return { cocok: hilang.length === 0 && harapan.service > 0, hilang: hilang, harapan: harapan, teks: teks.slice(0, 400) };
    `);
    if (pasporDiag && pasporDiag.cocok) break;
    await wait(300);
  }
  ok('6.8e kartu riwayat passport = COUNT per nomor sasis dari database',
    pasporDiag && pasporDiag.cocok === true, pasporDiag);

  // Tab riwayat dipakai untuk membuktikan daftar panjang tidak dimuat seluruhnya.
  await ev(wc, `const t = [...document.querySelectorAll('button')].find(x => /Maintenance/.test(x.innerText)); if (t) t.click(); return !!t;`);
  ok('6.8f tab maintenance passport menampilkan WO unit tersebut',
    await waitFor(wc, `/WO-HAND-001/.test(document.body.innerText)`, 'riwayat maintenance'));

  await ev(wc, `window.location.hash = '#/warehouse'; return true;`);
  // Tunggu kueri halaman benar-benar selesai: #pager-info sudah ada sejak debounce
  // 200ms berjalan, dan membaca saat masih 'memuat' membuat bagian 7 salah simpul.
  ok('6.8g kembali ke halaman Gudang untuk uji tulis per baris',
    await waitFor(wc, `!!document.querySelector('#pager-info')
      && !/memuat/i.test(document.querySelector('#pager-info').innerText)`, 'kembali ke gudang'));

  // ── 7. Halaman Gudang berpaginasi: baca lewat SQLite, tulis per baris ──
  const pagerAwal = await ev(wc, `
    return {
      info: document.querySelector('#pager-info') ? document.querySelector('#pager-info').innerText : '',
      pos: document.querySelector('#pager-position') ? document.querySelector('#pager-position').innerText : '',
      rows: document.querySelectorAll('tbody tr').length,
      total: ((await readStore()).warehouse || []).length,
    };`);
  ok('7.1 penanda halaman melaporkan jumlah record yang sebenarnya dari database',
    pagerAwal.info.includes('dari ' + pagerAwal.total + ' record'), pagerAwal);

  // Jejak jalur tulis dicatat sebelum dan sesudah satu aksi UI. Ini penjaga
  // tugas #41: satu perubahan harus lewat kanal patch dan HANYA mengirim baris
  // yang berubah. Jalur collection penuh (db-save) di halaman berpaginasi adalah
  // pintu masuk kehilangan data — array yang dipegang halaman belum tentu
  // seluruh isi tabel.
  const jejakSebelumTambah = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);

  await ev(wc, `const b = byText(/Catat Mutasi Stok/); if (b) b.click(); return !!b;`);
  ok('7.2 form pencatatan mutasi terbuka',
    await waitFor(wc, `/Catat Mutasi Masuk \\/ Keluar Gudang/.test(document.body.innerText)`, 'form mutasi'));

  const diisi = await ev(wc, `
    const teks = [...document.querySelectorAll('.modal input[type=text]')];
    const desc = teks.find(i => /Contoh:/.test(i.placeholder || ''));
    const ref = teks.find(i => /PO-2026/.test(i.placeholder || ''));
    if (desc) setVal(desc, 'Excavator SANY SY215C Uji Page');
    if (ref) setVal(ref, 'REF-PAGE-77');
    const b = byText(/Simpan Mutasi/); if (b) b.click();
    return { desc: desc && desc.value, ref: ref && ref.value, clicked: !!b };`);
  ok('7.3 form terkirim', diisi && diisi.clicked === true && diisi.ref === 'REF-PAGE-77', diisi);

  // saveNow(): baris harus sudah ada di FILE saat halaman mengambil datanya
  // kembali — tanpa itu halaman berpaginasi justru tidak menampilkan hasil edit.
  const diSarana = await waitFor(wc,
    `/REF-PAGE-77/.test((document.querySelector('#warehouse-table tbody') || {}).innerText || '')`,
    'mutasi baru tampil di halaman pertama', 20000);
  ok('7.4 mutasi hasil UI langsung terlihat di halaman pertama (urut terbaru)', diSarana);

  const diFile = await waitForStore(wc, `
    const w = (s.warehouse || []).filter(x => x.referenceDoc === 'REF-PAGE-77');
    return w.length === 1 ? w[0] : false;
  `, 'mutasi baru masuk ke SQLite tanpa menunggu debounce');
  ok('7.5 mutasi baru sudah tertulis ke file SQLite (jalur patch per baris)',
    !!diFile && diFile.itemDescription === 'Excavator SANY SY215C Uji Page' && diFile.type === 'INBOUND', diFile);

  const jumlahSetelahTambah = await ev(wc, `return ((await readStore()).warehouse || []).length;`);
  const W_TBODIES = `document.querySelectorAll('#warehouse-table tbody tr')`;
  await ev(wc, `
    const input = document.querySelector('#warehouse-search');
    if (input) setVal(input, 'REF-PAGE-77');
    return !!input;`);
  const hasilCari = await waitFor(wc,
    `${W_TBODIES}.length === 1 && /REF-PAGE-77/.test(document.querySelector('#warehouse-table').innerText)`,
    'pencarian sisi SQL', 20000);
  const pagerCari = await ev(wc, `
    return { info: (document.querySelector('#pager-info') || {}).innerText || '', rows: ${W_TBODIES}.length };`);
  ok('7.6 pencarian di sisi SQL menemukan mutasi lewat nomor dokumen referensi',
    hasilCari && pagerCari.rows === 1, { hasilCari, pagerCari });
  ok('7.7 jumlah record pada penanda halaman ikut berubah untuk hasil yang disaring',
    /dari 1 record/.test(pagerCari.info), pagerCari);

  await ev(wc, `
    const input = document.querySelector('#warehouse-search');
    if (input) setVal(input, 'TIDAKADA-X9');
    return !!input;`);
  const kosong = await waitFor(wc,
    `/Tidak ada record|Belum ada rekaman mutasi/.test(document.querySelector('#warehouse-table').innerText)`,
    'hasil pencarian kosong', 20000);
  ok('7.8 pencarian yang tidak cocok menampilkan keadaan kosong, bukan data lama', kosong);

  await ev(wc, `
    const input = document.querySelector('#warehouse-search');
    if (input) setVal(input, '');
    return !!input;`);
  const semuaKembali = await waitFor(wc,
    `((document.querySelector('#warehouse-table') || {}).innerText || '').includes('REF-PAGE-77')`,
    'kembali ke semua mutasi', 20000);
  const diagnostikKosong = await ev(wc, `
    const s = await readStore();
    return {
      nilaiInput: (document.querySelector('#warehouse-search') || {}).value,
      diDatabase: (s.warehouse || []).length,
      tipe: (s.warehouse || []).map(w => w.type).join(','),
      baris: ${W_TBODIES}.length,
      info: (document.querySelector('#pager-info') || {}).innerText || '',
      tabel: ((document.querySelector('#warehouse-table') || {}).innerText || '').slice(0, 200),
    };`);
  ok('7.9 pencarian yang dikosongkan menampilkan kembali semua mutasi',
    semuaKembali && diagnostikKosong.baris === diagnostikKosong.diDatabase,
    { semuaKembali, diagnostikKosong });

  const chip = await ev(wc, `
    const b = byText(/^Barang Keluar$/);
    if (b) b.click();
    return b ? b.innerText.trim() : null;`);
  // Jangan dibaca selagi query masih berjalan: halaman menampilkan hasil
  // sebelumnya sampai hasil baru tiba, dan itu akan terlihat seperti filter
  // yang tidak bekerja.
  const difilter = await waitFor(wc,
    `!/Barang Masuk/.test((document.querySelector('#warehouse-table') || {}).innerText || '')`
    + ` && !/memuat/.test((document.querySelector('#pager-info') || {}).innerText || '')`,
    'hanya mutasi keluar yang tersisa', 20000);
  const jumlahKeluar = await ev(wc, `
    return {
      sql: ((await readStore()).warehouse || []).filter(w => w.type === 'OUTBOUND').length,
      rows: ${W_TBODIES}.length,
      info: (document.querySelector('#pager-info') || {}).innerText || '',
      tabel: (document.querySelector('#warehouse-table') || {}).innerText || '',
    };`);
  ok('7.10 tombol tipe menyaring di sisi SQL dan hitungannya memakai hasil yang disaring',
    chip === 'Barang Keluar' && difilter && jumlahKeluar.rows === jumlahKeluar.sql
      && jumlahKeluar.info.includes('dari ' + jumlahKeluar.sql + ' record'), jumlahKeluar);

  // Tulis lewat halaman tidak boleh menghapus baris di luar yang berubah:
  // patch hanya mengirim record yang identity-nya berbeda.
  await ev(wc, `const b = byText(/^Semua$/); if (b) b.click(); return !!b;`);
  const utuh = await waitForStore(wc, `
    return (s.warehouse || []).length === ${jumlahSetelahTambah} ? (s.warehouse || []).length : false;
  `, 'seluruh mutasi lain masih ada');
  ok('7.11 simpanan sebagian dari halaman tidak menghapus baris lain',
    utuh === jumlahSetelahTambah, { utuh, jumlahSetelahTambah });

  // ── 7.12 jalur tulis: satu aksi UI = satu baris, bukan satu collection ──
  const jejakSesudahTambah = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);
  const tulisTambah = {
    patchCalls: jejakSesudahTambah.patchCalls - jejakSebelumTambah.patchCalls,
    upsertRows: jejakSesudahTambah.patchUpsertRows - jejakSebelumTambah.patchUpsertRows,
    fullCalls: jejakSesudahTambah.fullCalls - jejakSebelumTambah.fullCalls,
    fullRows: jejakSesudahTambah.fullRows - jejakSebelumTambah.fullRows,
  };
  ok('7.12 menambah satu mutasi mengirim satu baris lewat patch, bukan collection penuh',
    tulisTambah.upsertRows === 1 && tulisTambah.fullCalls === 0 && tulisTambah.patchCalls >= 1,
    { tulisTambah, mutasiDiFile: jumlahSetelahTambah });

  // Chip 'Semua' diklik pada 7.11, tapi tabel masih memegang hasil filter
  // OUTBOUND sampai query berikutnya tiba — baris uji harus benar-benar
  // tampil sebelum tombolnya dicari.
  const tampakLagi = await waitFor(wc,
    `[...document.querySelectorAll('#warehouse-table tbody tr')].some(r => /REF-PAGE-77/.test(r.innerText))`,
    'mutasi uji tampil kembali setelah filter dibuka', 20000);
  const jejakSebelumHapus = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);
  const hapusDiklik = await ev(wc, `
    const tr = [...document.querySelectorAll('#warehouse-table tbody tr')].find(r => /REF-PAGE-77/.test(r.innerText));
    const btn = tr && [...tr.querySelectorAll('button')].find(b => /Hapus/.test((b.innerText || '').trim()));
    if (btn) btn.click();
    return !!btn;`);
  ok('7.13 baris mutasi hasil UI punya tombol hapus yang dapat dipakai',
    tampakLagi && hapusDiklik === true, { tampakLagi, hapusDiklik });

  const terhapus = await waitForStore(wc, `
    return (s.warehouse || []).every(x => x.referenceDoc !== 'REF-PAGE-77') ? true : false;
  `, 'mutasi terhapus keluar dari file');
  const sisaSetelahHapus = await ev(wc, `return ((await readStore()).warehouse || []).length;`);
  const jejakSesudahHapus = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);
  const tulisHapus = {
    removeIds: jejakSesudahHapus.patchRemoveIds - jejakSebelumHapus.patchRemoveIds,
    upsertRows: jejakSesudahHapus.patchUpsertRows - jejakSebelumHapus.patchUpsertRows,
    fullCalls: jejakSesudahHapus.fullCalls - jejakSebelumHapus.fullCalls,
  };
  ok('7.14 menghapus satu baris mengirim hanya id-nya dan meninggalkan baris lain utuh',
    terhapus === true && tulisHapus.removeIds === 1 && tulisHapus.upsertRows === 0
      && tulisHapus.fullCalls === 0 && sisaSetelahHapus === jumlahSetelahTambah - 1,
    { terhapus, tulisHapus, sisaSetelahHapus, jumlahSetelahTambah });

  // ── 8. Halaman besar lain ikut dibaca per halaman: Unit, Suku Cadang, Invoice ──
  await ev(wc, `window.location.hash = '#/units'; return true;`);
  await waitFor(wc, `!!document.querySelector('#units-search')`, 'halaman Unit terbuka', 30000);
  // Catatan: `/record/` SAJA bukan tanda selesai. Selama debounce 200 ms dan kueri
  // pertama berjalan, total masih 0 sehingga Pager berbunyi "Tidak ada record ·
  // memuat..." — kalimat yang juga mengandung "record". Menunggu itu membuat assertion
  // membaca keadaan loading (pernah jatuh di rantai-302f: sql=2, kartu=0).
  await waitFor(wc, `!!document.querySelector('#pager-info')
    && !/memuat/.test((document.querySelector('#pager-info') || {}).innerText || '')
    && /record/.test((document.querySelector('#pager-info') || {}).innerText || '')`,
    'penanda halaman Unit terisi', 30000);
  const unitAwal = await ev(wc, `
    const s = await readStore();
    return {
      sql: (s.units || []).length,
      info: (document.querySelector('#pager-info') || {}).innerText || '',
      kartu: document.querySelectorAll('#units-grid .card').length,
    };`);
  ok('8.1 halaman Unit hanya menampilkan satu halaman kartu tapi melaporkan jumlah sebenarnya',
    unitAwal.info.includes('dari ' + unitAwal.sql + ' record') && unitAwal.kartu > 0 && unitAwal.kartu <= 12,
    unitAwal);

  // Pencarian yang diminta pengguna: "SANY SY215C" harus ditemukan, sekarang di
  // sisi SQLite. Harapan dihitung dengan aturan normalisasi yang sama.
  const unitCari = await ev(wc, `
    const s = await readStore();
    const norm = v => String(v === null || v === undefined ? '' : v).toLowerCase().replace(/[^\\p{L}\\p{N}]/gu, '');
    const tokens = ['sany', 'sy215c'];
    const cocok = (s.units || []).filter(u => {
      const blob = [u.serialNumber, u.brand, u.model, u.category, u.location, u.status, u.notes, u.year]
        .map(norm).filter(Boolean).join(' ');
      return tokens.every(t => blob.includes(t));
    }).length;
    setVal(document.querySelector('#units-search'), 'SANY SY215C');
    return { cocok, total: (s.units || []).length };`);
  const unitHasil = await waitFor(wc,
    `/dari ${unitCari.cocok} record/.test((document.querySelector('#pager-info') || {}).innerText || '')`
    + ` && !/memuat/.test((document.querySelector('#pager-info') || {}).innerText || '')`,
    'pencarian unit sisi SQL', 30000);
  const unitTampil = await ev(wc, `
    return {
      kartu: document.querySelectorAll('#units-grid .card').length,
      teks: ((document.querySelector('#units-grid') || {}).innerText || '').slice(0, 120),
      info: (document.querySelector('#pager-info') || {}).innerText || '',
    };`);
  ok('8.2 pencarian merek + model menemukan unit lewat SQLite',
    unitHasil && unitCari.cocok > 0 && unitTampil.kartu > 0 && /SY215C/.test(unitTampil.teks),
    { unitCari, unitHasil, unitTampil });

  // Suku cadang: kategori, merek yang cocok, rak dan harga jual harus benar-benar
  // tersimpan (dulu field itu dibuang saat menyimpan dan ditampilkan palsu).
  await ev(wc, `window.location.hash = '#/spareparts'; return true;`);
  await waitFor(wc, `!!document.querySelector('#spareparts-search')`, 'halaman suku cadang terbuka', 30000);
  await ev(wc, `const b = byText(/Tambah Spare Part/); if (b) b.click(); return !!b;`);
  await waitFor(wc, `!!byText(/Simpan Spare Part/)`, 'form suku cadang terbuka', 20000);
  const partTerkirim = await ev(wc, `
    const byPlace = (re) => [...document.querySelectorAll('.modal input')].find(i => re.test(i.placeholder || ''));
    const input = byPlace(/6736-51-5142/);
    const nama = byPlace(/Fuel Filter Cartridge/);
    const rak = byPlace(/A1-02-04/);
    const select = document.querySelector('.modal select');
    if (input) setVal(input, 'PN-RAKUJI-9');
    if (nama) setVal(nama, 'Filter Uji Halaman');
    if (rak) setVal(rak, 'RAKUJI-A9');
    if (select) setSelect(select, 'FILTER');
    const b = byText(/Simpan Spare Part/); if (b) b.click();
    return { input: !!input && input.value, nama: !!nama, select: select && select.value, clicked: !!b };`);
  ok('8.3 form suku cadang terkirim lengkap',
    partTerkirim.input === 'PN-RAKUJI-9' && partTerkirim.select === 'FILTER' && partTerkirim.clicked === true,
    partTerkirim);

  const partDiFile = await waitForStore(wc, `
    const p = (s.spareParts || []).filter(x => x.sku === 'PN-RAKUJI-9');
    return p.length === 1 ? p[0] : false;
  `, 'suku cadang baru masuk SQLite');
  ok('8.4 kategori, merek dan rak tersimpan apa adanya (tidak dikarang)',
    !!partDiFile && partDiFile.category === 'FILTER' && partDiFile.rackLocation === 'RAKUJI-A9'
      && partDiFile.name === 'Filter Uji Halaman', partDiFile);

  const partTampil = await waitFor(wc,
    `/PN-RAKUJI-9/.test((document.querySelector('#spareparts-table') || {}).innerText || '')`,
    'baris baru terlihat di halaman pertama', 20000);
  ok('8.5 halaman suku cadang mengambil ulang halamannya dari file setelah menulis', partTampil);

  const chipPart = await ev(wc, `const b = byText(/^FILTER$/); if (b) b.click(); return b ? b.innerText.trim() : null;`);
  const partDisaring = await waitFor(wc,
    `!/memuat/.test((document.querySelector('#pager-info') || {}).innerText || '')`,
    'penyaringan kategori selesai', 20000);
  const jumlahPart = await ev(wc, `
    const s = await readStore();
    return {
      sql: (s.spareParts || []).filter(p => p.category === 'FILTER').length,
      rows: document.querySelectorAll('#spareparts-table tbody tr').length,
      info: (document.querySelector('#pager-info') || {}).innerText || '',
      chip: ${JSON.stringify(chipPart)},
    };`);
  ok('8.6 tombol kategori menyaring di sisi SQL dan hitungannya ikut menyesuaikan',
    chipPart === 'FILTER' && partDisaring && jumlahPart.rows === jumlahPart.sql
      && jumlahPart.info.includes('dari ' + jumlahPart.sql + ' record'),
    jumlahPart);

  await ev(wc, `window.location.hash = '#/invoices'; return true;`);
  await waitFor(wc, `!!document.querySelector('#invoice-search')`, 'halaman invoice terbuka', 30000);
  await waitFor(wc, `!!document.querySelector('#pager-info')
    && !/memuat/.test((document.querySelector('#pager-info') || {}).innerText || '')
    && /record/.test((document.querySelector('#pager-info') || {}).innerText || '')`,
    'penanda halaman invoice terisi', 30000);
  const jumlahInv = await ev(wc, `
    const s = await readStore();
    return {
      semua: (s.invoices || []).length,
      unpaid: (s.invoices || []).filter(i => i.status === 'UNPAID').length,
      info: (document.querySelector('#pager-info') || {}).innerText || '',
    };`);
  await ev(wc, `const b = byText(/^Belum Bayar$/); if (b) b.click(); return !!b;`);
  const invDisaring = await waitFor(wc,
    `!/memuat/.test((document.querySelector('#pager-info') || {}).innerText || '')`
    + ` && /dari \\d+ record|Tidak ada record/.test((document.querySelector('#pager-info') || {}).innerText || '')`,
    'penyaringan status selesai', 20000);
  const invAkhir = await ev(wc, `
    return { rows: document.querySelectorAll('#invoice-table tbody tr').length,
             info: (document.querySelector('#pager-info') || {}).innerText || '' };`);
  ok('8.7 halaman invoice membaca per halaman dan status menyaring di SQL',
    invDisaring && jumlahInv.unpaid <= jumlahInv.semua
      && (jumlahInv.unpaid === 0
        ? /Tidak ada/.test(invAkhir.info) || invAkhir.rows <= 1
        : invAkhir.rows === jumlahInv.unpaid && invAkhir.info.includes('dari ' + jumlahInv.unpaid + ' record')),
    { jumlahInv, invAkhir });

  // ── 9. #38: membuka menu tidak menyalin seluruh store ke renderer ──
  // Diukur sebagai DELTA. Harness sendiri memakai readStore() (muat penuh, memang
  // disengaja untuk membaca kondisi uji) di bagian 1-8, jadi angka absolut tidak
  // berarti. Antara dua pengukuran di bawah tidak ada satu pun readStore, sehingga
  // setiap pergeseran jejak baca murni perbuatan aplikasi.
  const jejakSebelum9 = await ev(wc, `
    const s = await window.electronAPI.dbStats();
    return { reads: s.reads, totalRows: s.totalRows };`);
  await ev(wc, `window.location.hash = '#/sales'; return true;`);
  const salesTerbuka = await waitFor(wc, `/Penjualan & SPK/.test(document.body.innerText)`,
    'halaman Penjualan terbuka', 30000);
  await ev(wc, `window.location.hash = '#/rental'; return true;`);
  const rentalTerbuka = await waitFor(wc, `/Manajemen Rental/.test(document.body.innerText)`,
    'halaman Rental terbuka', 30000);
  const jejakSesudah9 = await ev(wc, `return (await window.electronAPI.dbStats()).reads;`);
  const delta9 = {
    penuh: jejakSesudah9.fullCalls - jejakSebelum9.reads.fullCalls,
    sebagian: jejakSesudah9.subsetCalls - jejakSebelum9.reads.subsetCalls,
    baris: jejakSesudah9.rows - jejakSebelum9.reads.rows,
  };
  ok('9.1 dua menu yang menghidrasi collection-nya sendiri tidak sekali pun memuat seluruh store',
    salesTerbuka && rentalTerbuka && delta9.penuh === 0 && delta9.sebagian >= 2,
    { jejakSebelum9: jejakSebelum9.reads, jejakSesudah9, delta9 });
  // sales + deliveries + rentals = baris yang pindah; units, services, purchases,
  // spareParts, invoices, kas ditinggal — bukti bahwa biayanya mengikuti menu.
  ok('9.2 baris yang lewat IPC untuk dua menu itu hanya sebagian dari isi file',
    delta9.baris > 0 && delta9.baris < jejakSebelum9.totalRows,
    { barisPindah: delta9.baris, totalRows: jejakSebelum9.totalRows });

  // ── 9.3 #47: migrasi foto base64 tetap jalan walau halaman Unit tidak pernah
  // memuat array units (route-nya tidak punya kebutuhan hidrasi). Dulu efek ini
  // memindai `data` yang kosong sehingga foto base64 lama tidak pernah berpindah.
  const fotoUnit = await ev(wc, `
    const kanvas = document.createElement('canvas');
    kanvas.width = 64; kanvas.height = 48;
    const ctx = kanvas.getContext('2d');
    ctx.fillStyle = '#1e6f3c'; ctx.fillRect(0, 0, 64, 48);
    const dataUrl = kanvas.toDataURL('image/jpeg', 0.8);
    const ditulis = await window.electronAPI.dbPatch({
      units: { upsert: [{
        id: 'H-U4', serialNumber: 'HAND-PHOTO-4', brand: 'SANY', model: 'SY215C',
        status: 'AVAILABLE', hourMeter: 30, photo: dataUrl,
      }], removeIds: [] },
    });
    const kandidat = await window.electronAPI.dbQuery({ collection: 'units', where: { inlinePhoto: 1 }, limit: 5 });
    return {
      dataUrl: dataUrl.slice(0, 11),
      ditulis: !!ditulis && !ditulis.error,
      kandidat: (kandidat.rows || []).map(r => r.id).join(','),
    };`);
  ok('9.3 unit dengan foto base64 tercatat dan terbaca lewat kolom turunan inlinePhoto',
    fotoUnit.dataUrl === 'data:image/' && fotoUnit.ditulis === true && fotoUnit.kandidat.includes('H-U4'),
    fotoUnit);

  await ev(wc, `window.location.hash = '#/units'; return true;`);
  await waitFor(wc, `!!document.querySelector('#units-search')`, 'halaman Unit terbuka (lagi)', 30000);
  const fotoPindah = await waitForStore(wc, `
    const u = (s.units || []).find(x => x.id === 'H-U4') || {};
    return u.photoId && !u.photo ? u : false;
  `, 'base64 berpindah ke berkas foto', 30000);
  ok('9.4 membuka halaman Unit memindahkan base64 ke berkas tanpa memuat seluruh collection',
    !!fotoPindah && fotoPindah.photoId === 'unit-H-U4.jpg', fotoPindah);
  const inlineSisa = await ev(wc, `
    const r = await window.electronAPI.dbQuery({ collection: 'units', where: { inlinePhoto: 1 }, limit: 5 });
    return { sisa: (r.rows || []).map(x => x.id).join(','), total: r.total };`);
  ok('9.5 tidak ada lagi unit yang menyimpan fotonya sebagai base64 di dalam record',
    inlineSisa.total === 0 && inlineSisa.sisa === '', inlineSisa);

  // ── 9.6 #48: modal foto memakai baris yang diklik ──
  // Sejak #38 array units di memori kosong, jadi versi lama (mencari id di array
  // itu) menghasilkan modal tanpa target: preview jatuh ke placeholder dan
  // upload/hapus foto tidak melakukan apa pun tanpa pesan kesalahan.
  const kartuMuncul = await waitFor(wc,
    `[...document.querySelectorAll('#units-grid .card')].some(c => /HAND-SY-001/.test(c.innerText || ''))`,
    'kartu unit SANY muncul', 30000);
  const klikFoto = await ev(wc, `
    const kartu = [...document.querySelectorAll('#units-grid .card')]
      .find(c => /HAND-SY-001/.test(c.innerText || ''));
    const tombol = kartu && [...kartu.querySelectorAll('button')].find(b => /Kelola Foto/.test(b.title || ''));
    if (tombol) tombol.click();
    return { kartu: !!kartu, tombol: !!tombol };`);
  const modalFoto = await waitFor(wc, `/Kelola Foto Unit/.test(document.body.innerText)`,
    'modal foto terbuka', 20000);
  const isiFoto = await ev(wc, `
    const m = [...document.querySelectorAll('.modal')].find(x => /Kelola Foto Unit/.test(x.innerText || ''));
    const img = m ? m.querySelector('img') : null;
    return {
      teks: ((m || {}).innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
      src: img ? img.getAttribute('src') : null,
      kosong: /Belum ada foto/.test((m || {}).innerText || ''),
    };`);
  ok('9.6 modal foto terbuka dari kartu yang diklik dan menyebut unit yang benar',
    kartuMuncul && klikFoto.tombol === true && modalFoto
      && isiFoto.teks.includes('HAND-SY-001') && isiFoto.kosong === false,
    { klikFoto, isiFoto });
  ok('9.7 pratinjau memakai foto merek unit, bukan placeholder kosong',
    isiFoto.src === './units/sany.jpg', isiFoto);

  // ── 9.8 #48: duplikat nomor rangka dicek terhadap isi file ──
  const unitSebelumDup = await ev(wc, `
    window.__alerts = [];
    const r = await window.electronAPI.dbQuery({ collection: 'units', limit: 1 });
    return r.total;`);
  await ev(wc, `const b = byText(/Tambah Unit/); if (b) b.click(); return !!b;`);
  const formUnit = await waitFor(wc, `!!byText(/Simpan Unit/)`, 'form tambah unit terbuka', 20000);
  const nomorSerial = await ev(wc, `
    const input = [...document.querySelectorAll('.modal input')]
      .find(i => /SY215C-099/.test(i.placeholder || ''));
    if (input) setVal(input, 'hand-sy-001');
    const b = byText(/Simpan Unit/); if (b) b.click();
    return { isian: !!input ? input.value : null, klik: !!b };`);
  const tolakDup = await waitFor(wc,
    `/sudah terdaftar pada unit lain/.test((window.__alerts || []).join('|'))`,
    'peringatan serial ganda muncul', 20000);
  const unitSesudahDup = await ev(wc, `
    const r = await window.electronAPI.dbQuery({ collection: 'units', limit: 1 });
    return r.total;`);
  ok('9.8 nomor rangka yang sudah ada ditolak walau array units di memori kosong',
    formUnit && nomorSerial.isian === 'hand-sy-001' && tolakDup && unitSesudahDup === unitSebelumDup,
    { nomorSerial, tolakDup, unitSebelumDup, unitSesudahDup });
  await ev(wc, `
    const m = [...document.querySelectorAll('.modal')].find(x => /Tambah Unit|Edit Unit/.test(x.innerText || ''));
    const b = m && [...m.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '×');
    if (b) b.click();
    return !!b;`);

  // ── 9.9 #49 + #71: saran nomor bukti mutasi Gudang ──
  // Halaman Gudang tidak menghidrasi seluruh collection-nya, jadi versi lama yang
  // memakai data.length menyarankan nomor yang sudah ada di file. Kontraknya sekarang:
  // usulan melanjutkan nomor tertinggi di FILE dan tidak pernah dipakai.
  // Dibuktikan dengan menanami satu bukti bernomor besar (TRX-<tahun>-888) yang tidak
  // ada di array halaman — rumus lama (jumlah baris + 1) mustahil menghasilkan 889.
  const tahun9 = new Date().getFullYear();
  const tanam9 = 'TRX-' + tahun9 + '-888';
  const polaSrc9 = '^TRX-' + tahun9 + '-\\d{3,}$';
  const pola9 = new RegExp(polaSrc9);
  const hasilTanam9 = await ev(wc, `
    const sebelum = await window.electronAPI.dbQuery({ collection: 'warehouse', limit: 1 });
    await window.electronAPI.dbPatch({ warehouse: { upsert: [{
      id: 'H9TRX', trxNo: ${JSON.stringify(tanam9)}, type: 'Masuk',
      warehouseName: 'Gudang Uji', itemDescription: 'Uji nomor bukti',
      date: '2026-01-05', qty: 1,
    }], removeIds: [] } });
    const sesudah = await window.electronAPI.dbQuery({ collection: 'warehouse', limit: 1 });
    return { sebelum: sebelum.total, sesudah: sesudah.total };`);
  await ev(wc, `window.location.hash = '#/warehouse'; return true;`);
  await waitFor(wc, `!!document.querySelector('#warehouse-search')`, 'halaman Gudang terbuka (lagi)', 30000);
  const mutasiSql = await ev(wc, `
    const r = await window.electronAPI.dbQuery({ collection: 'warehouse', limit: 1 });
    return r.total;`);
  // Nomor yang sudah ada di file, dibaca sendiri tanpa menyalin algoritma halaman.
  const dasar9 = await ev(wc, `
    const r = await window.electronAPI.dbQuery({ collection: 'warehouse', limit: 500 });
    const angka = r.rows.map(x => /(\\d+)$/.exec(String(x.trxNo || '').trim())).filter(Boolean).map(m => Number(m[1]));
    return { tertinggi: angka.length ? Math.max(...angka) : 0, nomor: r.rows.map(x => String(x.trxNo || '')) };`);
  // Penanda halaman harus sudah selesai membaca file sebelum formulir dibuka: usulan
  // dihitung dari isi file pada saat tombol diklik.
  const gudangSiap = await waitFor(wc,
    `/dari ${mutasiSql} record/.test((document.querySelector('#pager-info') || {}).innerText || '')`,
    'halaman Gudang selesai membaca jumlahnya', 20000);
  const bukaMutasi = await ev(wc, `const b = byText(/Catat Mutasi Stok/); if (b) b.click(); return !!b;`);
  const trxSiap = await waitFor(wc,
    `(()=>{const v=(document.querySelector('.modal input')||{}).value||'';`
    + `return new RegExp(${JSON.stringify(polaSrc9)}).test(v)`
    + `&&!${JSON.stringify(dasar9.nomor)}.includes(v);})()`,
    'saran nomor bukti bebas tumbukan dan melewati nomor tertinggi di file', 20000);
  const trxNilai = await ev(wc, `return (document.querySelector('.modal input') || {}).value;`);
  const cocok9 = /(\d+)$/.exec(String(trxNilai));
  const urutan9 = cocok9 ? Number(cocok9[1]) : -1;
  const cek9 = await ev(wc, `
    const r = await window.electronAPI.dbQuery({ collection: 'warehouse', where: { trxNo: ${JSON.stringify(trxNilai)} }, limit: 1 });
    return r.total;`);
  ok('9.9 saran No. Bukti Mutasi berlanjut dari nomor tertinggi di file, bukan dari jumlah baris yang terlihat',
    hasilTanam9.sebelum + 1 === hasilTanam9.sesudah && mutasiSql === hasilTanam9.sesudah
    && gudangSiap && bukaMutasi && trxSiap
    && pola9.test(trxNilai) && urutan9 > 888 && cek9 === 0,
    { hasilTanam9, mutasiSql, tertinggi: dasar9.tinggi, nomorLama: dasar9.nomor, urutan9, trxNilai, sudahDipakai: cek9 });
  const cabut9 = await ev(wc, `
    await window.electronAPI.dbPatch({ warehouse: { upsert: [], removeIds: ['H9TRX'] } });
    const r = await window.electronAPI.dbQuery({ collection: 'warehouse', limit: 1 });
    return r.total;`);
  ok('9.9b bukti uji nomor dibersihkan dan jumlah mutasi kembali seperti semula',
    cabut9 === hasilTanam9.sebelum, { cabut9, semula: hasilTanam9.sebelum });

  // Bersihkan unit foto uji supaya bagian 9 tidak meninggalkan jejak.
  const bersihkan9 = await ev(wc, `
    const dihapus = await window.electronAPI.dbPatch({ units: { upsert: [], removeIds: ['H-U4'] } });
    const sisa = await window.electronAPI.dbQuery({ collection: 'units', limit: 1 });
    if (window.electronAPI.deletePhoto) {
      await window.electronAPI.deletePhoto('unit-H-U4.jpg');
      await window.electronAPI.deletePhoto('unit-H-U4.thumb.jpg');
    }
    return { deleted: dihapus && dihapus.units && dihapus.units.deleted, total: sisa.total };`);
  ok('9.10 unit uji foto dibersihkan dan jumlah unit kembali seperti sebelum bagian 9',
    bersihkan9.deleted === 1 && bersihkan9.total === unitSebelumDup - 1,
    { bersihkan9, unitSebelumDup });

  const sehat9 = await ev(wc, `return window.electronAPI.dbIntegrity();`);
  ok('9.11 database tetap utuh sesudah seluruh uji hidrasi dan penjaga tulis',
    sehat9.ok === true, sehat9.quickCheck);

  // ── 10. hapus di menu katalog: satu baris lewat patch, bukan collection penuh ──
  // Operator, Teknisi, Dokumen, Pengiriman, Breakdown dan Persetujuan dulu
  // menghapus dengan menyaring array di memorinya sendiri. Di layar hasilnya
  // identik, jadi tidak ada yang sadar bahwa yang dikirim ke file adalah seluruh
  // collection — dan pemeriksaan rujukan di removeRow tidak pernah dipanggil.
  // Enam menu ini diuji dengan cara yang sama seperti 7.14: dua baris uji masuk ke
  // file, satu ditekan lewat tombolnya, dan jejak tulisnya dibandingkan.
  const KATALOG = [
    { rute: 'operators', collection: 'operators',
      baris: (id, tanda) => ({
        id, operatorNumber: tanda, name: 'Operator Uji ' + tanda, phone: '0811000000',
        email: '', nik: '', status: 'ACTIVE', certifications: [], assignedUnit: '',
        assignedProject: '', totalHours: 3, startDate: '2026-01-05', licenseNumber: '',
        notes: '',
      }) },
    { rute: 'technicians', collection: 'technicians',
      baris: (id, tanda) => ({
        id, technicianNumber: tanda, name: 'Teknisi Uji ' + tanda, phone: '0811000000',
        email: '', status: 'ACTIVE', specializations: [], certifications: [],
        totalWorkOrders: 1, totalHours: 4, startDate: '2026-01-05', skills: [], notes: '',
      }) },
    { rute: 'documents', collection: 'documents',
      baris: (id, tanda) => ({
        id, jenisDokumen: 'Surat Uji Tipe', nomorDokumen: tanda, masaBerlaku: '2030-01-01',
        statusLegalitas: 'AKTIF', keterangan: '',
      }) },
    { rute: 'delivery', collection: 'deliveries',
      baris: (id, tanda) => ({
        id, doNumber: tanda, salesOrderRef: 'SO-UJI-10', customerName: 'PT Uji Serah',
        unitModel: 'SANY SY215C', serialNumber: 'RANGKA-UJI-10', deliveryDate: '2026-10-01',
        destination: 'Site Uji', driverName: 'Sopir Uji', truckPlate: 'B 1234 XY',
        status: 'MENUNGGU', notes: '',
      }) },
    { rute: 'breakdown', collection: 'breakdowns',
      baris: (id, tanda) => ({
        id, breakdownNumber: tanda, unitSerialNumber: 'RANGKA-UJI-10', unitModel: 'SANY SY215C',
        location: 'Site Uji', reportedBy: 'Pimpinan Uji', reportedAt: '2026-10-01T08:00:00.000Z',
        severity: 'MINOR', status: 'REPORTED', description: 'Laporan uji hapus',
      }) },
    { rute: 'approvals', collection: 'approvals',
      baris: (id, tanda) => ({
        id, requestNumber: tanda, type: 'PURCHASE_REQUEST', title: 'Pengajuan Uji',
        description: 'Pengajuan uji hapus', requestedBy: 'Sales Uji', requestedAt: '2026-10-01',
        amount: 1000, status: 'PENDING', approverLevel: 1, currentApprover: '', notes: '',
      }) },
  ];
  for (const m of KATALOG) {
    const kode = m.collection.slice(0, 2).toUpperCase();
    m.hapus = 'UJI10HAPUS' + kode;
    m.sisa = 'UJI10SISA' + kode;
  }
  const masuk = await ev(wc, `return await window.electronAPI.dbPatch(${JSON.stringify(
    Object.fromEntries(KATALOG.map(m => [m.collection, {
      upsert: [m.baris('H10A-' + m.hapus, m.hapus), m.baris('H10B-' + m.sisa, m.sisa)],
      removeIds: [],
    }])))
  });`);
  ok('10.0 dua baris uji per collection masuk ke file sebelum tombolnya ditekan',
    KATALOG.every(m => masuk[m.collection] && masuk[m.collection].inserted === 2), masuk);

  // Boot tidak lagi memindahkan seluruh file ke renderer, jadi collection yang
  // sudah pernah dibuka menunya (deliveries dibaca lewat Penjualan di bagian 5)
  // menyimpan salinannya sendiri di memori dan TIDAK membaca ulang apa yang baru
  // saja masuk ke file. Tanpa muat ulang, baris uji tidak akan pernah muncul di
  // daftar dan yang diuji bukan jalurnya. Sesi login ikut bertahan, makanya
  // layar login hanya dibuka kalau aplikasinya benar-benar keluar.
  await wc.reload();
  const masukLagi = async () => {
    for (let i = 0; i < 60; i++) {
      if (await ev(wc, `return !!document.querySelector('#login-username');`)) {
        await ev(wc, `
          setVal(document.querySelector('#login-username'), 'admin');
          setVal(document.querySelector('#login-password'), 'BaruHand123');
          const b = byText(/Masuk ke FATHONI/); if (b) b.click();
          return true;`);
      } else if (await ev(wc, `return /Dasbor|Armada|Kontrol|Laporan/i.test(document.body.innerText);`)) {
        return true;
      }
      await wait(500);
    }
    return false;
  };
  ok('10.0b aplikasi dibuka ulang dengan tenang supaya daftar katalog dibaca dari file',
    await masukLagi());

  // Jejak tulis hanya bermakna kalau tidak ada simpanan tertunda yang mengalir di
  // sampingnya: counter dibaca berulang sampai dua detik terakhir tidak bergerak.
  const tulisTenang = async () => {
    let terakhir = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);
    for (let i = 0; i < 8; i++) {
      await wait(1500);
      const kini = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);
      if (kini.patchCalls === terakhir.patchCalls && kini.patchUpsertRows === terakhir.patchUpsertRows
        && kini.patchRemoveIds === terakhir.patchRemoveIds && kini.fullCalls === terakhir.fullCalls) return kini;
      terakhir = kini;
    }
    return terakhir;
  };

  for (const [i, m] of KATALOG.entries()) {
    await ev(wc, `window.location.hash = '#/${m.rute}'; return true;`);
    const tampak = await waitFor(wc,
      `[...document.querySelectorAll('tbody tr')].some(r => /${m.hapus}/.test(r.innerText))`,
      `baris uji ${m.collection} tampil`, 25000);
    const sebelumTulis = await tulisTenang();
    const sebelumJumlah = await ev(wc, `
      window.confirm = () => true;
      window.__alert = null;
      window.alert = (msg) => { window.__alert = String(msg); };
      return (await window.electronAPI.dbQuery({ collection: '${m.collection}', limit: 500 })).total;`);
    const klik = await ev(wc, `
      const tr = [...document.querySelectorAll('tbody tr')].find(r => /${m.hapus}/.test(r.innerText));
      const btn = tr && [...tr.querySelectorAll('button')].find(b => (b.title || '') === 'Delete' || /Hapus/.test((b.innerText || '').trim()));
      if (btn) btn.click();
      return { baris: !!tr, tombol: !!btn };`);
    ok(`10.${i + 1} ${m.collection}: baris uji tampil dan tombol hapusnya dapat dipakai`,
      tampak === true && klik.baris === true && klik.tombol === true, { tampak, klik });

    const bersih = await waitFor(wc,
      `(await window.electronAPI.dbQuery({ collection: '${m.collection}', search: '${m.hapus}', limit: 1 })).total === 0`,
      `baris ${m.hapus} hilang dari file`, 25000);
    const sesudah = await ev(wc, `
      const w = (await window.electronAPI.dbStats()).writes;
      return {
        tulis: {
          removeIds: w.patchRemoveIds - ${sebelumTulis.patchRemoveIds},
          upsertRows: w.patchUpsertRows - ${sebelumTulis.patchUpsertRows},
          fullCalls: w.fullCalls - ${sebelumTulis.fullCalls},
        },
        jumlah: (await window.electronAPI.dbQuery({ collection: '${m.collection}', limit: 500 })).total,
        sisaAda: (await window.electronAPI.dbQuery({ collection: '${m.collection}', search: '${m.sisa}', limit: 1 })).total,
        alert: window.__alert,
      };`);
    ok(`10.${i + 7} ${m.collection}: hapus mengirim satu id lewat patch, bukan seluruh collection`,
      bersih === true && sesudah.tulis.removeIds === 1 && sesudah.tulis.upsertRows === 0
        && sesudah.tulis.fullCalls === 0 && sesudah.jumlah === sebelumJumlah - 1
        && sesudah.sisaAda === 1 && !sesudah.alert,
      { bersih, sebelumJumlah, sesudah });
  }

  const sehat10 = await ev(wc, `return window.electronAPI.dbIntegrity();`);
  ok('10.13 database tetap utuh sesudah enam menu katalog menghapus barisnya',
    sehat10.ok === true, sehat10.quickCheck);

  // ── 10.14 nilai di luar daftar tidak menjatuhkan layarnya ──
  // Ditemukan oleh bagian 10 ini sendiri: baris breakdown dengan severity di luar
  // daftarnya membuat layaranya melempar saat merender, dan boundary yang hanya
  // ada di akar aplikasi menyimpan status kesalahannya — setelah tiga kali
  // percobaan pulih otomatis, SEMUA menu ikut menampilkan "Terjadi Kesalahan"
  // sampai pengguna memuat ulang. Itulah bentuk "macet" yang paling sering
  // dilaporkan. Dua lapis perbaikannya: peta status/severity sekarang dibaca
  // dengan fallback (barisnya tetap tampil, nilainya apa adanya), dan boundary
  // dipasang per rute supaya kerusakan apa pun berhenti di satu layar.
  const barisRusak = await ev(wc, `
    return await window.electronAPI.dbPatch({ breakdowns: { upsert: [{
      id: 'H10RUSAK', breakdownNumber: 'UJI10RUSAKBR', unitSerialNumber: 'RANGKA-UJI-10',
      unitModel: 'SANY SY215C', location: 'Site Uji', reportedBy: 'Pimpinan Uji',
      reportedAt: '2026-10-01T08:00:00.000Z', severity: 'MEDIUM', status: 'ESCALATED',
      description: 'Baris uji dengan severity dan status di luar daftarnya',
    }], removeIds: [] } });`);
  await wc.reload();
  const masukSetelahRusak = await masukLagi();
  await ev(wc, `window.location.hash = '#/breakdown'; return true;`);
  // Barisnya harus benar-benar terbaca di tabel, bukan hanya "halamannya tidak
  // error": kalau nilainya disaring keluar, layar terlihat sehat padahal datanya
  // hilang dari pandangan.
  const tampil = await waitFor(wc,
    `/UJI10RUSAKBR/.test(document.body.innerText)`
    + ` && /MEDIUM/.test(document.body.innerText)`
    + ` && /ESCALATED/.test(document.body.innerText)`
    + ` && !/Terjadi Kesalahan/.test(document.body.innerText)`,
    'baris asing tampil di Breakdown tanpa layar kesalahan', 25000);
  await ev(wc, `window.location.hash = '#/customers'; return true;`);
  // Sekaligus menunggu barisnya datang: rute ini baru saja dihidrasi dari file,
  // dan judul "Pelanggan" sudah tampil sebelum tabelnya terisi.
  const pulih = await waitFor(wc,
    `/Pelanggan/.test(document.body.innerText)`
    + ` && !/Terjadi Kesalahan/.test(document.body.innerText)`
    + ` && document.querySelectorAll('tbody tr').length > 0`,
    'menu Pelanggan tetap terbuka sesudah baris asing dibuka', 25000);
  const daftarPelanggan = await ev(wc, `return document.querySelectorAll('tbody tr').length;`);
  ok('10.14 baris dengan nilai di luar daftar tetap tampil dan tidak meruntuhkan menu lain',
    barisRusak.breakdowns.inserted === 1 && masukSetelahRusak === true && tampil === true
      && pulih === true && daftarPelanggan > 0,
    { barisRusak, masukSetelahRusak, tampil, pulih, daftarPelanggan });

  const bersihkan10 = await ev(wc, `
    return await window.electronAPI.dbPatch({ breakdowns: { upsert: [], removeIds: ['H10RUSAK'] } });`);
  const sehat10b = await ev(wc, `return window.electronAPI.dbIntegrity();`);
  ok('10.15 baris asing dibersihkan dan database tetap utuh',
    bersihkan10.breakdowns.deleted === 1 && sehat10b.ok === true,
    { bersihkan10, quickCheck: sehat10b.quickCheck });

  // ── 10.16 kolom yang boleh kosong tidak boleh meruntuhkan layarnya ──
  // Kelas cacat yang sama dengan 10.14, lewat field lain: kolom INTEGER
  // dikembalikan sebagai null kalau barisnya tidak punya field itu (data lama,
  // hasil impor, restore), dan field yang bukan kolom (array sertifikasi/keahlian)
  // ikut hilang dari JSON. Sel tabel memanggil totalHours.toLocaleString() dan
  // specializations.slice() langsung, jadi render-nya melempar.
  const barisKosong = await ev(wc, `
    return await window.electronAPI.dbPatch({
      operators: { upsert: [{
        id: 'H10NULL-OP', operatorNumber: 'UJI10NULLOP', name: 'Operator Tanpa Jam',
        status: 'ACTIVE', phone: '08000000010',
      }], removeIds: [] },
      technicians: { upsert: [{
        id: 'H10NULL-TE', technicianNumber: 'UJI10NULLTE', name: 'Teknisi Tanpa Jam',
        status: 'ACTIVE', phone: '08000000011',
      }], removeIds: [] } });`);
  await wc.reload();
  const masukNull = await masukLagi();
  const nullDitulis = await ev(wc, `
    return (await window.electronAPI.dbQuery({ collection: 'operators', search: 'UJI10NULLOP' })).rows
      .map(r => r.totalHours);`);
  const layarKosong = [];
  for (const m of [
    { rute: 'operators', tanda: 'UJI10NULLOP' },
    { rute: 'technicians', tanda: 'UJI10NULLTE' },
  ]) {
    await ev(wc, `window.location.hash = '#/${m.rute}'; return true;`);
    const tampil = await waitFor(wc,
      `/UJI10NULL/.test(document.body.innerText)`
      + ` && !/Terjadi Kesalahan/.test(document.body.innerText)`,
      `baris tanpa angka tampil di ${m.rute}`, 25000);
    if (!tampil) layarKosong.push(m.rute);
  }
  ok('10.16 baris dengan kolom angka kosong tetap tampil, layarnya tidak jatuh',
    barisKosong.operators.inserted === 1 && barisKosong.technicians.inserted === 1
      && masukNull === true && nullDitulis.length === 1
      && (nullDitulis[0] === null || nullDitulis[0] === undefined)
      && layarKosong.length === 0,
    { barisKosong, nullDitulis, layarKosong });

  const bersihkan10c = await ev(wc, `
    return await window.electronAPI.dbPatch({
      operators: { upsert: [], removeIds: ['H10NULL-OP'] },
      technicians: { upsert: [], removeIds: ['H10NULL-TE'] } });`);
  const sehat10c = await ev(wc, `return window.electronAPI.dbIntegrity();`);
  ok('10.17 baris angka kosong dibersihkan dan database tetap utuh',
    bersihkan10c.operators.deleted === 1 && bersihkan10c.technicians.deleted === 1
      && sehat10c.ok === true,
    { bersihkan10c, quickCheck: sehat10c.quickCheck });

  // ── 10.18 orang yang masih disebut dokumen tidak boleh bisa dihapus ──
  // Teknisi dan operator dulu "record daun": tidak ada aturan rujukan untuk
  // keduanya, jadi menghapus teknisi yang namanya masih tertulis di Work Order
  // lolos tanpa pesan apa pun dan dokumen itu menunjuk orang yang sudah tidak
  // ada. Namanya tidak disimpan sebagai kolom turunan di dokumen anak (tidak ada
  // menu yang menyaring berdasarkan orang), jadi rujukannya dibaca dari blob
  // pencarian yang memang sudah menyimpan mechanicName / driverName.
  const ORANG = await ev(wc, `
    return await window.electronAPI.dbPatch({
      technicians: { upsert: [{
        id: 'H18TECH', technicianNumber: 'TECH-UJI-18', name: 'Suryo Ampi',
        status: 'ACTIVE', phone: '08000000018', totalHours: 6, specializations: [],
      }], removeIds: [] },
      services: { upsert: [{
        id: 'H18WO', woNumber: 'WO-UJI-18', serialNumber: 'RANGKA-UJI-18',
        unitModel: 'SANY SY215C', customerOrProject: 'PT Uji Orang',
        serviceType: 'PERIODIC_250H', mechanicName: 'Suryo Ampi & Tim',
        status: 'OPEN', openDate: '2026-10-02', hourMeter: 100, estimatedCost: 0,
      }], removeIds: [] },
      operators: { upsert: [{
        id: 'H18OP', operatorNumber: 'OP-UJI-18', name: 'Warsito',
        status: 'ACTIVE', phone: '08000000019', totalHours: 2,
      }], removeIds: [] },
      deliveries: { upsert: [{
        id: 'H18DO', doNumber: 'DO-UJI-18', salesOrderRef: 'SO-UJI-18',
        customerName: 'PT Uji Orang', unitModel: 'SANY SY215C',
        serialNumber: 'RANGKA-UJI-18', deliveryDate: '2026-10-02',
        destination: 'Site Uji', driverName: 'Warsito', truckPlate: 'B 8888 ZZ',
        status: 'MENUNGGU', notes: '',
      }], removeIds: [] } });`);
  ok('10.18a orang beserta dokumen yang menyebut namanya masuk ke file',
    ORANG.technicians.inserted === 1 && ORANG.services.inserted === 1
      && ORANG.operators.inserted === 1 && ORANG.deliveries.inserted === 1, ORANG);

  await wc.reload();
  const masukOrang = await masukLagi();
  for (const m of [
    { rute: 'technicians', collection: 'technicians', tanda: 'TECH-UJI-18',
      dokumen: 'Work Order Servis', induk: 'services', tandaInduk: 'WO-UJI-18' },
    { rute: 'operators', collection: 'operators', tanda: 'OP-UJI-18',
      dokumen: 'Surat Jalan', induk: 'deliveries', tandaInduk: 'DO-UJI-18' },
  ]) {
    await ev(wc, `
      window.confirm = () => true;
      window.__alert = null;
      window.alert = (msg) => { window.__alert = String(msg); };
      window.location.hash = '#/${m.rute}'; return true;`);
    const siap = await waitFor(wc,
      `[...document.querySelectorAll('tbody tr')].some(r => /${m.tanda}/.test(r.innerText))`,
      `baris ${m.collection} tampil`, 25000);
    const menekan = await ev(wc, `
      const tr = [...document.querySelectorAll('tbody tr')].find(r => /${m.tanda}/.test(r.innerText));
      const btn = tr && [...tr.querySelectorAll('button')].find(b => (b.title || '') === 'Delete' || /Hapus/.test((b.innerText || '').trim()));
      if (btn) btn.click();
      return !!btn;`);
    const menunggu = await waitFor(wc, `!!window.__alert`, 'penolakan hapus', 25000);
    const file = await ev(wc, `
      const q = await window.electronAPI.dbQuery({ collection: '${m.collection}', search: '${m.tanda}', limit: 5 });
      const i = await window.electronAPI.dbQuery({ collection: '${m.induk}', search: '${m.tandaInduk}', limit: 5 });
      return { alert: String(window.__alert || ''), masihAda: q.total, indukAda: i.total };`);
    ok(`10.18b hapus ${m.collection} yang masih disebut dokumennya ditolak dengan alasan yang benar`,
      siap === true && menekan === true && menunggu === true
        && /masih dipakai/i.test(file.alert) && file.alert.includes(m.dokumen)
        && file.masihAda === 1 && file.indukAda === 1,
      { siap, menekan, menunggu, alert: file.alert, masihAda: file.masihAda, indukAda: file.indukAda });
  }

  // Baris uji orang dibersihkan lewat patch langsung: removeRow akan menolak
  // dirinya sendiri justru karena pembuktiannya di atas.
  const bersihkan18 = await ev(wc, `
    return await window.electronAPI.dbPatch({
      technicians: { upsert: [], removeIds: ['H18TECH'] },
      operators: { upsert: [], removeIds: ['H18OP'] },
      services: { upsert: [], removeIds: ['H18WO'] },
      deliveries: { upsert: [], removeIds: ['H18DO'] } });`);
  const sehat18 = await ev(wc, `return window.electronAPI.dbIntegrity();`);
  ok('10.18c baris uji orang dibersihkan dan database tetap utuh',
    masukOrang === true
      && bersihkan18.technicians.deleted === 1 && bersihkan18.operators.deleted === 1
      && bersihkan18.services.deleted === 1 && bersihkan18.deliveries.deleted === 1
      && sehat18.ok === true,
    { masukOrang, bersihkan18, quickCheck: sehat18.quickCheck });

  // ── 10.19 usulan nomor dokumen diambil dari nomor tertinggi di file ──
  // Nomor SPK adalah kunci yang dibaca menu lain (Surat Jalan dan Invoice menunjuk
  // salesOrderRef). Dulu calon nomor dihitung dari panjang array yang dipegang
  // halaman: satu SPK terhapus meninggalkan celah dan usulan berikutnya menabrak
  // nomor yang masih ada di file, sedangkan array halaman tidak pernah lengkap
  // lagi sejak hidrasi per menu (#38).
  const TAHUN19 = new Date().getFullYear();
  const N19 = (n) => `SO-${TAHUN19}-${String(n).padStart(3, '0')}`;
  const BARIS19 = [901, 902, 903].map(n => ({
    id: 'H19' + n, orderNo: N19(n), customerName: 'PT Uji Nomor',
    unitModel: 'SANY SY215C', serialNumber: 'RANGKA-UJI-19-' + n,
    orderDate: '2026-06-01', totalPrice: 1000, downPayment: 0,
    paymentScheme: 'CASH', status: 'CONFIRMED', salesPerson: 'Uji',
  }));
  const MASUK19 = await ev(wc, `
    return await window.electronAPI.dbPatch({ sales: { upsert: ${JSON.stringify(BARIS19)}, removeIds: [] } });`);
  ok('10.19a tiga SPK uji bernomor 901..903 masuk ke file',
    MASUK19.sales.inserted === 3, MASUK19);

  const HAPUS19 = await ev(wc, `
    return await window.electronAPI.dbPatch({ sales: { upsert: [], removeIds: ['H19903'] } });`);
  ok('10.19b SPK bernomor tertinggi dihapus, menyisakan celah di ujung nomor',
    HAPUS19.sales.deleted === 1, HAPUS19);

  await wc.reload();
  const masuk19 = await masukLagi();
  await ev(wc, `window.location.hash = '#/sales'; return true;`);
  const tabel19 = await waitFor(wc,
    `[...document.querySelectorAll('tbody tr')].some(r => /${N19(902)}/.test(r.innerText))`,
    'daftar SPK uji tampil', 25000);
  const tombol19 = await ev(wc, `
    const b = byText(/Buat SPK/i); if (b) b.click(); return !!b;`);
  const modal19 = await waitFor(wc, `!!document.querySelector('.modal')`, 'modal tambah SPK', 25000);
  const usulan19 = await ev(wc, `
    const lab = [...document.querySelectorAll('.modal label')].find(l => /Nomor SPK/.test(l.innerText || ''));
    const inp = lab && lab.parentElement.querySelector('input');
    return inp ? inp.value : null;`);
  const file19 = await ev(wc, `
    const tabrak = await window.electronAPI.dbQuery({ collection: 'sales', where: { orderNo: ${JSON.stringify(String(usulan19 || ''))} }, limit: 5 });
    const semua = await window.electronAPI.dbQuery({ collection: 'sales', limit: 1 });
    return { tabrakan: tabrak.total, jumlahBaris: semua.total };`);
  ok('10.19c usulan nomor SPK melanjutkan nomor tertinggi di file, bukan jumlah baris',
    masuk19 === true && tabel19 === true && tombol19 === true && modal19 === true
      && usulan19 === N19(903) && file19.tabrakan === 0
      && Number(String(usulan19).slice(-3)) > file19.jumlahBaris,
    { usulan: usulan19, diharapkan: N19(903), tabrakan: file19.tabrakan, jumlahBaris: file19.jumlahBaris });

  const bersihkan19 = await ev(wc, `
    return await window.electronAPI.dbPatch({ sales: { upsert: [], removeIds: ['H19901', 'H19902'] } });`);
  const sehat19 = await ev(wc, `return window.electronAPI.dbIntegrity();`);
  ok('10.19d baris uji nomor dibersihkan dan database tetap utuh',
    bersihkan19.sales.deleted === 2 && sehat19.ok === true,
    { bersihkan: bersihkan19.sales, quickCheck: sehat19.quickCheck });

  console.log(`\n=== handoff-check: ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

require('../../dist-electron/main.js');
