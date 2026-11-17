// tests/harness/usable-check.cjs
// Baris matriks Fase 6 "Usability": bukti terukur bahwa layar utama masih muat di
// lebar jendela yang DIJANJIKAN aplikasi (minWidth 1200) dan di layar terkecil
// yang jadi target pengguna (1366x768).
//
// Kenapa harness ini ada, bukan hanya dibaca CSS-nya: `.table-wrapper` memakai
// `overflow: hidden` (src/index.css), sehingga tabel yang lebih lebar dari
// jendelanya TERPOTONG — kontennya tidak hilang, tapi juga tidak bisa digulir
// untuk dilihat. Mana yang benar-benar terpotong hanya terlihat kalau jendela
// sungguhan dibuka dan tiap rute dilewati.
//
// Cara menjalankan (profil sementara, satu harness Electron pada satu waktu):
//   HEMS_DATA_DIR=D:/SANY/tmp-harness/r-usable node_modules/electron/dist/electron.exe tests/harness/usable-check.cjs

const { app, BrowserWindow } = require('electron');
const selesai = require('./selesai.cjs');
const path = require('path');

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
  function byText(re, tag) {
    return [...document.querySelectorAll(tag || 'button')].find(x => re.test((x.innerText || '').trim()));
  }
  // Semua wadah yang memotong isinya sendiri DAN memuat tabel: di situlah kolom
  // yang hilang berarti dokumen pengguna tidak bisa dibaca, bukan sekadar teks
  // pendek yang memang diberi elipsis.
  function potong() {
    const keluar = [];
    for (const el of document.querySelectorAll('div,section,main')) {
      const s = getComputedStyle(el);
      if (s.overflowX !== 'hidden' && s.overflowX !== 'clip') continue;
      if (!el.querySelector('th')) continue;
      const hilang = el.scrollWidth - el.clientWidth;
      if (hilang > 2 && el.clientWidth > 0) {
        keluar.push({ tag: el.tagName, kelas: String(el.className || '').slice(0, 34), lebar: el.clientWidth, hilang });
      }
    }
    keluar.sort((a, b) => b.hilang - a.hilang);
    return keluar.slice(0, 3);
  }
  // Vertikal: body di-clamp dengan overflow:hidden dan halaman punya
  // .page-container sendiri yang seharusnya menggulir. Kalau masih ada wadah
  // overflow-y:hidden yang kehilangan tinggi, bagian bawah layarnya tidak bisa
  // dibuka sama sekali — itu temuan, bukan sekadar tampilan jelek.
  function potongTinggi() {
    const keluar = [];
    for (const el of document.querySelectorAll('body,div,section,main')) {
      const s = getComputedStyle(el);
      const terpotong = el.scrollHeight - el.clientHeight;
      if (terpotong <= 4 || el.clientHeight <= 120) continue;
      const adaJalurSkroll = s.overflowY === 'auto' || s.overflowY === 'scroll';
      if (adaJalurSkroll) continue;
      if (s.overflowY !== 'hidden' && s.overflowY !== 'clip') continue;
      keluar.push({ tag: el.tagName, kelas: String(el.className || '').slice(0, 30), tinggi: el.clientHeight, hilang: terpotong });
    }
    keluar.sort((a, b) => b.hilang - a.hilang);
    return keluar.slice(0, 3);
  }
  function ukur() {
    const de = document.documentElement;
    const tabel = [...document.querySelectorAll('table')].map(t => t.scrollWidth);
    // Wadah tabel yang memang butuh gulir horizontal dan menyediakannya.
    const gulir = [...document.querySelectorAll('div,section,main')].filter(el => {
      const s = getComputedStyle(el);
      return el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && el.querySelector('th')
        && (s.overflowX === 'auto' || s.overflowX === 'scroll');
    }).length;
    const hilang = [...document.querySelectorAll('div,section,main')]
      .filter(el => el.clientWidth > 0 && el.querySelector('th'))
      .map(el => el.scrollWidth - el.clientWidth)
      .reduce((a, b) => Math.max(a, b), 0);
    const skroll = [...document.querySelectorAll('div,section,main')].filter(el => {
      const s = getComputedStyle(el);
      return el.clientHeight > 200 && el.scrollHeight > el.clientHeight + 4 && (s.overflowY === 'auto' || s.overflowY === 'scroll');
    }).map(el => String(el.className || el.tagName).slice(0, 26));
    return {
      client: de.clientWidth,
      scroll: de.scrollWidth,
      clientT: de.clientHeight,
      scrollT: de.scrollHeight,
      jalurSkroll: skroll,
      tabelTerlebar: tabel.length ? Math.max(...tabel) : 0,
      gulirTabel: gulir,
      hilangTabel: hilang,
      barisTabel: document.querySelectorAll('tbody tr').length,
      potong: potong(),
      potongTinggi: potongTinggi(),
    };
  }
