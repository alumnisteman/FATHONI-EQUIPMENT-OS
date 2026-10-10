// tests/harness/search.entry.ts
// Titik masuk bundel untuk menguji kesamaan semantik pencarian renderer (JS)
// dan pencarian SQLite (kolom "search"). Hanya modul murni tanpa React.

export { matchesQuery } from '../../src/utils/searchMatch';
export { searchBlob, tokenizeSearch, normalizeSearch, COLLECTION_SPECS, SPEC_BY_NAME } from '../../electron/dbSchema';
