// tests/harness/otorisasi-check.cjs
// Mengunci dua sisi dari SATU keputusan wewenang tulis:
//   sisi main process  -> electron/authorization.ts (WRITABLE_BY_ROLE)
//   sisi renderer      -> src/components/Layout.tsx (requiredRoles pada menu)
// dan membuktikan jalur yazarnya berjalan: tulisan tanpa sesi ditolak, tulisan
// peran yang tidak memegang collection ditolak, angka rusak ditolak, dan setiap
// penolakan serta setiap penghapusan masuk jejak audit.
//
// Harness ini memakai profil uji sendiri (HEMS_DATA_DIR wajib) dan tidak pernah
// menyentuh data pengguna nyata.
const { app } = require('electron');
const selesai = require('./selesai.cjs');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.HEMS_DATA_DIR;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else {
    console.log('FAIL ' + name + (extra !== undefined && extra !== null ? ' -> ' + JSON.stringify(extra) : ''));
    fail++;
  }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// executeJavaScript menolak `return` di level atas, jadi setiap potongan dibungkus.
function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${body} })()`);
}

async function waitFor(wc, expr, label, timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await ev(wc, `return !!(${expr});`)) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

// ── Peta "collection ini diedit lewat menu mana" ─────────────────────────────
// Harness ini tidak bisa membaca maksud seorang programmer, jadi peta inilah yang
// menuliskannya. Setiap collection baru wajib masuk: tanpa entri, tidak ada menu
// yang menawarkan dan tidak ada jalur tulis yang sah — itulah yang dicari uji
// "semua collection punya rumah menu" di bawah.
const WEWENANG_MENU = {
  units: 'units',
  // Katalog merek & model diedit dari satu layar (Brands.tsx) yang sama dengan
  // rute /brands — keduanya tidak punya menu sendiri.
  brands: 'brands',
  models: 'brands',
  customers: 'customers',
  suppliers: 'suppliers',
  operators: 'operators',
  technicians: 'technicians',
  purchases: 'purchase',
  sales: 'sales',
  rentals: 'rental',
  approvals: 'approvals',
  invoices: 'invoices',
  warehouse: 'warehouse',
  spareParts: 'spareparts',
  breakdowns: 'breakdown',
  services: 'service',
  deliveries: 'delivery',
  documents: 'documents',
  kas: 'finance',
  bankAccounts: 'finance',
};

const PERAN = ['SUPERADMIN', 'SALES', 'WAREHOUSE', 'SERVICE', 'FINANCE'];

/** Ambil {path, requiredRoles} dari NAV_GROUPS dengan memotong teks sumber. */
function bacaMenu() {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/Layout.tsx'), 'utf-8');
  const mulai = src.indexOf('const NAV_GROUPS');
  const akhir = src.indexOf('\n];', mulai);
  if (mulai < 0 || akhir < 0) throw new Error('NAV_GROUPS tidak ditemukan di Layout.tsx');
  const wilayah = src.slice(mulai, akhir);
  const titik = [...wilayah.matchAll(/path:\s*'\/([a-z0-9-]+)'/gi)].map(m => ({ segmen: m[1], i: m.index }));
  const hasil = [];
  for (let n = 0; n < titik.length; n++) {
    const potongan = wilayah.slice(titik[n].i, n + 1 < titik.length ? titik[n + 1].i : wilayah.length);
    const roles = /requiredRoles:\s*\[([^\]]*)\]/.exec(potongan);
    hasil.push({
      segmen: titik[n].segmen,
      roles: roles ? [...roles[1].matchAll(/'([A-Z_]+)'/g)].map(m => m[1]) : PERAN.slice(),
    });
  }
  return hasil;
}

// ── Bagian 1: peta wewenang itu sendiri (tanpa jendela) ──────────────────────
function ujiPeta(authz, spec) {
  const { WRITABLE_BY_ROLE, ALL_COLLECTIONS, bolehTulis, alasanTulis } = authz;

  ok('1.1 peta punya tepat lima peran',
    Object.keys(WRITABLE_BY_ROLE).sort().join() === PERAN.slice().sort().join(),
    Object.keys(WRITABLE_BY_ROLE));

  const takDikenal = ALL_COLLECTIONS.filter(c => !spec.includes(c));
  ok('1.2 setiap nama collection di peta dikenal skema', takDikenal.length === 0, takDikenal);

  ok('1.3 super admin dapat menulis semua collection',
    [...ALL_COLLECTIONS].sort().join() === [...WRITABLE_BY_ROLE.SUPERADMIN].sort().join(),
    { peta: WRITABLE_BY_ROLE.SUPERADMIN.length, skema: ALL_COLLECTIONS.length });

  const yatim = ALL_COLLECTIONS.filter(c => !PERAN.some(r => bolehTulis(r, c)));
  ok('1.4 tidak ada collection yang tidak bisa ditulis siapa pun', yatim.length === 0, yatim);

  ok('1.5 peran asing / collection asing / nilai bukan teks ditolak',
    bolehTulis('HACKER', 'customers') === false
      && bolehTulis('SALES', 'tidakAda') === false
      && bolehTulis(undefined, 'customers') === false
      && bolehTulis('SALES', undefined) === false,
    null);

  const pesan = alasanTulis('SALES', 'kas');
  ok('1.6 penolakan menyebut peran dan collection',
    /SALES/.test(pesan) && /kas/.test(pesan), pesan);

  // ── Pasangan dengan menu ──
  let menu;
  try { menu = bacaMenu(); } catch (e) { ok('1.7 Layout.tsx terbaca', false, String(e.message || e)); return; }
  ok('1.7 Layout.tsx terbaca', menu.length > 0, menu.length);

  const tanpaRumah = ALL_COLLECTIONS.filter(c => !WEWENANG_MENU[c]);
  ok('1.8 setiap collection punya menu tempat ia diedit', tanpaRumah.length === 0, tanpaRumah);

  const salahRumah = Object.entries(WEWENANG_MENU).filter(([c, m]) =>
    !ALL_COLLECTIONS.includes(c) || !menu.some(x => x.segmen === m));
  ok('1.9 peta menu memakai nama collection dan rute yang benar-benar ada',
    salahRumah.length === 0, salahRumah);

  const perMenu = {};
  for (const m of menu) {
    perMenu[m.segmen] = PERAN.filter(r => (perMenu[m.segmen] || []).includes(r) || m.roles.includes(r));
  }
  const bocor = [];
  for (const [collection, segmen] of Object.entries(WEWENANG_MENU)) {
    if (!menu.some(x => x.segmen === segmen)) continue;
    const dariMenu = perMenu[segmen] || [];
    const dariMain = PERAN.filter(r => bolehTulis(r, collection));
    if (dariMenu.sort().join() !== dariMain.sort().join()) {
      bocor.push(`${collection} via /${segmen}: menu=${dariMenu.join('|') || '-'} main=${dariMain.join('|') || '-'}`);
    }
  }
  // Dua arah karena dua-duanya merusak: menu yang menawarkan collection di luar
  // daftarnya memberi tombol yang tahu-tahu ditolak, dan collection yang boleh
  // ditulis sebuah peran tetapi tidak ditawarkan menunya membuat peran itu tidak
  // pernah bisa mengerjakan bidangnya.
  ok('1.10 requiredRoles menu == hak tulis main process untuk semua collection',
    bocor.length === 0, bocor);
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

const BARIS = {
  customers: { id: 'O-C1', name: 'Pelanggan Uji Otorisasi' },
  purchases: { id: 'O-P1', poNumber: 'PO-UJI-O', supplier: 'PT Uji', totalAmount: 1000000 },
  services: { id: 'O-S1', jobNumber: 'WO-UJI-O', status: 'OPEN' },
  units: { id: 'O-U1', serialNumber: 'FATHONI-Otorisasi-1', brand: 'SANY', model: 'SY215C', hourMeter: 12 },
  // Nama mereknya sengaja di luar katalog bawaan supaya rujukan model -> merek
  // yang terbentuk di uji runtime hanya bisa berasal dari baris yang ditanam sini.
  brands: { id: 'O-B1', name: 'FATHONI Merek Uji', country: 'Indonesia', category: 'Excavator' },
  models: { id: 'O-M1', brandName: 'FATHONI Merek Uji', modelCode: 'FATHONI-UJI-100', category: 'Excavator' },
  kas: { id: 'O-K1', tanggal: '2026-10-01', tipe: 'MASUK', kategori: 'Penjualan', jumlah: 500000 },
  operators: { id: 'O-O1', name: 'Operator Uji' },
};

/** Semua probe lewat jalur tulis asli, jadi yang diuji adalah kanal IPC, bukan fungsi internal. */
async function patch(wc, patches) {
  return ev(wc, `return await window.electronAPI.dbPatch(${JSON.stringify(patches)});`);
}

async function run(wc) {
  if (!DATA_DIR || !fs.existsSync(DATA_DIR)) {
    console.log('HARNESS ERROR: HEMS_DATA_DIR wajib pointing ke folder sementara yang ada');
    selesai(app, 3);
    return;
  }
  await wait(500);

  const { WRITABLE_BY_ROLE, ALL_COLLECTIONS, bolehTulis, alasanTulis } = require('../../dist-electron/authorization.js');
  const spec = require('../../dist-electron/dbSchema.js');
  ujiPeta({ WRITABLE_BY_ROLE, ALL_COLLECTIONS, bolehTulis, alasanTulis }, Object.keys(spec.SPEC_BY_NAME));

  await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    localStorage.removeItem('hems_session');
    return true;`);
  await wc.reload();
  ok('2.1 layar login muncul', await waitFor(wc, `!!document.querySelector('#login-username')`, 'form login'));

  const masuk = async (u, p) => ev(wc, `return await window.electronAPI.login(${JSON.stringify(u)}, ${JSON.stringify(p)});`);
  const keluar = async t => ev(wc, `return await window.electronAPI.logout(${JSON.stringify(t)});`);

  // ── 3. sesi adalah syarat, bukan hiasan ──
  // Baris pertama sengaja ditanam oleh super admin: sesudah itu database pasti
  // bukan perawan lagi, jadi penolakan "tanpa sesi" tidak bisa tertukar dengan
  // penyimpangan migrasi boot.
  const admin = await masuk('admin', 'admin123');
  ok('3.1 login super admin', admin.success === true, admin);
  const tanam = await patch(wc, { customers: { upsert: [BARIS.customers], removeIds: [] } });
  ok('3.2 super admin boleh menulis customers', tanam && tanam.customers && tanam.customers.inserted === 1, tanam);
  await keluar(admin.token);
  const tanpaSesi = await patch(wc, { customers: { upsert: [{ ...BARIS.customers, id: 'O-C2' }], removeIds: [] } });
  ok('3.3 jendela tanpa sesi ditolak',
    tanpaSesi && tanpaSesi.dilarang === true && /sesi/i.test(String(tanpaSesi.error)), tanpaSesi);
  const sisaDitolak = (await ev(wc, `return (await window.electronAPI.dbLoad(['customers'])).customers.map(c => c.id);`)) || [];
  ok('3.4 tulisan yang ditolak tidak masuk ke file', !sisaDitolak.includes('O-C2'), sisaDitolak);

  // ── 4. peran menegakkan collection-nya sendiri ──
  const sales = await masuk('sales', 'sales123');
  ok('4.1 login sales', sales.success === true, sales);
  const milikSales = await patch(wc, { customers: { upsert: [{ ...BARIS.customers, id: 'O-C3' }], removeIds: [] } });
  ok('4.2 sales menulis collection yang mejeng di menunya',
    milikSales && milikSales.customers && milikSales.customers.inserted === 1, milikSales);
  const bukanSales = await patch(wc, { operators: { upsert: [BARIS.operators], removeIds: [] } });
  ok('4.3 sales ditolak saat menulis operators',
    bukanSales && bukanSales.dilarang === true && /operators/.test(String(bukanSales.error)), bukanSales);
  const campur = await patch(wc, {
    customers: { upsert: [{ ...BARIS.customers, id: 'O-C4' }], removeIds: [] },
    operators: { upsert: [{ ...BARIS.operators, id: 'O-O2' }], removeIds: [] },
  });
  ok('4.4 satu patch campuran ditolak seluruhnya', campur && campur.dilarang === true, campur);
  const idSetelahCampur = (await ev(wc, `return (await window.electronAPI.dbLoad(['customers'])).customers.map(c => c.id);`)) || [];
  ok('4.5 penolakan patch campuran tidak menulis separuhnya', !idSetelahCampur.includes('O-C4'), idSetelahCampur);

  // Hapus juga wewenang: sales boleh menghapus customers yang tadi ia buat.
  const hapusSales = await patch(wc, { customers: { upsert: [], removeIds: ['O-C1', 'O-C3'] } });
  ok('4.6 sales menghapus customers miliknya',
    hapusSales && hapusSales.customers && hapusSales.customers.deleted === 2, hapusSales);

  // ── 4b. katalog merek & model ──
  // Dulu halaman Brands hanya array lokal: tidak ada jalur tulis, tidak ada
  // wewenang, dan tidak ada pemeriksaan rujukan. Sekarang ia collection sungguhan,
  // jadi kedua hal itu harus terbukti lewat kanal IPC yang asli, bukan lewat
  // fungsi internal.
  const katalogSales = await patch(wc, {
    brands: { upsert: [BARIS.brands], removeIds: [] },
    models: { upsert: [BARIS.models], removeIds: [] },
  });
  ok('4b.1 sales menulis katalog merek dan model',
    !!katalogSales && katalogSales.brands && katalogSales.brands.inserted === 1
      && katalogSales.models && katalogSales.models.inserted === 1, katalogSales);
  const rujukanMerek = await ev(wc, `return await window.electronAPI.dbReferences('brands', 'O-B1');`);
  ok('4b.2 merek yang masih punya model di bawahnya dilaporkan menahan hapus',
    !!rujukanMerek && rujukanMerek.blocked === true && !rujukanMerek.error
      && (rujukanMerek.hits || []).some(h => h.collection === 'models' && (h.contoh || []).includes('FATHONI-UJI-100')),
    rujukanMerek);
  const rujukanKode = await ev(wc, `return await window.electronAPI.dbReferences('models', 'O-M1');`);
  ok('4b.3 kode model yang belum menjadi unit tidak menahan hapusnya sendiri',
    !!rujukanKode && rujukanKode.blocked === false && !rujukanKode.error, rujukanKode);
  const bersihKatalog = await patch(wc, {
    models: { upsert: [], removeIds: ['O-M1'] },
    brands: { upsert: [], removeIds: ['O-B1'] },
  });
  ok('4b.4 katalog uji dibersihkan (kedua collection boleh ditulis sales)',
    !!bersihKatalog && !bersihKatalog.dilarang, bersihKatalog);

  const gudang = await masuk('gudang', 'gudang123');
  ok('4.7 login gudang', gudang.success === true, gudang);
  const milikGudang = await patch(wc, { purchases: { upsert: [BARIS.purchases], removeIds: [] } });
  ok('4.8 gudang menulis purchases', milikGudang && milikGudang.purchases && milikGudang.purchases.inserted === 1, milikGudang);
  const bukanGudang = await patch(wc, { customers: { upsert: [{ ...BARIS.customers, id: 'O-C5' }], removeIds: [] } });
  ok('4.9 gudang ditolak saat menulis customers', bukanGudang && bukanGudang.dilarang === true, bukanGudang);

  const servis = await masuk('service', 'service123');
  ok('4.10 login servis', servis.success === true, servis);
  const milikServis = await patch(wc, { services: { upsert: [BARIS.services], removeIds: [] } });
  ok('4.11 servis menulis services', milikServis && milikServis.services && milikServis.services.inserted === 1, milikServis);
  const unitServis = await patch(wc, { units: { upsert: [BARIS.units], removeIds: [] } });
  ok('4.12 servis boleh menulis units (efek samping WO yang sah)',
    unitServis && unitServis.units && unitServis.units.inserted === 1, unitServis);
  const bukanServis = await patch(wc, { sales: { upsert: [{ id: 'O-SAL1', soNumber: 'SO-UJI' }], removeIds: [] } });
  ok('4.13 servis ditolak saat menulis sales', bukanServis && bukanServis.dilarang === true, bukanServis);

  const keu = await masuk('finance', 'finance123');
  ok('4.14 login keuangan', keu.success === true, keu);
  const milikKeu = await patch(wc, { kas: { upsert: [BARIS.kas], removeIds: [] } });
  ok('4.15 keuangan menulis kas', milikKeu && milikKeu.kas && milikKeu.kas.inserted === 1, milikKeu);
  const bukanKeu = await patch(wc, { units: { upsert: [{ ...BARIS.units, id: 'O-U2' }], removeIds: [] } });
  ok('4.16 keuangan ditolak saat menulis units', bukanKeu && bukanKeu.dilarang === true, bukanKeu);

  // Katalog ikut diuji dari sisi penolakan: /brands memang tidak pernah offered
  // ke FINANCE, dan itu harus punya lawan di main process. Kalau salah satu sisi
  // berubah sendiri, uji 1.10 menangkap peta — uji ini menangkap jalur tulisnya.
  const bukanKeuMerek = await patch(wc, { brands: { upsert: [{ ...BARIS.brands, id: 'O-B2' }], removeIds: [] } });
  ok('4.17 keuangan ditolak saat menulis katalog merek',
    !!bukanKeuMerek && bukanKeuMerek.dilarang === true && /brands/.test(String(bukanKeuMerek.error)), bukanKeuMerek);
  const bukanKeuModel = await patch(wc, { models: { upsert: [{ ...BARIS.models, id: 'O-M2' }], removeIds: [] } });
  ok('4.18 keuangan ditolak saat menulis katalog model',
    !!bukanKeuModel && bukanKeuModel.dilarang === true && /models/.test(String(bukanKeuModel.error)), bukanKeuModel);

  // ── 5. gerbang angka hanya untuk penulis, tidak untuk migrasi boot ──
  // Sengaja diuji sebagai super admin: kalau peran yang dipegang tidak boleh
  // menulis collection-nya, penolakannya datang dari wewenang, bukan dari angka,
  // dan uji ini tidak membuktikan apa pun.
  const admin12 = await masuk('admin', 'admin123');
  ok('5.0 login super admin sebelum uji angka', admin12.success === true, admin12);
  const rusakKas = await patch(wc, { kas: { upsert: [{ id: 'O-K2', tanggal: '2026-10-02', tipe: 'KELUAR', kategori: 'Servis', jumlah: '1.,5' }], removeIds: [] } });
  ok('5.1 angka rusak ditolak lewat db-patch',
    rusakKas && rusakKas.dilarang === true && /bukan angka/.test(String(rusakKas.error)), rusakKas);
  await masuk('admin', 'admin123');
  const rusakSave = await ev(wc, `
    const s = await window.electronAPI.dbLoad(['units']);
    s.units.push({ id: 'O-U3', serialNumber: 'FATHONI-Otorisasi-3', brand: 'SANY', model: 'SY215C', hourMeter: '12,5.' });
    return await window.electronAPI.dbSave({ units: s.units });`);
  ok('5.2 angka rusak ditolak lewat jalur collection penuh',
    rusakSave && rusakSave.dilarang === true && /bukan angka/.test(String(rusakSave.error)), rusakSave);
  const idRusak = (await ev(wc, `return (await window.electronAPI.dbLoad(['units'])).units.map(u => u.id);`)) || [];
  ok('5.3 baris cacat tidak masuk file', !idRusak.includes('O-U3'), idRusak);
  const kosongBoleh = await patch(wc, { customers: { upsert: [{ id: 'O-C9', name: 'Kolom angka dibiarkan kosong' }], removeIds: [] } });
  ok('5.4 kolom angka yang kosong bukan penolakan', kosongBoleh && kosongBoleh.customers && kosongBoleh.customers.inserted === 1, kosongBoleh);

  // ── 6. penolakan dan penghapusan meninggalkan jejak ──
  const admin2 = await masuk('admin', 'admin123');
  ok('6.1 login ulang super admin untuk membaca log', admin2.success === true, admin2);
  const log = (await ev(wc, `return await window.electronAPI.auditLog(${JSON.stringify(admin2.token)});`)) || {};
  const entri = log.entries || [];
  ok('6.2 log terbaca dari main process', log.success === true && entri.length > 0, { success: log.success, jumlah: entri.length });
  const deny = entri.filter(e => e.event === 'DATA_DENY');
  ok('6.3 setiap penolakan tercatat sebagai DATA_DENY', deny.length >= 7, deny.length);
  // Setiap penolakan harus menyebut collection yang ditolak. Bentuk pesannya
  // berbeda-beda (wewenang: "(collection: x)"; angka rusak: 'pada "x"'), jadi
  // yang diuji adalah isinya: tidak ada penolakan tanpa nama collection.
  ok('6.4 DATA_DENY menyebut collection yang ditolak',
    deny.length > 0
      && deny.every(e => ALL_COLLECTIONS.some(c => String(e.detail).includes(c)))
      && deny.some(e => String(e.detail).includes('operators'))
      && deny.some(e => String(e.detail).includes('units'))
      && deny.some(e => String(e.detail).includes('brands'))
      && deny.some(e => String(e.detail).includes('models')),
    deny.slice(0, 3).map(e => e.detail));
  ok('6.5 DATA_DENY menyebut siapa yang ditolak',
    deny.some(e => e.username === 'sales') && deny.some(e => e.username === 'gudang'),
    [...new Set(deny.map(e => e.username))]);
  const hapus = entri.filter(e => e.event === 'DATA_DELETE');
  ok('6.6 penghapusan tercatat sebagai DATA_DELETE dengan jumlah baris',
    hapus.some(e => /customers=2/.test(String(e.detail))), hapus.slice(0, 3).map(e => e.detail));
  ok('6.7 penolakan karena tanpa sesi tercatat atas nama jendela, bukan akun',
    deny.some(e => /tidak punya sesi/i.test(String(e.detail))), deny.slice(0, 8).map(e => e.detail));

  // ── 7. penjaga otomatisasi lewat kanal IPC yang sebenarnya ──
  // Fungsi penjaganya diuji murni di automation-check; di sini yang dibuktikan
  // adalah bahwa db-patch MEMANGGILNYA, menolak dengan pesan yang bisa dibaca
  // pengguna, tidak menulis separuh, dan meninggalkan jejak DATA_DENY.
  const admin7 = await masuk('admin', 'admin123');
  ok('7.0 login super admin sebelum uji otomatisasi', admin7.success === true, admin7);

  const inv1 = await patch(wc, { invoices: {
    upsert: [{
      id: 'O-INV1', invoiceNo: 'INV-UJI-1', sourceType: 'SERVICE', sourceNumber: 'WO-UJI-O',
      customerName: 'Pelanggan Uji', totalAmount: 1000,
    }], removeIds: [],
  } });
  ok('7.1 invoice pertama tersimpan', !!inv1 && inv1.invoices && inv1.invoices.inserted === 1, inv1);

  const inv2 = await patch(wc, { invoices: {
    upsert: [{
      id: 'O-INV2', invoiceNo: 'INV-UJI-1', sourceType: 'SALES', sourceNumber: 'SO-UJI-O',
      customerName: 'Pelanggan Uji', totalAmount: 2000,
    }], removeIds: [],
  } });
  ok('7.2 nomor invoice kembar ditolak di jalur tulis',
    !!inv2 && inv2.dilarang === true && /INV-UJI-1/.test(String(inv2.error)), inv2);

  const inv3 = await patch(wc, { invoices: {
    upsert: [{
      id: 'O-INV3', invoiceNo: 'INV-UJI-3', sourceType: 'SERVICE', sourceNumber: 'WO-UJI-O',
      customerName: 'Pelanggan Uji', totalAmount: 3000,
    }], removeIds: [],
  } });
  ok('7.3 sumber yang sudah punya invoice tidak boleh menagih kedua kali',
    !!inv3 && inv3.dilarang === true && /WO-UJI-O/.test(String(inv3.error)), inv3);

  const invEdit = await patch(wc, { invoices: {
    upsert: [{
      id: 'O-INV1', invoiceNo: 'INV-UJI-1', sourceType: 'SERVICE', sourceNumber: 'WO-UJI-O',
      customerName: 'Pelanggan Uji Diperbaiki', totalAmount: 1000,
    }], removeIds: [],
  } });
  ok('7.4 menyunting invoice yang sama tetap lolos (jalur perbaikan)',
    !!invEdit && !invEdit.dilarang, invEdit);

  const unitKembar = await patch(wc, { units: {
    upsert: [{ id: 'O-U-DUP', serialNumber: 'FATHONI-Otorisasi-1', brand: 'SANY', model: 'SY215C' }],
    removeIds: [],
  } });
  ok('7.5 serial unit kembar ditolak di jalur tulis',
    !!unitKembar && unitKembar.dilarang === true && /FATHONI-Otorisasi-1/.test(String(unitKembar.error)), unitKembar);

  const sewa1 = await patch(wc, { rentals: {
    upsert: [{
      id: 'O-R1', contractNo: 'K-UJI-1', serialNumber: 'FATHONI-Otorisasi-1', status: 'ACTIVE',
      startDate: '2026-10-01', endDate: '2026-10-31', monthlyRate: 1000,
    }], removeIds: [],
  } });
  ok('7.6 kontrak sewa aktif pertama tersimpan',
    !!sewa1 && sewa1.rentals && sewa1.rentals.inserted === 1, sewa1);

  const sewa2 = await patch(wc, { rentals: {
    upsert: [{
      id: 'O-R2', contractNo: 'K-UJI-2', serialNumber: 'FATHONI-Otorisasi-1', status: 'ACTIVE',
      startDate: '2026-10-15', endDate: '2026-11-15', monthlyRate: 1000,
    }], removeIds: [],
  } });
  ok('7.7 kontrak yang beririsan untuk unit yang sama ditolak',
    !!sewa2 && sewa2.dilarang === true && /K-UJI-1/.test(String(sewa2.error)), sewa2);

  const sewa3 = await patch(wc, { rentals: {
    upsert: [{
      id: 'O-R3', contractNo: 'K-UJI-3', serialNumber: 'FATHONI-Otorisasi-1', status: 'ACTIVE',
      startDate: '2026-11-01', endDate: '2026-11-30', monthlyRate: 1000,
    }], removeIds: [],
  } });
  ok('7.8 kontrak berurutan setelah kontrak lama berakhir diterima',
    !!sewa3 && sewa3.rentals && sewa3.rentals.inserted === 1, sewa3);

  const isiInvoices = (await ev(wc, `return (await window.electronAPI.dbLoad(['invoices'])).invoices.map(i => i.id);`)) || [];
  ok('7.9 invoice yang ditolak tidak pernah masuk file',
    isiInvoices.includes('O-INV1') && !isiInvoices.includes('O-INV2') && !isiInvoices.includes('O-INV3'), isiInvoices);
  const isiUnits = (await ev(wc, `return (await window.electronAPI.dbLoad(['units'])).units.map(u => u.id);`)) || [];
  ok('7.10 unit bernomor kembar tidak pernah masuk file', !isiUnits.includes('O-U-DUP'), isiUnits);
  const isiRentals = (await ev(wc, `return (await window.electronAPI.dbLoad(['rentals'])).rentals.map(r => r.id);`)) || [];
  ok('7.11 kontrak yang bentrok tidak masuk, kontrak berurutan masuk',
    !isiRentals.includes('O-R2') && isiRentals.includes('O-R1') && isiRentals.includes('O-R3'), isiRentals);

  const admin7b = await masuk('admin', 'admin123');
  const log7 = (await ev(wc, `return await window.electronAPI.auditLog(${JSON.stringify(admin7b.token)});`)) || {};
  const deny7 = (log7.entries || []).filter(e => e.event === 'DATA_DENY');
  ok('7.12 penolakan otomatisasi tercatat sebagai DATA_DENY yang menyebut dokumennya',
    deny7.some(e => /INV-UJI-1/.test(String(e.detail)))
      && deny7.some(e => /WO-UJI-O/.test(String(e.detail)))
      && deny7.some(e => /FATHONI-Otorisasi-1/.test(String(e.detail)))
      && deny7.some(e => /K-UJI-1/.test(String(e.detail))),
    deny7.slice(0, 4).map(e => e.detail));

  console.log(`\n=== otorisasi-check: ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

require('../../dist-electron/main.js');