`;

function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`);
}

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    wc.once('did-finish-load', () => run(wc).catch(err => bail(wc, err)));
  }
});
app.on('window-all-closed', () => { /* biarkan harness memutuskan */ });

async function bail(wc, err) {
  console.log('HARNESS ERROR', err && err.message);
  try { console.log('DOM:', JSON.stringify((await ev(wc, 'return document.body.innerText.slice(0,300);')))); } catch { /* abaikan */ }
  selesai(app, 2);
}

// Isi uji: nama panjang dan nomor dokumen nyata, karena lebar kolom yang
// bermasalah hanya muncul kalau isinya sepanjang data kantor sungguhan.
const PANJANG = 'PT Konstruksi Cikande Putra Mandiri Sejahtera Abadi';
const SEED = {
  units: [
    { id: 'US-U1', serialNumber: 'SDPE219RPLK0001234', brand: 'SANY', model: 'SY215C-9K', status: 'IN_SERVICE', hourMeter: 4210, purchasePrice: 1_500_000_000 },
    { id: 'US-U2', serialNumber: 'PC2008KPM0099877', brand: 'KOMATSU', model: 'PC200-8 SEI', status: 'AVAILABLE', hourMeter: 8120, purchasePrice: 1_850_000_000 },
  ],
  customers: [{ id: 'US-C1', name: PANJANG, segment: 'KONTRAKTOR', contactPerson: 'Bpk. Suryadi Wijaya', phone: '0812-3456-7890', email: 'suryadi@konstruksi-cikande-mandiri.co.id', address: 'Jl. Industri Raya Blok C-17 No. 8, Cikande, Serang, Banten' }],
  suppliers: [{ id: 'US-S1', name: 'PT Pemasok Suku Cadang Nusantara Sentosa', contact: 'Ibu Ratna Dewi', phone: '021-555-1234', email: 'ratna@nusantarasantosa.co.id', npwp: '01.234.567.8-901.200' }],
  spareParts: [{ id: 'US-P1', name: 'Filter Oli HYUNDAI Hi-Max 250 Jam Servis', sku: 'FO-HY-250JS-XL', stock: 4, minStock: 6, price: 385_000, unit: 'pcs' }],
  sales: [{ id: 'US-SO1', orderNo: 'SO/CIKANDE/2026-09-014', customerName: PANJANG, unitModel: 'SANY SY215C-9K', serialNumber: 'SDPE219RPLK0001234', orderDate: '2026-09-14', totalPrice: 1_750_000_000, downPayment: 350_000_000, paymentScheme: 'LEASING', status: 'CONFIRMED', salesPerson: 'Budi Hartono' }],
  rentals: [{ id: 'US-RT1', contractNo: 'RCT-2026-000078', customerName: PANJANG, unitModel: 'KOMATSU PC200-8 SEI', serialNumber: 'PC2008KPM0099877', startDate: '2026-08-01', endDate: '2026-11-30', monthlyPrice: 55_000_000, status: 'ACTIVE', site: 'Proyek Tol Cisumdawu Seksi 4' }],
  purchases: [{ id: 'US-PO1', poNumber: 'PO/SPAREPART/2026-000321', supplierName: 'PT Pemasok Suku Cadang Nusantara Sentosa', itemName: '12 Filter Oli HYUNDAI Hi-Max 250 Jam Servis', category: 'SPAREPART', orderDate: '2026-09-01', totalAmount: 4_620_000, status: 'RECEIVED', notes: 'Pengadaan bulanan untuk servis rutin' }],
  services: [{ id: 'US-WO1', woNumber: 'WO/SERVICE/2026-000912', unitModel: 'SANY SY215C-9K', serialNumber: 'SDPE219RPLK0001234', customerOrProject: PANJANG, serviceType: 'PERIODIC_500H', mechanicName: 'Agus Supriyatno', openDate: '2026-10-02', estimatedCost: 8_500_000, status: 'IN_PROGRESS', complaintNotes: 'Getaran di boom saat swing kiri' }],
  invoices: [{ id: 'US-INV1', invoiceNo: 'INV/SO/CIKANDE/2026-09-014', customerName: PANJANG, issueDate: '2026-09-20', dueDate: '2026-10-20', totalAmount: 1_750_000_000, paidAmount: 350_000_000, status: 'PARTIAL', sourceType: 'SALES', sourceNumber: 'SO/CIKANDE/2026-09-014' }],
  warehouse: [{ id: 'US-GI1', trxNo: 'GI-WO/SERVICE/2026-000912', type: 'OUTBOUND', warehouseName: 'Gudang Pusat Cikande', itemDescription: '12 Filter Oli HYUNDAI Hi-Max 250 Jam Servis (FO-HY-250JS-XL)', date: '2026-10-03', qty: 12 }],
  kas: [{ id: 'US-K1', tanggal: '2026-09-20', kategori: 'PEMASUKAN', tipe: 'MASUK', jumlah: 350_000_000, rekening: 'BCA - 1234567890', referensi: 'SO/CIKANDE/2026-09-014' }],
  bankAccounts: [{ id: 'US-B1', namaBank: 'Bank Central Asia (BCA) Cabang Cikande', nomorRekening: '1234567890', namaPemilik: PANJANG, cabang: 'Cikande', mataUang: 'IDR', isActive: true }],
  deliveries: [{ id: 'US-DO1', doNumber: 'DO/CIKANDE/2026-09-014-A', salesOrderRef: 'SO/CIKANDE/2026-09-014', customerName: PANJANG, unitModel: 'SANY SY215C-9K', serialNumber: 'SDPE219RPLK0001234', deliveryDate: '2026-09-25', destination: 'Proyek Tol Cisumdawu Seksi 4, Sumedang', driverName: 'Sutarjo Wibowo', truckPlate: 'B 9214 KXA', status: 'DALAM_PERJALANAN' }],
  documents: [{ id: 'US-DOC1', jenisDokumen: 'SIA (Surat Izin Alat)', nomorDokumen: 'SIA/DJ-III/001234/2026', masaBerlaku: '2027-03-31', statusLegalitas: 'AKTIF', fileName: 'sia-sdpe219rplk0001234.pdf', keterangan: 'Perpanjangan SIA unit SANY SY215C-9K atas nama PT Konstruksi Cikande Putra Mandiri' }],
  breakdowns: [{ id: 'US-BD1', breakdownNumber: 'BD-2026-000117', unitSerialNumber: 'SDPE219RPLK0001234', unitModel: 'SANY SY215C-9K', location: 'Pekerjaan Sta. 12+400, Tol Cisumdawu Seksi 4', reportedBy: 'Agus Supriyatno', reportedAt: '2026-10-05', severity: 'MAJOR', status: 'REPAIRING', description: 'Kebocoran oli pada silinder boom kanan, tekanan swing turun drastis', assignedTechnician: 'Bambang Riyadi', estimatedRepairCost: 42_500_000, downtimeHours: 26 }],
  operators: [{ id: 'US-OP1', operatorNumber: 'OP-2026-000104', name: 'Sutarjo Wibowo', phone: '0813-2233-4455', nik: '3671012398000012', status: 'ACTIVE', certifications: [{ name: 'SIO Kelas II', issueDate: '2024-05-10', expiryDate: '2027-05-10' }], assignedUnit: 'SDPE219RPLK0001234', assignedProject: 'Proyek Tol Cisumdawu Seksi 4', totalHours: 3180, startDate: '2023-02-01', licenseNumber: 'SIO-KII/0041234/2024', licenseExpiry: '2027-05-10' }],
  technicians: [{ id: 'US-TC1', technicianNumber: 'TECH-2026-000061', name: 'Bambang Riyadi', phone: '0812-9988-7766', status: 'ACTIVE', specializations: ['Hidrolik', 'Engine Overhaul'], certifications: [{ name: 'Hydraulic System Specialist', issueDate: '2023-07-01', expiryDate: '2026-07-01' }], totalWorkOrders: 214, totalHours: 5230, startDate: '2021-08-16', skills: ['SANY SY215C-9K', 'Komatsu PC200-8'] }],
  approvals: [{ id: 'US-AP1', requestNumber: 'APR-2026-000088', type: 'MAINTENANCE_REQUEST', title: 'Perbaikan silinder boom kanan SANY SY215C-9K', description: 'Estimasi 42,5 juta termasuk seal kit asli', requestedBy: 'Agus Supriyatno', requestedAt: '2026-10-06', amount: 42_500_000, status: 'PENDING', approverLevel: 1, currentApprover: 'admin' }],
};

