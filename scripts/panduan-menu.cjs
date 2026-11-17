// scripts/panduan-menu.cjs
// Perkakas baca-saja untuk penulis dokumentasi: membuka setiap menu sidebar pada
// profil SEMENTARA, memotret layar daftarnya dan setiap jendela "buat record",
// lalu membongkar DOM-nya (label kolom persis seperti di layar, wajib/tidaknya,
// jenis kontrol, bawaan, isi dropdown, tombol footer, tinggi gulir) ke
// panduan-menu/data.json.
//
// Kenapa dibongkar dari DOM dan bukan ditulis tangan dari sumber: panduan harus
// mengatakan hal yang sama dengan layar. Kolom yang di source disebut
// "form.unitModel" baru boleh muncul di dokumen kalau labelnya benar-benar
// terbaca di jendela; dan kolom yang TIDAK ada di layar harus terlihat tidak ada
// di dokumen. Angka bawaan (tanggal hari ini, qty 1, PIC 'Rudi Hermawan') juga
// diambil dari yang dirender, bukan dari tebakan.
//
// Bukan langkah regresi: tidak mencetak assertion dan tidak dinilai
// tests/harness/regressi.sh, jadi ia tinggal di scripts/ (penjaga §15
// validation-check mewajibkan setiap berkas Electron di tests/harness menjadi
// langkah rantai atau didaftarkan sebagai perkakas).
//
// Tidak ada satu pun tombol simpan yang diklik. Yang ditulis ke database hanya
// baris ber-id PG-* di profil sementara, dan hanya supaya layar tidak kosong:
// dropdown punya pilihan, tabel punya baris, tombol baris (Bayar) bisa dipotret.
// Profil itu dibuang setelah run, jadi tidak ada bersih-bersih data yang bisa
// gagal. Tombol yang merusak (Backup Sekarang, Muat data contoh, Ekspor CSV,
// Cetak, Hapus, Terima Barang lewat confirm) TIDAK ada di daftar pemicu.
//
// Cara menjalankan (satu proses Electron pada satu waktu):
//   HEMS_DATA_DIR=D:/SANY/tmp-harness/r-panduan-menu \
//     node_modules/electron/dist/electron.exe scripts/panduan-menu.cjs

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'panduan-menu');
const GAMBAR = path.join(OUT, 'gambar');
const selesai = require('../tests/harness/selesai.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const LEBAR = 1125;
const TINGGI = 980;

const HELPERS = `
  function byText(re, tag) {
    return [...document.querySelectorAll(tag || 'button')].find(x => re.test((x.innerText || '').trim()));
  }
  function klik(re, tag) {
    const b = byText(re, tag);
    if (!b) return 'TIDAK ADA TOMBOL ' + re + ' | tombol=' +
      [...document.querySelectorAll('button')].map(x => (x.innerText || '').trim()).filter(Boolean).slice(0, 30).join(' / ');
    b.click();
    return 'ok';
  }
  function modal() { return document.querySelector('.modal'); }
  function kepalaForm() {
    const m = modal();
    if (!m) return null;
    const t = m.querySelector('.modal-title') || m.querySelector('.modal-header h2');
    return t ? t.innerText.trim() : null;
  }
  function tutupForm() {
    const b = document.querySelector('.modal-backdrop');
    if (b) b.click();
    else {
      const x = document.querySelector('.modal .modal-close') ||
        [...document.querySelectorAll('.modal button')].find(t => (t.innerText || '').trim() === '×');
      if (x) x.click();
    }
    return !modal();
  }
  function kontrol(el) {
    if (!el) return null;
    const o = {
      jenis: el.tagName.toLowerCase(),
      tipe: el.getAttribute('type') || null,
      wajib: el.required === true,
      terkunci: el.disabled === true,
      hanyaBaca: el.readOnly === true,
      contoh: el.placeholder || null,
    };
    const v = el.value;
    o.bawaan = (v === undefined || v === null || String(v) === '') ? null : String(v);
    if (el.tagName === 'SELECT') {
      o.opsi = [...el.options].map(x => (x.innerText || '').trim());
    }
    return o;
  }
  function isiForm() {
    const m = modal();
    if (!m) return null;
    const kolom = [...m.querySelectorAll('.form-group')].map(g => {
      const l = g.querySelector('label');
      const k = kontrol(g.querySelector('input, select, textarea')) || {};
      return Object.assign({ label: l ? l.innerText.trim() : null }, k);
    }).filter(x => x.label || x.jenis);
    const body = m.querySelector('.modal-body');
    const lebar = parseInt(getComputedStyle(m).width, 10) || null;
    return {
      kepala: kepalaForm(),
      lebar,
      kolom,
      tombol: [...m.querySelectorAll('.modal-footer button')].map(b => b.innerText.trim()).filter(Boolean),
      gulir: body ? { isi: body.scrollHeight, tampak: body.clientHeight } : null,
      teks: (body ? body.innerText : m.innerText).replace(/\\s+/g, ' ').slice(0, 420),
    };
  }
  function ambil(s) { const e = document.querySelector(s); return e ? e.innerText.trim() : null; }
  function semua(s) { return [...document.querySelectorAll(s)].map(e => (e.innerText || '').trim()).filter(Boolean); }
  function layar() {
    const kartu = [...document.querySelectorAll('.stat-card')].map(c => ({
      judul: (c.querySelector('.card-title') || {}).innerText || null,
      nilai: (c.querySelector('.card-value') || {}).innerText || null,
      sub: (c.querySelector('.card-sub') || {}).innerText || null,
    }));
    const tabel = [...document.querySelectorAll('table')].map(tb => ({
      kepala: [...tb.querySelectorAll('thead th')].map(th => (th.innerText || '').trim()).filter(Boolean),
      baris: tb.querySelectorAll('tbody tr').length,
    }));
    const isian = [...document.querySelectorAll('input, select')]
      .filter(el => !modal() || !modal().contains(el))
      .map(el => kontrol(el))
      .filter(Boolean);
    return {
      judul: ambil('.page-title'),
      subjudul: ambil('.page-subtitle'),
      kartu,
      tabel,
      tombol: [...new Set(semua('button'))].slice(0, 60),
      tab: semua('.tab, .tab-btn, .tab-button, [class*="tab-"]').slice(0, 12),
      isian,
      kosong: /belum ada|tidak ada data|Belum Tersedia/i.test(document.body.innerText) || null,
      teks: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 260),
    };
  }
`;

function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`);
}

// Urutan = urutan sidebar. `form[].pemicu` = teks tombol pembuka jendela,
// `tab` = tab yang harus aktif lebih dulu, `diBaris` = pemicunya tombol di
// dalam tabel (butuh baris seed). Semua string sudah dibaca dari sumber halaman
// dan diperiksa lagi di layar oleh alat ini.
const MENUS = [
  { slug: 'dasbor', rute: '#/dashboard', label: 'Dasbor', kelompok: 'Utama' },
  { slug: 'control-tower', rute: '#/control-tower', label: 'Control Tower', kelompok: 'Utama' },

  {
    slug: 'merek-model', rute: '#/brands', label: 'Merek & Model', kelompok: 'Master Data',
    tampilan: [
      { nama: 'layar', klik: 'Daftar Merek \\(' },
      { nama: 'layar-model', klik: 'Spesifikasi Model Unit \\(' },
    ],
    form: [
      { nama: 'tambah-merek', pemicu: '^Tambah Merek$', tab: 'Daftar Merek \\(' },
      { nama: 'tambah-model', pemicu: '^Tambah Model Unit$', tab: 'Spesifikasi Model Unit \\(' },
    ],
  },
  { slug: 'unit', rute: '#/units', label: 'Unit / Armada', kelompok: 'Master Data', form: [{ nama: 'tambah-unit', pemicu: '^Tambah Unit$' }] },
  { slug: 'pelanggan', rute: '#/customers', label: 'Pelanggan', kelompok: 'Master Data', form: [{ nama: 'tambah-pelanggan', pemicu: '^Tambah Pelanggan$' }] },
  { slug: 'pemasok', rute: '#/suppliers', label: 'Pemasok', kelompok: 'Master Data', form: [{ nama: 'tambah-pemasok', pemicu: '^Tambah Pemasok$' }] },
  { slug: 'operator', rute: '#/operators', label: 'Operator', kelompok: 'Master Data', form: [{ nama: 'tambah-operator', pemicu: '\\+ Tambah Operator' }] },
  { slug: 'teknisi', rute: '#/technicians', label: 'Teknisi', kelompok: 'Master Data', form: [{ nama: 'tambah-teknisi', pemicu: '\\+ Tambah Teknisi' }] },

  { slug: 'pembelian', rute: '#/purchase', label: 'Pembelian', kelompok: 'Transaksi', form: [{ nama: 'buat-po', pemicu: '^Buat PO Baru$' }] },
  { slug: 'penjualan', rute: '#/sales', label: 'Penjualan', kelompok: 'Transaksi', form: [{ nama: 'buat-spk', pemicu: '^Buat SPK Baru$' }] },
  { slug: 'sewa-rental', rute: '#/rental', label: 'Sewa / Rental', kelompok: 'Transaksi', form: [{ nama: 'buat-kontrak', pemicu: '^Buat Kontrak Sewa$' }] },
  { slug: 'persetujuan', rute: '#/approvals', label: 'Persetujuan (Approval)', kelompok: 'Transaksi', form: [{ nama: 'buat-request', pemicu: '\\+ Buat Request' }] },
  {
    slug: 'faktur', rute: '#/invoices', label: 'Faktur / Invoice', kelompok: 'Transaksi',
    form: [
      { nama: 'buat-invoice', pemicu: '^Buat Invoice Baru$' },
      { nama: 'catat-pembayaran', pemicu: '^Bayar$', diBaris: true },
    ],
  },

  { slug: 'gudang', rute: '#/warehouse', label: 'Gudang', kelompok: 'Operasional', form: [{ nama: 'catat-mutasi', pemicu: '^Catat Mutasi Stok$' }] },
  { slug: 'suku-cadang', rute: '#/spareparts', label: 'Suku Cadang', kelompok: 'Operasional', form: [{ nama: 'tambah-spare-part', pemicu: '^Tambah Spare Part$' }] },
  { slug: 'breakdown', rute: '#/breakdown', label: 'Breakdown', kelompok: 'Operasional', form: [{ nama: 'lapor-breakdown', pemicu: '\\+ Lapor Breakdown' }] },
  { slug: 'servis', rute: '#/service', label: 'Servis & Work Order', kelompok: 'Operasional', form: [{ nama: 'buka-work-order', pemicu: '^Buka Work Order Servis$' }] },
  { slug: 'pengiriman', rute: '#/delivery', label: 'Pengiriman', kelompok: 'Operasional', form: [{ nama: 'buat-surat-jalan', pemicu: '^Buat Surat Jalan$' }] },

  { slug: 'kas-bank', rute: '#/finance', label: 'Kas & Bank', kelompok: 'Keuangan', form: [{ nama: 'catat-transaksi', pemicu: '^Catat Transaksi$' }] },
  { slug: 'laporan', rute: '#/reports', label: 'Laporan', kelompok: 'Keuangan' },

  { slug: 'pengaturan', rute: '#/settings', label: 'Pengaturan', kelompok: 'Sistem' },
  { slug: 'pengguna', rute: '#/users', label: 'Pengguna', kelompok: 'Sistem', form: [{ nama: 'tambah-pengguna', pemicu: '^Tambah Pengguna$' }] },
  { slug: 'dokumen-legal', rute: '#/documents', label: 'Dokumen Legal', kelompok: 'Sistem', form: [{ nama: 'upload-dokumen', pemicu: '\\+ Upload Dokumen' }] },
  { slug: 'backup', rute: '#/backup', label: 'Backup & Restore', kelompok: 'Sistem' },
  { slug: 'pemeliharaan-sistem', rute: '#/maintenance', label: 'Pemeliharaan Sistem', kelompok: 'Sistem' },
  { slug: 'audit-log', rute: '#/audit-log', label: 'Audit Log', kelompok: 'Sistem' },
];

// Seed PG-*: satu-dua baris per collection supaya layar tidak kosong. Bentuk
// kolomnya ditiru dari src/data/sampleData.ts (data contoh resmi aplikasi) dan
// dari formKosong halaman masing-masing, jadi nilainya sah menurut renderer.
const SEED = {
  brands: [
    { id: 'PG-B1', name: 'SANY', country: 'Tiongkok', category: 'Excavator', description: 'Merek uji panduan' },
    { id: 'PG-B2', name: 'Komatsu', country: 'Jepang', category: 'Excavator', description: 'Merek uji panduan' },
  ],
  models: [
    { id: 'PG-M1', brandName: 'SANY', modelCode: 'SY215C', category: 'Excavator', capacity: '1,2 m3', enginePower: '129 kW', operatingWeight: '21.900 kg' },
    { id: 'PG-M2', brandName: 'Komatsu', modelCode: 'PC200-8', category: 'Excavator', capacity: '0,8 m3', enginePower: '110 kW', operatingWeight: '20.000 kg' },
  ],
  units: [
    { id: 'PG-U1', serialNumber: 'PG-SY215-001', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE', category: 'Excavator', location: 'Yard Cikande', hourMeter: 1250, purchasePrice: 1750000000, purchaseDate: '2025-01-10', year: '2025', notes: 'Unit uji panduan' },
    { id: 'PG-U2', serialNumber: 'PG-PC200-002', brand: 'Komatsu', model: 'PC200-8', status: 'ON_PROJECT', category: 'Excavator', location: 'Jobsite Morowali', hourMeter: 8900, purchasePrice: 1850000000, purchaseDate: '2023-01-15', year: '2022', notes: 'Unit uji panduan' },
  ],
  customers: [
    { id: 'PG-C1', name: 'PT Konstruksi Maju', phone: '081234567890', email: 'promo@konstruksimaju.example', segment: 'KONTRAKTOR', address: 'Jl. Jend. Sudirman No. 1, Jakarta', contactPerson: 'Budi Santoso' },
    { id: 'PG-C2', name: 'CV Tambang Abadi', phone: '081987654321', email: 'purchasing@tambangabadi.example', segment: 'TAMBANG', address: 'Jl. Merdeka No. 45, Balikpapan', contactPerson: 'Ahmad Hidayat' },
  ],
  suppliers: [
    { id: 'PG-S1', name: 'PT SANY Indonesia', phone: '0215000001', email: 'sales@sany.example', category: 'PRINCIPAL', npwp: '01.234.567.8-901.000', contact: 'Andi Prasetyo', address: 'Jakarta' },
    { id: 'PG-S2', name: 'Toko Hidraulik Jaya', phone: '0215000002', email: 'info@hidraulikjaya.example', category: 'SPAREPART', npwp: '01.234.567.8-901.001', contact: 'Lina Marlina', address: 'Tangerang' },
  ],
  spareParts: [
    { id: 'PG-P1', name: 'Engine Oil Filter Cartridge', sku: 'PG-6736-51-5142', stock: 24, minStock: 10, price: 285000, unit: 'pcs', category: 'Filter', compatibleBrands: 'SANY, Komatsu', rackLocation: 'Rak A1' },
    { id: 'PG-P2', name: 'Main Hydraulic Pump Assembly', sku: 'PG-SY-HYD-708', stock: 1, minStock: 2, price: 48000000, unit: 'unit', category: 'Hydraulic', compatibleBrands: 'SANY', rackLocation: 'Rak C2' },
  ],
  warehouse: [
    { id: 'PG-W1', trxNo: 'GR-PG-001', type: 'INBOUND', warehouseName: 'Yard Cikande Main Hub (Banten)', itemDescription: '2 Engine Oil Filter Cartridge (PG-6736-51-5142)', qty: 2, unit: 'pcs', referenceDoc: 'PO-PG-001', date: '2026-10-05', pic: 'Rudi Hermawan', notes: 'Penerimaan uji panduan' },
    { id: 'PG-W2', trxNo: 'GI-PG-001', type: 'OUTBOUND', warehouseName: 'Yard Cikande Main Hub (Banten)', itemDescription: '1 Track Roller (TR-200-8-1)', qty: 1, unit: 'pcs', referenceDoc: 'WO-PG-001', date: '2026-10-07', pic: 'Rudi Hermawan', notes: 'Pemakaian Work Order uji panduan' },
  ],
  sales: [
    { id: 'SPK-PG-001', orderNo: 'SPK-PG-001', customerName: 'PT Konstruksi Maju', unitModel: 'SANY SY215C', serialNumber: 'PG-SY215-001', orderDate: '2026-09-20', totalPrice: 1750000000, downPayment: 350000000, paymentScheme: 'CASH', status: 'CONFIRMED', salesPerson: 'Rina Kartika' },
  ],
  rentals: [
    { id: 'RNT-PG-001', contractNo: 'RNT-PG-001', customerName: 'CV Tambang Abadi', unitModel: 'Komatsu PC200-8', serialNumber: 'PG-PC200-002', startDate: '2026-09-01', endDate: '2026-12-31', location: 'Jobsite Morowali', monthlyRate: 45000000, minimumHours: 160, operatorIncluded: true, status: 'ACTIVE' },
  ],
  services: [
    { id: 'WO-PG-001', woNumber: 'WO-PG-001', unitModel: 'Komatsu PC200-8', serialNumber: 'PG-PC200-002', customerOrProject: 'CV Tambang Abadi', serviceType: 'PERIODIC_250H', mechanicName: 'Agus Sutrisno', hourMeter: 8900, openDate: '2026-10-06', estimatedCost: 12500000, status: 'IN_PROGRESS', complaintNotes: 'Servis berkala 250 jam uji panduan' },
  ],
  purchases: [
    { id: 'PO-PG-001', poNumber: 'PO-PG-001', supplierName: 'Toko Hidraulik Jaya', itemName: '2 Engine Oil Filter Cartridge', category: 'SPAREPART', status: 'ORDERED', orderDate: '2026-10-01', deliveryExpectedDate: '2026-10-15', totalAmount: 570000, notes: 'PO uji panduan' },
  ],
  invoices: [
    { id: 'INV-PG-001', invoiceNo: 'INV-PG-001', customerName: 'PT Konstruksi Maju', unitOrDesc: 'SANY SY215C - SN PG-SY215-001', type: 'PENJUALAN', status: 'UNPAID', issueDate: '2026-09-20', dueDate: '2026-10-20', totalAmount: 1400000000, paidAmount: 0, sourceType: 'SALES', sourceNumber: 'SPK-PG-001' },
    { id: 'INV-PG-002', invoiceNo: 'INV-PG-002', customerName: 'CV Tambang Abadi', unitOrDesc: 'Sewa Komatsu PC200-8 Morowali Oktober', type: 'RENTAL', status: 'OVERDUE', issueDate: '2026-09-01', dueDate: '2026-10-01', totalAmount: 45000000, paidAmount: 10000000, sourceType: 'RENTAL', sourceNumber: 'RNT-PG-001' },
  ],
  kas: [
    { id: 'PG-K1', tanggal: '2026-09-20', keterangan: 'Penerimaan DP Penjualan SPK-PG-001 - PT Konstruksi Maju', kategori: 'PENJUALAN', tipe: 'MASUK', jumlah: 350000000, rekening: 'BCA - 1234567890', referensi: 'SPK-PG-001' },
    { id: 'PG-K2', tanggal: '2026-10-05', keterangan: 'Pembayaran PO PO-PG-001 ke Toko Hidraulik Jaya', kategori: 'PEMBELIAN', tipe: 'KELUAR', jumlah: 570000, rekening: 'Mandiri - 0987654321', referensi: 'PO-PG-001' },
  ],
  deliveries: [
    { id: 'PG-D1', doNumber: 'DO-PG-001', salesOrderRef: 'SPK-PG-001', customerName: 'PT Konstruksi Maju', unitModel: 'SANY SY215C', serialNumber: 'PG-SY215-001', deliveryDate: '2026-10-08', destination: 'Proyek Tol Cileunyi, Jawa Barat', driverName: 'Supomo', truckPlate: 'B 9812 XY', status: 'DALAM_PERJALANAN', notes: 'Surat jalan uji panduan' },
  ],
  breakdowns: [
    { id: 'PG-BD1', breakdownNumber: 'BD-PG-001', unitSerialNumber: 'PG-PC200-002', unitModel: 'Komatsu PC200-8', location: 'Jobsite Morowali', reportedBy: 'Ahmad Hidayat', reportedAt: '2026-10-06T08:30:00', severity: 'MAJOR', status: 'REPAIRING', description: 'Hydraulic pump tidak berfungsi (laporan uji panduan)', assignedTechnician: 'Agus Sutrisno', estimatedRepairCost: 15000000 },
  ],
  operators: [
    { id: 'PG-OP1', operatorNumber: 'OP-PG-001', name: 'Budi Santoso', phone: '081234567890', email: 'budi@example.com', nik: '3201010101010001', status: 'ACTIVE', assignedUnit: 'PG-SY215-001', assignedProject: 'Yard Cikande', totalHours: 4500, licenseNumber: 'LIC-OP-2020-001', licenseExpiry: '2027-01-15', startDate: '2020-02-01', certifications: [], notes: 'Operator uji panduan' },
  ],
  technicians: [
    { id: 'PG-TC1', technicianNumber: 'TECH-PG-001', name: 'Agus Sutrisno', phone: '082345678901', email: 'agus@example.com', nik: '3203030303030003', status: 'ACTIVE', totalHours: 2400, totalWorkOrders: 150, startDate: '2018-07-01', specializations: [], certifications: [], skills: [], notes: 'Teknisi uji panduan' },
  ],
  approvals: [
    { id: 'PG-AP1', requestNumber: 'APR-PG-001', type: 'PURCHASE_REQUEST', title: 'Pembelian hydraulic pump unit PG-PC200-002', description: 'Request uji panduan', requestedBy: 'Agus Sutrisno', requestedAt: '2026-10-06T10:00:00', amount: 48000000, status: 'PENDING', approverLevel: 1, currentApprover: 'Manager Operations', notes: '' },
  ],
  documents: [
    { id: 'PG-DOK1', jenisDokumen: 'SIA (Surat Izin Alat)', nomorDokumen: 'SIA-PG-2026-001', masaBerlaku: '2027-01-15', statusLegalitas: 'AKTIF', keterangan: 'Dokumen uji panduan' },
  ],
  bankAccounts: [
    { id: 'PG-BA1', namaBank: 'BCA', nomorRekening: '1234567890', namaPemilik: 'CV. MUGHNY NAMASKARABUMI KURNIA', cabang: 'Jakarta', mataUang: 'IDR', isActive: true, keterangan: 'Rekening utama uji panduan' },
    { id: 'PG-BA2', namaBank: 'Mandiri', nomorRekening: '0987654321', namaPemilik: 'CV. MUGHNY NAMASKARABUMI KURNIA', cabang: 'Jakarta', mataUang: 'IDR', isActive: true, keterangan: 'Rekening cadangan uji panduan' },
  ],
};

async function waitFor(wc, expr, label, timeoutMs = 40000) {
  const mulai = Date.now();
  while (Date.now() - mulai < timeoutMs) {
    if (await ev(wc, `return !!(${expr});`)) return true;
    await wait(250);
  }
  console.log('GAGAL menunggu: ' + label + ' || layar: ' + await ev(wc, `return layar().teks;`));
  return false;
}

async function potret(wc, file) {
  const image = await wc.capturePage();
  const buf = image.toPNG();
  fs.mkdirSync(GAMBAR, { recursive: true });
  fs.writeFileSync(path.join(GAMBAR, file), buf);
  const u = image.getSize();
  console.log(`  TERTULIS gambar/${file} ${buf.length} byte ${u.width}x${u.height}`);
  return { berkas: 'gambar/' + file, byte: buf.length, lebar: u.width, tinggi: u.height };
}

async function bukaLayar(wc, m) {
  await ev(wc, `window.location.hash = '${m.rute}'; return true;`);
  if (!await waitFor(wc, `(!!document.querySelector('.page-title') || !!document.querySelector('h1')) && document.body.innerText.length > 300`, `${m.slug} terisi`, 25000)) {
    return false;
  }
  await wait(600);
  return true;
}

async function jalan(wc) {
  const win = BrowserWindow.fromWebContents(wc);
  const hasil = [];
  let gagal = 0;

  console.log('LANGKAH 1 tunggu layar login');
  if (!await waitFor(wc, `!!document.querySelector('#login-username') && !!document.querySelector('#login-password')`, 'form login')) {
    return selesai(app, 1);
  }
  console.log('LANGKAH 2 masuk ' + await ev(wc, `
    const s = (el, v) => { const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    s(document.querySelector('#login-username'), 'admin');
    s(document.querySelector('#login-password'), 'admin123');
    return klik(/Masuk ke FATHONI/);`));
  console.log('LANGKAH 3 gerbang password ' + await waitFor(wc, `/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'gerbang'));
  console.log('LANGKAH 4 ganti password ' + await ev(wc, `
    const s = (el, v) => { const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    s(document.querySelector('#cpw-current'), 'admin123');
    s(document.querySelector('#cpw-next'), 'Panduan2026x');
    s(document.querySelector('#cpw-confirm'), 'Panduan2026x');
    return klik(/Simpan password baru/);`));
  if (!await waitFor(wc, `!/Ganti password sebelum melanjutkan/.test(document.body.innerText) && (/Selamat Datang/.test(document.body.innerText) || !!document.querySelector('.sidebar-item'))`, 'setelah gerbang')) {
    return selesai(app, 1);
  }

  // Profil baru berhenti di layar "Selamat Datang ... Pilih profil" sebelum
  // shell muncul. Semua mode bisnis ditandai aktif supaya setiap menu sidebar
  // punya peluang tampil, lalu renderer dimuat ulang.
  console.log('LANGKAH 5 profil bisnis ' + await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER', 'TRADER', 'WORKSHOP', 'CONTRACTOR', 'RENTAL'], customMenus: [], isSetupComplete: true }));
    return 'ok';`));
  await wc.reload();
  if (!await waitFor(wc, `!!document.querySelector('.sidebar-item') && document.body.innerText.length > 300`, 'shell')) {
    return selesai(app, 1);
  }

  console.log('LANGKAH 6 seed PG-* ' + JSON.stringify(await ev(wc, `
    const seed = ${JSON.stringify(SEED)};
    const patches = {};
    for (const k of Object.keys(seed)) patches[k] = { upsert: seed[k], removeIds: [] };
    return window.electronAPI.dbPatch(patches);`)));
  await wc.reload();
  if (!await waitFor(wc, `!!document.querySelector('.sidebar-item') && document.body.innerText.length > 300`, 'shell setelah seed')) {
    return selesai(app, 1);
  }

  const menuSidebar = await ev(wc, `return [...document.querySelectorAll('.sidebar-item')].map(x => (x.innerText || '').trim()).filter(Boolean);`);
  console.log('LANGKAH 7 sidebar tampil ' + menuSidebar.length + ' menu: ' + menuSidebar.join(' / '));

  win.setContentSize(LEBAR, TINGGI);
  win.center();
  win.focus();
  await wait(500);

  for (const m of MENUS) {
    const entry = { slug: m.slug, label: m.label, kelompok: m.kelompok, rute: m.rute, tampilan: [], form: [] };
    if (!await bukaLayar(wc, m)) { gagal++; hasil.push(entry); continue; }

    for (const t of (m.tampilan || [{ nama: 'layar' }])) {
      if (t.klik) {
        await ev(wc, `return klik(/${t.klik}/);`);
        await wait(600);
      }
      const dump = await ev(wc, `return layar();`);
      const gambar = await potret(wc, `${m.slug}-${t.nama}.png`);
      entry.tampilan.push({ nama: t.nama, gambar, dump });
      if (t.klik) console.log(`  LAYAR ${m.slug}-${t.nama} | ${dump.judul} | tombol=${(dump.tombol || []).slice(0, 6).join(', ')}`);
    }

    for (const f of (m.form || [])) {
      // Kembali ke layar daftar dulu: tab yang tersisa dari tampilan sebelumnya
      // bisa menyembunyikan tombol pemicu.
      if (!await bukaLayar(wc, m)) { gagal++; continue; }
      if (f.tab) {
        console.log('  TAB ' + await ev(wc, `return klik(/${f.tab}/);`));
        await wait(600);
      }
      const cari = f.diBaris
        ? `byText(/${f.pemicu}/, 'tbody button, table button')`
        : `byText(/${f.pemicu}/)`;
      if (!await waitFor(wc, `!!(${cari})`, `tombol ${m.slug}/${f.nama}`, 20000)) { gagal++; continue; }
      console.log('  BUKA ' + f.nama + ' ' + await ev(wc, `return klik(/${f.pemicu}/, ${JSON.stringify(f.diBaris ? 'tbody button, table button' : 'button')});`));
      if (!await waitFor(wc, `!!kepalaForm()`, `jendela ${m.slug}/${f.nama}`, 20000)) { gagal++; continue; }
      await wait(700);
      const dump = await ev(wc, `return isiForm();`);
      const gambar = await potret(wc, `${m.slug}-${f.nama}.png`);
      entry.form.push({ nama: f.nama, pemicu: f.pemicu, gambar, dump });
      const g = dump && dump.gulir;
      console.log(`  FORM ${m.slug}/${f.nama} | "${dump && dump.kepala}" | kolom=${dump && dump.kolom.length} | footer=${(dump && dump.tombol || []).join(', ')}` +
        (g ? ` | gulir=${g.isi}>${g.tampak ? g.tampak : '?'}` : ''));
      await ev(wc, `return tutupForm();`);
      if (!await waitFor(wc, `!modal()`, `tutup ${m.slug}/${f.nama}`, 10000)) gagal++;
      await wait(250);
    }

    hasil.push(entry);
    console.log(`SELESAI MENU ${m.label}`);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({
    dibuat: new Date().toISOString(),
    jendela: { lebar: LEBAR, tinggi: TINGGI },
    seed: Object.keys(SEED).map(k => `${k}=${SEED[k].length}`),
    menu: hasil,
  }, null, 1), 'utf8');
  console.log('TERTULIS panduan-menu/data.json');

  const jumlahForm = hasil.reduce((a, m) => a + m.form.length, 0);
  const jumlahLayar = hasil.reduce((a, m) => a + m.tampilan.length, 0);
  console.log(`\n=== panduan-menu: ${hasil.length} menu, ${jumlahLayar} layar, ${jumlahForm} form, ${gagal} gagal ===`);
  selesai(app, gagal === 0 ? 0 : 1);
}

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    wc.once('did-finish-load', () => jalan(wc).catch((err) => {
      console.log('ALAT ERROR', err && (err.stack || err.message));
      ev(wc, `return layar().teks;`).then((t) => console.log('LAYAR:', t)).catch(() => { /* jendela sudah tertutup */ });
      selesai(app, 2);
    }));
  }
});
app.on('window-all-closed', () => { /* biarkan alat memutuskan sendiri */ });

require('../dist-electron/main.js');
app.whenReady().then(() => { /* main.js yang membuka jendela */ });
