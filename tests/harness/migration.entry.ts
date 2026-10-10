// tests/harness/migration.entry.ts
// Titik masuk bundel harness Fase 3. Hanya modul murni (tanpa React) yang
// diekspor di sini agar bisa dijalankan node lewat esbuild.

export { migrateStore, readMigrationMarker, writeMigrationMarker, hasMigrationWork, MIGRATION_MARKER_KEY, isLegacyArchiveKey } from '../../src/store/dataMigration';
export { buildSampleStore, SAMPLE_COLLECTIONS } from '../../src/data/sampleData';
export { invoiceFromSale, invoiceFromRental, invoiceFromService, hasInvoiceFor } from '../../src/domain/invoiceFactory';
export { lastMonthKeys, revenueByMonth, labelForMonthKey } from '../../src/domain/revenue';
export { DEMO_SALES, DEMO_RENTALS, DEMO_SERVICES } from '../../src/data/demoTransactions';