const RUTE = [
  ['/', 'Dashboard', null],
  ['#/units', 'Armada', 'SDPE219RPLK0001234'],
  ['#/customers', 'Pelanggan', 'Cikande Putra Mandiri'],
  ['#/suppliers', 'Pemasok', 'Nusantara Sentosa'],
  ['#/sales', 'Penjualan', 'SO/CIKANDE/2026-09-014'],
  ['#/purchase', 'Pembelian', 'PO/SPAREPART/2026-000321'],
  ['#/rental', 'Rental', 'RCT-2026-000078'],
  ['#/invoices', 'Invoice', 'INV/SO/CIKANDE'],
  ['#/warehouse', 'Gudang', 'GI-WO/SERVICE'],
  ['#/spareparts', 'Suku Cadang', 'FO-HY-250JS-XL'],
  ['#/service', 'Servis', 'WO/SERVICE/2026-000912'],
  ['#/finance', 'Keuangan', '350.000.000'],
  ['#/reports', 'Laporan', null],
  ['#/users', 'Pengguna', 'admin'],
  ['#/settings', 'Pengaturan', null],
  ['#/backup', 'Backup', null],
  // Sembilan rute terakhir ini sebelumnya tidak pernah dibuka lewat UI di harness
  // mana pun, sehingga klaim "semua layar muat di 1200px" hanya menutup 16 dari
  // 25 menu. audit-log memakai jejak nyata dari main process (login + ganti
  // password harness ini), makanya ada teks uji.
  ['#/delivery', 'Pengiriman', 'DO/CIKANDE/2026-09-014-A'],
  ['#/breakdown', 'Breakdown', 'BD-2026-000117'],
  ['#/documents', 'Dokumen Legal', 'SIA/DJ-III/001234/2026'],
  ['#/operators', 'Operator', 'OP-2026-000104'],
  ['#/technicians', 'Teknisi', 'TECH-2026-000061'],
  ['#/approvals', 'Persetujuan', 'APR-2026-000088'],
  ['#/audit-log', 'Jejak Audit', 'Password diganti'],
  ['#/maintenance', 'Perawatan Sistem', null],
  ['#/brands', 'Merek & Model', null],
];

