// tests/harness/crud-check.cjs
// BUKTI DARI KURSI PENGGUNA: tambah-edit-hapus-pencarian berjalan konsisten lewat
// tombol dan kotak cari yang sebenarnya, satu klik ganda tidak melahirkan dua
// record, dan record yang masih disebut menu lain tidak bisa dihapus lewat tombol.
//
// Kenapa lewat UI dan bukan lewat IPC: jalur tulis per IPC sudah diuji gui-check
// (#11/#13/#14/#16) dan handoff-check (§10). Yang tidak pernah diuji adalah
// halaman itu sendiri — apakah nilainya benar-benar sampai ke daftar, apakah
// pencarian menemukan baris yang baru diubah, dan apakah tombol bisa menekan
// dirinya dua kali.
//
// Harness ini memakai profil uji sendiri (HEMS_DATA_DIR wajib) dan tidak pernah
// menyentuh data pengguna nyata.
const { app, BrowserWindow } = require('electron');
const selesai = require('./selesai.cjs');
const fs = require('fs');

const DATA_DIR = process.env.HEMS_DATA_DIR;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else {
    fail++;
    console.log('FAIL ' + name + (extra !== undefined && extra !== null ? ' -> ' + JSON.stringify(extra) : ''));
  }
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
  const mulai = Date.now();
  while (Date.now() - mulai < timeoutMs) {
    if (await ev(wc, `return !!(${expr});`)) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

// confirm()/alert() asli membekukan renderer; dialognya distub dan alertnya
// dibaca sebagai bukti. Dipasang lagi setiap muatan halaman.
const STUB = `
  window.__alerts = [];
  window.confirm = () => true;
  window.alert = (m) => { window.__alerts.push(String(m)); };
  return true;`;

async function stub(wc) { await ev(wc, STUB); }

// Jejak tulis hanya boleh dinilai setelah tidak ada simpanan tertunda yang
// mengalir: autosave debounce-nya hidup di renderer, bukan di panggilan UI.
async function tulisTenang(wc) {
  let terakhir = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);
  for (let i = 0; i < 10; i++) {
    await wait(1200);
    const kini = await ev(wc, `return (await window.electronAPI.dbStats()).writes;`);
    if (kini.patchCalls === terakhir.patchCalls && kini.patchUpsertRows === terakhir.patchUpsertRows
      && kini.patchRemoveIds === terakhir.patchRemoveIds && kini.fullCalls === terakhir.fullCalls) return kini;
    terakhir = kini;
  }
  return terakhir;
}

const bacaCustomers = () => `(await window.electronAPI.dbLoad(['customers'])).customers`;

