// electron/dbSchema.ts
// Definisi tabel SQLite untuk setiap collection aplikasi. Ini satu-satunya tempat
// yang tahu kolom mana dari sebuah record ikut dinormalisasi ke kolom SQL.
//
// Alasan bentuknya "payload JSON + kolom turunan":
//   payload  -> tidak ada field yang hilang saat berpindah mesin, termasuk field
//               yang hanya dipakai satu halaman;
//   turunan  -> pencarian, penyaringan dan pengurutan jalan di SQLite, jadi halaman
//               besar tidak perlu memuat seluruh collection ke RAM;
//   hash     -> penyimpanan write-behind bisa melewatkan baris yang tidak berubah.
//
// Blob pencarian memakai normalisasi yang SAMA dengan src/utils/searchMatch.ts.
// Fungsi itu sengaja disalin (bukan diimpor) karena tsconfig.electron.json hanya
// mengompilasi folder electron/; harness db-check.cjs menguji keduanya tetap identik.

export interface ColumnSpec {
  /** Nama kolom SQL. */
  col: string;
  field?: string;
  type: 'TEXT' | 'REAL' | 'INTEGER';
  /** Pengambil nilai dari record. Hasil selalu dikonversi ke tipe kolom. */
  get: (row: any) => unknown;
}

export interface CollectionSpec {
  name: string;
  columns: ColumnSpec[];
  /** Field record yang digabung menjadi blob pencarian. */
  search: string[];
  /** Kolom urutan baku; harus ada di columns. */
  sort: string;
  /** Pasangan (kolom turunan) yang duplikatnya perlu dilaporkan ke pengguna. */
  duplicates?: string[];
}

const str = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  return String(v);
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Samakan dengan normalize() di src/utils/searchMatch.ts. */
export function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').trim();
}

/** Samakan dengan tokenize() di src/utils/searchMatch.ts. */
export function tokenizeSearch(query: string): string[] {
  return String(query || '').split(/[\s,;]+/).map(normalizeSearch).filter(Boolean);
}

/**
 * Samakan dengan cara matchesQuery menggabungkan kolom: setiap field dinormalisasi
 * sendiri lalu digabung dengan spasi, supaya satu kata tidak kebetulan terbentuk
 * dari gabungan dua kolom.
 */
export function searchBlob(row: any, fields: string[]): string {
  return fields
    .map(f => normalizeSearch(str(row ? row[f] : '')))
    .filter(Boolean)
    .join(' ');
}

const TEXT = (col: string, field: string): ColumnSpec => ({ col, field, type: 'TEXT', get: r => r[field] });
const REAL = (col: string, field: string): ColumnSpec => ({ col, field, type: 'REAL', get: r => num(r[field]) });
const INT = (col: string, field: string): ColumnSpec => ({ col, field, type: 'INTEGER', get: r => num(r[field]) });

/**
 * 'YYYY-MM' dari field tanggal ISO, untuk agregat per bulan di SQLite.
 * Tanggal yang tidak bisa dibaca menjadi string kosong — sama seperti
 * revenueByMonth() di src/domain/revenue.ts yang MENGABAIKANNYA, bukan
 * menumpuknya di bulan yang salah. Karena kolomnya TEXT, kelompok kosong ini
 * tetap ada di tabel tapi tidak pernah cocok dengan kunci bulan mana pun.
 */
const MONTH = (col: string, field: string): ColumnSpec => ({
  col,
  type: 'TEXT',
  get: r => {
    const m = /^(\d{4})-(\d{2})/.exec(str(r ? r[field] : ''));
    return m ? `${m[1]}-${m[2]}` : '';
  },
});

/** Sisa jam meter menuju servis 500 HM berikutnya, seperti hitungan Dasbor. */
const SERVICE_DUE_IN: ColumnSpec = {
  col: 'serviceDueIn',
  type: 'INTEGER',
  get: r => {
    const hm = Number(r && r.hourMeter) || 0;
    if (!Number.isFinite(hm) || hm < 0) return null;
    return 500 - (Math.trunc(hm) % 500);
  },
};

