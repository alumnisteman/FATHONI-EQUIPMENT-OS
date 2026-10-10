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
  units: [],
  warehouse: [],
  backup: [],
  users: [],
  setup: [],
  login: [],
  brands: [],

  // ── Master data kecil: daftar penuh memang ditampilkan ──
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

  // ── Sistem: aksi di halaman ini menyapu seluruh collection ──
  maintenance: SEMUA_COLLECTION,
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