// ── Seed untuk sapuan pencarian lintas menu ──────────────────────────────────
// Dua baris per collection dengan token yang berbeda, supaya "hanya yang cocok
// yang tersisa" bisa dibuktikan — satu baris akan selalu tersisa apa pun.
const SEED = {
  units: [
    { id: 'CR-U1', serialNumber: 'CRUDUNIT-A1', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE', hourMeter: 100 },
    { id: 'CR-U2', serialNumber: 'CRUDUNIT-B2', brand: 'KOMA', model: 'PC200', status: 'AVAILABLE', hourMeter: 200 },
  ],
  warehouse: [
    { id: 'CR-W1', trxNo: 'CRUD-GUDANG-A1', type: 'INBOUND', warehouseName: 'Gudang Uji', itemDescription: 'Barang uji A', date: '2026-10-01', qty: 1 },
    { id: 'CR-W2', trxNo: 'CRUD-GUDANG-B2', type: 'INBOUND', warehouseName: 'Gudang Uji', itemDescription: 'Barang uji B', date: '2026-10-02', qty: 2 },
  ],
  spareParts: [
    { id: 'CR-P1', name: 'Part Uji A', sku: 'CRUD-PART-A1', stock: 1, minStock: 1, price: 100000, unit: 'pcs' },
    { id: 'CR-P2', name: 'Part Uji B', sku: 'CRUD-PART-B2', stock: 2, minStock: 1, price: 200000, unit: 'pcs' },
  ],
  invoices: [
    { id: 'CR-I1', invoiceNo: 'CRUD-INV-A1', customerName: 'PT Crud Uji', issueDate: '2026-10-01', dueDate: '2026-10-31', totalAmount: 1000000, paidAmount: 0, status: 'UNPAID', sourceType: 'SALES', sourceNumber: 'SO-CRUD-1' },
    { id: 'CR-I2', invoiceNo: 'CRUD-INV-B2', customerName: 'PT Crud Uji', issueDate: '2026-10-02', dueDate: '2026-11-01', totalAmount: 2000000, paidAmount: 0, status: 'UNPAID', sourceType: 'SERVICE', sourceNumber: 'WO-CRUD-2' },
  ],
  kas: [
    { id: 'CR-K1', tanggal: '2026-10-01', kategori: 'Penjualan', tipe: 'MASUK', jumlah: 1000000, rekening: 'BCA', referensi: 'CRUD-KAS-A1' },
    { id: 'CR-K2', tanggal: '2026-10-02', kategori: 'Servis', tipe: 'KELUAR', jumlah: 200000, rekening: 'Mandiri', referensi: 'CRUD-KAS-B2' },
  ],
};

const SAPU = [
  ['#/units', '#units-search', 'CRUDUNIT-A1', 'CRUDUNIT-B2', 'Armada'],
  ['#/warehouse', '#warehouse-search', 'CRUD-GUDANG-A1', 'CRUD-GUDANG-B2', 'Gudang'],
  ['#/spareparts', '#spareparts-search', 'CRUD-PART-A1', 'CRUD-PART-B2', 'Suku Cadang'],
  ['#/invoices', '#invoice-search', 'CRUD-INV-A1', 'CRUD-INV-B2', 'Faktur'],
  ['#/finance', '#finance-search', 'CRUD-KAS-A1', 'CRUD-KAS-B2', 'Kas & Bank'],
];

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev2, _lvl, msg) => {
    if (/error|uncaught|failed/i.test(msg)) console.log('RENDERER:', msg.slice(0, 300));
  });
  wc.on('did-finish-load', () => { stub(wc).catch(() => {}); });
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    wc.once('did-finish-load', () => run(wc).catch(async err => {
      console.log('HARNESS ERROR', err && (err.stack || err.message));
      try { console.log('DOM:', JSON.stringify((await ev(wc, 'return document.body.innerText.slice(0,300);')))); } catch { /* abaikan */ }
      selesai(app, 2);
    }));
  }
});

/** Isi form modal Pelanggan berdasarkan teks labelnya. */
async function isiForm(wc, values) {
  return ev(wc, `
    const peta = ${JSON.stringify(values)};
    const kelompok = [...document.querySelectorAll('.modal .form-group')];
    const hasil = {};
    for (const [label, nilai] of Object.entries(peta)) {
      const g = kelompok.find(x => (((x.querySelector('.form-label') || {}).innerText) || '').toLowerCase().includes(label.toLowerCase()));
      if (!g) { hasil[label] = 'tidak-ada'; continue; }
      const input = g.querySelector('input, textarea, select');
      if (!input) { hasil[label] = 'tanpa-input'; continue; }
      setVal(input, nilai);
      hasil[label] = 'ok';
    }
    return hasil;`);
}

const jumlahBarisDaftar = () => `
  return [...document.querySelectorAll('tbody tr')]
    .map(t => t.innerText).filter(t => !/Tidak ada data/.test(t)).length;`;