/**
 * Selisih stok terhadap titik aman. Kolomnya dibuat di sini, bukan dibandingkan
 * dua kolom saat query, supaya nilainya ikut terisi di indeks dan bisa
 * disaring seperti kolom turunan lain (`{ stockShortfall: { op: 'lte', value: 0 } }`).
 */
const STOCK_SHORTFALL: ColumnSpec = {
  col: 'stockShortfall',
  type: 'INTEGER',
  get: r => {
    const stock = Number(r && r.stock);
    const min = Number(r && r.minStock);
    if (!Number.isFinite(stock) || !Number.isFinite(min)) return null;
    return Math.trunc(stock - min);
  },
};

/**
 * Penanda 0/1: record unit masih menyimpan fotonya sebagai base64 di dalam
 * payload. Kolom ini ada supaya migrasi foto (Fase 0) tetap bisa menemukan
 * kandidatnya lewat query — sejak boot tidak lagi memuat seluruh collection
 * units ke renderer, layar Unit tidak memegang array penuh untuk dipindai lagi.
 *
 * Cara menandainya SAMA dengan isDataUrl() di src/utils/photoStore.ts ('data:'
 * di awal string); disalin karena alasan yang sama dengan normalizeSearch:
 * renderer tidak boleh mengimpor kode main process, dan db-check membandingkan
 * hasil kedua sisi pada baris yang sama.
 */
const INLINE_PHOTO: ColumnSpec = {
  col: 'inlinePhoto',
  type: 'INTEGER',
  get: r => (typeof r?.photo === 'string' && (r as any).photo.startsWith('data:') ? 1 : 0),
};