async function run(wc) {
  await wait(500);
  const win = BrowserWindow.fromWebContents(wc);
  ok('0.1 jendela aplikasi tersedia untuk diubah ukurannya', !!win, !!win);

  // ── 1. login sungguhan lewat UI (lalu gate ganti password) ──
  ok('1.1 layar login muncul',
    await waitFor(wc, `!!document.querySelector('#login-username')`, 'form login', 40000));
  await ev(wc, `
    setVal(document.querySelector('#login-username'), 'admin');
    setVal(document.querySelector('#login-password'), 'admin123');
    const b = byText(/Masuk ke FATHONI/); if (b) b.click(); return !!b;`);
  await waitFor(wc, `/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'gate', 45000);
  await ev(wc, `
    setVal(document.querySelector('#cpw-current'), 'admin123');
    setVal(document.querySelector('#cpw-next'), 'BaruUsab123');
    setVal(document.querySelector('#cpw-confirm'), 'BaruUsab123');
    const b = byText(/Simpan password baru/); if (b) b.click(); return !!b;`);
  ok('1.2 aplikasi terbuka setelah ganti password',
    await waitFor(wc, `/Dasbor|Armada|Kontrol/i.test(document.body.innerText) && !/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'dashboard', 45000));

  // ── 2. isi database SEBELUM penjelajahan, lalu boot ulang ──
  // Hidrasi per menu (#38) membaca SQLite saat collection pertama kali diminta.
  // Dashboard membuka banyak collection sekaligus, jadi menulisi database setelah
  // boot tanpa memuat ulang akan diukur pada halaman KOSONG — dan halaman kosong
  // tidak pernah melebar. Karena itu: tulis dulu, reload, baru ukur.
  const seed = await ev(wc, `
    const patch = {};
    for (const [k, rows] of Object.entries(${JSON.stringify(SEED)})) patch[k] = { upsert: rows, removeIds: [] };
    const r = await window.electronAPI.dbPatch(patch);
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    return { unit: r && r.units && r.units.inserted, invoice: r && r.invoices && r.invoices.inserted };`);
  ok('2.1 data uji tertulis lewat jalur patch', seed.unit === 2 && seed.invoice === 1, seed);
  await wc.reload();
  ok('2.2 aplikasi boot ulang dengan data uji',
    await waitFor(wc, `/Dasbor|Armada|Kontrol/i.test(document.body.innerText)`, 'shell setelah reload', 45000));

  // ── 3. lewati tiap rute pada lebar yang dijanjikan (1200 = minWidth) ──
  const hasil = [];
  for (const [hash, nama, isi] of RUTE) {
    win.setSize(1200, 760);
    await wait(60);
    await ev(wc, `window.location.hash = '${hash}'; return true;`);
    if (isi) {
      await waitFor(wc, `document.body.innerText.includes(${JSON.stringify(isi)})`, `${nama} terisi data uji`, 25000);
    } else {
      await wait(700);
    }
    const u = await ev(wc, `return ukur();`);
    const teks = await ev(wc, `return document.body.innerText.includes(${JSON.stringify(isi || '')});`);
    hasil.push({ nama, ...u });
    console.log(`INFO ${nama} @1200: client=${u.client} scroll=${u.scroll} baris=${u.barisTabel} tabelTerlebar=${u.tabelTerlebar} potong=${JSON.stringify(u.potong)}`);
    // Bukan jumlah baris tabel: Armada, Rental dan Servis menampilkan kartunya
    // sendiri, bukan <table>. Yang diukur di sini hanyalah bahwa halaman itu tidak
    // kosong — halaman kosong selalu muat di lebar apa pun dan membuat uji ini
    // lulus tanpa menguji apa pun.
    if (isi) ok(`isi ${nama}: data uji terlihat sehingga pengukurannya berarti`, teks === true, { nama, baris: u.barisTabel });
  }
  const memotong = hasil.filter(h => h.potong.length > 0);
  const noScrollLebar = hasil.filter(h => h.scroll > h.client + 2);
  ok('3.1 tidak ada halaman yang membuat seluruh dokumen bergulir horizontal di 1200px',
    noScrollLebar.length === 0, noScrollLebar.map(h => [h.nama, h.client, h.scroll]));
  ok('3.2 tidak ada wadah tabel yang memotong kolomnya sendiri di 1200px',
    memotong.length === 0, memotong.map(h => [h.nama, h.potong]));

  // ── 4. layar target pengguna: 1366x768 ──
  const luas = [];
  for (const [hash, nama] of RUTE) {
    win.setSize(1366, 768);
    await wait(60);
    await ev(wc, `window.location.hash = '${hash}'; return true;`);
    await wait(500);
    const u = await ev(wc, `return ukur();`);
    luas.push({ nama, ...u });
  }
  ok('4.1 semua rute muat tanpa gulir horizontal di 1366x768',
    luas.filter(h => h.scroll > h.client + 2).length === 0, luas.filter(h => h.scroll > h.client + 2).map(h => [h.nama, h.scroll]));
  ok('4.2 tidak ada tabel terpotong di 1366x768',
    luas.filter(h => h.potong.length > 0).length === 0, luas.filter(h => h.potong.length > 0).map(h => [h.nama, h.potong]));

  // ── 5. di bawah yang dijanjikan: 1024 ──
  // Jendela tidak bisa diseret sampai sejauh ini (minWidth), jadi ukuran ini
  // diukur dengan melonggarkan batasnya dari harness. Tujuannya satu angka:
  // seberapa jauh aplikasi masih bisa dipakai kalau batas bawahnya diturunkan.
  win.setMinimumSize(800, 600);
  win.setSize(1024, 768);
  await wait(120);
  const sempit = [];
  for (const [hash, nama] of RUTE.slice(0, 8)) {
    await ev(wc, `window.location.hash = '${hash}'; return true;`);
    await wait(500);
    sempit.push({ nama, ...(await ev(wc, `return ukur();`)) });
  }
  console.log('INFO 1024px: ' + JSON.stringify(sempit.map(s => [s.nama, s.client, s.scroll, s.potong.length, s.potongTinggi.length])));
  // Yang boleh terjadi di bawah batas yang dijanjikan hanyalah gulir horizontal
  // yang terlihat. Yang tidak boleh: konten terpotong tanpa ada cara melihatnya.
  ok('5.1 pada 1024px tidak ada kolom atau bagian bawah layar yang terpotong diam-diam',
    sempit.every(s => s.potong.length === 0 && s.potongTinggi.length === 0),
    sempit.filter(s => s.potong.length > 0 || s.potongTinggi.length > 0).map(s => [s.nama, s.potong, s.potongTinggi]));
  // Yang ini membuktikan perbaikannya bekerja, bukan hanya menghilangkan gejala:
  // kalau ada tabel yang lebih lebar dari jendelanya, wadahnya harus bisa
  // digulir — kalau tidak, tidak akan ada yang melaporkan apa pun.
  const butuh = sempit.filter(s => s.hilangTabel > 2);
  ok('5.2 tabel yang lebih lebar dari jendelanya menyediakan jalur gulir di 1024px',
    butuh.length >= 1 && butuh.every(s => s.gulirTabel >= 1), butuh.map(s => [s.nama, s.hilangTabel, s.gulirTabel]));

  const terpotongTinggi = hasil.filter(h => h.potongTinggi.length > 0);
  const tanpaJalurSkroll = hasil.filter(h => h.scrollT > h.clientT + 2 && h.jalurSkroll.length === 0);
  console.log('INFO vertikal @1200x760: ' + JSON.stringify(hasil.map(h => [h.nama, h.clientT, h.scrollT, h.jalurSkroll.length, h.potongTinggi.length])));
  ok('6.1 tidak ada wadah yang memotong bagian bawah kontennya di tinggi 760',
    terpotongTinggi.length === 0, terpotongTinggi.map(h => [h.nama, h.potongTinggi]));
  ok('6.2 konten yang lebih tinggi dari jendela selalu punya jalur gulir',
    tanpaJalurSkroll.length === 0, tanpaJalurSkroll.map(h => [h.nama, h.clientT, h.scrollT]));

  // ── 7. pintu masuk menu: sidebar, pencarian topbar, Ctrl+K ──────────
  // Profil uji di §2.1 adalah DEALER, jadi 'Sewa / Rental' (RENTAL/CONTRACTOR)
  // tidak boleh muncul di mana pun. Dulu CommandPalette membawa daftarnya sendiri
  // (17 dari 26 menu, urutan beda, tanpa gerbang) dan pencarian topbar membaca
  // ALL_NAV_ITEMS mentah — user bisa menemukan serta membuka menu yang menurut
  // profilnya sedang mati, sementara menu yang HIDUP tidak selalu bisa dicari.
  await ev(wc, `window.location.hash = '#/dashboard'; return true;`);
  const adaSidebar = await waitFor(wc, `document.querySelectorAll('.sidebar-item').length >= 20`,
    'sidebar terisi menu untuk profil DEALER', 20000);
  const linkSidebar = await ev(wc, `
    return [...document.querySelectorAll('.sidebar-item')]
      .map(a => (a.getAttribute('href') || '').replace(/^#/, ''));`);
  ok('7.1 sidebar menampilkan menu profil DEALER tanpa Sewa/Rental',
    adaSidebar && linkSidebar.length === 25 && !linkSidebar.includes('/rental'),
    { jumlah: linkSidebar.length, rental: linkSidebar.includes('/rental') });

  await ev(wc, `
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    return true;`);
  const paletteTerbuka = await waitFor(wc,
    `[...document.querySelectorAll('input')].some(x => (x.placeholder || '').includes('menu atau halaman'))`,
    'Ctrl+K membuka command palette', 8000);
  const barisPalette = await waitFor(wc, `document.querySelectorAll('[data-palette-item]').length >= 20`,
    'palette menampilkan daftar menu', 8000);
  const pathPalette = await ev(wc, `
    return [...document.querySelectorAll('[data-palette-item]')]
      .map(e => e.getAttribute('data-palette-item'));`);
  const bedaPalette = [...new Set([...pathPalette, ...linkSidebar])]
    .filter(p => pathPalette.includes(p) !== linkSidebar.includes(p));
  ok('7.2 Ctrl+K menawarkan menu yang sama persis dengan sidebar (satu sumber, satu gerbang)',
    paletteTerbuka && barisPalette && pathPalette.length === linkSidebar.length && bedaPalette.length === 0,
    { palette: pathPalette.length, sidebar: linkSidebar.length, beda: bedaPalette });

  // Enter dari palette harus benar-benar membuka rutenya, bukan hanya menutup layer.
  await ev(wc, `
    const inp = [...document.querySelectorAll('input')].find(x => (x.placeholder || '').includes('menu atau halaman'));
    setVal(inp, 'onderdil');
    return true;`);
  const ketemuKunci = await waitFor(wc,
    `document.querySelectorAll('[data-palette-item]').length === 1`
    + ` && document.querySelector('[data-palette-item]').getAttribute('data-palette-item') === '/spareparts'`,
    'kata kunci "onderdil" menemukan Suku Cadang', 8000);
  await ev(wc, `
    const inp = [...document.querySelectorAll('input')].find(x => (x.placeholder || '').includes('menu atau halaman'));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;`);
  const masukRute = await waitFor(wc, `location.hash === '#/spareparts'`,
    'Enter di palette membawa ke /spareparts', 8000);
  ok('7.3 kata kunci menu (onderdil) dikenali palette dan Enter membuka rutenya',
    ketemuKunci === true && masukRute === true, { ketemuKunci, masukRute });

  await ev(wc, `
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;`);
  await wait(300);

  // Kotak cari di topbar: kata kerja profil (sewa) tidak boleh menawarkan menu
  // yang dimatikan, sementara kata kunci part harus menemukan satu menu tepat.
  const inputTopbar = await ev(wc, `
    const i = document.querySelector('.topbar-search input');
    i.focus(); setVal(i, 'onderdil');
    return !!i;`);
  const hasilTopbar = await waitFor(wc,
    `document.querySelectorAll('[data-search-result]').length === 1`
    + ` && document.querySelector('[data-search-result]').getAttribute('data-search-result') === '/spareparts'`,
    'pencarian topbar menemukan Suku Cadang dari kata kunci', 8000);
  await ev(wc, `setVal(document.querySelector('.topbar-search input'), 'sewa'); return true;`);
  await wait(400);
  const bocorSewa = await ev(wc, `
    return [...document.querySelectorAll('[data-search-result]')]
      .map(e => e.getAttribute('data-search-result'));`);
  ok('7.4 pencarian topbar memakai kata kunci yang sama dan tidak membocorkan menu yang mati',
    inputTopbar === true && hasilTopbar === true && !bocorSewa.includes('/rental'),
    { hasilTopbar, hasilUntukSewa: bocorSewa });
  await ev(wc, `setVal(document.querySelector('.topbar-search input'), ''); return true;`);

  // ── 8. navigasi bolak-balik, muat ulang, dan halaman yang benar-benar terisi ──
  // "State" yang diukur di sini adalah yang TIDAK BOLEH hilang karena berpindah
  // menu: data halaman dan sesi login. Posisi filter tidak ikut diuji — menyimpan
  // atau tidak menyimpannya adalah hak renderer, bukan tanda kehilangan data.
  await ev(wc, `window.location.hash = '#/units'; return true;`);
  const unitsAwal = await waitFor(wc, `document.body.innerText.includes('SDPE219RPLK0001234')`,
    '/units menampilkan unit uji', 25000);
  await ev(wc, `window.location.hash = '#/customers'; return true;`);
  const custAwal = await waitFor(wc, `document.body.innerText.includes('Cikande Putra Mandiri')`,
    '/customers menampilkan pelanggan uji', 25000);
  ok('8.1 dua menu berturut-turut menampilkan datanya sendiri', unitsAwal && custAwal, { unitsAwal, custAwal });

  await ev(wc, `window.history.back(); return true;`);
  const mundur = await waitFor(wc,
    `location.hash === '#/units' && document.body.innerText.includes('SDPE219RPLK0001234')`,
    'mundur ke /units beserta datanya', 25000);
  await ev(wc, `window.history.forward(); return true;`);
  const maju = await waitFor(wc,
    `location.hash === '#/customers' && document.body.innerText.includes('Cikande Putra Mandiri')`,
    'maju ke /customers beserta datanya', 25000);
  ok('8.2 mundur lalu maju mengembalikan halaman beserta datanya', mundur && maju, { mundur, maju });

  // Rangkaian panjang: maju lewat lima menu, mundur lima kali, maju lima kali.
  // Yang dicari halaman yang tinggal kosong atau layar login yang muncul lagi.
  const bolakBalik = await ev(wc, `
    const rute = ['#/units', '#/warehouse', '#/spareparts', '#/service', '#/invoices'];
    const jeda = () => new Promise(x => setTimeout(x, 400));
    for (const r of rute) { window.location.hash = r; await jeda(); }
    for (let i = 0; i < rute.length; i++) { window.history.back(); await jeda(); }
    for (let i = 0; i < rute.length; i++) { window.history.forward(); await jeda(); }
    return { hash: location.hash, invoice: document.body.innerText.includes('INV/SO/CIKANDE'),
             login: !!document.querySelector('#login-username'), panjang: document.body.innerText.length };`);
  ok('8.3 lima menu maju-mundur dua putaran berakhir di halaman berisi data, tanpa layar login',
    bolakBalik.hash === '#/invoices' && bolakBalik.invoice === true
      && bolakBalik.login === false && bolakBalik.panjang > 300, bolakBalik);

  await ev(wc, `window.location.hash = '#/units'; return true;`);
  await wait(400);
  await wc.reload();
  const setelahReload = await waitFor(wc,
    `!document.querySelector('#login-username') && document.body.innerText.includes('SDPE219RPLK0001234')`,
    '/units terisi ulang tanpa login ulang', 45000);
  ok('8.4 muat ulang di tengah menu tidak menghasilkan halaman kosong dan tidak mengusir sesi',
    setelahReload === true, setelahReload);

  // Semua menu, termasuk yang tidak punya penanda data uji dan karena itu tidak
  // pernah dipastikan terisi di §3/§4. Halaman kosong selalu lolos uji tata
  // letak, jadi "panjang teks" inilah yang membuktikan menunya benar-benar dibuka.
  const kosong = [];
  for (const [hash, nama] of RUTE) {
    await ev(wc, `window.location.hash = ${JSON.stringify(hash)}; return true;`);
    const siap = await waitFor(wc, `document.body.innerText.length > 300 && !!document.querySelector('.sidebar-item')`,
      `${nama} terisi`, 20000);
    const panjang = await ev(wc, `return document.body.innerText.length;`);
    if (!siap) kosong.push([nama, panjang]);
  }
  ok('8.5 setiap menu di sidebar benar-benar merender konten, bukan halaman kosong',
    kosong.length === 0, kosong);

  // Bersihkan jejak uji supaya profil sementara tidak menyimpan data palsu.
  const bersih = await ev(wc, `
    const patch = {};
    for (const k of Object.keys(${JSON.stringify(SEED)})) patch[k] = { upsert: [], removeIds: ${JSON.stringify(Object.values(SEED).flat().map(r => r.id))} };
    const r = await window.electronAPI.dbPatch(patch);
    return Object.entries(r).every(([k, v]) => !v || v.deleted === undefined || v.deleted >= 0);`);
  ok('9.1 data uji dibersihkan lewat jalur yang sama', bersih === true, bersih);

  console.log(`\n=== usability: ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

async function waitFor(wc, expr, label, timeoutMs = 30000) {
  const mulai = Date.now();
  while (Date.now() - mulai < timeoutMs) {
    const nilai = await ev(wc, `return !!(${expr});`);
    if (nilai) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

require('../../dist-electron/main.js');
app.whenReady().then(() => { /* main.js yang membuka jendela */ });
