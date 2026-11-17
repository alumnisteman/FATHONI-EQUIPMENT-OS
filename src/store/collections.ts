// src/store/collections.ts
// Daftar kunci store dalam modul tanpa React: dataStore, layar Backup, dan peta
// kebutuhan per menu (collectionNeeds) memakai daftar yang sama, dan harness Node
// harus bisa membandingkannya dengan tabel SQLite tanpa ikut memuat React.
//
// Nama di bawah adalah NAMA COLLECTION di sisi renderer sekaligus nama tabel di
// file — daftar putih yang dipakai main process untuk menolak nama asing.

// BUG-006 FIX: Satu konstanta storage key yang konsisten (semua lowercase)
export const STORAGE_KEY = 'hems_data_store_v1';

// Kunci collection yang wajib berbentuk array di dalam store.
export const COLLECTION_KEYS = [
  'units', 'brands', 'models', 'customers', 'suppliers', 'spareParts', 'invoices', 'sales',
  'rentals', 'services', 'kas', 'deliveries', 'warehouse', 'purchases',
  'documents', 'bankAccounts', 'breakdowns', 'operators', 'technicians',
  'approvals',
];