export const COLLECTION_SPECS: CollectionSpec[] = [
  {
    name: 'units',
    columns: [
      TEXT('serialNumber', 'serialNumber'), TEXT('brand', 'brand'), TEXT('model', 'model'),
      TEXT('status', 'status'), TEXT('category', 'category'), TEXT('location', 'location'),
      INT('hourMeter', 'hourMeter'), REAL('purchasePrice', 'purchasePrice'), TEXT('purchaseDate', 'purchaseDate'),
      SERVICE_DUE_IN, INLINE_PHOTO,
    ],
    // 'year' ikut: halaman Unit mencari tahun produksi, dan blob yang tidak
    // memuatnya membuat pencarian "SY215C 2021" menemukan lebih sedikit daripada
    // pencarian lama di sisi renderer.
    search: ['serialNumber', 'brand', 'model', 'category', 'location', 'status', 'notes', 'year'],
    sort: 'purchaseDate',
    duplicates: ['serialNumber'],
  },
  {
    // Katalog merek dipisahkan dari unit: halaman Unit mengambil pilihan merek
    // dari sini, dan `units.brand` yang ditulis tangan tidak pernah menjadi
    // kunci rujukan — penjagaannya lewat pemeriksaan "merek masih dipakai"
    // (referential.ts), bukan lewat FOREIGN KEY.
    name: 'brands',
    columns: [TEXT('name', 'name'), TEXT('country', 'country'), TEXT('category', 'category')],
    search: ['name', 'country', 'category', 'description'],
    sort: 'name',
    duplicates: ['name'],
  },
  {
    name: 'models',
    columns: [
      TEXT('brandName', 'brandName'), TEXT('modelCode', 'modelCode'), TEXT('category', 'category'),
    ],
    // Kapasitas/daya/berat ikut blob: pencarian "SY215C 21.900" di halaman katalog
    // harus menemukan barisnya, sama seperti kolom yang dicari lewat matchesQuery.
    search: ['brandName', 'modelCode', 'category', 'capacity', 'enginePower', 'operatingWeight'],
    sort: 'modelCode',
    duplicates: ['modelCode'],
  },
  {
    name: 'customers',
    columns: [TEXT('name', 'name'), TEXT('phone', 'phone'), TEXT('segment', 'segment'), TEXT('email', 'email')],
    search: ['name', 'phone', 'address', 'email', 'contactPerson', 'segment'],
    sort: 'name',
  },
  {
    name: 'suppliers',
    columns: [TEXT('name', 'name'), TEXT('phone', 'phone'), TEXT('category', 'category'), TEXT('email', 'email')],
    search: ['name', 'contact', 'phone', 'email', 'address', 'category', 'npwp'],
    sort: 'name',
  },
  {
    name: 'spareParts',
    columns: [
      TEXT('name', 'name'), TEXT('sku', 'sku'), INT('stock', 'stock'), INT('minStock', 'minStock'),
      REAL('price', 'price'),
      TEXT('unit', 'unit'), TEXT('category', 'category'),
      TEXT('compatibleBrands', 'compatibleBrands'), TEXT('rackLocation', 'rackLocation'),
      STOCK_SHORTFALL,
    ],
    // Halaman Suku Cadang mencari dan menyaring pada kategori, merek yang cocok,
    // dan lokasi rak — blob yang hanya memuat name/sku/unit membuat pencarian
    // "rak A1" dan tombol kategori tidak pernah cocok.
    search: ['name', 'sku', 'unit', 'category', 'compatibleBrands', 'rackLocation'],
    sort: 'sku',
    duplicates: ['sku'],
  },
  {
    name: 'invoices',
    columns: [
      TEXT('invoiceNo', 'invoiceNo'), TEXT('customerName', 'customerName'), TEXT('type', 'type'),
      TEXT('status', 'status'), TEXT('issueDate', 'issueDate'), TEXT('dueDate', 'dueDate'),
      REAL('totalAmount', 'totalAmount'), REAL('paidAmount', 'paidAmount'),
      TEXT('sourceType', 'sourceType'), TEXT('sourceNumber', 'sourceNumber'),
      MONTH('month', 'issueDate'),
    ],
    search: ['invoiceNo', 'customerName', 'unitOrDesc', 'type', 'status', 'sourceNumber'],
    sort: 'issueDate',
    duplicates: ['invoiceNo'],
  },
  {
    name: 'sales',
    columns: [
      TEXT('orderNo', 'orderNo'), TEXT('customerName', 'customerName'), TEXT('serialNumber', 'serialNumber'),
      TEXT('unitModel', 'unitModel'), TEXT('status', 'status'), TEXT('orderDate', 'orderDate'),
      REAL('totalPrice', 'totalPrice'), REAL('downPayment', 'downPayment'),
      MONTH('month', 'orderDate'),
    ],
    search: ['orderNo', 'customerName', 'unitModel', 'serialNumber', 'status', 'salesPerson', 'paymentScheme'],
    sort: 'orderDate',
    duplicates: ['orderNo'],
  },
  {
    name: 'rentals',
    columns: [
      TEXT('contractNo', 'contractNo'), TEXT('customerName', 'customerName'), TEXT('unitModel', 'unitModel'),
      TEXT('serialNumber', 'serialNumber'), TEXT('status', 'status'), TEXT('startDate', 'startDate'),
      TEXT('endDate', 'endDate'), REAL('monthlyRate', 'monthlyRate'),
      MONTH('month', 'startDate'),
    ],
    search: ['contractNo', 'customerName', 'unitModel', 'serialNumber', 'location', 'status'],
    sort: 'startDate',
    duplicates: ['contractNo'],
  },
  {
    name: 'services',
    columns: [
      TEXT('woNumber', 'woNumber'), TEXT('serialNumber', 'serialNumber'), TEXT('unitModel', 'unitModel'),
      TEXT('customerOrProject', 'customerOrProject'), TEXT('status', 'status'), TEXT('openDate', 'openDate'),
      TEXT('completedDate', 'completedDate'), REAL('estimatedCost', 'estimatedCost'), REAL('actualCost', 'actualCost'),
      MONTH('month', 'openDate'),
    ],
    search: ['woNumber', 'unitModel', 'serialNumber', 'customerOrProject', 'serviceType', 'mechanicName', 'status'],
    sort: 'openDate',
    duplicates: ['woNumber'],
  },
  {
    name: 'kas',
    columns: [
      TEXT('tanggal', 'tanggal'), TEXT('kategori', 'kategori'), TEXT('tipe', 'tipe'),
      REAL('jumlah', 'jumlah'), TEXT('rekening', 'rekening'), TEXT('referensi', 'referensi'),
      MONTH('month', 'tanggal'),
    ],
    search: ['tanggal', 'keterangan', 'kategori', 'tipe', 'rekening', 'referensi'],
    sort: 'tanggal',
  },
  {
    name: 'deliveries',
    columns: [
      TEXT('doNumber', 'doNumber'), TEXT('customerName', 'customerName'), TEXT('serialNumber', 'serialNumber'),
      TEXT('status', 'status'), TEXT('deliveryDate', 'deliveryDate'), TEXT('salesOrderRef', 'salesOrderRef'),
    ],
    search: ['doNumber', 'salesOrderRef', 'customerName', 'unitModel', 'serialNumber', 'destination', 'driverName', 'truckPlate', 'status'],
    sort: 'deliveryDate',
    duplicates: ['doNumber'],
  },
  {
    name: 'warehouse',
    columns: [
      TEXT('trxNo', 'trxNo'), TEXT('type', 'type'), TEXT('warehouseName', 'warehouseName'),
      TEXT('itemDescription', 'itemDescription'),
      // Baris aplikasi memakai "date"; rekaman warisan dari HEMS_WAREHOUSE ada
      // yang memakai "tanggal". Kolomnya satu, sumber nilainya dua.
      { col: 'tanggal', type: 'TEXT', get: r => r.date ?? r.tanggal },
      INT('qty', 'qty'),
    ],
    search: ['trxNo', 'warehouseName', 'itemDescription', 'type', 'referenceDoc', 'referensi', 'pic'],
    sort: 'tanggal',
  },
  {
    name: 'purchases',
    columns: [
      TEXT('poNumber', 'poNumber'), TEXT('supplierName', 'supplierName'), TEXT('category', 'category'),
      TEXT('status', 'status'), TEXT('orderDate', 'orderDate'), REAL('totalAmount', 'totalAmount'),
      TEXT('itemName', 'itemName'),
      MONTH('month', 'orderDate'),
    ],
    search: ['poNumber', 'supplierName', 'itemName', 'category', 'status', 'notes'],
    sort: 'orderDate',
    duplicates: ['poNumber'],
  },
  {
    name: 'documents',
    columns: [
      TEXT('jenisDokumen', 'jenisDokumen'), TEXT('nomorDokumen', 'nomorDokumen'),
      TEXT('statusLegalitas', 'statusLegalitas'), TEXT('masaBerlaku', 'masaBerlaku'),
    ],
    search: ['jenisDokumen', 'nomorDokumen', 'statusLegalitas', 'keterangan', 'masaBerlaku'],
    sort: 'masaBerlaku',
  },
  {
    name: 'bankAccounts',
    columns: [
      TEXT('namaBank', 'namaBank'), TEXT('nomorRekening', 'nomorRekening'),
      TEXT('mataUang', 'mataUang'), TEXT('isActive', 'isActive'),
    ],
    search: ['namaBank', 'nomorRekening', 'namaPemilik', 'cabang', 'mataUang', 'keterangan'],
    sort: 'namaBank',
  },
  {
    name: 'breakdowns',
    columns: [
      TEXT('breakdownNumber', 'breakdownNumber'), TEXT('unitSerialNumber', 'unitSerialNumber'),
      TEXT('unitModel', 'unitModel'), TEXT('severity', 'severity'), TEXT('status', 'status'),
      TEXT('reportedAt', 'reportedAt'), REAL('estimatedRepairCost', 'estimatedRepairCost'),
    ],
    search: ['breakdownNumber', 'unitSerialNumber', 'unitModel', 'location', 'reportedBy', 'assignedTechnician', 'severity', 'status', 'description'],
    sort: 'reportedAt',
    duplicates: ['breakdownNumber'],
  },
  {
    name: 'operators',
    columns: [
      TEXT('operatorNumber', 'operatorNumber'), TEXT('name', 'name'), TEXT('status', 'status'),
      TEXT('assignedUnit', 'assignedUnit'), INT('totalHours', 'totalHours'),
    ],
    search: ['operatorNumber', 'name', 'phone', 'email', 'nik', 'status', 'assignedUnit', 'assignedProject', 'licenseNumber'],
    sort: 'operatorNumber',
    duplicates: ['operatorNumber'],
  },
  {
    name: 'technicians',
    columns: [
      TEXT('technicianNumber', 'technicianNumber'), TEXT('name', 'name'),
      TEXT('status', 'status'), INT('totalHours', 'totalHours'),
    ],
    search: ['technicianNumber', 'name', 'phone', 'email', 'nik', 'status'],
    sort: 'technicianNumber',
    duplicates: ['technicianNumber'],
  },
  {
    name: 'approvals',
    columns: [
      TEXT('requestNumber', 'requestNumber'), TEXT('type', 'type'), TEXT('status', 'status'),
      TEXT('requestedAt', 'requestedAt'), REAL('amount', 'amount'), TEXT('currentApprover', 'currentApprover'),
    ],
    search: ['requestNumber', 'type', 'title', 'requestedBy', 'currentApprover', 'status'],
    sort: 'requestedAt',
    duplicates: ['requestNumber'],
  },
];

