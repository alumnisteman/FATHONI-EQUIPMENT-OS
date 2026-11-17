// src/domain/derivedColumns.ts
// Nilai kolom turunan SQLite untuk MODE BROWSER (vite dev tanpa Electron), saat
// query tidak tersedia dan angka tetap harus bisa dihitung dari array store.
//
// Ini cerminan cara electron/dbSchema.ts mengisi kolom yang sama. Fungsinya
// sengaja disalin, bukan diimpor: tsconfig.electron.json hanya mengompilasi
// folder electron/ dan renderer tidak boleh menarik kode main process ke
// bundle-nya. tests/harness/db-check.cjs bagian 13 membandingkan hasil kedua
// sisi pada baris yang sama, jadi penyimpangan salah satu sisi membuat uji
// gagal — bukan menampilkan angka yang salah diam-diam.

/** 'YYYY-MM' dari tanggal ISO, sama seperti MONTH(col, field) di dbSchema. */
export function monthOf(value: unknown): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(value ?? ''));
  return m ? `${m[1]}-${m[2]}` : '';
}

/**
 * Field sumber kolom 'month' per collection. Tabel eksplisit dipilih alih-alih
 * menebak field tanggal mana yang dipakai record: banyak record punya beberapa
 * field tanggal (invoice punya issueDate DAN dueDate) dan pilihannya harus sama
 * persis dengan pilihan di sisi SQLite.
 */
export const MONTH_SOURCE: Record<string, string> = {
  invoices: 'issueDate',
  sales: 'orderDate',
  rentals: 'startDate',
  services: 'openDate',
  kas: 'tanggal',
  purchases: 'orderDate',
};

/**
 * Siklus servis yang sama dipakai kolom turunan `serviceDueIn` di sisi SQLite
 * (`electron/dbSchema.ts`, angkanya tertulis di sana karena `electron/` dibuild
 * terpisah dan tidak boleh mengimpor `src/`) dan kartu "Servis Periodik
 * Selanjutnya" di layar Unit. Bukan 250: kartu Unit dulu menulis `hourMeter + 250`
 * sehingga dua menu melaporkan servis berikutnya berbeda untuk alat yang sama, dan
 * salah satunya pasti salah di mata operator lapangan.
 */
export const SIKLUS_SERVIS_HM = 500;

/** Sisa HM menuju servis 500 HM berikutnya, seperti kartu alert Dasbor. */
export function serviceDueInOf(hourMeter: unknown): number | null {
  const hm = Number(hourMeter) || 0;
  if (!Number.isFinite(hm) || hm < 0) return null;
  return SIKLUS_SERVIS_HM - (Math.trunc(hm) % SIKLUS_SERVIS_HM);
}

/** HM tempat servis berkala berikutnya jatuh, atau null bila HM tidak terpakai. */
export function hmServisBerikutnyaOf(hourMeter: unknown): number | null {
  const sisa = serviceDueInOf(hourMeter);
  if (sisa === null) return null;
  return Math.trunc(Number(hourMeter) || 0) + sisa;
}

/** Selisih stok terhadap titik aman; nol atau negatif berarti perlu restock. */
export function stockShortfallOf(stock: unknown, minStock: unknown): number | null {
  const s = Number(stock);
  const m = Number(minStock);
  if (!Number.isFinite(s) || !Number.isFinite(m)) return null;
  return Math.trunc(s - m);
}

/**
 * Penanda 0/1 foto yang masih menempel sebagai base64, sama seperti kolom
 * INLINE_PHOTO di dbSchema (dan isDataUrl di src/utils/photoStore.ts).
 */
export function inlinePhotoOf(photo: unknown): number {
  return typeof photo === 'string' && photo.startsWith('data:') ? 1 : 0;
}

/**
 * Nilai satu kolom untuk satu record. Kolom turunan dihitung, sisanya dibaca
 * apa adanya kecuali beberapa kolom yang nama field sumbernya tidak sama dengan
 * nama kolomnya.
 */
export function columnValueOf(collection: string, col: string, row: any): unknown {
  if (col === 'month') {
    const field = MONTH_SOURCE[collection];
    return field ? monthOf(row?.[field]) : '';
  }
  if (col === 'serviceDueIn') return serviceDueInOf(row?.hourMeter);
  if (col === 'stockShortfall') return stockShortfallOf(row?.stock, row?.minStock);
  if (collection === 'units' && col === 'inlinePhoto') return inlinePhotoOf(row?.photo);
  // Gudang: baris aplikasi memakai "date", rekaman warisan HEMS memakai
  // "tanggal". Kolom SQL-nya satu, sumber nilainya dua — sama seperti di spec.
  if (collection === 'warehouse' && col === 'tanggal') return row?.date ?? row?.tanggal;
  return row?.[col];
}
