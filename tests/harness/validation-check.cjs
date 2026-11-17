// tests/harness/validation-check.cjs
// Harness UNIT untuk lapisan validasi form + checksum pemulihan data.
//
//   node tests/harness/validation-check.cjs
//
// Tidak butuh `npm run build` dan tidak butuh Electron: yang diuji di sini modul
// murni, jadi bundel esbuild-nya dijalankan Node biasa. localStorage ditiru di
// memory — harness ini tidak pernah membuka profil pengguna sungguhan.
//
// Kenapa harness ini ada: sampai Fase 6, validasi.ts hanya teruji tidak langsung
// lewat layar (flow-check / handoff-check). Aturan batas (min/max/panjang/regex)
// dan apa yang terjadi pada nilai kosong-NaN tidak pernah dinyatakan di satu
// tempat, padahal aturan itulah yang menahan data salah masuk file SQLite.

const path = require('path');
const fs = require('fs');
const os = require('os');
const esbuild = require('esbuild');

// ── localStorage tiruan ────────────────────────────────────────
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
}
globalThis.localStorage = new MemoryStorage();
// dataRecovery mengintip window untuk memutuskan mode desktop; tanpa window
// sama sekali modulnya tetap termuat, tapi dibikin agar pemeriksaan tidak
// bergantung pada urutan require.
globalThis.window = globalThis.window || {};