export const SPEC_BY_NAME: Record<string, CollectionSpec> = Object.fromEntries(
  COLLECTION_SPECS.map(s => [s.name, s])
);

export function isCollectionName(name: unknown): name is string {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(SPEC_BY_NAME, name);
}

export interface StoredRow {
  pk: string;
  id: string;
  payload: string;
  hash: string;
  search: string;
  values: unknown[];
}

/**
 * Kunci penyimpanan untuk setiap baris. Baris dengan id rangkap tetap disimpan
 * (penanda #2, #3, ...) supaya tidak ada data yang hilang saat menulis ulang;
 * `id` aslinya tetap ada di payload sehingga muat-balik identik.
 */
export function storageKeys(rows: any[]): { pk: string; id: string }[] {
  const seen = new Map<string, number>();
  return rows.map((row, index) => {
    const id = row && row.id !== undefined && row.id !== null ? String(row.id) : `noid-${index}`;
    const count = seen.get(id) || 0;
    seen.set(id, count + 1);
    return { pk: count === 0 ? id : `${id}#${count + 1}`, id };
  });
}

export function toColumnValue(spec: CollectionSpec, col: ColumnSpec, row: any): unknown {
  const raw = col.get(row || {});
  if (col.type === 'TEXT') return str(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw))) return null;
  return col.type === 'INTEGER' ? Math.trunc(Number(raw)) : Number(raw);
}

