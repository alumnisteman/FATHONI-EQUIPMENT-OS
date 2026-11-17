// src/store/collectionNeeds.ts
// Daftar collection yang HARUS termuat penuh sebelum sebuah menu boleh
// menampilkan atau menulis array store. Boot tidak lagi memindahkan seluruh isi
// file ke renderer (lihat DataProvider.ensureLoaded), jadi peta inilah yang
// menentukan apa yang dibaca saat sebuah menu dibuka.
//
// Sebuah nama masuk bila salah satu ini benar:
//  (a) halaman merender / memfilter / menghitung array store collection itu, atau
//  (b) halaman memanggil aksi yang menulis array penuh — termasuk aksi silang
//      menu: addSale menulis invoices+kas+deliveries+units, receivePurchase menulis
//      warehouse+suppliers+spareParts+kas, completeService menulis
//      warehouse+invoices+units+spareParts.
//  Aksi yang hanya mungkin jalan lewat tombol dan menyapu SEMUA collection tidak
//  perlu masuk peta: handler tombolnya memanggil ensureLoaded sendiri, supaya
//  membuka menunya tetap murah. Lihat `maintenance` di bawah.
//
// Nama yang TIDAK masuk peta berarti halamannya sudah mengambil angkanya langsung
// dari query SQLite, sehingga array store-nya boleh tetap kosong. Kosong bukan
// berarti data hilang: penjaga di dataStore melarang collection yang belum termuat
// ikut ditulis sebagai collection penuh.

import { COLLECTION_KEYS } from './collections';

/** Rute yang menyentuh seluruh array store (muat data contoh, pemulihan). */
export const SEMUA_COLLECTION = COLLECTION_KEYS;

const NEEDS: Record<string, string[]> = {
  // ── Angka lahir di query: tidak ada array store yang dibutuhkan ──
  dashboard: [],
  'control-tower': [],
  reports: [],
  'equipment-passport': [],
  warehouse: [],
  backup: [],
  users: [],
  setup: [],
  login: [],

  // ── Master data kecil: daftar penuh memang ditampilkan ──
  // Katalog merek/model: halamannya merender kedua array dan menyimpannya sebagai
  // collection penuh, jadi keduanya wajib terhidrasi sebelum layar boleh buka.
  // Halaman Unit juga memakainya (daftar merek + saran kode model).
  brands: ['brands', 'models'],
  // Unit memilih merek dari katalog dan menyarankan kode model, jadi dua array
  // katalog ikut dibaca. Angka unit sendiri tetap lahir dari query berpaginasi.
  units: ['brands', 'models'],
  customers: ['customers'],
  suppliers: ['suppliers'],
  technicians: ['technicians'],
  operators: ['operators', 'units'],
  approvals: ['approvals'],
  documents: ['documents'],
  // Dua kartu KPI suku cadang masih perkalian dua kolom di sisi renderer.
  spareparts: ['spareParts'],
  settings: ['bankAccounts'],

  // ── Transaksi: array sendiri + collection yang ikut ditulis aksinya ──
  sales: ['sales', 'units', 'customers', 'invoices', 'kas', 'deliveries'],
  purchase: ['purchases', 'suppliers', 'warehouse', 'spareParts', 'kas'],
  rental: ['rentals', 'units', 'customers', 'invoices'],
  service: ['services', 'units', 'customers', 'spareParts', 'warehouse', 'invoices'],
  delivery: ['deliveries', 'sales'],
  breakdown: ['breakdowns', 'units'],
  invoices: ['invoices', 'bankAccounts', 'kas'],
  finance: ['kas', 'bankAccounts'],

  // ── Sistem ──
  // Halaman ini hanya MEMBACA angka dari query (kesehatan, cadangan, pemakaian
  // ruang, laporan migrasi) — nol array store saat dibuka. Satu-satunya aksi yang
  // menyapu seluruh collection adalah "Muat data contoh", dan ia meminta hidrasi
  // sendiri (`ensureLoaded(SEMUA_COLLECTION)`) di dalam handler tombolnya. Dulu
  // rute ini memetakan SEMUA_COLLECTION, sehingga membuka menu Perawatan Sistem
  // pada basis data besar langsung memindahkan seluruh isi file ke renderer demi
  // satu tombol yang jarang ditekan. Dikunci validation-check §26 + db-check 15.11.
  maintenance: [],
  // Jejak audit dibaca dari main process (kanal auth-audit-log), bukan dari
  // array store — memetakan collection di sini hanya membuat rute ini
  // menghidrasi tujuh daftar yang tidak pernah dipakai halamannya.
  'audit-log': [],
};

/**
 * Kebutuhan satu path. Rute yang tidak dikenal mengembalikan SEMUA collection:
 * lebih baik memuat lebih banyak daripada menulis ke array yang belum pernah
 * dibacakan — rute tak dikenal hanya muncul kalau ada rute baru yang petanya
 * belum diperbarui.
 */
export function needsForPath(pathname: string): string[] {
  const segmen = String(pathname || '').split('/').filter(Boolean)[0] || 'dashboard';
  return NEEDS[segmen] ?? SEMUA_COLLECTION;
}

/** Kunci rute yang terdaftar, untuk harness dan dokumentasi. */
export function routeKeys(): string[] {
  return Object.keys(NEEDS).sort();
}
