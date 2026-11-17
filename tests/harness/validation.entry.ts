// tests/harness/validation.entry.ts
// Titik masuk bundel harness unit MURNI (tanpa React, tanpa Electron).
// Isi yang diekspor di sini adalah kode yang hari ini hanya teruji tidak langsung
// lewat layar: validasi form dan checksum pemulihan data.

export * as V from '../../src/utils/validation';
// Kolom turunan ikut dibundle sebagai unit murni: satu-satunya aturan "servis
// berikutnya" (Tahap 1 T2) harus bisa dibuktikan tanpa membuka Electron, karena
// sisi SQLite menyalin angkanya dan paritas keduanya diuji terpisah di db-check.
export * as D from '../../src/domain/derivedColumns';
export { getDataRecovery, collectSnapshotSettings } from '../../src/utils/dataRecovery';
export { matchesQuery } from '../../src/utils/searchMatch';
export { COLLECTION_KEYS } from '../../src/store/collections';
export {
  urutanTerakhir, urutanTertinggi, cariUrutanBebas, nomorBerikut, nomorSementara,
} from '../../src/utils/nomorBerikut';
