// tests/harness/totals.entry.ts
// Titik masuk esbuild untuk bagian 13 dan 15 db-check: sisi renderer dari
// penyaringan, pengelompokan dan PENJAGA TULIS, dibundle menjadi CommonJS supaya
// harness Node bisa membandingkannya langsung dengan hasil SQLite pada baris yang
// sama. writeGuard dan derivedColumns sengaja modul tanpa React — itulah alasan
// penjaga keselamatan data bisa diuji tanpa membuka aplikasi.

export { matchesWhere, groupLocally } from '../../src/hooks/useCollectionTotals';
export {
  columnValueOf, monthOf, serviceDueInOf, stockShortfallOf, inlinePhotoOf, MONTH_SOURCE,
} from '../../src/domain/derivedColumns';
export { revenueByMonth, lastMonthKeys, isoDay } from '../../src/domain/revenue';
export { rowKey, diffRows, rencanakanTulis } from '../../src/store/writeGuard';
export { COLLECTION_KEYS, STORAGE_KEY } from '../../src/store/collections';
export { needsForPath, routeKeys } from '../../src/store/collectionNeeds';
