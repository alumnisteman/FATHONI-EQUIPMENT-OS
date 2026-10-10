// tests/harness/validation.entry.ts
// Titik masuk bundel harness unit MURNI (tanpa React, tanpa Electron).
// Isi yang diekspor di sini adalah kode yang hari ini hanya teruji tidak langsung
// lewat layar: validasi form dan checksum pemulihan data.

export * as V from '../../src/utils/validation';
export { getDataRecovery, collectSnapshotSettings } from '../../src/utils/dataRecovery';
export { matchesQuery } from '../../src/utils/searchMatch';
