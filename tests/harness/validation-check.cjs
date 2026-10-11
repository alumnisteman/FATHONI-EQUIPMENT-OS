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
// removeRow. Brands.tsx sengaja tidak ikut — daftar merek/model adalah state
// lokal halaman itu, bukan collection store, jadi tidak ada baris file yang bisa
// tertinggal.
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

// ── 15. penjaga cara harness mengakhiri proses ────────────────
// app.exit() melompati before-quit main.js, jadi koneksi SQLite tetap terbuka
// saat Windows membongkar DLL-nya. Hasilnya pernah terlihat di rantai regresi:
// 72 assertion lulus semua, tapi proses keluar dengan Segmentation fault (139)
// sehingga rantai ditandai rusak. Semua harness Electron karena itu wajib lewat
// tests/harness/selesai.cjs.
const HARNESS_ELECTRON = [
  'auth-check.cjs', 'compat-check.cjs', 'db-backup-check.cjs', 'db-check.cjs',
  'db-store-check.cjs', 'flow-check.cjs', 'gui-check.cjs', 'handoff-check.cjs',
  'integrity-check.cjs', 'perf-check.cjs', 'usable-check.cjs',
];
for (const f of HARNESS_ELECTRON) {
  const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
  check(`${f}: keluar lewat selesai(), tidak app.exit() langsung`,
    !/[^.]app\.exit\(/.test(src) && src.includes("require('./selesai.cjs')"));
}

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

fs.rmSync(outfile, { force: true });
console.log(`\n=== unit: ${passed} lulus, ${failed} gagal ===`);
process.exit(failed === 0 ? 0 : 1);