const outfile = path.join(os.tmpdir(), `fathoni-validation-entry-${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'validation.entry.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile,
  logLevel: 'error',
});
const E = require(outfile);
const V = E.V;
const D = E.D;

// ── kerangka ───────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS  ' + name);
  } else {
    failed += 1;
    console.log('FAIL  ' + name + (detail === undefined ? '' : '  -> ' + JSON.stringify(detail)));
  }
}
/** Bandingkan pesan error apa adanya — pesan inilah yang dibaca pengguna. */
function msgIs(name, actual, expected) {
  check(name, actual === expected, { actual, expected });
}
function noError(name, actual) {
  check(name, actual === null, { actual });
}

const TAHUN_INI = new Date().getFullYear();

// ── 1. validateField ───────────────────────────────────────────
msgIs('wajib: kosong', V.validateField('', { required: true }, 'Nama'), 'Nama wajib diisi');
msgIs('wajib: null', V.validateField(null, { required: true }, 'Nama'), 'Nama wajib diisi');
msgIs('wajib: undefined', V.validateField(undefined, { required: true }, 'Nama'), 'Nama wajib diisi');
noError('wajib: angka 0 bukan kosong', V.validateField(0, { required: true }, 'Jumlah'));
noError('wajib: string "0" bukan kosong', V.validateField('0', { required: true }, 'Jumlah'));
msgIs('wajib: hanya spasi dianggap kosong', V.validateField('   ', { required: true }, 'Nama'), 'Nama wajib diisi');
msgIs('wajib: non-required + kosong = dilewati', V.validateField('', { minLength: 5 }, 'Nama'), null);
noError('non-required: kosong lolos', V.validateField('', { minLength: 5, pattern: /^x/ }, 'Nama'));

msgIs('min: di bawah batas', V.validateField(4, { min: 5 }, 'HM'), 'HM tidak boleh kurang dari 5');
noError('min: tepat di batas', V.validateField(5, { min: 5 }, 'HM'));
msgIs('max: di atas batas', V.validateField(6, { max: 5 }, 'HM'), 'HM tidak boleh lebih dari 5');
noError('max: tepat di batas', V.validateField(5, { max: 5 }, 'HM'));
msgIs('min: NaN ditolak, bukan diloloskan', V.validateField(NaN, { min: 0 }, 'HM'), 'HM harus berupa angka');
msgIs('max: NaN ditolak', V.validateField(NaN, { max: 10 }, 'HM'), 'HM harus berupa angka');
noError('tanpa aturan angka: NaN bukan urusan validateField', V.validateField(NaN, { minLength: 2 }, 'HM'));

noError('minLength: panjang tepat', V.validateField('abcde', { minLength: 5 }, 'Model'));
msgIs('minLength: kurang satu', V.validateField('abcd', { minLength: 5 }, 'Model'), 'Model minimal 5 karakter');
noError('maxLength: panjang tepat', V.validateField('abcde', { maxLength: 5 }, 'Model'));
msgIs('maxLength: lebih satu', V.validateField('abcdef', { maxLength: 5 }, 'Model'), 'Model maksimal 5 karakter');
msgIs('pattern: tidak cocok', V.validateField('abc1', { pattern: /^[a-z]+$/ }, 'Kode'), 'Kode format tidak valid');
noError('pattern: cocok', V.validateField('abc', { pattern: /^[a-z]+$/ }, 'Kode'));
msgIs('custom: pesan custom dipakai apa adanya',
  V.validateField('x', { custom: () => 'Aturan khusus menolak' }, 'X'), 'Aturan khusus menolak');
noError('custom: null berarti lolos', V.validateField('x', { custom: () => null }, 'X'));
msgIs('urutan: wajib diperiksa lebih dulu', V.validateField('', { required: true, minLength: 5 }, 'Nama'), 'Nama wajib diisi');
msgIs('urutan: min sebelum panjang', V.validateField(1, { min: 5, minLength: 3 }, 'Angka'), 'Angka tidak boleh kurang dari 5');

// ── 2. validateForm ────────────────────────────────────────────
{
  const hasil = V.validateForm(
    { nama: '', umur: 3, kode: 'abc' },
    { nama: { required: true }, umur: { min: 5 }, kode: { pattern: /^\d+$/ } }
  );
  check('form: tiga error terkumpul', Object.keys(hasil.errors).length === 3, hasil.errors);
  check('form: isValid false saat ada error', hasil.isValid === false);
  check('form: isi error sesuai field', hasil.errors.nama === 'nama wajib diisi', hasil.errors);
}
{
  const hasil = V.validateForm({ nama: 'Budi', lain: 'x' }, { nama: { required: true } });
  check('form: field tanpa aturan diabaikan', hasil.isValid === true && Object.keys(hasil.errors).length === 0, hasil);
}
{
  const hasil = V.validateForm({}, { nama: { required: true } });
  check('form: data kosong tidak memunculkan error', hasil.isValid === true, hasil);
}

// ── 3. validateDateRange ───────────────────────────────────────
noError('rentang: sama hari', V.validateDateRange('2026-05-10', '2026-05-10'));
msgIs('rentang: akhir sebelum awal',
  V.validateDateRange('2026-05-10', '2026-05-09'), 'Tanggal selesai tidak boleh sebelum Tanggal mulai');
msgIs('rentang: label dipakai di pesan',
  V.validateDateRange('2026-05-10', '2026-05-01', 'Tanggal Order', 'Estimasi Tiba'),
  'Estimasi Tiba tidak boleh sebelum Tanggal Order');
noError('rentang: awal kosong dilewati', V.validateDateRange('', '2026-05-10'));
noError('rentang: akhir kosong dilewati', V.validateDateRange('2026-05-10', ''));
msgIs('rentang: tanggal tak terbaca ditolak',
  V.validateDateRange('bukan-tanggal', '2026-05-10'), 'Tanggal mulai formatnya tidak valid');

// ── 4. validateUniqueSerialNumber ──────────────────────────────
{
  const units = [
    { id: 'U1', serialNumber: 'SY215C-001' },
    { id: 'U2', serialNumber: null },
    { id: 'U3', serialNumber: ' KOM200-9 ' },
  ];
  msgIs('serial: duplikat tidak peka huruf',
    V.validateUniqueSerialNumber('sy215c-001', units),
    'Serial Number sy215c-001 sudah terdaftar pada unit lain');
  noError('serial: id yang sama dikecualikan', V.validateUniqueSerialNumber('SY215C-001', units, 'U1'));
  msgIs('serial: spasi di kiri-kanan dinormalkan',
    V.validateUniqueSerialNumber('KOM200-9', units),
    'Serial Number KOM200-9 sudah terdaftar pada unit lain');
  noError('serial: kosong tidak diperiksa', V.validateUniqueSerialNumber('', units));
  noError('serial: unit tanpa serial tidak ikut tertuduh', V.validateUniqueSerialNumber('XYZ', units));
}

// ── 5. validator angka tunggal ─────────────────────────────────
noError('HM: 0', V.validateHourMeter(0));
noError('HM: 100000 tepat', V.validateHourMeter(100000));
msgIs('HM: negatif', V.validateHourMeter(-1), 'Hour Meter tidak boleh negatif');
msgIs('HM: di atas 100.000', V.validateHourMeter(100001), 'Hour Meter tidak realistis (maksimal 100.000 HM)');
msgIs('HM: NaN ditolak', V.validateHourMeter(NaN), 'Hour Meter harus berupa angka');
msgIs('HM: nilai non-angka ditolak', V.validateHourMeter(undefined), 'Hour Meter harus berupa angka');

noError('tahun: tahun ini', V.validateYear(String(TAHUN_INI)));
noError('tahun: tahun depan masih boleh', V.validateYear(String(TAHUN_INI + 1)));
msgIs('tahun: sebelum 1990', V.validateYear('1989'), 'Tahun minimal 1990');
msgIs('tahun: terlalu maju', V.validateYear(String(TAHUN_INI + 2)), `Tahun tidak boleh lebih dari ${TAHUN_INI + 1}`);
msgIs('tahun: bukan angka', V.validateYear('abc'), 'Tahun harus berupa angka');
msgIs('tahun: kosong', V.validateYear(''), 'Tahun harus berupa angka');

noError('uang: dalam rentang', V.validateAmount(5000, 1000, 10000));
noError('uang: batas bawah tepat', V.validateAmount(1000, 1000, 10000));
noError('uang: batas atas tepat', V.validateAmount(10000, 1000, 10000));
msgIs('uang: di bawah batas', V.validateAmount(999, 1000, 10000), 'Nilai minimal Rp 1.000');
msgIs('uang: di atas batas', V.validateAmount(10001, 1000, 10000), 'Nilai maksimal Rp 10.000');
msgIs('uang: NaN ditolak', V.validateAmount(NaN), 'Nilai harus berupa angka');
msgIs('uang: string kosong ditolak', V.validateAmount(''), 'Nilai harus berupa angka');

noError('persen: 0', V.validatePercentage(0));
noError('persen: 100', V.validatePercentage(100));
msgIs('persen: negatif', V.validatePercentage(-0.5), 'Persentase tidak boleh negatif');
msgIs('persen: lebih dari 100', V.validatePercentage(100.5), 'Persentase maksimal 100%');
msgIs('persen: NaN ditolak', V.validatePercentage(NaN), 'Persentase harus berupa angka');

// ── 6. validator teks ──────────────────────────────────────────
noError('email: kosong dilewati', V.validateEmail(''));
noError('email: bentuk normal', V.validateEmail('admin@hems-system.co.id'));
msgIs('email: tanpa domain akhir', V.validateEmail('a@b'), 'Format email tidak valid');
msgIs('email: ada spasi', V.validateEmail('a b@c.id'), 'Format email tidak valid');
msgIs('email: tanpa @', V.validateEmail('abc.def'), 'Format email tidak valid');

noError('telepon: kosong dilewati', V.validatePhone(''));
noError('telepon: format +62', V.validatePhone('+62-812-3456-7890'));
noError('telepon: format kurung', V.validatePhone('(021) 5551 2345'));
msgIs('telepon: kurang digit', V.validatePhone('0812345'), 'Nomor telepon minimal 10 digit');
msgIs('telepon: huruf', V.validatePhone('0812-ABC-DEF'), 'Format nomor telepon tidak valid');

noError('nama: normal', V.validateName('PT Makmur Sentosa', 3, 100));
msgIs('nama: terlalu pendek', V.validateName('AB', 3, 100), 'Nama minimal 3 karakter');
msgIs('nama: terlalu panjang', V.validateName('x'.repeat(101), 3, 100), 'Nama maksimal 100 karakter');
msgIs('nama: hanya angka', V.validateName('12345678', 3, 100), 'Nama tidak valid');
msgIs('nama: hanya simbol', V.validateName('!!!###', 3, 100), 'Nama tidak valid');
noError('nama: kosong dilewati', V.validateName(''));

noError('alamat: cukup panjang', V.validateAddress('Jl. Raya Cikande KM 12, Serang', 10));
msgIs('alamat: pendek', V.validateAddress('Jl. Mawar', 10), 'Alamat minimal 10 karakter');
noError('alamat: kosong dilewati', V.validateAddress(''));

msgIs('deskripsi: wajib diisi', V.validateDescription(''), 'Deskripsi wajib diisi');
msgIs('deskripsi: kosong berarti wajib walau dipanggil tanpa isi', V.validateDescription(null), 'Deskripsi wajib diisi');
msgIs('deskripsi: terlalu pendek', V.validateDescription('pendek', 10, 500), 'Deskripsi minimal 10 karakter');
msgIs('deskripsi: terlalu panjang', V.validateDescription('x'.repeat(501), 10, 500), 'Deskripsi maksimal 500 karakter');
noError('deskripsi: normal', V.validateDescription('Servis 500 HM excavator SY215C', 10, 500));

// ── 7. daftar nilai yang boleh (enum) ──────────────────────────
const ENUMS = [
  ['Kategori', V.validateUnitCategory, V.VALID_UNIT_CATEGORIES],
  ['Merek', V.validateBrand, V.VALID_BRANDS],
  ['Status', V.validateUnitStatus, V.VALID_UNIT_STATUSES],
  ['Tipe servis', V.validateServiceType, V.VALID_SERVICE_TYPES],
  ['Status', V.validateOrderStatus, V.VALID_ORDER_STATUSES],
  ['Kategori', V.validatePurchaseCategory, V.VALID_PURCHASE_CATEGORIES],
];
for (const [label, fn, daftar] of ENUMS) {
  let rusak = null;
  for (const nilai of daftar) if (fn(nilai) !== null) rusak = nilai;
  check(`${label}: semua anggota daftar lolos (${daftar.length} nilai)`, rusak === null, { rusak });
  noError(`${label}: kosong dilewati`, fn(''));
  const pesan = fn('TIDAK-ADA-DI-DAFTAR');
  check(`${label}: nilai asing ditolak dengan daftar pilihan`,
    pesan === `${label} tidak valid. Pilih dari: ${daftar.join(', ')}`, { pesan });
  check(`${label}: daftar sensitif huruf`, fn(daftar[0].toLowerCase()) === pesan);
}
check('daftar kategori memuat Excavator', V.VALID_UNIT_CATEGORIES.includes('Excavator'));
check('daftar merek memuat SANY', V.VALID_BRANDS.includes('SANY'));
check('status unit punya RESERVED dan MAINTENANCE',
  V.VALID_UNIT_STATUSES.includes('RESERVED') && V.VALID_UNIT_STATUSES.includes('MAINTENANCE'));

// ── 8. format & sanitasi ───────────────────────────────────────
msgIs('mata uang: tanpa desimal', V.formatCurrency(1234567), 'Rp\xa01.234.567');
msgIs('mata uang: nol', V.formatCurrency(0), 'Rp\xa00');
msgIs('mata uang: negatif', V.formatCurrency(-1000), '-Rp\xa01.000');
msgIs('sanitasi: kurang dari', V.sanitizeInput('<b>'), '&lt;b&gt;');
msgIs('sanitasi: kutip', V.sanitizeInput('a"b\'c'), 'a&quot;b&#39;c');
msgIs('sanitasi: garis miring', V.sanitizeInput('Jl. Merdeka / 12'), 'Jl. Merdeka &#x2F; 12');
msgIs('sanitasi: kosong', V.sanitizeInput(''), '');
check('sanitasi: huruf biasa utuh', V.sanitizeInput('Makmur 2026') === 'Makmur 2026');

// ── 9. validasi berkas foto ────────────────────────────────────
{
  const fa = (size, type) => ({ size, type });
  noError('berkas: tepat di batas 5MB', V.validateFileSize(fa(5 * 1024 * 1024, 'image/jpeg'), 5));
  msgIs('berkas: 1 byte di atas batas',
    V.validateFileSize(fa(5 * 1024 * 1024 + 1, 'image/jpeg'), 5), 'Ukuran file maksimal 5MB');
  noError('berkas: batas kecil custom', V.validateFileSize(fa(2000, 'image/png'), 0.01));
  msgIs('berkas: tipe asing',
    V.validateFileType(fa(100, 'application/pdf')),
    'Tipe file tidak valid. Hanya: image/jpeg, image/png, image/jpg');
  noError('berkas: jpg diterima', V.validateFileType(fa(100, 'image/jpg')));
  noError('berkas: daftar tipe custom', V.validateFileType(fa(100, 'image/webp'), ['image/webp']));
}

// ── 10. checksum pemulihan data ────────────────────────────────
{
  const R = E.getDataRecovery();
  const sum = (data) => R.calculateChecksum(data);
  check('checksum: fungsi tersedia', typeof sum === 'function');
  const satu = { units: [{ id: 'U1', serialNumber: 'SY215C-001' }], kas: [] };
  check('checksum: stabil untuk isi yang sama', sum(satu) === sum(JSON.parse(JSON.stringify(satu))));
  check('checksum: berbeda saat satu nilai berubah', sum(satu) !== sum({ ...satu, kas: [{ id: 'K1' }] }));
  check('checksum: bentuk base36', /^-?[0-9a-z]+$/.test(sum(satu)), sum(satu));
  check('checksum: urutan kunci ikut mengubah nilai (sudah didokumentasikan)',
    sum({ a: 1, b: 2 }) !== sum({ b: 2, a: 1 }));
  check('checksum: nilai undefined hilang dari JSON', sum({ a: 1, b: undefined }) === sum({ a: 1 }));
  const besar = { rows: Array.from({ length: 20000 }, (_, i) => ({ id: 'R' + i, v: i * 7 })) };
  check('checksum: data besar tidak melempar', /^-?[0-9a-z]+$/.test(sum(besar)));
  check('checksum: string kosong pun terhitung', /^-?[0-9a-z]+$/.test(sum('')));
  check('checksum: null terhitung', /^-?[0-9a-z]+$/.test(sum(null)));
}

// ── 11. kunci yang boleh ikut snapshot ─────────────────────────
{
  const s = globalThis.localStorage;
  s.clear();
  s.setItem('hems_settings', '{"company":"PT X"}');
  s.setItem('hems_business_modes', '["DEALER"]');
  s.setItem('hems_data_store_v1', 'ARSIP-BESAR-PRA-MIGRASI');
  s.setItem('HEMS_DATA_BACKUPS', '[]');
  s.setItem('hems_health_logs', '[]');
  const dipilih = E.collectSnapshotSettings();
  check('snapshot: hanya settings yang ikut',
    Object.keys(dipilih).sort().join(',') === 'hems_business_modes,hems_settings', dipilih);
  check('snapshot: arsip data tidak ikut dibekukan', dipilih.hems_data_store_v1 === undefined);
  check('snapshot: nilai settings terbawa utuh', dipilih.hems_settings === '{"company":"PT X"}');
  s.clear();
  check('snapshot: profil bersih menghasilkan daftar kosong',
    Object.keys(E.collectSnapshotSettings()).length === 0);
  s.setItem('hems_settings', '');
  check('snapshot: kunci string kosong tidak dianggap isi',
    Object.keys(E.collectSnapshotSettings()).length === 0);
}

// ── 12. penjaga hapus tersambung ke menunya ───────────────────
// Bukan uji fungsi validasi — ini penjaga sambungan. Aturan "record ini masih
// dipakai dokumen lain" hanya hidup di removeRow (dataStore), dan removeRow hanya
// dipanggil kalau halamannya memang memakai jalur itu. Halaman yang menghapus
// dengan menyaring array di memori menulis collection penuh, jadi PO / WO / SPK
// yang masih punya dokumen turunan bisa tetap hilang tanpa pernah ditanya.
// Sekali halaman kembali ke pola filter-array, aturan di main process jadi
// hiasan tanpa ada yang sadar.
const MENU_HAPUS = {
  units: 'Units.tsx',
  brands: 'Brands.tsx',
  models: 'Brands.tsx',
  customers: 'Customers.tsx',
  suppliers: 'Suppliers.tsx',
  spareParts: 'SpareParts.tsx',
  invoices: 'Invoices.tsx',
  kas: 'Finance.tsx',
  warehouse: 'Warehouse.tsx',
  sales: 'Sales.tsx',
  rentals: 'Rental.tsx',
  services: 'Service.tsx',
  purchases: 'Purchase.tsx',
  deliveries: 'Delivery.tsx',
  documents: 'Documents.tsx',
  breakdowns: 'Breakdown.tsx',
  operators: 'Operators.tsx',
  technicians: 'Technicians.tsx',
  approvals: 'Approvals.tsx',
};
const idArrayHapus = /\.filter\(\s*\w+\s*=>\s*\w+\.id\s*!==\s*\w+\s*\)/;
for (const [collection, file] of Object.entries(MENU_HAPUS)) {
  const src = fs.readFileSync(path.join(__dirname, '../../src/pages', file), 'utf8');
  check(`${file}: hapus "${collection}" lewat removeRow`,
    src.includes(`removeRow('${collection}'`));
  check(`${file}: tidak menghapus collection dengan menyaring array`,
    !idArrayHapus.test(src));
}
// Peta di atas hanya mengawasi menu yang sudah dikenal. Aturan umum ini yang
// menahan menu baru (atau perubahan lama) supaya tidak kembali ke filter-array:
// setiap halaman yang mengambil datanya dari useDataStore harus menghapus lewat
// removeRow. Brands.tsx sekarang ikut peta: katalog merek/model adalah collection
// store (brands + models) sejak 3.0.4, jadi menghapus satu entri harus menahan
// hapusnya kalau merek/kodenya masih dipakai unit — dan itu hanya berjalan lewat
// removeRow.
const halamanStore = fs.readdirSync(path.join(__dirname, '../../src/pages'))
  .filter(f => f.endsWith('.tsx'))
  .filter(f => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/pages', f), 'utf8');
    return src.includes('useDataStore') && idArrayHapus.test(src);
  });
check('tidak ada halaman berstore yang menghapus dengan menyaring array',
  halamanStore.length === 0, { halamanStore });
// Kelengkapan peta, dibandingkan dengan daftar collection yang benar-tbenar ada
// di store. bankAccounts satu-satunya yang belum punya layar hapus (kunci rekening
// dikelola lewat Settings tanpa tombol hapus). Collection baru yang muncul di
// daftar ini tanpa ikut disambungkan akan gagal di sini.
const belumPeta = E.COLLECTION_KEYS.filter(c => !MENU_HAPUS[c]);
check('setiap collection store tercatat di peta hapus (kecuali bankAccounts)',
  belumPeta.join(',') === 'bankAccounts', { belumPeta });
try {
  const { REFERENCE_RULES } = require('../../dist-electron/referential.js');
  const SCHEMA = require('../../dist-electron/dbSchema.js');
  const tanpaMenu = Object.keys(REFERENCE_RULES).filter(c => !MENU_HAPUS[c]);
  // bankAccounts memang belum punya layar hapus; kalau collection lain muncul
  // di sini, artinya aturan baru ditambah tapi menunya belum disambungkan.
  check('setiap collection berpemeriksaan rujukan punya menu yang memakai removeRow',
    tanpaMenu.join(',') === 'bankAccounts', { tanpaMenu });
  // Aturan blobField mencari di kolom "search", bukan kolom sendiri. Field yang
  // tidak ada di daftar search anak tidak akan pernah tertulis ke blob, jadi
  // rujukannya hilang tanpa suara — findReferences menolaknya dengan error, dan
  // itu menahan SETIAP hapus di menu tersebut. Lebih baik tertangkap di sini.
  const salahBlob = [];
  for (const [nama, aturan] of Object.entries(REFERENCE_RULES)) {
    for (const r of aturan || []) {
      if (!r.blobField) continue;
      const spec = SCHEMA.SPEC_BY_NAME[r.child];
      if (!spec || spec.search.indexOf(r.blobField) === -1) salahBlob.push(`${nama} -> ${r.child}.${r.blobField}`);
      if (r.column) salahBlob.push(`${nama} -> ${r.child}: column dan blobField dipakai bersama`);
    }
  }
  check('aturan blob hanya menyebut field yang benar-benar ikut ditulis ke blob pencarian',
    salahBlob.length === 0, { salahBlob });
  // Orang pernah menjadi "record daun": menghapus teknisi yang masih menulis
  // namanya di Work Order lolos tanpa penolakan. Kalau aturannya dihapus lagi,
  // ini yang menahan.
  check('teknisi dan operator punya aturan rujukan',
    (REFERENCE_RULES.technicians || []).length > 0 && (REFERENCE_RULES.operators || []).length > 0,
    { teknisi: (REFERENCE_RULES.technicians || []).length, operator: (REFERENCE_RULES.operators || []).length });
} catch (err) {
  console.log('LOMPONG: dist-electron/referential.js belum dibangun, peta menu tidak dibandingkan dengan daftar aturan');
}

// ── 12b. katalog Merek & Model adalah collection, bukan state halaman ─────────
// Sebelum 3.0.4 halaman ini mengisi dirinya sendiri dari INITIAL_BRANDS di dalam
// komponen: apa yang tampil bukan katalog perusahaan, dan setiap perubahan hilang
// saat halaman ditutup. Yang diuji di bawah adalah JALURNYA (store + removeRow +
// katalog awal hanya lewat tombol), karena itu yang bisa kembali ke pola lama
// tanpa ada yang sadar.
const BRANS = fs.readFileSync(path.join(__dirname, '../../src/pages/Brands.tsx'), 'utf8');
check('Brands.tsx: membaca katalog dari store, bukan useState lokal',
  /const \{ brands, setBrands, models, setModels, saveRow(?:s|, saveRows)?, (?:saveRows, )?removeRow \} = useDataStore\(\)/.test(BRANS)
    && !/useState<[^>]*\[\]>\(INITIAL/.test(BRANS)
    && !/INITIAL_BRANDS|INITIAL_MODELS/.test(BRANS));
check('Brands.tsx: merek dan model sama-sama dihapus lewat removeRow',
  BRANS.includes("removeRow('brands'") && BRANS.includes("removeRow('models'"));
check('Brands.tsx: nama merek wajib unik dan model wajib berdiri di bawah merek yang ada',
  /merekList\.some\(b => kecil\(b\.name\) === kecil\(name\)/.test(BRANS)
    && /sudah ada di katalog/.test(BRANS)
    && /Pilih merek yang sudah ada di katalog/.test(BRANS));
check('Brands.tsx: jumlah model per merek dihitung dari katalog, bukan field yang membeku',
  /jumlahModel/.test(BRANS) && !/modelCount/.test(BRANS));
check('Brands.tsx: mengubah nama merek ditahan bila masih dipakai unit',
  /unitPakaiMerek/.test(BRANS) && /masih ada \$\{dipakai\} unit/.test(BRANS));
// Katalog awal: boleh ada, tapi hanya lewat tombol. Ini penerapan aturan "hapus
// auto-seed palsu" pada collection baru — halaman yang mengisi dirinya sendiri
// membuat angkanya tidak bisa dipercaya lagi.
const KATALOG = fs.readFileSync(path.join(__dirname, '../../src/data/katalogAwal.ts'), 'utf8');
const alamatMuat = BRANS.indexOf('const muatKatalogAwal');
check('katalog awal hanya masuk lewat tombol eksplisit yang dikonfirmasi',
  alamatMuat >= 0 && /setBrands\(KATALOG_MEREK\.map/.test(BRANS.slice(alamatMuat, alamatMuat + 900))
    && /confirm\(/.test(BRANS.slice(alamatMuat, alamatMuat + 900))
    && !/useState[\s\S]{0,80}KATALOG_MEREK/.test(BRANS));
// Yang mengimpor modul katalog awal hanya layarnya. Kalau store atau App yang
// mengimpor, isi katalog masuk lagi tanpa ada yang menekan tombol.
const yangImporKatalog = fs.readdirSync(path.join(__dirname, '../../src'))
  .flatMap(dir => {
    const penuh = path.join(__dirname, '../../src', dir);
    if (!fs.statSync(penuh).isDirectory()) return [];
    return fs.readdirSync(penuh)
      .filter(f => /\.(ts|tsx)$/.test(f))
      .map(f => ({ berkas: `${dir}/${f}`, teks: fs.readFileSync(path.join(penuh, f), 'utf8') }));
  })
  .filter(x => /from '[^']*data\/katalogAwal'/.test(x.teks))
  .map(x => x.berkas);
check('katalog awal tidak diimpor oleh store (tidak ada auto-seed senyap)',
  yangImporKatalog.length === 1 && yangImporKatalog[0] === 'pages/Brands.tsx', { yangImporKatalog });
// Nama merek di katalog awal harus sama dengan cara units.brand mencatatnya, atau
// pemeriksaan rujukan saat hapus/rename tidak akan pernah menemukan rujukannya.
const namaKatalogAwal = [...KATALOG.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);
check('katalog awal memakai nama merek persis seperti units.brand mencatatnya',
  ['SANY', 'Komatsu', 'Caterpillar'].every(n => namaKatalogAwal.includes(n)), { namaKatalogAwal });

// ── 12c. halaman Unit mengambil merek/model dari katalog ─────────────────────
const UNIT_TEKS = fs.readFileSync(path.join(__dirname, '../../src/pages/Units.tsx'), 'utf8');
check('Units.tsx: pilihan merek datang dari collection brands dengan fallback daftar bawaan',
  /const merekKatalog = Array\.from\(new Set\(/.test(UNIT_TEKS)
    && /merekKatalog\.length > 0 \? merekKatalog : VALID_BRANDS/.test(UNIT_TEKS)
    && /merekPilihan\.map\(m =>/.test(UNIT_TEKS)
    && !/<option value="SANY">SANY<\/option>/.test(UNIT_TEKS));
check('Units.tsx: merek di luar katalog tetap bisa dibaca dan disimpan ulang',
  /(di luar katalog)/.test(UNIT_TEKS));
check('Units.tsx: kode model disarankan dari katalog model merek terpilih',
  /kodeModelKatalog\(form\.brand\)/.test(UNIT_TEKS) && /list="unit-kode-model"/.test(UNIT_TEKS));
check('Units.tsx: validasi merek menerima merek katalog',
  /validateBrand\(form\.brand, merekKatalog\)/.test(UNIT_TEKS));
check('validation.ts: validateBrand tetap tertutup tanpa katalog dan terbuka dengan katalog',
  V.validateBrand('XCMG-Baru') !== null
    && V.validateBrand('XCMG-Baru', ['XCMG-Baru']) === null
    && V.validateBrand('SANY', ['Apa-Pun']) === null);

// ── 12d. store mendaftar setiap collection di dua tempat yang harus sama ─────
// dataStore menyusun dataRef.current dari satu literal berisi nama collection.
// Nama yang hilang di sana tidak pernah ikut autosave — perubahannya hilang tanpa
// pesan. Ini membandingkan literal itu dengan COLLECTION_KEYS.
const STORE_TEKS = fs.readFileSync(path.join(__dirname, '../../src/store/dataStore.tsx'), 'utf8');
const potong = (mulai, akhir) => {
  const m = STORE_TEKS.indexOf(mulai);
  if (m < 0) return null;
  const a = STORE_TEKS.indexOf(akhir, m);
  return a < 0 ? null : STORE_TEKS.slice(m + mulai.length, a);
};
// Penanda ikut membawa ganti baris: di dalam removeRow ada `dataRef.current = {
// ...dataRef.current, [name]: … }` yang lebih dulu muncul dan bukan literal store.
const LIT = potong('dataRef.current = {\n', '\n    };');
const namaLit = new Set((LIT || '').replace(/\s+/g, ' ').split(',').map(s => s.trim()).filter(Boolean));
check('dataStore: literal dataRef memuat tepat semua COLLECTION_KEYS',
  !!LIT && E.COLLECTION_KEYS.every(k => namaLit.has(k)) && namaLit.size === E.COLLECTION_KEYS.length,
  { belum: E.COLLECTION_KEYS.filter(k => !namaLit.has(k)), lebih: [...namaLit].filter(k => !E.COLLECTION_KEYS.includes(k)) });
const SETTER_LIT = potong('const collectionSetters = useMemo<Record<string, React.Dispatch<React.SetStateAction<any[]>>>>(() => ({', '}), []');
const namaSetter = new Set((SETTER_LIT || '').replace(/\s+/g, ' ').split(',')
  .map(s => s.split(':')[0].trim()).filter(Boolean));
check('dataStore: peta setter menutup semua COLLECTION_KEYS (hidrasi bisa menulis)',
  E.COLLECTION_KEYS.every(k => namaSetter.has(k)), { belum: E.COLLECTION_KEYS.filter(k => !namaSetter.has(k)) });

// ── 13. pencarian daftar (matchesQuery) ───────────────────────
// Aturan yang dipegang pengguna: ketik "SANY SY215C" di halaman mana pun harus
// menemukan unitnya, walau merek dan model tersimpan di dua kolom berbeda.
// Dulu seluruh kalimat dibandingkan per kolom sehingga tidak ada satu kolom pun
// yang memuat kedua kata. Dua hal diuji sekaligus: kata harus tersebar boleh di
// kolom berbeda, TAPI satu kata tidak boleh terbentuk dari gabungan dua kolom.
const M = E.matchesQuery;
const unit = { brand: 'SANY', model: 'SY215C', serialNumber: 'SDPE219RPL0001234' };
const kolom = () => [unit.brand, unit.model, unit.serialNumber];
check('cari: dua kata di dua kolom berbeda tetap cocok', M(kolom(), 'SANY SY215C') === true);
check('cari: urutan kata tidak penting', M(kolom(), 'SY215C SANY') === true);
check('cari: huruf besar-kecil diabaikan', M(kolom(), 'sany sy215c') === true);
check('cari: tanda hubung pada yang diketik diabaikan', M(kolom(), 'SY-215C') === true);
check('cari: satu kata saja cukup', M(kolom(), 'SANY') === true);
check('cari: sebagian nomor rangka cocok', M(kolom(), 'PL0001234') === true);
check('cari: kata yang hanya ada di satu kolom tidak membuat rekaman lain lolos',
  M(kolom(), 'SANY KOMATSU') === false);
check('cari: kata gabungan dua kolom tidak diterima', M(['AB', 'CD'], 'ABCD') === false);
check('cari: kata yang lebih panjang dari kolomnya ditolak', M(kolom(), 'SANYXY') === false);
check('cari: koma dan titik-koma memisahkan kata', M(kolom(), 'SANY,SY215C;PC200') === false);
check('cari: query kosong menampilkan semuanya', M(kolom(), '') === true && M(kolom(), '   ') === true);
check('cari: kolom null/undefined/kosong tidak membuat pencarian melempar',
  M([null, undefined, '', 0], '0') === true && M([null, undefined], 'x') === false);
check('cari: angka ikut dicari sebagai teks', M([250, 'Ex300'], '250') === true);

// ── 14. penjaga konfigurasi packaging ─────────────────────────
// Konfigurasi pengemasan tersebar di tiga berkas yang harus sepakat:
// package.json (electron-builder), installer/FATHONI-InnoSetup.iss (Inno Setup)
// dan scripts/apply-exe-branding.cjs. Kalau salah satu bergeser, hasilnya tetap
// compile sukses — hanya saja installer mengemas paket yang salah. Itu bukan
// kekhawatiran teori: audit Fase 5 menemukan app.asar 147 MB karena seluruh
// node_modules ikut dibungkus, dan pemindahan folder output hari ini nyaris
// membuat [Files] Inno menunjuk ke paket lama.
const ROOT = path.join(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ISS = fs.readFileSync(path.join(ROOT, 'installer', 'FATHONI-InnoSetup.iss'), 'utf8');
const PS1 = fs.readFileSync(path.join(ROOT, 'build-installer.ps1'), 'utf8');
const BRI = fs.readFileSync(path.join(ROOT, 'scripts', 'apply-exe-branding.cjs'), 'utf8');
/** Baca #define <nama> "nilai" dari skrip Inno. */
const define = (nama) => {
  const m = ISS.match(new RegExp('#define\\s+' + nama + '\\s+"([^"]*)"'));
  return m ? m[1] : null;
};
const B = PKG.build;

check('packaging: nama exe sama di electron-builder dan Inno',
  define('MyAppExeName') === B.executableName + '.exe',
  { iss: define('MyAppExeName'), builder: B.executableName });
check('packaging: nama produk sama di electron-builder dan Inno',
  define('MyAppName') === B.productName,
  { iss: define('MyAppName'), builder: B.productName });
check('packaging: sumber [Files] Inno = folder output electron-builder',
  define('AppUnpackedDir') === '..\\' + B.directories.output.replace(/\//g, '\\') + '\\win-unpacked',
  { iss: define('AppUnpackedDir'), output: B.directories.output });
check('packaging: AppId tidak berubah (kunci upgrade instalasi lama)',
  ISS.includes('AppId={{E8B71C02-A23B-4921-99A1-HEMS-2026}'));

// Asar 147 MB dulu berisi Prisma, @types, dan seluruh node_modules. whitelist
// harus tetap putih: menambah dependensi baru tidak boleh otomatis ikut terkirim.
check('packaging: yang dibungkus hanya dist, dist-electron, better-sqlite3',
  B.files.includes('dist/**/*') && B.files.includes('dist-electron/**/*')
    && B.files.includes('node_modules/better-sqlite3/**/*'),
  B.files);
check('packaging: tidak ada wildcard node_modules di files',
  !B.files.some((f) => /^node_modules\/\*\*/.test(f) && !f.includes('better-sqlite3')),
  B.files);
check('packaging: file .map dan .pdb dikecualikan',
  B.files.includes('!**/*.map') && B.files.includes('!**/*.pdb'), B.files);

// electron-builder hanya bisa mengedit resource exe kalau arsip winCodeSign bisa
// diekstrak; arsip itu berisi symlink macOS yang butuh hak khusus, jadi jalur
// resminya mati di mesin ini dan ikon dikerjakan scripts/apply-exe-branding.cjs.
check('packaging: electron-builder tidak mengedit exe (ikon lewat skrip sendiri)',
  B.win.signAndEditExecutable === false, B.win);
check('packaging: build-installer.ps1 menjalankan skrip branding sebelum ISCC',
  PS1.includes('apply-exe-branding') && PS1.indexOf('apply-exe-branding') < PS1.indexOf('ISCC'),
  undefined);
check('packaging: rcedit yang dipakai skrip branding ikut tersimpan di proyek',
  fs.existsSync(path.join(ROOT, 'scripts', 'tools', 'rcedit-x64.exe')));

// Versi dipakai tiga tempat: resource exe (rcedit), AppVersion dan nama installer.
// rcedit memecah angka per titik, jadi format harus tegas tiga bagian.
check('packaging: versi package.json tiga angka',
  /^\d+\.\d+\.\d+$/.test(PKG.version), PKG.version);
check('packaging: build-installer.ps1 membaca versi dari package.json, tidak hardcode',
  PS1.includes('.version') && !/FATHONI-Setup-\d/.test(PS1));
check('packaging: author ada (dipakai CompanyName exe)',
  typeof PKG.author === 'string' && PKG.author.length > 0, PKG.author);
check('packaging: satu ikon yang sama untuk installer dan exe aplikasi',
  ISS.includes('SetupIconFile=assets\\fathoni.ico') && BRI.includes("'fathoni.ico'")
    && fs.existsSync(path.join(ROOT, 'installer', 'assets', 'fathoni.ico')));

// Masih ada berkas .iss KEDUA di root, warisan sebelum pengemasan dirapikan:
// installer.iss mengemas dari dist-electron-portable/win-unpacked — folder yang
// ditinggalkan karena app.asar-nya ikut membungkus seluruh node_modules (147 MB) —
// dengan AppVersion "1.0.0" tertulis mati dan OutputDir ke dist-installer. Kalau
// sampai dikompilasi, hasilnya installer "versi hantu" yang mendarat di folder
// rilis bersama yang 3.0.2. Berkasnya sendiri tidak dihapus (keputusan pengguna),
// tapi tidak boleh ada satu pun jalur build yang memanggilnya.
const ISS_LAMA = fs.existsSync(path.join(ROOT, 'installer.iss'))
  ? fs.readFileSync(path.join(ROOT, 'installer.iss'), 'utf8') : '';
const JALUR_BUILD = PS1 + ' ' + Object.values(PKG.scripts || {}).join(' ');
check('packaging: ISCC hanya dipanggil dengan installer resmi (installer\\FATHONI-InnoSetup.iss)',
  /\$iscc[\s\S]*installer\\FATHONI-InnoSetup\.iss/.test(PS1), PS1.match(/\$iscc.*/g));
check('packaging: tidak ada jalur build yang memanggil .iss lama di root',
  !/(^|["'\s\\/])installer\.iss\b/.test(JALUR_BUILD)
    && (!ISS_LAMA || /dist-electron-portable/.test(ISS_LAMA)),
  { referensi: JALUR_BUILD.match(/(^|["'\s\\/])installer\.iss\b/g), sumberIssLama: (ISS_LAMA.match(/Source:\s*"([^"]+)"/) || [])[1] });


// ── 15. penjaga cara harness mengakhiri proses ────────────────
// app.exit() melompati before-quit main.js, jadi koneksi SQLite tetap terbuka
// saat Windows membongkar DLL-nya. Hasilnya pernah terlihat di rantai regresi:
// 72 assertion lulus semua, tapi proses keluar dengan Segmentation fault (139)
// sehingga rantai ditandai rusak. Semua harness Electron karena itu wajib lewat
// tests/harness/selesai.cjs.
//
// Daftarnya DERIVASI dari cara rantai benar-benar memanggil harness: baris
// "$ELEKTRON" di regressi.sh, ditambah harness yang di-spawn orkestrator
// (*-run.cjs) lewat electron/cli.js. Bukan daftar tulis tangan — daftar tulis
// pernah tertinggal satu harness (cetak-check) persis seperti komplain yang kami
// buat untuk menu di §16: penjaga yang daftarnya harus disenyorkan manual tidak
// menjaga apa-apa.
const REGRESH = fs.readFileSync(path.join(__dirname, 'regressi.sh'), 'utf8');
const PANGGIL = [...REGRESH.matchAll(/"\$ELEKTRON"\s+tests\/harness\/([\w.-]+\.cjs)/g)].map((m) => m[1]);
for (const f of fs.readdirSync(__dirname).filter((x) => /-run\.cjs$/.test(x))) {
  const t = fs.readFileSync(path.join(__dirname, f), 'utf8');
  for (const m of t.matchAll(/path\.join\(__dirname,\s*'([\w.-]+\.cjs)'\)/g)) {
    if (m[1] !== f) PANGGIL.push(m[1]);
  }
}
const HARNESS_ELECTRON = [...new Set(PANGGIL)];
check('harness: rantai menyebut dua belas harness Electron (daftar tidak kosong)',
  HARNESS_ELECTRON.length >= 12, HARNESS_ELECTRON);
// Selain langkah rantai, satu-satunya pengguna electron yang boleh keluar sendiri
// adalah perkakas inspeksi manual (tidak mencetak assertion, tidak dinilai rantai).
const DI_LUAR_RANTAI = { 'profile-inspect.cjs': 'perkakas baca profil untuk manusia, bukan langkah regresi' };
const PEMAKAI_ELECTRON = fs.readdirSync(__dirname)
  .filter((f) => /\.cjs$/.test(f) && !/^selesai\.cjs$/.test(f))
  .filter((f) => /require\('electron'\)/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
check('harness: setiap pengguna electron adalah langkah rantai atau perkakas yang dinyatakan',
  PEMAKAI_ELECTRON.every((f) => HARNESS_ELECTRON.includes(f) || DI_LUAR_RANTAI[f]),
  PEMAKAI_ELECTRON.filter((f) => !HARNESS_ELECTRON.includes(f) && !DI_LUAR_RANTAI[f]));
for (const f of HARNESS_ELECTRON) {
  const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
  check(`${f}: keluar lewat selesai(), tidak app.exit() langsung`,
    !/[^.]app\.exit\(/.test(src) && src.includes("require('./selesai.cjs')"));
}
// selesai() wajib menutup koneksi sebelum app.exit(), dan wajib mengumumkan
// hasilnya sendiri supaya rantai tidak menilai uji dari kode keluar proses.
const SELESAI_SRC = fs.readFileSync(path.join(__dirname, 'selesai.cjs'), 'utf8');
// Komentar kepala berkas menyebut app.exit() sebagai hal yang dilarang; yang
// dibandingkan di sini hanya baris kode.
const SELESAI_KODE = SELESAI_SRC.replace(/^\s*\/\/.*$/gm, '');
check('selesai.cjs: menutup database sebelum app.exit dan mencetak penanda',
  /closeDatabase\(\)/.test(SELESAI_KODE) && /SELESAI kode=/.test(SELESAI_SRC)
  && SELESAI_KODE.indexOf('closeDatabase()') < SELESAI_KODE.indexOf('app.exit('));

// Rantai memanggil electron.exe langsung (satu proses node npm lebih sedikit di
// mesin 3,8 GB, dan kode keluar tidak lagi bisa berasal dari pembungkus).
check('regressi: harness Electron dipanggil lewat electron.exe, bukan npx',
  /ELEKTRON=node_modules\/electron\/dist\/electron\.exe/.test(REGRESH)
  && !/npx\s+electron/.test(REGRESH.replace(/^\s*#.*$/gm, '')), REGRESH.match(/npx\s+electron/));


// ── 16. penjaga cakupan rute di harness UI ────────────────────
// "Semua layar sudah diuji ukurannya" selama ini hanya berarti 16 dari 25 menu
// pernah dibuka: sembilan rute lain (Pengiriman, Breakdown, Dokumen, Operator,
// Teknisi, Persetujuan, Jejak Audit, Perawatan Sistem, Merek) tidak dilewati
// harness mana pun, jadi kolom terpotong atau halaman kosong di sana tidak akan
// pernah ada yang melaporkan. Penjaga ini membandingkan daftar rute nyata di
// App.tsx dengan rute yang disebut harness UI — rute baru tanpa uji ikut tertahan.
const APP = fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8');
const RUTE_APP = [...new Set([...APP.matchAll(/path="(\/[^"]*)"/g)].map(m => m[1]))].filter(p => p !== '*');
check('cakupan UI: daftar rute terbaca dari App.tsx (penjaga tidak boleh kosong)',
  RUTE_APP.length >= 25, RUTE_APP.length);
const HARNESS_UI = ['usable-check.cjs', 'handoff-check.cjs', 'flow-check.cjs',
  'compat-check.cjs', 'perf-check.cjs', 'gui-check.cjs', 'db-store-check.cjs'];
const TeksUI = HARNESS_UI.map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
const segmen = (p) => p.replace(/^\/+/, '').split('/')[0];
const DI_LUAR_UJI_UI = {
  dashboard: 'alias beranda; rute "/" sudah dilewati usable-check',
  login: 'layar login dibuka flow-check sebelum harness lain menyentuh UI',
  setup: 'wizard profil hanya tampil sebelum setup selesai; harness memakai isSetupComplete',
};
const belumDiuji = RUTE_APP.filter(p => {
  const s = segmen(p);
  if (DI_LUAR_UJI_UI[s]) return false;
  return s === '' ? !TeksUI.includes("['/',") : !TeksUI.includes('#/' + s);
});
check('cakupan UI: setiap rute aplikasi dilewati minimal satu harness',
  belumDiuji.length === 0, belumDiuji);

// ── 17. penjaga Jejak Audit membaca log yang sungguhan ────────
// Halaman ini pernah menampilkan lima baris karangan (id AUDIT-001..005,
// "Simulate audit logs") padahal main process menyimpan kejadian nyata di kanal
// auth-audit-log. Log palsu lebih berbahaya dari tidak ada log: percobaan login
// gagal tidak pernah muncul, dan yang dibaca pengelola terlihat seperti bukti.
const HALAMAN_LOG = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'AuditLog.tsx'), 'utf8');
// Komentar sejarah ("halaman ini dulu menayangkan log karangan") boleh menulis
// kata itu; yang tidak boleh adalah log karangan di dalam kode.
const KODE_LOG = HALAMAN_LOG.replace(/^\s*\/\/.*$/gm, '');
check('AuditLog: sumber datanya authClient (kanal auth-audit-log)',
  HALAMAN_LOG.includes("from '../services/authClient'") && /auditLog\(/.test(HALAMAN_LOG));
check('AuditLog: tidak ada log karangan di dalam kode',
  !/Simulate|AUDIT-00\d|"Unit"|'Unit'/.test(KODE_LOG), KODE_LOG.match(/Simulate|AUDIT-00\d/g));
check('AuditLog: CSV lewat util yang meng-escape dan menahan injeksi formula',
  HALAMAN_LOG.includes('buildCsv') && !HALAMAN_LOG.includes('URL.createObjectURL'));
// Menu tidak boleh menawarkan log yang main process tolak untuk peran itu.
const MULAI_MENU = fs.readFileSync(path.join(ROOT, 'src', 'components', 'Layout.tsx'), 'utf8');
const POTONG = MULAI_MENU.indexOf("path: '/audit-log'");
check('AuditLog: menu hanya untuk SUPERADMIN, sama seperti penolakan main process',
  POTONG >= 0 && /requiredRoles:\s*\[[^\]]*SUPERADMIN/.test(MULAI_MENU.slice(POTONG, POTONG + 400)));
const KEBUTUHAN = fs.readFileSync(path.join(ROOT, 'src', 'store', 'collectionNeeds.ts'), 'utf8');
check('AuditLog: rute tidak menghidrasi collection yang tidak dibacanya',
  /'audit-log':\s*\[\]/.test(KEBUTUHAN));

// ── 18. penjaga health check memeriksa penyimpanan yang benar ──
// Smoke test paket 3.0.0 menemukan probe '_hems_health_test_' masih ditulis ke
// localStorage setiap siklus di mode desktop, sementara data pengguna sudah
// pindah ke SQLite. Akibatnya arsip pra-SQLite terus tumbuh dan file basis data
// yang tidak terbuka bisa tertutup status "localStorage bisa ditulis".
const HEALTH = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'healthCheck.ts'), 'utf8');
check('healthCheck: mengenal lapisan SQLite',
  /dbAvailable/.test(HEALTH) && /dbInfo/.test(HEALTH) && /dbIntegrity/.test(HEALTH));
check('healthCheck: cek penyimpanan pertama dialihkan ke SQLite bila tersedia',
  /if \(dbAvailable\(\)\) return this\.checkSqlite\(\);/.test(HEALTH));
check('healthCheck: integritas dibaca dari PRAGMA, bukan dari kunci hems_* lama',
  /if \(dbAvailable\(\)\) return this\.checkSqliteIntegrity/.test(HEALTH));
// Probe tulis localStorage hanya boleh ada di cabang browser (mode demo).
check('healthCheck: probe tulis localStorage hanya untuk mode demo',
  HEALTH.indexOf('checkLocalStorageBrowser') >= 0 &&
  HEALTH.indexOf('_hems_health_test_') > HEALTH.indexOf('checkLocalStorageBrowser'));
// Nama cek berubah menjadi 'storage'; pemulihan otomatis tidak boleh lagi
// menyapu localStorage saat yang rusak adalah file basis data.
check('healthCheck: pemulihan localStorage tidak dijalankan di mode desktop',
  !/case 'localStorage':/.test(HEALTH) &&
  /if \(!dbAvailable\(\)\) this\.fixLocalStorage\(\);/.test(HEALTH));

// ── 19. penjaga lokasi data pada paket + uji asap rilis ───────
// Paket mem-pin folder datanya supaya rebrand tidak memindahkan database. Satu
// jalan keluar yang diizinkan adalah --user-data-dir (switch resmi Chromium);
// tanpa itu, uji asap paket akan mengganti password admin dan menulis jejak audit
// ke profil pengguna nyata — pernah terjadi dan harus dikembalikan manual.
const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.ts'), 'utf8');
check('main: paket hanya berpindah folder data bila --user-data-dir disebut',
  /getSwitchValue\('user-data-dir'\)/.test(MAIN) &&
  /forcedDataDir = app\.isPackaged \? switchDataDir : \(process\.env\.HEMS_DATA_DIR \|\| ''\)/.test(MAIN));
const SMOKE = fs.readFileSync(path.join(ROOT, 'tests', 'harness', 'smoke-paket-check.cjs'), 'utf8');
check('smoke-paket: menjalankan FATHONI.exe selalu dalam sandbox',
  /--user-data-dir=\$\{PROFIL\}/.test(SMOKE) && !/APPDATA: SANDBOX/.test(SMOKE));
check('smoke-paket: profil nyata dibandingkan sebelum/sesudah agar kebocoran terlihat',
  /sebelumLive === sesudahLive/.test(SMOKE));

// ── 20. boundary dipasang per rute, bukan hanya di akar ───────────
// ErrorBoundary di akar (App.tsx) menyimpan status kesalahan sampai aplikasi
// dimuat ulang. Satu layar yang melempar karena satu baris rusak membuat SEMUA
// menu ikut menampilkan "Terjadi Kesalahan" — inilah bentuk "aplikasi macet" yang
// paling sering dilaporkan, padahal file basis datanya baik-baik saja. ProtectedRoute
// sekarang membungkus kontennya sendiri dengan boundary berkunci rute, jadi
// pindah menu memulihkan layar.
const APPSRC = fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8');
check('App: konten terlindungi dibungkus boundary berkunci rute (pulih saat pindah menu)',
  /<ErrorBoundary key=\{[^}]*pathname[^}]*\}>/.test(APPSRC));
check('App: boundary akar tetap ada untuk error di luar rute',
  /<ErrorBoundary>\s*<AuthProvider>/.test(APPSRC));
check('handoff-check bagian 10 menguji enam menu katalog menghapus lewat patch',
  /KATALOG/.test(fs.readFileSync(path.join(ROOT, 'tests', 'harness', 'handoff-check.cjs'), 'utf8')));

// ── 21. nilai asing tidak boleh menjatuhkan layar ──────────────────
// Peta status/severity ditulis sebagai Record<Enum, {label, badge}> sehingga TypeScript
// mengira kuncinya selalu dikenal. Baris dari SQLite tidak tahu itu: kolom status hanya
// TEXT, dan satu nilai di luar daftar membuat `MAP[nilai].label` melempar saat layar
// merender. Inilah jalan masuk yang dipakai handoff 10.14 (severity 'MEDIUM'), dan
// sebelum boundary per rute dipasang kerusakannya menyebar ke semua menu. Yang boleh
// adalah bentuk yang sudah dipakai Purchase/Rental/Service/Warehouse/Delivery: `?.`
// dengan fallback, jadi barisnya tetap tampil dengan nilainya apa adanya.
const BERKAS_SRC = [];
(() => {
  const jalan = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) jalan(p);
      else if (/\.(tsx|ts)$/.test(ent.name) && !/\.d\.ts$/.test(ent.name)) BERKAS_SRC.push(p);
    }
  };
  jalan(path.join(ROOT, 'src'));
})();
check('penjaga membaca berkas sumber (daftar tidak boleh kosong karena jalur salah)',
  BERKAS_SRC.length > 30, { jumlah: BERKAS_SRC.length });
// `[^\]]*\]` lalu TITIK tanpa tanda tanya: persis pola yang melempar.
const TANPA_FALLBACK = [];
for (const f of BERKAS_SRC) {
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((baris, i) => {
    if (/(MAP|CONFIG|LABELS|STYLES|BADGES|ICONS)\[[^\]]*\]\.(label|badge|icon)\b/.test(baris)) {
      TANPA_FALLBACK.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + baris.trim());
    }
  });
}
check('setiap pembacaan peta label/badge memakai ?., sehingga nilai asing tidak meruntuhkan layar',
  TANPA_FALLBACK.length === 0, { TANPA_FALLBACK });

// ── 22. kolom yang boleh kosong tidak boleh langsung dipakai ─────────
// Kolom INTEGER/REAL dikembalikan lapisan SQLite sebagai null kalau barisnya tidak
// punya field itu — terbukti lewat handoff 10.16, yang membuat layar Operator dan
// Teknisi jatuh hanya karena satu baris tanpa totalHours. Data lama, hasil impor,
// dan restore semuanya bisa membawa baris seperti ini. Jadi angka/teks dari baris
// harus dibaca dengan `?? ` atau diperiksa dulu sebelum `.toLocaleString()` /
// `.toLowerCase()`. Aturan ini hanya menyaring src/pages: di situ `item` selalu
// baris database, sementara di komponen `item` bisa saja konfigurasi menu yang
// labelnya terjamin ada (Layout.tsx mencari dengan item.label.toLowerCase()).
const PANGGILAN_LANGSUNG = /\bitem\.([A-Za-z_]+)\.(toLocaleString|toFixed|toLowerCase|toUpperCase|replace|split|trim|charAt|padStart)\(/g;
const LANGSUNG = [];
for (const f of BERKAS_SRC.filter(x => x.includes(path.join('src', 'pages')))) {
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((baris, i) => {
    for (const m of baris.matchAll(PANGGILAN_LANGSUNG)) {
      const field = m[1];
      const dijaga = baris.includes(`${field} ?? `) || baris.includes(`item.${field} ?`)
        || baris.includes(`item.${field} &&`);
      if (!dijaga) LANGSUNG.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + baris.trim());
    }
  });
}
check('halaman: angka/teks dari baris dibaca lewat ?? atau pemeriksaan dulu (null tidak meruntuhkan layar)',
  LANGSUNG.length === 0, { LANGSUNG });
check('handoff-check menguji baris tanpa kolom angka di Operator dan Teknisi',
  /H10NULL-OP/.test(fs.readFileSync(path.join(ROOT, 'tests', 'harness', 'handoff-check.cjs'), 'utf8')));

// ── 23. nomor dokumen berikutnya ───────────────────────────────
// Nomor bisnis adalah kunci yang dipakai antar menu saling menunjuk (lihat
// electron/referential.ts). Dua dokumen bernomor sama membuat rujukan tidak
// terbaca lagi dan penolakan hapus salah alamat. Sumber nomornya dulu panjang
// array di halaman — menghapus satu record meninggalkan celah dan saran
// berikutnya menabrak nomor yang masih ada di file.
(async () => {
  const N = E;
  const buat = (n) => `T-${String(n).padStart(3, '0')}`;

  check('nomor: akhiran digit dibaca',
    N.urutanTerakhir('SO-2026-007') === 7 && N.urutanTerakhir('INV-2026-0011') === 11,
    { tujuh: N.urutanTerakhir('SO-2026-007'), sebelas: N.urutanTerakhir('INV-2026-0011') });
  check('nomor: tanpa angka di ujung bernilai 0, bukan NaN',
    N.urutanTerakhir('ABC') === 0 && N.urutanTerakhir(null) === 0 && N.urutanTerakhir(undefined) === 0
    && N.urutanTerakhir('') === 0 && N.urutanTerakhir(12) === 12);
  check('nomor: tertinggi dari baris memori, termasuk baris tanpa field',
    N.urutanTertinggi([{ no: 'T-003' }, { no: 'T-011' }, {}], 'no') === 11
    && N.urutanTertinggi([], 'no') === 0 && N.urutanTertinggi(undefined, 'no') === 0);

  const tanya = (isi) => async () => isi;
  check('nomor: file kosong memberi nomor pertama',
    await N.cariUrutanBebas(1, buat, tanya([])) === 1);
  check('nomor: celah hasil hapus tidak ditawari ulang',
    await N.cariUrutanBebas(9, buat, tanya(['T-009'])) === 10);
  check('nomor: deretan penuh melewati satu kelompok kandidat',
    await N.cariUrutanBebas(1, buat, tanya(
      Array.from({ length: 60 }, (_, i) => buat(i + 1)))) === 61);
  // Lebar nomor pernah tidak seragam (template 'INV-2026-00' + angka): 0010 dan
  // 010 adalah urutan yang sama dan tetap dianggap tabrakan.
  check('nomor: urutan yang sama dengan lebar berbeda tetap tabrakan',
    await N.cariUrutanBebas(10, buat, tanya(['T-00010'])) === 11);
  check('nomor: embel lain tidak menahan kandidat (penyaring kolom tak dikenal)',
    await N.cariUrutanBebas(1, buat, tanya(['TRX-2026-001', 'INV-2026-001'])) === 1);
  check('nomor: mulai dari nilai < 1 tidak menghasilkan urutan 0',
    await N.cariUrutanBebas(0, buat, tanya([])) === 1
    && await N.cariUrutanBebas(-5, buat, tanya([])) === 1);

  // Mode browser (tidak ada electronAPI): hanya array di memori yang bisa dibaca.
  check('nomor: tanpa database, saran bersumber dari array maksimum',
    await N.nomorBerikut('sales', 'orderNo', [{ orderNo: 'SO-2026-004' }], buat) === 'T-005');
  check('nomor: array kosong tanpa database memberi nomor pertama',
    await N.nomorBerikut('sales', 'orderNo', [], buat) === 'T-001');
  check('nomor: keadaan awal form tidak pernah bernomor 000',
    N.nomorSementara([], 'no', buat) === 'T-001'
    && N.nomorSementara([{ no: 'T-007' }], 'no', buat) === 'T-008');

  // ── penjaga statis: tidak ada lagi nomor yang lahir dari panjang array ──
  const HALAMAN = fs.readdirSync(path.join(ROOT, 'src', 'pages'))
    .filter(f => /\.tsx$/.test(f)).map(f => path.join(ROOT, 'src', 'pages', f));
  const DARI_LENGTH = [];
  const PANGGILAN = [];
  for (const f of HALAMAN) {
    const teks = fs.readFileSync(f, 'utf8');
    teks.split(/\r?\n/).forEach((baris, i) => {
      if (/\.length\s*\+\s*\d/.test(baris) && /No|nomor|Number|Nomor/.test(baris)) {
        DARI_LENGTH.push(path.basename(f) + ':' + (i + 1) + '  ' + baris.trim());
      }
      for (const m of baris.matchAll(/nomorBerikut\(\s*'([A-Za-z]+)'\s*,\s*'([A-Za-z0-9]+)'/g)) {
        PANGGILAN.push({ berkas: path.basename(f), collection: m[1], field: m[2] });
      }
    });
  }
  check('halaman: tidak ada nomor dokumen yang dibangun dari panjang array',
    DARI_LENGTH.length === 0, { DARI_LENGTH });
  const PERLU = ['approvals', 'breakdowns', 'deliveries', 'invoices', 'operators', 'purchases',
    'rentals', 'sales', 'services', 'technicians', 'warehouse'];
  const colect = [...new Set(PANGGILAN.map(p => p.collection))];
  check('halaman: sebelas nomor bisnis diturunkan lewat nomorBerikut',
    PERLU.every(c => colect.includes(c)), { belum: PERLU.filter(c => !colect.includes(c)) });
  try {
    const SCHEMA = require('../../dist-electron/dbSchema.js');
    const kolom = (c) => new Set((SCHEMA.SPEC_BY_NAME[c] || { columns: [] }).columns.map(x => x.col));
    const salah = PANGGILAN.filter(p => !kolom(p.collection).has(p.field));
    // Kalau field-nya bukan kolom SQL, WHERE diabaikan dan file mengembalikan baris
    // apa saja: nomor bisa tertahan palsu atau, lebih buruk, tabrakan tidak terlihat.
    check('nomorBerikut: setiap collection/field nyata ada sebagai kolom SQL',
      salah.length === 0, { salah });
  } catch (err) {
    console.log('LOMPONG: dist-electron/dbSchema.js belum dibangun, kolom nomor tidak dibandingkan dengan skema');
  }

  // ── 24. field array dari baris tidak boleh langsung dipanggil ────────
  // Perluasan §22 untuk kolom yang berbentuk array. Dua lapis bahayanya:
  // baris lama / hasil impor / restore bisa tidak punya field itu sama sekali
  // (`item.certifications.map` melempar pada undefined), dan backups yang disunting
  // manusia bisa menyimpannya sebagai teks — `item.X && item.X.length > 0` LOLOS untuk
  // string, lalu `.map` tetap melempar. Jadi yang diterima hanya normalisasi eksplisit:
  // `Array.isArray(...)` atau `?? []` / `|| []` pada baris yang sama. Yang dibaca lewat
  // variabel hasil normalisasi (`sertifikat.map`) tidak terlihat pola ini memang sengaja:
  // normalisasinya sudah ada satu baris di atasnya dan dijaga pola `Array.isArray`.
  const NAMA_ARRAY = ['certifications', 'partsUsed', 'specializations', 'skills',
    'compatibleModels', 'photos', 'items', 'serviceRecords', 'categories', 'models'];
  const METODE_ARRAY = ['map', 'filter', 'slice', 'join', 'length', 'includes', 'some', 'every',
    'find', 'findIndex', 'forEach', 'reduce', 'indexOf', 'concat', 'push', 'at'].join('|');
  const BACA_ARRAY = new RegExp('\\bitem\\.(' + NAMA_ARRAY.join('|') + ')\\.(' + METODE_ARRAY + ')\\b', 'g');
  const TANPA_NORMALIASI = [];
  for (const f of BERKAS_SRC) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((baris, i) => {
      for (const m of baris.matchAll(BACA_ARRAY)) {
        const field = m[1];
        const dijaga = /Array\.isArray\(\s*[\w.]*\b/.test(baris)
          || /\?\?\s*\[\s*\]/.test(baris) || /\|\|\s*\[\s*\]/.test(baris);
        if (!dijaga) TANPA_NORMALIASI.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + baris.trim());
      }
    });
  }
  check('field array dari baris dinormalkan (Array.isArray / ?? []) sebelum dipakai',
    TANPA_NORMALIASI.length === 0, { TANPA_NORMALIASI });
  // cetak adalah satu-satunya jalan yang membaca sertifikat/partsUsed, dan ia dibangun
  // dari htmlContent di dalam handlePrint — jadi bentuk normalisasinya dikunci statis.
  // Dua bentuk yang diterima: normalisasi INLINE di dalam template, atau satu PENJAGA
  // LOKAL yang memakai Array.isArray lalu dipanggil untuk kolom itu. Yang harus tetap
  // ditolak adalah membaca kolom array mentah — string dari baris lama atau hasil
  // suntingan tangan lolos `item.X && item.X.length > 0`, lalu `.map` melempar dan
  // seluruh layar/rute ikut runtuh.
  const PENJAGA_LOKAL = /const\s+(\w+)\s*=\s*\([^)]*\)\s*:[^=]*=>\s*\(?\s*Array\.isArray\s*\(/;
  const KOLOM_ARRAY_CETAK = ['certifications', 'partsUsed', 'specializations', 'skills'];
  const TERCETAK = [];
  for (const f of ['src/pages/Operators.tsx', 'src/pages/Technicians.tsx', 'src/pages/Breakdown.tsx']) {
    const teks = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const penjaga = teks.match(PENJAGA_LOKAL);
    for (const kolom of KOLOM_ARRAY_CETAK) {
      // Hanya kolom yang memang disebut di file ini yang ditagih.
      if (!new RegExp('item\\.' + kolom + '\\b').test(teks)) continue;
      const inline = new RegExp('Array\\.isArray\\(\\s*item\\.' + kolom + '\\s*\\)\\s*\\?\\s*item\\.' + kolom + '\\s*:\\s*\\[\\]').test(teks);
      const lewat = !!penjaga && new RegExp('\\b' + penjaga[1] + '\\s*\\(\\s*item\\.' + kolom + '\\b').test(teks);
      if (!inline && !lewat) TERCETAK.push(f + ' -> ' + kolom);
    }
  }
  check('template cetak Operator/Teknisi/Breakdown menormalkan array sebelum template',
    TERCETAK.length === 0, { TERCETAK });

  // ── 25. katalog modul Settings sinkron dengan sidebar ────────────────
  // Dua daftar menerangkan menu yang sama: NAV_GROUPS di Layout.tsx (sidebar,
  // yang tiap hari dilihat user) dan ALL_MODULES di Settings.tsx (katalog modul di
  // tab Pengaturan). Keduanya dulu berdiri sendiri: `/rental` berada di grup
  // Transaksi di sidebar tapi berkategori 'Operasional' di katalog, dan urutan
  // katalog masih warisan lama. User yang mengaktifkan modul dari Pengaturan lalu
  // mencari menunya di sidebar menemukan posisi dan kelompok yang berbeda — persis
  // "miss komunikasi antar menu" yang dilarang. Yang dikunci: kategori katalog ==
  // grup sidebar, urutan katalog == subsekuensi urutan sidebar, dan urutan grup
  // sidebar itu sendiri adalah siklus proyek dari awal sampai selesai.
  const LAYOUT_TEKS = fs.readFileSync(path.join(ROOT, 'src', 'components', 'Layout.tsx'), 'utf8');
  const AWAL_NAV = LAYOUT_TEKS.indexOf('const NAV_GROUPS');
  const NAV_TEKS = LAYOUT_TEKS.slice(AWAL_NAV, LAYOUT_TEKS.indexOf('\n];', AWAL_NAV));
  check('sidebar: blok NAV_GROUPS terbaca', AWAL_NAV > 0 && NAV_TEKS.length > 1000,
    { AWAL_NAV, panjang: NAV_TEKS.length });

  const GRUP_NAV = [];        // [{ grup, paths: [...] }]
  const GRUP_DARI_PATH = {};  // '/sales' -> 'Transaksi'
  const URUT_SIDEBAR = [];    // path dalam urutan tampil
  let grupAktif = null;
  for (const baris of NAV_TEKS.split(/\r?\n/)) {
    const g = /^\s{4}label: '([^']+)',$/.exec(baris);
    if (g) { grupAktif = g[1]; GRUP_NAV.push({ grup: g[1], paths: [] }); continue; }
    const p = /^\s{8}path: '(\/[^']+)',$/.exec(baris);
    if (p && grupAktif) {
      GRUP_NAV[GRUP_NAV.length - 1].paths.push(p[1]);
      GRUP_DARI_PATH[p[1]] = grupAktif;
      URUT_SIDEBAR.push(p[1]);
    }
  }
  // Parser berbasis indentasi bisa diam-diam menghasilkan daftar pendek kalau
  // formatnya berubah. Penjaga: jumlah path yang terbaca harus sama dengan jumlah
  // baris `path:` yang ada di blok itu.
  const JUMLAH_BARIS_PATH = (NAV_TEKS.match(/^\s{8}path:/gm) || []).length;
  check('sidebar: seluruh item NAV_GROUPS terbaca parser (daftar tidak boleh bocor)',
    URUT_SIDEBAR.length === JUMLAH_BARIS_PATH && GRUP_NAV.length >= 6 && URUT_SIDEBAR.length >= 25,
    { terbaca: URUT_SIDEBAR.length, diBerkas: JUMLAH_BARIS_PATH, grup: GRUP_NAV.map(x => x.grup) });

  // Siklus: beranda -> master data -> transaksi (beli, jual/sewa, tagih) ->
  // operasional (stok & servis menindaklanjuti) -> keuangan -> sistem.
  const SIKLUS = ['Utama', 'Master Data', 'Transaksi', 'Operasional', 'Keuangan', 'Sistem'];
  check('sidebar: grup mengikuti siklus proyek awal-sampai-selesai',
    GRUP_NAV.map(x => x.grup).join('|') === SIKLUS.join('|'),
    { nyata: GRUP_NAV.map(x => x.grup), diharapkan: SIKLUS });
  const URUT_TRANSAKSI = (GRUP_NAV.find(x => x.grup === 'Transaksi') || { paths: [] }).paths;
  const posOf = (p) => URUT_TRANSAKSI.indexOf(p);
  check('sidebar: dalam Transaksi urutan belanjanya dahulu (PO -> SO/Sewa -> Faktur)',
    URUT_TRANSAKSI.includes('/purchase') && URUT_TRANSAKSI.includes('/sales')
    && URUT_TRANSAKSI.includes('/rental') && URUT_TRANSAKSI.includes('/invoices')
    && posOf('/purchase') < posOf('/sales')
    && posOf('/sales') < posOf('/invoices') && posOf('/rental') < posOf('/invoices'),
    { Transaksi: URUT_TRANSAKSI });

  const SETTINGS_TEKS = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Settings.tsx'), 'utf8');
  const KATALOG = [...SETTINGS_TEKS.matchAll(/^\s*\{\s*path:\s*'(\/[^']+)',.*?\bcat:\s*'([^']+)'/gm)]
    .map(m => ({ path: m[1], cat: m[2] }));
  check('katalog modul: daftar ALL_MODULES terbaca (penjaga tidak boleh kosong)',
    KATALOG.length >= 17, { jumlah: KATALOG.length });
  // Label kategori di katalog lebih rinci daripada judul grup sidebar; ini
  // terjemahannya. Kategori baru tanpa padanan akan tertangkap di BUKAN_GRUP.
  const PETA_KATEGORI = {
    'Alat Berat': 'Master Data', 'CRM & Mitra': 'Master Data',
    'Transaksi': 'Transaksi', 'Operasional': 'Operasional',
    'Keuangan': 'Keuangan', 'Sistem': 'Sistem',
  };
  const TIDAK_ADA_DI_SIDEBAR = KATALOG.filter(m => !GRUP_DARI_PATH[m.path]).map(m => m.path);
  check('katalog modul: setiap modul yang ditawarkan Pengaturan ada di sidebar',
    TIDAK_ADA_DI_SIDEBAR.length === 0, TIDAK_ADA_DI_SIDEBAR);
  const BEDA_KATEGORI = KATALOG
    .filter(m => GRUP_DARI_PATH[m.path] && PETA_KATEGORI[m.cat] !== GRUP_DARI_PATH[m.path])
    .map(m => `${m.path}: katalog '${m.cat}' (grup sidebar: ${GRUP_DARI_PATH[m.path]})`);
  check('katalog modul: kategori sama dengan grup sidebar untuk path yang sama',
    BEDA_KATEGORI.length === 0, BEDA_KATEGORI);
  const OUT_OF_MAP = [...new Set(KATALOG.map(m => m.cat))].filter(c => !PETA_KATEGORI[c]);
  check('katalog modul: semua label kategori punya padanan grup sidebar',
    OUT_OF_MAP.length === 0, OUT_OF_MAP);
  // Subsekuensi: urutan katalog harus bisa diikuti di sidebar tanpa melompat mundur.
  const TIDAK_URUT = [];
  let kemudi = -1;
  for (const m of KATALOG) {
    const i = URUT_SIDEBAR.indexOf(m.path);
    if (i < 0 || i >= kemudi) { if (i >= 0) kemudi = i; continue; }
    TIDAK_URUT.push(`${m.path} didahului ${URUT_SIDEBAR[kemudi]} di sidebar`);
  }
  check('katalog modul: urutannya subsekuensi dari urutan sidebar',
    TIDAK_URUT.length === 0, { TIDAK_URUT, katalog: KATALOG.map(m => m.path) });

  // Jalan masuk kedua ke menu yang sama: CommandPalette (Ctrl+K) dan kotak cari di
  // topbar. Keduanya dulu berdiri sendiri — palette mengulang daftar menu (dan
  // tinggal menampung 17 dari 26 menu), pencarian sidebar memakai ALL_NAV_ITEMS
  // mentah sehingga menu yang disembunyikan untuk peran/profil itu masih bisa
  // dituju. Sekarang keduanya memakai hasil gerbang NAV_GROUPS.
  const PALETTE_TEKS = fs.readFileSync(path.join(ROOT, 'src', 'components', 'CommandPalette.tsx'), 'utf8');
  const DI_ULANG_DI_PALETTE = [...PALETTE_TEKS.matchAll(/\bpath:\s*'(\/[a-z-]+)'/g)].map(m => m[1]);
  check('CommandPalette: tidak punya daftar menu sendiri, melainkan menerima item dari Layout',
    DI_ULANG_DI_PALETTE.length === 0
    && /items:\s*PaletteItem\[\]/.test(PALETTE_TEKS)
    && LAYOUT_TEKS.includes('<CommandPalette items={menuTerbuka} />'),
    { pathYangDiulang: DI_ULANG_DI_PALETTE, terimaProp: /items:\s*PaletteItem\[\]/.test(PALETTE_TEKS) });
  check('pencarian topbar: hasil baca dari menu yang sudah lolos gerbang peran/profil',
    /const searchResults[\s\S]{0,160}menuTerbuka\.filter/.test(LAYOUT_TEKS)
    && !/ALL_NAV_ITEMS\.filter/.test(LAYOUT_TEKS),
    { masihMentah: /ALL_NAV_ITEMS\.filter/.test(LAYOUT_TEKS) });
  // Nama menu yang dicari user harus dikenali dari kedua jalan masuk; keyword satu
  // daftar dipakai bersama karena palette dan topbar membaca item yang sama.
  const TANPA_KEYWORD = URUT_SIDEBAR.filter(p => {
    const potong = LAYOUT_TEKS.slice(LAYOUT_TEKS.indexOf(`path: '${p}'`));
    return !/keywords:\s*\[/.test(potong.slice(0, 400));
  });
  check('sidebar: setiap menu punya kata kunci pencarian (label Indonesia saja tidak cukup)',
    TANPA_KEYWORD.length === 0, TANPA_KEYWORD);

  // Daftar ke-empat: ALL_PATHS di configStore (tombol "aktifkan semua menu" di
  // wizard / Pengaturan). Ia satu-satunya jalan menyalakan menu di luar profil,
  // jadi menu baru yang lupa dimasukkan ke daftar ini tidak akan pernah bisa
  // dibuka pengguna yang profilnya berbeda. Yang wajib ada hanya menu bergerbang
  // mode — menu tanpa gerbang (Dasbor, Control Tower) selalu tampil.
  const BLOK_ITEM = NAV_TEKS.split(/\n\s{6}\{\n/).slice(1);
  const MENU_BERGELEMBAR = [];
  for (const mentah of BLOK_ITEM) {
    const isi = mentah.split(/\n\s{6}\}/)[0];
    const p = /path:\s*'(\/[^']+)'/m.exec(isi);
    if (p && /requiredModes:/.test(isi)) MENU_BERGELEMBAR.push(p[1]);
  }
  const CONFIG_TEKS = fs.readFileSync(path.join(ROOT, 'src', 'store', 'configStore.tsx'), 'utf8');
  const AWAL_ALL_PATHS = CONFIG_TEKS.indexOf('const ALL_PATHS');
  const ALL_PATHS = [...CONFIG_TEKS.slice(AWAL_ALL_PATHS, CONFIG_TEKS.indexOf('];', AWAL_ALL_PATHS))
    .matchAll(/'(\/[^']+)'/g)].map(m => m[1]);
  check('enableAllMenus: daftar path terbaca penjaga',
    AWAL_ALL_PATHS > 0 && ALL_PATHS.length >= 24, { jumlah: ALL_PATHS.length });
  const KURANG_DI_ALL = MENU_BERGELEMBAR.filter(p => !ALL_PATHS.includes(p));
  check('enableAllMenus: setiap menu yang digerbangi mode bisa diaktifkan dari daftar',
    KURANG_DI_ALL.length === 0, { kurang: KURANG_DI_ALL, bergelembang: MENU_BERGELEMBAR.length });
  const MATI_DI_ALL = ALL_PATHS.filter(p => !URUT_SIDEBAR.includes(p));
  check('enableAllMenus: tidak ada path mati di daftar (setiap entri masih jadi menu)',
    MATI_DI_ALL.length === 0, MATI_DI_ALL);

  // peta hidrasi (collectionNeeds) adalah jalan masuk kelima: menu yang tidak ada
  // kuncinya di sana diam-diam menghidrasi SEMUA collection tiap dibuka — lambat,
  // dan justru pola yang dibuang di #38.
  const KUNCI_NEEDS = [...fs.readFileSync(path.join(ROOT, 'src', 'store', 'collectionNeeds.ts'), 'utf8')
    .matchAll(/^\s{2}'?([a-z][a-z-]*)'?:\s*(?:\[|SEMUA_COLLECTION)/gm)].map(m => m[1]);
  check('peta hidrasi: daftar kunci terbaca penjaga', KUNCI_NEEDS.length >= 25, KUNCI_NEEDS.length);
  const TANPA_PETA = [...new Set(URUT_SIDEBAR.map(p => p.replace(/^\//, '')))].filter(k => !KUNCI_NEEDS.includes(k));
  check('peta hidrasi: setiap menu sidebar punya kunci kebutuhan collection',
    TANPA_PETA.length === 0, TANPA_PETA);

  // ── 26. tidak ada rute yang memuat seluruh file hanya untuk dibuka ─────
  // SEMUA_COLLECTION di dalam NEEDS berarti membuka menu itu memindahkan seluruh
  // isi file ke renderer. Itu bukan lagi kebutuhan render mana pun: yang menulis
  // array penuh dari seluruh collection adalah SATU aksi ber-tombol (muat data
  // contoh di Perawatan Sistem), dan handler tombol itu wajib meminta hidrasinya
  // sendiri. Rute tak dikenal tetap boleh jatuh ke SEMUA_COLLECTION di needsForPath
  // — itu penjaga, bukan kemalasan.
  const NEEDS_TEKS = fs.readFileSync(path.join(ROOT, 'src', 'store', 'collectionNeeds.ts'), 'utf8');
  const AWAL_NEEDS = NEEDS_TEKS.indexOf('const NEEDS');
  const BLOK_NEEDS = NEEDS_TEKS.slice(AWAL_NEEDS, NEEDS_TEKS.indexOf('\n};', AWAL_NEEDS));
  const RUTE_SEMUA = [...BLOK_NEEDS.matchAll(/^\s{2}'?([a-z][a-z-]*)'?:\s*SEMUA_COLLECTION/gm)].map(m => m[1]);
  check('peta hidrasi: tidak ada rute yang memetakan SEMUA collection (hanya fallback fungsi)',
    AWAL_NEEDS > 0 && RUTE_SEMUA.length === 0, { rute: RUTE_SEMUA });
  check('peta hidrasi: rute yang tidak dikenal tetap jatuh ke SEMUA collection',
    /NEEDS\[segmen\]\s*\?\?\s*SEMUA_COLLECTION/.test(NEEDS_TEKS), NEEDS_TEKS.slice(NEEDS_TEKS.indexOf('needsForPath'), 400));
  // Aksi yang menulis array penuh di semua collection tanpa hidrasi = menulis
  // collection yang belum pernah dibacakan. Yang boleh menulis penuh hanya jalan
  // yang sudah memanggil ensureLoaded lebih dulu.
  const HALAMAN_SEMUA = fs.readdirSync(path.join(ROOT, 'src', 'pages'))
    .filter(f => /\.(tsx|ts)$/.test(f))
    .map(f => ({ f, teks: fs.readFileSync(path.join(ROOT, 'src', 'pages', f), 'utf8') }))
    .filter(x => /loadSampleData\s*\(/.test(x.teks))
    .filter(x => !/ensureLoaded\s*\(/.test(x.teks))
    .map(x => x.f);
  check('halaman yang menulis seluruh collection meminta hidrasinya sendiri',
    HALAMAN_SEMUA.length === 0, HALAMAN_SEMUA);
  check('Perawatan Sistem: hidrasi diminta tepat sebelum data contoh ditulis',
    /await ensureLoaded\(SEMUA_COLLECTION\)[\s\S]{0,160}loadSampleData\(\)/
      .test(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'SystemMaintenance.tsx'), 'utf8')));

  // ── 27. skrip di root tidak boleh menghancurkan repository ───────────
  // auto-fix.ps1 versi 1 menghapus node_modules dan package-lock.json,
  // menjalankan `npm cache clean --force`, lalu `git reset` + `git clean -fd`
  // — otomatis, tanpa diminta. Di proyek ini perintah itu memusnahkan tiga hal
  // yang TIDAK bisa dibangun ulang dari kode: kunci ABI modul native
  // (package-lock.json + .npmrc bersama-sama menentukan prebuild electron-v123),
  // paket yang sedang diuji (dist-app/ dan dist-installer/ keduanya tak terlacak
  // git, jadi git clean menghapus bukti rilis), dan cache prebuild yang dipakai
  // saat mesin offline. Penjaga ini membandingkan setiap skrip root dengan daftar
  // hitam, dan memaksa jalur tulis/ubah berada di belakang gerbang -Apply.
  const SKRIP_ROOT = fs.readdirSync(ROOT).filter((f) => /\.(ps1|sh|cmd|bat)$/.test(f));
  /** Potong komentar dan string: teks penjelasan tidak boleh dianggap perintah. */
  const KODE_BERSIH = (teks) => teks
    .replace(/<#[\s\S]*?#>/g, '')
    .split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n')
    .replace(/'[^']*'/g, "''");
  const KODE_BERSIH2 = (teks) => KODE_BERSIH(teks).replace(/"[^"]*"/g, '""');
  const HITAM = [
    [/\bgit\s+clean\b/i, 'git clean (menghapus berkas tak-terlacak: paket + log uji)'],
    [/\bgit\s+reset\b/i, 'git reset (membuang staging pekerjaan yang belum di-commit)'],
    [/\bnpm\s+cache\s+clean\b/i, 'npm cache clean (membuang prebuild electron; mesin ini sering offline)'],
    [/\bnpm(?:\s+\S+)*?\s+(?:install|ci)\b/i, 'npm install/ci buta (mengunci ulang versi native harus keputusan, bukan efek samping)'],
  ];
  const HAPUS = /(Remove-Item|Remove-PSItem|\bdel\b|\bri\b|\brm\b|rmdir|\bunlink\b)/i;
  const TERLINDUNG = /(node_modules|package-lock\.json|app\.asar|dist-app|dist-installer|fathoni\.db|\.npmrc|\bsrc\b|APPDATA)/i;
  // Yang boleh dihapus hanya hasil build yang memang regenerable atau berkas sementara.
  const BOLEH_HAPUS = /\$probe\b|\$viteCache\b|tmp-harness|GetTempPath/i;
  const PELANGGARAN = [];
  for (const f of SKRIP_ROOT) {
    const kode = KODE_BERSIH(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const baris of kode.split(/\r?\n/)) {
      for (const [re, nama] of HITAM) {
        if (re.test(baris)) PELANGGARAN.push(f + ': ' + nama + ' -> ' + baris.trim());
      }
      if (HAPUS.test(baris)) {
        if (TERLINDUNG.test(baris)) PELANGGARAN.push(f + ': hapus berkas terlindungi -> ' + baris.trim());
        if (!BOLEH_HAPUS.test(baris)) PELANGGARAN.push(f + ': hapus di luar daftar yang boleh -> ' + baris.trim());
      }
    }
  }
  check('skrip root: tidak ada perintah yang memusnahkan kunci build, paket, atau pekerjaan git',
    SKRIP_ROOT.length >= 2 && PELANGGARAN.length === 0, { SKRIP_ROOT, PELANGGARAN });

  // Enkoding: Windows PowerShell 5.1 membaca .ps1 tanpa BOM sebagai cp1252, jadi
  // satu tanda hubung panjang (E2 80 94) pecah menjadi tiga karakter — dan byte
  // terakhirnya adalah 0x94, yang di cp1252 adalah tanda kutip kiri. Tanda kutip
  // itu menutup string di tengah baris, dan skrip build mati dengan error parse
  // yang terlihat tidak berhubungan. Temuan nyata saat auto-fix.ps1 ditulis
  // ulang: build-installer.ps1 juga mengandung byte non-ASCII tanpa BOM.
  const TANPA_BOM = fs.readdirSync(ROOT)
    .filter((f) => /\.ps1$/.test(f))
    .map((f) => ({ f, b: fs.readFileSync(path.join(ROOT, f)) }))
    .filter((x) => [...x.b].some((byte) => byte >= 0x80))
    .filter((x) => !(x.b[0] === 0xEF && x.b[1] === 0xBB && x.b[2] === 0xBF))
    .map((x) => x.f);
  check('skrip root: .ps1 dengan karakter non-ASCII memakai BOM UTF-8',
    TANPA_BOM.length === 0, TANPA_BOM);

  const AUTOFIX = fs.readFileSync(path.join(ROOT, 'auto-fix.ps1'), 'utf8');
  const GARIS_AF = KODE_BERSIH2(AUTOFIX).split(/\r?\n/);
  const BATAS_AF = GARIS_AF.findIndex((l) => /-not\s+\$Apply/.test(l));
  check('auto-fix.ps1: memeriksa saja secara default, memperbaiki hanya dengan -Apply',
    /\[switch\]\s*\$Apply/.test(AUTOFIX) && BATAS_AF > 0, { BATAS_AF });
  // Berkas sementara hasil probe (temp) boleh dibersihkan sebelum gerbang;
  // yang tidak boleh adalah perintah build dan penghapusan apa pun yang nyata.
  const SEBELUM_AF = GARIS_AF.slice(0, BATAS_AF)
    .map((l) => l.trim())
    .filter((l) => /\bnpm\s+(run|install|ci)\b/.test(l) || (/Remove-Item/.test(l) && !/\$probe\b/.test(l)));
  check('auto-fix.ps1: tidak ada tulis/hapus/npm sebelum gerbang -Apply',
    SEBELUM_AF.length === 0, SEBELUM_AF);
  const SESUDAH_AF = GARIS_AF.slice(BATAS_AF).join('\n');
  check('auto-fix.ps1: cabang -Apply benar-benar menjalankan perbaikan (penjaga tidak vakum)',
    /\bnpm\s+(run|install)/.test(SESUDAH_AF) && /\$viteCache/.test(SESUDAH_AF), undefined);

  // ── 28. harness tidak boleh membaca keadaan "memuat" sebagai data ─────
  // Pager.tsx menampilkan "Tidak ada record" selama total masih 0 — yaitu selama
  // debounce 200 ms dan selama kueri pertama masih berjalan, dengan akhiran
  // " · memuat...". Jadi `/record/.test(pager)` BUKAN tanda selesai: kalimatnya
  // benar untuk halaman kosong DAN untuk halaman yang sedang memuat. Rantai pernah
  // jatuh karena ini (rantai-302f, handoff 8.1: sql=2 tapi kartu=0 — pembacaan
  // terjadi di keadaan loading). Setiap waitFor yang menyentuh #pager-info wajib
  // memakai salah satu dari dua tanda selesai yang sah: mengecualikan "memuat",
  // atau menguji frasa "dari N record" yang tidak mungkin ada di keadaan loading.
  const BERSIH_KOMENTAR = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  /** Potong satu panggilan lengkap mulai dari '(' pembuka — kurung dalam kondisi
   *  ini selalu seimbang, termasuk di dalam template literal. */
  function PARENS(t, mulai) {
    let d = 0;
    for (let i = mulai; i < t.length; i++) {
      if (t[i] === '(') d++;
      else if (t[i] === ')' && --d === 0) return t.slice(mulai, i + 1);
    }
    return t.slice(mulai);
  }
  const WAIT_PAGER = [], TERLAMBAU = [];
  const HARNESS_LIHAT = fs.readdirSync(__dirname)
    .filter((f) => /-check\.cjs$/.test(f) && f !== 'validation-check.cjs');
  for (const f of HARNESS_LIHAT) {
    const t = BERSIH_KOMENTAR(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    for (const m of t.matchAll(/\bwaitFor\(/g)) {
      const call = PARENS(t, m.index + 'waitFor'.length - 1);
      if (!call.includes('#pager-info')) continue;
      WAIT_PAGER.push({ f, call });
      const sah = /!\s*\/memuat\b/.test(call) || /\/dari\s/.test(call);
      if (!sah) TERLAMBAU.push({ f, call: call.replace(/\s+/g, ' ').slice(0, 240) });
    }
  }
  check('wait pager: setiap waitFor yang membaca #pager-info mengecualikan keadaan loading',
    TERLAMBAU.length === 0, TERLAMBAU);
  const UJI_REKOR = WAIT_PAGER.filter((x) => /\/record\//.test(x.call)).length;
  check('wait pager: penjaga tidak vakum — harness benar-benar menunggu penanda halaman',
    WAIT_PAGER.length >= 15 && UJI_REKOR >= 3, { WAIT: WAIT_PAGER.length, UJI_REKOR });

  // Satu kelas kegagalan yang sama, efek yang berbeda: window.open di renderer
  // diblokir oleh setWindowOpenHandler, lalu URL-nya diserahkan ke
  // shell.openExternal — di desktop manusia itu berarti Chrome sungguhan terbuka
  // tiap langkah 'gui' dijalankan. Karena itu harness yang memanggil window.open
  // wajib menambal openExternal dengan perekam lebih dulu, supaya sisi efeknya
  // dinyatakan sebagai assertion, bukan dibuktikan lewat jendela pengguna.
  const BROWSER_JAHIL = [];
  for (const f of HARNESS_LIHAT) {
    const t = BERSIH_KOMENTAR(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    const pakai = /window\.open\(/.test(t);
    if (pakai && !/shell\.openExternal\s*=/.test(t)) BROWSER_JAHIL.push(f);
  }
  check('harness: yang memanggil window.open menambal shell.openExternal lebih dulu',
    BROWSER_JAHIL.length === 0, BROWSER_JAHIL);
  check('harness: penambalan openExternal benar-benar dipakai sebagai assertion (tidak vakum)',
    /shell\.openExternal\s*=/.test(BERSIH_KOMENTAR(fs.readFileSync(path.join(__dirname, 'gui-check.cjs'), 'utf8'))),
    undefined);

  // ── 29. jalur signing opsional tidak boleh menjadi kejutan di menit ke-15 ──
  // Plumbing-nya sudah ada (#80) tapi belum pernah dijalankan sampai siklus ini,
  // dan pengukuran dengan sertifikat self-signed di C:\tmp menunjukkan dua hal yang
  // tidak bisa dilihat dari membaca kode: (1) `signtool sign` dengan /tr yang tidak
  // terjangkau keluar 1 dan meninggalkan exe TANPA tanda tangan — di mesin build yang
  // sedang offline, skrip lama baru mati di langkah 5, setelah npm build + bundel +
  // branding tertelan; (2) `verify /pa` keluar 1 untuk rantai yang tidak dipercaya,
  // jadi sertifikat uji tidak akan pernah menghasilkan paket yang layak edar. Kini
  // prasyaratnya diperiksa di depan, dan bentuk perintahnya dikunci di sini.
  const PENYATUAN = fs.readFileSync(path.join(ROOT, 'build-installer.ps1'), 'utf8');
  const GARIS_PS = PENYATUAN.split(/\r?\n/);
  const BARIS = (re) => GARIS_PS.findIndex((l) => re.test(l));
  const BANGUN = BARIS(/&\s+npm\s+run\s+build\b/);
  const CEK_SIGNTOOL = BARIS(/throw\s+"HEMS_SIGN_PFX diset tapi signtool\.exe/);
  const CEK_PFX = BARIS(/throw\s+"HEMS_SIGN_PFX menunjuk berkas/);
  check('signing: signtool + pfx diverifikasi SEBELUM langkah build apa pun',
    BANGUN > 0 && CEK_SIGNTOOL > 0 && CEK_PFX > 0 && CEK_SIGNTOOL < BANGUN && CEK_PFX < BANGUN,
    { BANGUN: BANGUN + 1, CEK_SIGNTOOL: CEK_SIGNTOOL + 1, CEK_PFX: CEK_PFX + 1 });
  const PANGGIL_SIGN = BARIS(/&\s+\$signtool\s+sign\b/);
  const BARIS_SIGN = GARIS_PS.slice(PANGGIL_SIGN, PANGGIL_SIGN + 1).join('');
  check('signing: SHA256 + timestamp + /td SHA256 dipakai dari satu variabel, bukan dua tempat',
    /^\$signTs\s*=\s*'https?:\/\//m.test(PENYATUAN)
      && /\/fd\s+SHA256/.test(BARIS_SIGN) && /\/tr\s+\$signTs/.test(BARIS_SIGN)
      && /\/td\s+SHA256/.test(BARIS_SIGN),
    { BARIS_SIGN });
  check('signing: setiap kegagalan signtool menghentikan build (tidak ada jalur diam-diam)',
    /if\s+\(\$LASTEXITCODE -ne 0\)\s*\{\s*$/.test(GARIS_PS[PANGGIL_SIGN + 1] || '')
      && /throw\s+"signtool GAGAL/.test(PENYATUAN)
      && /&\s+\$signtool\s+verify\s+\/pa/.test(PENYATUAN)
      && /throw\s+"signtool verify \/pa GAGAL/.test(PENYATUAN), undefined);
  const PANGGILAN_SIGN = [...PENYATUAN.matchAll(/Sign-Exe\s+\$?(\w+)/g)].map((m) => m[1]);
  check('signing: binary aplikasi DAN installer keduanya melewati Sign-Exe (penjaga tidak vakum)',
    PANGGILAN_SIGN.includes('appExe') && PANGGILAN_SIGN.some((x) => /setup/i.test(x)),
    { PANGGILAN_SIGN });
  check('signing: tanpa HEMS_SIGN_PFX skrip tetap menyebut paket TIDAK tersign',
    /LEWAT sign: paket ini TIDAK ditandatangani/.test(PENYATUAN)
      && /Tersign|TERSIGN|status tanda tangan/.test(PENYATUAN), undefined);

  // ── 30. pembacaan meter yang mundur (Tahap 1 T4 / #88) ───────────────
  // Satu kolom HM yang ditulis tangan dari lapangan pasti pernah salah baca.
  // Sebelum Tahap 1 angka yang lebih kecil diterima diam-diam, lalu menyeret
  // turun seluruh hitungan siklus servis dan biaya per jam tanpa jejak. Yang
  // ditegakkan: mundur hanya sah dengan penanda koreksi DAN alasan yang berisi,
  // dan alasannya tidak dibuang karena ia satu-satunya jejak yang tersisa setelah
  // angkanya ditimpa.
  noError('meter: naik diterima', V.validateHourMeterProgress(500, 450, {}));
  noError('meter: sama persis bukan kemunduran', V.validateHourMeterProgress(450, 450, {}));
  msgIs('meter: mundur tanpa penanda koreksi ditolak beserta selisihnya',
    V.validateHourMeterProgress(440, 450, {}),
    'Hour Meter mundur dari 450 ke 440 (10 jam). Bila ini pembacaan yang benar, '
    + 'centang "Ini koreksi pembacaan meter" dan isi alasannya; bila bukan, perbaiki angkanya.');
  msgIs('meter: koreksi tanpa alasan tetap ditolak',
    V.validateHourMeterProgress(440, 450, { koreksi: true, alasan: '' }),
    'Koreksi pembacaan meter wajib disertai alasan (misalnya "HM sebelumnya salah baca 450, seharusnya 440").');
  msgIs('meter: alasan hanya spasi bukan alasan',
    V.validateHourMeterProgress(440, 450, { koreksi: true, alasan: '   ' }),
    'Koreksi pembacaan meter wajib disertai alasan (misalnya "HM sebelumnya salah baca 450, seharusnya 440").');
  noError('meter: koreksi + alasan diterima',
    V.validateHourMeterProgress(440, 450, { koreksi: true, alasan: 'HM lama salah baca 450, seharusnya 440' }));
  noError('meter: angka yang tidak terbaca bukan urusan gerbang ini',
    V.validateHourMeterProgress('abc', 450, {}));
  noError('meter: unit baru tanpa HM tercatat tidak ditahan',
    V.validateHourMeterProgress(10, undefined, {}));
  check('meter: kemunduran besar tetap memakai kalimat yang sama',
    /mundur dari 1200 ke 300 \(900 jam\)/.test(V.validateHourMeterProgress(300, 1200, {}) || ''),
    V.validateHourMeterProgress(300, 1200, {}));
  msgIs('jejak koreksi: bentuk yang ditulis ke catatan record',
    V.catatanKoreksiHourMeter(450, 440, '  salah baca di formulir  '),
    '[KOREKSI HM 450 -> 440: salah baca di formulir]');
  check('jejak koreksi: memuat angka lama DAN angka baru supaya jejak bisa dibaca ulang',
    /\[KOREKSI HM 450 -> 440: x\]$/.test(V.catatanKoreksiHourMeter(450, 440, 'x')),
    V.catatanKoreksiHourMeter(450, 440, 'x'));

  // ── 31. kategori pembelian: BBM tersimpan, warisan tidak ditolak (T1 / #85) ──
  // Dua cacat kembar sebelum Tahap 1: layar menawarkan CONSUMABLE yang ditolak
  // validasi (PO oli tidak pernah bisa disimpan), sementara FUEL sah di validasi
  // tapi tidak bisa dipilih. Sekarang keduanya satu daftar, dan kategori warisan
  // diterima saat disimpan ulang — kalau tidak, membuka PO lama lalu menekan
  // Simpan diam-diam mengganti kategorinya.
  noError('kategori PO: BBM (FUEL) boleh disimpan', V.validatePurchaseCategory('FUEL'));
  noError('kategori PO: pelumas boleh disimpan', V.validatePurchaseCategory('LUBRICANT'));
  noError('kategori PO: CONSUMABLE warisan diterima ulang', V.validatePurchaseCategory('CONSUMABLE'));
  check('kategori PO: warisan TIDAK ditawarkan sebagai kategori baru',
    !V.VALID_PURCHASE_CATEGORIES.includes('CONSUMABLE') && V.PURCHASE_CATEGORY_LEGACY.includes('CONSUMABLE'),
    { sah: V.VALID_PURCHASE_CATEGORIES, warisan: V.PURCHASE_CATEGORY_LEGACY });
  check('kategori PO: FUEL dan LUBRICANT sama-sama bisa dipilih',
    V.VALID_PURCHASE_CATEGORIES.includes('FUEL') && V.VALID_PURCHASE_CATEGORIES.includes('LUBRICANT'),
    V.VALID_PURCHASE_CATEGORIES);
  msgIs('kategori PO: label FUEL adalah BBM yang dibaca dispatcher',
    V.PURCHASE_CATEGORY_LABELS.FUEL, 'BBM (Solar)');
  const WARISAN_TANPA_LABEL = V.PURCHASE_CATEGORY_LEGACY.filter((k) => !V.PURCHASE_CATEGORY_LEGACY_LABELS[k]);
  check('kategori PO: setiap kategori warisan punya label yang mengarahkan ke pengganti',
    WARISAN_TANPA_LABEL.length === 0 && Object.keys(V.PURCHASE_CATEGORY_LEGACY_LABELS)
      .every((k) => V.PURCHASE_CATEGORY_LEGACY.includes(k)),
    { WARISAN_TANPA_LABEL, label: Object.keys(V.PURCHASE_CATEGORY_LEGACY_LABELS) });
  msgIs('kategori PO: nilai asing ditolak dengan daftar yang bisa dipilih',
    V.validatePurchaseCategory('KACANG'),
    `Kategori tidak valid. Pilih dari: ${V.VALID_PURCHASE_CATEGORIES.join(', ')}`);

  // ── 32. satu aturan servis berikutnya, bukan dua (T2 / #86) ───────────
  // Kartu "Servis Periodik Selanjutnya" di layar Unit dulu menulis
  // `hourMeter + 250` sementara sisi SQLite menghitung siklus 500 — dua menu
  // melaporkan tanggal servis berbeda untuk alat yang sama. Yang dikunci di sini
  // adalah bentuk aritmetiknya, supaya angka 500 tidak bisa kembali sendiri.
  check('servis berikutnya: satu konstanta siklus dan angkanya 500 HM',
    D.SIKLUS_SERVIS_HM === 500, D.SIKLUS_SERVIS_HM);
  const SIKLUS_BATAS = [];
  for (const hm of [0, 120, 380, 470, 499, 500, 501, 1000, 1000.9, 12000]) {
    const sisa = D.serviceDueInOf(hm);
    const berikut = D.hmServisBerikutnyaOf(hm);
    const benar = sisa === D.SIKLUS_SERVIS_HM - (Math.trunc(hm) % D.SIKLUS_SERVIS_HM)
      && berikut === Math.trunc(hm) + sisa && sisa > 0 && sisa <= D.SIKLUS_SERVIS_HM;
    if (!benar) SIKLUS_BATAS.push({ hm, sisa, berikut });
  }
  check('servis berikutnya: sisa+HM jatuh selalu tepat pada kelipatan siklus (10 nilai tepi)',
    SIKLUS_BATAS.length === 0, SIKLUS_BATAS);
  check('servis berikutnya: HM tidak terpakai menghasilkan null, bukan angka karangan',
    D.serviceDueInOf(-5) === null && D.hmServisBerikutnyaOf(-5) === null
    && D.serviceDueInOf(Infinity) === null,
    { negatif: D.serviceDueInOf(-5), takhingga: D.serviceDueInOf(Infinity) });
  const SUMBER_HALAMAN = fs.readdirSync(path.join(ROOT, 'src', 'pages')).filter((f) => /\.tsx$/.test(f));
  const ARITMATIKA_250 = [];
  for (const f of SUMBER_HALAMAN) {
    const t = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', f), 'utf8'));
    if (/hourMeter\s*\+\s*250/.test(t)) ARITMATIKA_250.push(f);
  }
  const DC_TEKS = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'domain', 'derivedColumns.ts'), 'utf8'));
  check('servis berikutnya: tidak ada satu layar pun yang masih menjumlah 250 ke HM',
    ARITMATIKA_250.length === 0 && !/hourMeter\s*\+\s*250/.test(DC_TEKS), ARITMATIKA_250);
  // Dipanggil, bukan sekadar diimpor: impor yang menganggur membuat penjaga
  // terlihat hijau padahal layarnya sudah menghitung sendiri.
  const PEMAKAI_DC = fs.readdirSync(path.join(ROOT, 'src', 'pages'))
    .filter((f) => /\b(hmServisBerikutnyaOf|serviceDueInOf)\(/.test(
      BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', f), 'utf8'))));
  const DEKLARASI_LAIN = [...DC_TEKS.matchAll(/SIKLUS_SERVIS_HM\s*=/g)].length - 1
    + SUMBER_HALAMAN.filter((f) => /SIKLUS_SERVIS_HM\s*=\s*\d/.test(
      BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', f), 'utf8')))).length;
  check('servis berikutnya: layar memakainya lewat modul bersama, bukan salinan lokal',
    PEMAKAI_DC.length >= 2 && PEMAKAI_DC.includes('Units.tsx') && DEKLARASI_LAIN === 0,
    { PEMAKAI_DC, DEKLARASI_LAIN });

  // ── 33. layar Pembelian membaca daftar kategori yang sama (T1, statis) ─
  // Komentar di validation.ts menjanjikan penjaga ini; pasal ini membuatnya ada.
  // Kelas cacatnya bukan angka salah, melainkan daftar yang berdiri sendiri di
  // dua tempat: yang ditawarkan layar dan yang diterima validasi.
  const SUMBER_PO = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Purchase.tsx'), 'utf8'));
  check('kategori PO: dropdown dibangun dari PURCHASE_CATEGORY_LABELS, bukan <option> tulis tangan',
    /Object\.entries\(PURCHASE_CATEGORY_LABELS\)\.map/.test(SUMBER_PO)
    && /PURCHASE_CATEGORY_LEGACY_LABELS\[form\.category\]/.test(SUMBER_PO),
    { adaPeta: /Object\.entries\(PURCHASE_CATEGORY_LABELS\)\.map/.test(SUMBER_PO) });
  // Yang dibandingkan hanya layar yang mengikat <select> ke form.category: itulah
  // yang bisa menyimpang dari peta bersama. Nilai tokennya sengaja tidak
  // dibandingkan ke seluruh halaman — 'SPAREPART' juga nama tipe Invoice (domain
  // lain, daftar lain), dan penjaga yang menuduh itu akan dibuang karena bising.
  const HALAMAN_KATEGORI = SUMBER_HALAMAN.filter((f) =>
    /value=\{form\.category\}/.test(BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', f), 'utf8'))));
  const OPTION_TULIS_TANGAN = [];
  for (const f of HALAMAN_KATEGORI) {
    const t = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', f), 'utf8'));
    const salah = [...t.matchAll(/<option[^>]*value=\{?["'](UNIT|SPAREPART|FUEL|LUBRICANT|OTHER|CONSUMABLE)["']/g)]
      .map((m) => `${f}:${m[1]}`);
    if (salah.length) OPTION_TULIS_TANGAN.push(...salah);
  }
  check('kategori PO: tidak ada halaman yang menulis <option> kategori secara hardcode',
    OPTION_TULIS_TANGAN.length === 0, OPTION_TULIS_TANGAN);
  const PO_VALIDASI_LBH_DULU = SUMBER_PO.indexOf('validatePurchaseCategory(form.category)');
  const PO_SIMPAN = SUMBER_PO.indexOf('category: form.category');
  check('kategori PO: validasi kategori terjadi SEBELUM record disusun untuk disimpan',
    PO_VALIDASI_LBH_DULU > 0 && PO_SIMPAN > 0 && PO_VALIDASI_LBH_DULU < PO_SIMPAN,
    { PO_VALIDASI_LBH_DULU, PO_SIMPAN });
  check('penjaga kategori PO tidak vakum: layar pengikat kategori memang terbaca',
    /<option/.test(SUMBER_PO) && SUMBER_HALAMAN.length >= 15 && HALAMAN_KATEGORI.includes('Purchase.tsx'),
    { halaman: SUMBER_HALAMAN.length, HALAMAN_KATEGORI });

  // ── 34. gerbang koreksi meter benar-benar dipasang di kedua layar (T4) ─
  // Validatornya sudah diuji di §30; yang dijaga di sini adalah pemasangannya,
  // karena gerbang yang tidak dipanggil sama dengan gerbang yang tidak ada.
  const SUMBER_SVC = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Service.tsx'), 'utf8'));
  const SUMBER_UNT = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Units.tsx'), 'utf8'));
  const SUMBER_STORE = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'store', 'dataStore.tsx'), 'utf8'));
  const LABEL_KOREKSI = /label[^<]*>\s*(Ini koreksi pembacaan meter)/.exec(SUMBER_SVC)
    || /(Ini koreksi pembacaan meter)/.exec(SUMBER_SVC);
  check('layar Servis: penanda koreksi ditawarkan ke pengguna',
    !!LABEL_KOREKSI && /Alasan koreksi/.test(SUMBER_SVC), { LABEL_KOREKSI: LABEL_KOREKSI && LABEL_KOREKSI[1] });
  check('layar Servis: kalimat validator menunjuk label yang benar-benar ada di layar',
    LABEL_KOREKSI
    && (V.validateHourMeterProgress(1, 2, {}) || '').includes(`"${LABEL_KOREKSI[1]}"`),
    { label: LABEL_KOREKSI && LABEL_KOREKSI[1], pesan: V.validateHourMeterProgress(1, 2, {}) });
  // Pemetaan kunci state → kunci API validator. Penjaga teks sumber di atas dulu
  // hanya melihat bahwa gerbang DIPANGGIL, padahal panggilannya mengirim
  // `koreksiHm` apa adanya: validator membaca opts.koreksi, state layar memakai
  // kunci `aktif`, jadi opts.koreksi selalu undefined dan gerbang dengan centang
  // + alasan tetap ditolak selamanya. Yang dikunci sekarang adalah pemetaannya.
  const PEMETAAN_KOREKSI = /\{\s*koreksi:\s*koreksiHm\.aktif,\s*alasan:\s*koreksiHm\.alasan\s*\}/;
  const gerbangBerpetak = (sumber, mulai) => mulai > 0 && PEMETAAN_KOREKSI.test(sumber.slice(mulai, mulai + 220));
  const SVC_GATE = SUMBER_SVC.indexOf('validateHourMeterProgress(form.hourMeter, unitRujukan?.hourMeter,');
  // Sejak penulisan per baris (saveRow), Work Order baru tidak lagi masuk lewat
  // setData([newItem, ...prev]) di memori. Yang harus tetap berlaku adalah
  // urutannya: gerbang meter diputuskan SEBELUM baris itu ditulis ke file.
  const SVC_SIMPAN = SUMBER_SVC.indexOf("await saveRow('services', newItem)");
  check('layar Servis: gerbang meter dijalankan sebelum Work Order baru ditulis',
    gerbangBerpetak(SUMBER_SVC, SVC_GATE) && SVC_SIMPAN > 0 && SVC_GATE < SVC_SIMPAN, { SVC_GATE, SVC_SIMPAN });
  check('layar Servis: jejak koreksi ditulis pada record BARU dan hasil SUNTING (dua jalur)',
    (SUMBER_SVC.match(/hmKoreksi: jejakKoreksi/g) || []).length === 2,
    { jumlah: (SUMBER_SVC.match(/hmKoreksi: jejakKoreksi/g) || []).length });
  const UNT_GATE = SUMBER_UNT.indexOf('validateHourMeterProgress(form.hourMeter, hmLama,');
  check('layar Unit: gerbang meter dijalankan sebelum commit dan jejaknya menyimpan dari/ke/alasan/pada',
    gerbangBerpetak(SUMBER_UNT, UNT_GATE) && UNT_GATE < SUMBER_UNT.indexOf('commit({')
    && /hmKoreksi: adaKoreksi/.test(SUMBER_UNT)
    && ['dari:', 'ke:', 'alasan:', 'pada:'].every((k) => SUMBER_UNT.includes(k)),
    { UNT_GATE, commit: SUMBER_UNT.indexOf('commit({') });
  check('dataStore: servis selesai hanya menaikkan HM, kemunduran tidak pernah diserap',
    /const maju = hmSah && hmServis >= /.test(SUMBER_STORE)
    && /hourMeter: maju \? hmServis : u\.hourMeter/.test(SUMBER_STORE)
    && /lastServiceHM: maju \? hmServis : u\.lastServiceHM/.test(SUMBER_STORE), undefined);
  check('dataStore: servis selesai menulis lastServiceHM (dulu tidak pernah ada)',
    /lastServiceHM: /.test(SUMBER_STORE), undefined);
  // At-most-once: panggilan kedua tidak boleh mengulang efek sampingnya. Invoice
  // dan mutasi gudang sudah menolak duplikat sendiri, tetapi stok suku cadang
  // TIDAK — panggilan kedua tetap mengurangi stok sekali lagi.
  check('dataStore: Work Order yang sudah COMPLETED tidak diproses ulang',
    /if \(!wo \|\| wo\.status === 'COMPLETED'\) return;/.test(SUMBER_STORE), undefined);
  check('dataStore: biaya aktual dari modal tersimpan ke baris Work Order',
    /const biayaSah = actualCost !== undefined/.test(SUMBER_STORE)
    && /actualCost: biaya/.test(SUMBER_STORE), undefined);
  // Banner merah pernah menetap setelah tulisan berikutnya benar-benar berhasil:
  // jalur patch hanya membersihkan hasUnsavedChanges, bukan storageWarning, jadi
  // operator terus diberi tahu datanya hilang padahal sudah masuk file.
  const SIMPAN_OK = SUMBER_STORE.indexOf('bumpSaved([name]);');
  check('dataStore: peringatan gagal simpan dibersihkan setelah tulisan berhasil',
    SIMPAN_OK > 0 && SUMBER_STORE.indexOf('setStorageWarning(null);', SIMPAN_OK) > SIMPAN_OK, undefined);
  const SVC_KUNCI = SUMBER_SVC.indexOf('submitLock.current = true;');
  const SVC_PANGGIL = SUMBER_SVC.indexOf('completeService(completing.id');
  check('layar Servis: kirim ganda dikunci sebelum completeService dipanggil',
    SVC_KUNCI > 0 && SVC_PANGGIL > SVC_KUNCI
    && /if \(submitLock\.current\) return;/.test(SUMBER_SVC)
    && /submitLock\.current = false;/.test(SUMBER_SVC),
    { kunci: SVC_KUNCI, panggil: SVC_PANGGIL });

  // ── 35. biaya per jam Dashboard dihitung dari data (T5 / #89) ──────────
  // Panel Cost per Hour dulu berisi tiga konstanta yang tidak pernah berubah
  // seberapa banyak pun data masuk: Rp85.000 / Rp18.000 / Rp25.000 per HM, dan
  // pendapatan karangan Rp350.000/HM. Angka-angka itu kini harus tetap mati —
  // kalau salah satu kembali, layarnya terlihat meyakinkan dan tidak ada uji
  // runtime yang bisa membedakannya dari angka sungguhan.
  const SUMBER_DASH = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Dashboard.tsx'), 'utf8'));
  const KONSTANTA_LAMA = /(85000|85\.000|18000|18\.000|25000|25\.000|350000|350\.000)/g;
  const ANGKA_LAMA_KEMBALI = [...SUMBER_DASH.matchAll(KONSTANTA_LAMA)].map((m) => m[1]);
  check('dashboard: tidak ada satu pun konstanta biaya lama yang kembali',
    ANGKA_LAMA_KEMBALI.length === 0, ANGKA_LAMA_KEMBALI);
  check('dashboard: penyusutan memakai harga perolehan unit dan dua asumsi bernama',
    /const NILAI_SISA_EKONOMIS = /.test(SUMBER_DASH) && /const UMUR_EKONOMIS_HM = /.test(SUMBER_DASH)
    && /harga \* \(1 - NILAI_SISA_EKONOMIS\)\) \/ UMUR_EKONOMIS_HM/.test(SUMBER_DASH)
    && /biayaPerJam: penyusutanPerJam/.test(SUMBER_DASH), undefined);
  check('dashboard: pendapatan per jam datang dari agregat SQLite, bukan angka di layar',
    /const sewaPerSerial = useCollectionGroup\(/.test(SUMBER_DASH)
    && /const biayaServisPerSerial = useCollectionGroup\(/.test(SUMBER_DASH)
    && /kelompokSerial\(sewaPerSerial, unit\?\.serialNumber\)/.test(SUMBER_DASH), undefined);
  check('dashboard: tanpa tarif kontrak layar menyatakan ketiadaan, bukan mengarang angka',
    /tarif\/jam belum ada/.test(SUMBER_DASH) && /belum tercatat per unit/.test(SUMBER_DASH), undefined);
  check('penjaga dashboard tidak vakum: panel biaya per jam memang ada untuk dijaga',
    (SUMBER_DASH.match(/useCollectionGroup\(/g) || []).length >= 5
    && (SUMBER_DASH.match(/biayaPerJam/g) || []).length >= 3,
    { group: (SUMBER_DASH.match(/useCollectionGroup\(/g) || []).length, biaya: (SUMBER_DASH.match(/biayaPerJam/g) || []).length });

  // ── 36. ekspor Laporan menembus batas kueri dengan paginasi ─────────────
  // Batas 500 baris ditegakkan di main process untuk SEMUA kueri. Ketika angka
  // itu juga dipakai sebagai batas ekspor, satu kueri besar hanya akan dipotong
  // diam-diam: CSV-nya terlihat sukses dan berisi 500 baris. Yang dijaga di sini
  // adalah pemisahan dua batas itu dan bahwa ekspor benar-benar menelusuri
  // halaman — bukan hanya bahwa angkanya berbeda.
  const SUMBER_LAP = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Reports.tsx'), 'utf8'));
  check('laporan: batas kueri (500, ditegakkan main) dan batas ekspor CSV (5.000) adalah dua angka berbeda',
    /const BATAS_KUERI = 500/.test(SUMBER_LAP) && /const BATAS_EKSPOR = 5000/.test(SUMBER_LAP),
    { kueri: /const BATAS_KUERI = (\d+)/.exec(SUMBER_LAP)?.[1], ekspor: /const BATAS_EKSPOR = (\d+)/.exec(SUMBER_LAP)?.[1] });
  check('laporan: tidak ada satu pun kueri yang meminta lebih dari BATAS_KUERI (main memotongnya tanpa suara)',
    !/limit:\s*BATAS_EKSPOR/.test(SUMBER_LAP) && !/limit:\s*(1000|5000|10_000)/.test(SUMBER_LAP),
    { permintaan: (SUMBER_LAP.match(/limit:[^,}]+/g) || []).slice(0, 6) });
  check('laporan: penelusuran halaman berhenti pada total dari SQLite, bukan pada halaman pertama',
    /while \(rows\.length < batas && rows\.length < pertama\.total\)/.test(SUMBER_LAP)
    && /offset: rows\.length/.test(SUMBER_LAP)
    && /limit: Math\.min\(BATAS_KUERI, batas - rows\.length\)/.test(SUMBER_LAP), undefined);
  check('laporan: keempat jalur ambil-baris besar memakai penelusuran halaman, bukan dbQuery langsung',
    (SUMBER_LAP.match(/ambilUntukEkspor\(/g) || []).length === 4
    && (SUMBER_LAP.match(/, BATAS_EKSPOR\)/g) || []).length === 2
    && (SUMBER_LAP.match(/, BATAS_CETAK\)/g) || []).length === 2,
    { jalur: (SUMBER_LAP.match(/ambilUntukEkspor\(/g) || []).length });
  check('laporan: cetak PDF tetap di bawah batas layar sedangkan CSV naik ke 5.000 (dua niat, dua angka)',
    /const BATAS_CETAK = 500/.test(SUMBER_LAP) && /const BATAS_TAMPIL = 500/.test(SUMBER_LAP)
    && /sampai \{BATAS_EKSPOR\} baris/.test(SUMBER_LAP), undefined);

  // ── 37. BPKB bisa dipilih sebagai jenis dokumen ──────────────────────────
  // Panduan 3.0.3 menyuruh pengguna menulis "STNK" lalu mengganti teksnya di
  // file karena BPKB tidak ada di daftar. Daftarnya adalah satu-satunya sumber
  // pilihan di formulir, jadi penambahan yang hilang di sini terlihat runtime.
  const SUMBER_DOK = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Documents.tsx'), 'utf8'));
  const DAFTAR_JENIS = /const JENIS_DOKUMEN = \[([\s\S]*?)\];/.exec(SUMBER_DOK);
  check('dokumen: BPKB ada di daftar jenis dan daftar itu yang mengisi pilihan formulir',
    !!DAFTAR_JENIS && /BPKB \(Bukti Kepemilikan Kendaraan\)/.test(DAFTAR_JENIS[1])
    && /JENIS_DOKUMEN\.map\(/.test(SUMBER_DOK),
    { jenis: (DAFTAR_JENIS ? DAFTAR_JENIS[1].match(/'[^']+'/g) : []) || [] });

  // ── 38. satu pembayaran tidak bisa masuk kas dua kali (titik 5) ──────────
  // Penjaga anti-dobel dulunya hanya ada di jalur otomatis addKasEntry; layar Kas
  // & Bank menerima PO yang sama dua kali (Rp72 juta untuk satu faktur Rp36 juta)
  // dan duplikatnya bertahan lintas muat ulang. Sekarang aturannya satu, hidup di
  // tiga tempat: validator murni ini, form-nya, dan main process.
  const KAS_ADA = [
    { id: 'K-1', tipe: 'KELUAR', kategori: 'PEMBELIAN', referensi: 'PO-1' },
    { id: 'K-2', tipe: 'MASUK', kategori: 'PENJUALAN', referensi: 'INV-1' },
  ];
  noError('kas: baris tanpa referensi bukan pembayaran dokumen, jadi tidak ditahan',
    V.validateKasKembar({ id: 'X', tipe: 'KELUAR', kategori: 'OPERASIONAL', referensi: '' }, KAS_ADA));
  noError('kas: dokumen lain dengan nomor referensi lain tetap boleh',
    V.validateKasKembar({ id: 'X', tipe: 'KELUAR', kategori: 'PEMBELIAN', referensi: 'PO-2' }, KAS_ADA));
  noError('kas: tipe berbeda atas dokumen yang sama adalah transaksi berbeda',
    V.validateKasKembar({ id: 'X', tipe: 'MASUK', kategori: 'PEMBELIAN', referensi: 'PO-1' }, KAS_ADA));
  check('kas: referensi yang sama persis dengan id baru ditolak beserta nomor barisnya',
    /PO-1/.test(V.validateKasKembar({ id: 'X', tipe: 'KELUAR', kategori: 'PEMBELIAN', referensi: 'PO-1' }, KAS_ADA) || '')
    && /sudah tercatat di baris K-1/.test(
      V.validateKasKembar({ id: 'X', tipe: 'KELUAR', kategori: 'PEMBELIAN', referensi: 'PO-1' }, KAS_ADA) || ''),
    V.validateKasKembar({ id: 'X', tipe: 'KELUAR', kategori: 'PEMBELIAN', referensi: 'PO-1' }, KAS_ADA));
  noError('kas: menyunting baris yang sama bukan duplikasi',
    V.validateKasKembar({ id: 'K-1', tipe: 'KELUAR', kategori: 'PEMBELIAN', referensi: 'PO-1' }, KAS_ADA));
  check('kas: huruf besar/kecil dan spasi tidak meloloskan dobel yang sama',
    !!V.validateKasKembar({ id: 'X', tipe: 'keluar', kategori: 'Pembelian', referensi: ' po-1 ' }, KAS_ADA),
    V.validateKasKembar({ id: 'X', tipe: 'keluar', kategori: 'Pembelian', referensi: ' po-1 ' }, KAS_ADA));
  check('kas: daftar yang bukan array tidak meruntuhkan gerbang',
    V.validateKasKembar({ id: 'X', tipe: 'KELUAR', kategori: 'PEMBELIAN', referensi: 'PO-1' }, undefined) === null);
  // Ketiga tempat pemakaiannya, karena gerbang yang tidak dipanggil = gerbang yang
  // tidak ada: jalur otomatis, jalur manual, dan hakim terakhir di main process.
  check('kas: jalur otomatis (addKasEntry) memakai validator yang sama',
    /setKas\(prev => \(validateKasKembar\(entry, prev\)/.test(SUMBER_STORE), undefined);
  const SUMBER_FIN = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Finance.tsx'), 'utf8'));
  check('kas: form manual memeriksa kembar sebelum menulis dan tidak menutup modal saat ditolak',
    SUMBER_FIN.includes('validateKasKembar(row, data)')
    && SUMBER_FIN.indexOf('validateKasKembar(row, data)') < SUMBER_FIN.indexOf('await commit(row)')
    && /if \(!await commit\(row\)\) return;\s*\n\s*setShowModal\(false\)/.test(SUMBER_FIN), undefined);
  const PATCH_BLOCK = MAIN.slice(MAIN.indexOf("trustedHandle('db-patch'"));
  const SAVE_BLOCK = MAIN.slice(MAIN.indexOf("trustedHandle('db-save'"), MAIN.indexOf("trustedHandle('db-patch'"));
  const GATE_KAS = PATCH_BLOCK.indexOf('kasKembarCacat(');
  check('main: db-patch memanggil penjaga kembar dan menolaknya dengan DATA_DENY',
    GATE_KAS > 0 && GATE_KAS < PATCH_BLOCK.indexOf('transact(')
    && /void auditData\(putusan\.penulis\.username, 'DATA_DENY', kembar\)/.test(MAIN)
    && PATCH_BLOCK.slice(GATE_KAS, GATE_KAS + 260).includes('dilarang: true'),
    { GATE_KAS });
  check('main: jalur collection penuh (migrasi boot + Restore) tetap dikecualikan',
    !SAVE_BLOCK.includes('kasKembarCacat(') && !SAVE_BLOCK.includes('meterMundurCacat('), undefined);

  // ── 39. tab riwayat kartu Unit: data nyata, tombol yang benar-benar bekerja ──
  // Lima tab di kartu detail unit dulu berisi daftar tetap yang sama untuk semua
  // alat (WO, part, klaim garansi, kontrak, dokumen legal) dan enam tombolnya
  // hanya memunculkan alert(). Yang dikunci di sini: tidak ada satu pun angka
  // hiasan yang boleh kembali, riwayat unit dibaca lewat query atas nomor sasis,
  // dan tombolnya menyerahkan pengguna ke menu tempat record itu dibuat.
  const SUMBER_RTL = BERSIH_KOMENTAR(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Rental.tsx'), 'utf8'));
  const SUMBER_LBL = fs.readFileSync(path.join(ROOT, 'src', 'domain', 'labels.ts'), 'utf8');
  const ANGKA_HIASAN = ['SPK-2025-012', 'SPK-2024-089', 'SPK-2024-042', 'P-1002', 'P-2004',
    'CLM-2024-008', 'KNT-2025-001', 'KNT-2024-044', 'SIA-2024-8891-JKT', 'SILO-SANY',
    'INS-ALLIANZ', 'GARANSI AKTIF', 'Ahmad Jaya'];
  check('unit: tidak ada satu pun angka hiasan riwayat lama yang tersisa di layar',
    !ANGKA_HIASAN.some(t => SUMBER_UNT.includes(t)),
    { tersisa: ANGKA_HIASAN.filter(t => SUMBER_UNT.includes(t)) });
  check('unit: tidak ada tombol yang hanya memanggil alert() di kartu detail',
    !/onClick=\{\s*\(\)\s*=>\s*alert\(/.test(SUMBER_UNT), undefined);
  check('unit: WO dan kontrak sewa dibaca dari query berpaginasi atas nomor sasis unit ini',
    /const kunciUnit = \{ serialNumber: serial \}/.test(SUMBER_UNT)
    && /useCollectionQuery\(\s*\{\s*collection: 'services', where: kunciUnit/.test(SUMBER_UNT)
    && /useCollectionQuery\(\s*\{\s*collection: 'rentals', where: kunciUnit/.test(SUMBER_UNT)
    && /savedTick\.services/.test(SUMBER_UNT) && /savedTick\.rentals/.test(SUMBER_UNT), undefined);
  check('unit: satu komponen riwayat dipakai semua tab selain Ringkasan (tidak ada jalur kedua)',
    /\{activeTab !== 'RINGKASAN' && <UnitRiwayat unit=\{u\} activeTab=\{activeTab\} \/>\}/.test(SUMBER_UNT)
    && !/activeTab === 'PERAWATAN' && \(/.test(SUMBER_UNT), undefined);
  // Yang tidak punya kolom penaut per unit harus DIUCAPKAN, bukan dikarang — dan
  // ucapannya wajib menunjuk alasan datanya, supaya temuan probe tetap terbaca.
  check('unit: pemakaian part, garansi dan dokumen diucapkan apa adanya beserta alasannya',
    /Baris mutasi gudang tidak menyimpan nomor sasis/.test(SUMBER_UNT)
    && /tidak disimpan di baris unit maupun di katalog/.test(SUMBER_UNT)
    && /tidak menyimpan nomor sasis alatnya/.test(SUMBER_UNT), undefined);
  check('unit: tiap tombol menyerahkan pengguna ke menu tempat record itu dibuat',
    /navigate\('\/service',\s*\{\s*state:\s*\{\s*baru: true, unit: \{ serialNumber: serial, unitModel: model \}/.test(SUMBER_UNT)
    && /navigate\('\/service',\s*\{\s*state: serial \? \{ cari: serial \}/.test(SUMBER_UNT)
    && /navigate\('\/rental',\s*\{\s*state:\s*\{\s*baru: true, unit:/.test(SUMBER_UNT)
    && /navigate\('\/documents',\s*\{\s*state:\s*\{\s*baru: true\s*\}\s*\}\)/.test(SUMBER_UNT)
    && /navigate\('\/spareparts'\)/.test(SUMBER_UNT), undefined);
  // Sisi terima: tiga halaman tujuan harus membaca state yang sama, dan form barunya
  // tetap dibuka lewat openCreateModal sendiri supaya calon nomornya bersumber dari
  // file (nomorBerikut), bukan dari array yang dipegang halaman.
  check('servis: menyambut tawaran dari kartu Unit tanpa meninggalkan calon nomor dari file',
    /const lokasi = useLocation\(\);/.test(SUMBER_SVC)
    && /useState\(stateAwal\.cari \?\? ''\)/.test(SUMBER_SVC)
    && /if \(!stateAwal\.baru\) return undefined;/.test(SUMBER_SVC)
    && SUMBER_SVC.indexOf("nomorBerikut('services'") > 0
    && SUMBER_SVC.indexOf("nomorBerikut('services'") < SUMBER_SVC.indexOf('await openCreateModal();')
    && /serialNumber: String\(unitAwal\.serialNumber \?\? ''\)/.test(SUMBER_SVC), undefined);
  check('rental: menyambut tawaran dari kartu Unit dengan kontrak bernomor dari file',
    /useLocation\(\)\.state/.test(SUMBER_RTL)
    && /if \(!stateAwal\.baru\) return undefined;/.test(SUMBER_RTL)
    && SUMBER_RTL.indexOf("nomorBerikut('rentals'") > 0
    && SUMBER_RTL.indexOf("nomorBerikut('rentals'") < SUMBER_RTL.indexOf('await openCreateModal();'), undefined);
  check('dokumen: pintasan dari kartu Unit membuka formulir upload yang asli',
    /Boolean\(\(useLocation\(\)\.state as \{ baru\?: boolean \} \| null\)\?\.baru\)/.test(SUMBER_DOK), undefined);
  check('label status tunggal: Servis, Rental dan kartu Unit memakai daftar yang sama',
    /SERVICE_TYPE_LABEL, STATUS_WO as STATUS_MAP/.test(SUMBER_SVC)
    && /STATUS_SEWA as STATUS_MAP/.test(SUMBER_RTL)
    && /SERVICE_TYPE_LABEL, STATUS_SEWA, STATUS_WO/.test(SUMBER_UNT)
    && !/^const STATUS_MAP: /m.test(SUMBER_SVC) && !/^const STATUS_MAP: /m.test(SUMBER_RTL)
    && ['Servis Selesai', 'Menunggu Sparepart', 'Sedang Berjalan', 'Menunggu Mobilisasi',
      'Servis Berkala 250 Jam'].every(l => SUMBER_LBL.includes(l)), undefined);
})().then(() => {
  fs.rmSync(outfile, { force: true });
  console.log(`\n=== unit: ${passed} lulus, ${failed} gagal ===`);
  process.exit(failed === 0 ? 0 : 1);
});