async function run(wc) {
  if (!DATA_DIR || !fs.existsSync(DATA_DIR)) {
    console.log('HARNESS ERROR: HEMS_DATA_DIR wajib pointing ke folder sementara yang ada');
    selesai(app, 3);
    return;
  }
  await wait(500);
  const win = BrowserWindow.fromWebContents(wc);
  if (win) win.setSize(1366, 800);
  await stub(wc);

  // ── 1. login lewat UI, seperti pengguna ──
  await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    localStorage.removeItem('hems_session');
    return true;`);
  await wc.reload();
  ok('1.1 layar login muncul', await waitFor(wc, `!!document.querySelector('#login-username')`, 'form login', 40000));
  await stub(wc);
  await ev(wc, `
    setVal(document.querySelector('#login-username'), 'admin');
    setVal(document.querySelector('#login-password'), 'admin123');
    const b = byText(/Masuk ke FATHONI/); if (b) b.click(); return !!b;`);
  await waitFor(wc, `/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'layar ganti password', 45000);
  await ev(wc, `
    setVal(document.querySelector('#cpw-current'), 'admin123');
    setVal(document.querySelector('#cpw-next'), 'BaruCud123');
    setVal(document.querySelector('#cpw-confirm'), 'BaruCud123');
    const b = byText(/Simpan password baru/); if (b) b.click(); return !!b;`);
  ok('1.2 aplikasi terbuka', await waitFor(wc,
    `/Dasbor|Armada|Kontrol/i.test(document.body.innerText) && !/Ganti password sebelum melanjutkan/.test(document.body.innerText)`,
    'shell setelah login', 45000));

  // ── 2. TANBAH lewat form ──
  await ev(wc, `window.location.hash = '#/customers'; return true;`);
  ok('2.0 halaman Pelanggan terbuka', await waitFor(wc, `/Kelola data pelanggan/.test(document.body.innerText)`, '/customers'));
  await ev(wc, `document.querySelector('#btn-add-customer').click(); return true;`);
  ok('2.1 form tambah terbuka', await waitFor(wc, `/Tambah Pelanggan Baru/.test(document.body.innerText)`, 'modal tambah'));
  const diisi = await isiForm(wc, {
    'Nama Perusahaan': 'PT Crud Satu',
    'PIC': 'Budi Crud',
    'Telepon': '0811-CRUD-01',
    'Email': 'satu@crud.test',
    'Alamat': 'Cikande',
  });
  ok('2.2 semua field form terisi lewat labelnya',
    Object.values(diisi).every(v => v === 'ok'), diisi);
  await ev(wc, `const b = byText(/^Simpan$/, 'button'); if (b) b.click(); return !!b;`);
  ok('2.3 record baru tampil di daftar', await waitFor(wc,
    `document.body.innerText.includes('PT Crud Satu')`, 'PT Crud Satu di daftar', 20000));
  await tulisTenang(wc);
  const setelahTambah = await ev(wc, `return (${bacaCustomers()}).map(c => c.id);`);
  ok('2.4 daftar di layar sama dengan isi file', setelahTambah.length === 1, { diFile: setelahTambah });
  const barisFile = await ev(wc, `return (${bacaCustomers()})[0] || {};`);
  ok('2.5 nilai yang diketik sampai ke file apa adanya',
    barisFile.name === 'PT Crud Satu' && barisFile.phone === '0811-CRUD-01' && barisFile.pic === 'Budi Crud',
    barisFile);

  // ── 3. klik Simpan dua kali cepat tidak melahirkan dua record ──
  // Diuji sebagai dua event terpisah dengan jeda nyata, persis menekan mouse
  // dua kali: satu event yang dipanggil dua kali dari skrip bukan perilaku
  // pengguna dan tidak lewat jalur DOM yang sama.
  await ev(wc, `document.querySelector('#btn-add-customer').click(); return true;`);
  await waitFor(wc, `/Tambah Pelanggan Baru/.test(document.body.innerText)`, 'modal tambah kedua');
  await isiForm(wc, { 'Nama Perusahaan': 'PT Crud Dua', 'PIC': 'Sri Crud' });
  const klikPertama = await ev(wc, `
    const b = byText(/^Simpan$/, 'button');
    if (!b) return 'tanpa-tombol';
    b.click();
    return 'klik-pertama';`);
  await wait(60);
  const klikKedua = await ev(wc, `
    const b = byText(/^Simpan$/, 'button');
    if (!b) return 'form-sudah-tertutup';
    b.click();
    return 'klik-kedua';`);
  await wait(400);
  const barisTampil = await ev(wc, jumlahBarisDaftar());
  await tulisTenang(wc);
  const idFile = await ev(wc, `return (${bacaCustomers()}).map(c => String(c.id));`);
  // Kalau form masih terbuka setelah simpan (mis. simpanan await lebih dulu),
  // klik kedua ADD record lagi — itu duplikasi yang dicari checklist.
  ok('3.1 dua klik cepat hanya mengirim satu record ke file',
    klikPertama === 'klik-pertama' && idFile.length === 2, { klikPertama, klikKedua, idFile });
  // Daftar bisa menampakkan dua baris walau file hanya menyimpan satunya — itu
  // tetap kehilangan data bagi pengguna yang melihat dua "PT Crud Dua" lalu
  // menghapus salah satunya.
  ok('3.2 daftar juga tidak menampilkan baris ganda', barisTampil === 2, { klikKedua, barisTampil, idFile });
  const idGanda = await ev(wc, `
    const s = await window.electronAPI.dbLoad(['customers']);
    const id = s.customers.map(c => String(c.id));
    return id.length - new Set(id).size;`);
  ok('3.3 tidak ada id ganda di file', idGanda === 0, { idGanda });
  console.log(`   bukti 3: klik kedua -> ${klikKedua}, baris di file -> ${idFile.length}, baris di daftar -> ${barisTampil}`);

  // ── 4. EDIT lewat form, lalu pencarian harus menemukan nilai barunya ──
  const barisEdit = await ev(wc, `
    const tr = [...document.querySelectorAll('tbody tr')].find(t => t.innerText.includes('PT Crud Satu'));
    if (!tr) return 'tidak-ada';
    const b = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === 'Edit');
    if (!b) return 'tanpa-tombol-edit';
    b.click(); return 'ok';`);
  ok('4.1 tombol Edit pada baris membuka form berisi datanya', barisEdit === 'ok'
    && await waitFor(wc, `/Edit Pelanggan/.test(document.body.innerText)`, 'modal edit'), barisEdit);
  await isiForm(wc, { 'Telepon': '0811-CRUD-BARU', 'Kota': '' });
  await ev(wc, `const b = byText(/^Simpan$/, 'button'); if (b) b.click(); return !!b;`);
  ok('4.2 nilai hasil edit tampil di daftar', await waitFor(wc,
    `document.body.innerText.includes('0811-CRUD-BARU')`, 'telepon baru tampil', 20000));
  await tulisTenang(wc);
  const fileEdit = await ev(wc, `
    const s = await window.electronAPI.dbLoad(['customers']);
    return (s.customers.find(c => c.name === 'PT Crud Satu') || {}).phone;`);
  ok('4.3 file ikut berubah, bukan hanya layarnya', fileEdit === '0811-CRUD-BARU', fileEdit);

  // ── 5. pencarian pada menu ini ──
  // Kotak cari halaman harus punya id sendiri: Layout juga memasang satu
  // .topbar-search di bilah atas, jadi selector kelas akan mengetik ke pencarian
  // global dan daftar di bawahnya tidak pernah tersaring.
  const beda = await ev(wc, `
    const halaman = document.querySelector('#customer-search');
    const kelas = document.querySelector('.topbar-search input');
    return !!halaman && halaman !== kelas && halaman.placeholder.includes('pelanggan');`);
  ok('5.0 kotak cari halaman Pelanggan bukan kotak cari bilah atas', beda === true, { beda });
  const adaInputCari = await ev(wc, `
    const i = document.querySelector('#customer-search');
    if (!i) return 'tanpa-input';
    setVal(i, 'CRUD-BARU');
    return 'ok';`);
  ok('5.1 kata kunci menemukan baris yang baru diedit', adaInputCari === 'ok'
    && await waitFor(wc, `document.body.innerText.includes('PT Crud Satu')`, 'hasil cari cocok'), adaInputCari);
  const hanyaSatu = await ev(wc, `return [...document.querySelectorAll('tbody tr')]
      .map(t => t.innerText).filter(t => !/Tidak ada data/.test(t));`);
  ok('5.2 baris yang tidak cocok tersaring keluar', hanyaSatu.length === 1
    && hanyaSatu[0].includes('PT Crud Satu') && !hanyaSatu[0].includes('PT Crud Dua'), hanyaSatu);
  await ev(wc, `setVal(document.querySelector('#customer-search'), 'zzz-tidak-ada'); return true;`);
  ok('5.3 kata kunci asing menampilkan keadaan kosong, bukan error', await waitFor(wc,
    `/Tidak ada data pelanggan/.test(document.body.innerText)`, 'keadaan kosong'));
  await ev(wc, `setVal(document.querySelector('#customer-search'), ''); return true;`);
  const kembali = await ev(wc, jumlahBarisDaftar());
  ok('5.4 pencarian dikosongkan, seluruh daftar kembali', kembali === 2, { kembali });

  // ── 6. HAPUS lewat tombol ──
  const hapus1 = await ev(wc, `
    const tr = [...document.querySelectorAll('tbody tr')].find(t => t.innerText.includes('PT Crud Dua'));
    if (!tr) return 'tidak-ada';
    const b = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === 'Hapus');
    if (!b) return 'tanpa-tombol-hapus';
    b.click(); return 'ok';`);
  ok('6.1 tombol Hapus menghapus barisnya', hapus1 === 'ok' && await waitFor(wc,
    `!document.body.innerText.includes('PT Crud Dua')`, 'baris hilang dari daftar', 20000), hapus1);
  await tulisTenang(wc);
  const fileSetelahHapus = await ev(wc, `return (${bacaCustomers()}).map(c => c.name);`);
  ok('6.2 hapus sampai ke file, bukan hanya layar', fileSetelahHapus.length === 1
    && fileSetelahHapus[0] === 'PT Crud Satu', fileSetelahHapus);

  // ── 7. record yang masih disebut menu lain ditahan dari kursi pengguna ──
  const tanam = await ev(wc, `
    return await window.electronAPI.dbPatch({ sales: { upsert: [{
      id: 'CR-SO1', orderNo: 'SO-CRUD-1', customerName: 'PT Crud Satu',
      orderDate: '2026-10-05', totalPrice: 5000000, status: 'PENDING'
    }], removeIds: [] } });`);
  ok('7.1 penahan rujukan ditanam lewat jalur tulis', tanam && tanam.sales && tanam.sales.inserted === 1, tanam);
  await ev(wc, `window.__alerts = []; return true;`);
  const hapus2 = await ev(wc, `
    const tr = [...document.querySelectorAll('tbody tr')].find(t => t.innerText.includes('PT Crud Satu'));
    if (!tr) return 'tidak-ada';
    const b = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === 'Hapus');
    b.click(); return 'ok';`);
  await waitFor(wc, `window.__alerts.length > 0`, 'alert alasan hapus ditolak', 20000);
  const alert = await ev(wc, `return (window.__alerts || [])[0] || '';`);
  ok('7.2 hapus ditolak dan alasannya menyebut dokumen penahannya', hapus2 === 'ok'
    && /masih dipakai|merujuk|belum bisa dihapus/i.test(alert) && /Penjualan|sales/i.test(alert), alert.slice(0, 220));
  await tulisTenang(wc);
  const masihAda = await ev(wc, `return (${bacaCustomers()}).map(c => c.name);`);
  ok('7.3 penolakan tidak menghapus apa pun', masihAda.length === 1 && masihAda[0] === 'PT Crud Satu', masihAda);

  // ── 8. pencarian per menu lain, pada dataset yang sama sekali baru ──
  const seedHasil = await ev(wc, `
    const patch = {};
    for (const [k, rows] of Object.entries(${JSON.stringify(SEED)})) patch[k] = { upsert: rows, removeIds: [] };
    return await window.electronAPI.dbPatch(patch);`);
  ok('8.0 dua baris uji per collection masuk ke file',
    Object.keys(SEED).every(k => seedHasil[k] && seedHasil[k].inserted === 2),
    Object.fromEntries(Object.entries(seedHasil).map(([k, v]) => [k, v && v.inserted])));
  await wc.reload();
  await stub(wc);
  ok('8.0b aplikasi dibuka ulang agar daftar dibaca dari file', await waitFor(wc,
    `/Dasbor|Armada|Kontrol/i.test(document.body.innerText)`, 'shell setelah reload', 45000));

  for (const [hash, input, ada, hilang, nama] of SAPU) {
    await ev(wc, `window.location.hash = ${JSON.stringify(hash)}; return true;`);
    const siap = await waitFor(wc, `document.body.innerText.includes(${JSON.stringify(ada)})`
      + ` && document.body.innerText.includes(${JSON.stringify(hilang)})`, `${nama}: kedua baris uji tampil`, 30000);
    const ketik = await ev(wc, `
      const i = document.querySelector(${JSON.stringify(input)});
      if (!i) return 'tanpa-input';
      setVal(i, ${JSON.stringify(ada)});
      return 'ok';`);
    const tersaring = await waitFor(wc, `document.body.innerText.includes(${JSON.stringify(ada)})`
      + ` && !document.body.innerText.includes(${JSON.stringify(hilang)})`,
      `${nama}: hanya baris yang cocok yang tersisa`, 25000);
    ok(`8.${nama}: kotak carinya menyaring baris, tidak hanya menampilkan semuanya`,
      siap && ketik === 'ok' && tersaring, { nama, siap, ketik, tersaring });
    await ev(wc, `setVal(document.querySelector(${JSON.stringify(input)}), ''); return true;`);
    await wait(700);
  }

  // ── 9. bersih-bersih ──
  const bersih = await ev(wc, `
    const hapus = [];
    for (const k of Object.keys(${JSON.stringify(SEED)})) {
      const s = await window.electronAPI.dbLoad([k]);
      hapus.push([k, { upsert: [], removeIds: (s[k] || []).map(r => String(r.id)) }]);
    }
    const s = await window.electronAPI.dbLoad(['customers', 'sales']);
    hapus.push(['customers', { upsert: [], removeIds: s.customers.map(r => String(r.id)) }]);
    hapus.push(['sales', { upsert: [], removeIds: s.sales.map(r => String(r.id)) }]);
    const r = await window.electronAPI.dbPatch(Object.fromEntries(hapus));
    const sesudah = await window.electronAPI.dbStats();
    return { total: sesudah.totalRows, r };`);
  ok('9.1 jejak uji dibersihkan lewat jalur yang sama', bersih.total === 0, bersih);

  console.log(`\n=== crud-check: ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

require('../../dist-electron/main.js');