/**
 * Nilai angka yang cacat pada satu baris, atau null bila barisnya bersih.
 *
 * Ini BUKAN pengganti `toColumnValue`: lapisan itu tetap mengubah nilai kosong
 * menjadi NULL (dan itu diuji db-check bagian 13). Yang dijaga di sini adalah
 * nilai yang HADIR tapi bukan angka — "1.,5", "12x", NaN — yang kalau dibiarkan
 * masuk menjadi NULL diam-diam, sehingga SUM di Dasbor dan Laporan kehilangan
 * transaksi tanpa satu pesan pun. Kanal tulis karena itu menolak barisnya sebelum
 * satu pun collection tertulis. Kolom turunan ikut diperiksa: `get()`-nya selalu
 * mengembalikan angka atau null, jadi ia tidak pernah menjadi sumber penolakan.
 */
export function nilaiAngkaCacat(spec: CollectionSpec, row: any): string | null {
  for (const col of spec.columns) {
    if (col.type === 'TEXT') continue;
    const raw = col.field
      ? (row ? row[col.field] : undefined)
      : (row && row[col.col] !== undefined ? row[col.col] : col.get(row || {}));
    if (raw === null || raw === undefined || raw === '') continue;
    const t = typeof raw === 'string' ? raw.trim() : raw;
    if (typeof t === 'boolean') return `"${col.col}" berisi ${String(t)}`;
    if (typeof t === 'object') return `"${col.col}" berisi objek, bukan angka`;
    if (!Number.isFinite(Number(t))) return `"${col.col}" berisi "${String(t).slice(0, 40)}" yang bukan angka`;
  }
  return null;
}
