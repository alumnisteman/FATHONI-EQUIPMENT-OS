// src/store/dataMigration.ts
// Migrasi sekali jalan saat aplikasi pertama dibuka setelah Fase 3:
//  1. buang record yang masih persis sama dengan data contoh (yang tidak pernah
//     disunting pengguna) sehingga database tidak lagi berisi angka fiktif;
//  2. impor data asli yang tertinggal di kunci localStorage versi lama (HEMS_*);
//  3. backfill invoice untuk penjualan/rental/servis yang belum tertagih, karena
//     menu Invoice dan Laporan Pendapatan membacanya dari collection invoices.
// Nilai asli setiap kunci warisan tidak pernah dihapus dari profil — hanya dibaca.

import { SAMPLE_COLLECTIONS } from '../data/sampleData';
import { invoiceFromSale, invoiceFromRental, invoiceFromService } from '../domain/invoiceFactory';

export const MIGRATION_MARKER_KEY = 'hems_data_migration_v1';

interface LegacySource {
  key: string;
  collection: string;
  naturalKeys: string[];
}

// Kunci warisan (huruf besar) milik versi aplikasi sebelum rebrand.
const LEGACY_SOURCES: LegacySource[] = [
  { key: 'HEMS_UNITS',       collection: 'units',       naturalKeys: ['serialNumber'] },
  { key: 'HEMS_CUSTOMERS',   collection: 'customers',   naturalKeys: ['name'] },
  { key: 'HEMS_SUPPLIERS',   collection: 'suppliers',   naturalKeys: ['name'] },
  { key: 'HEMS_SPAREPARTS',  collection: 'spareParts',  naturalKeys: ['sku', 'name'] },
  { key: 'HEMS_SALES',       collection: 'sales',       naturalKeys: ['orderNo'] },
  { key: 'HEMS_RENTALS',     collection: 'rentals',     naturalKeys: ['contractNo'] },
  { key: 'HEMS_SERVICES',    collection: 'services',    naturalKeys: ['woNumber'] },
  { key: 'HEMS_INVOICES',    collection: 'invoices',    naturalKeys: ['invoiceNo'] },
  { key: 'HEMS_DELIVERIES',  collection: 'deliveries',  naturalKeys: ['doNumber'] },
  { key: 'HEMS_KAS',         collection: 'kas',         naturalKeys: ['referensi', 'tanggal'] },
  { key: 'HEMS_WAREHOUSE',   collection: 'warehouse',   naturalKeys: ['trxNo'] },
  { key: 'HEMS_PURCHASES',   collection: 'purchases',   naturalKeys: ['poNumber'] },
];

// Arsip lama yang isinya bukan data aktif: tetap ditinggalkan di profil sebagai
// arsip, tetapi tidak boleh ikut tersalin ke backup.
export const LEGACY_ARCHIVE_KEYS = ['HEMS_DATA_BACKUPS', 'HEMS_HEALTH_LOGS'];

export function isLegacyArchiveKey(key: string): boolean {
  return LEGACY_ARCHIVE_KEYS.includes(key) || LEGACY_SOURCES.some(s => s.key === key);
}

export interface MigrationReport {
  at: string;
  removedSamples: Record<string, number>;
  imported: Record<string, number>;
  backfilledInvoices: number;
  legacyRowsSeen: number;
}

const VOLATILE_FIELDS = new Set(['createdAt', 'updatedAt', 'lastSyncAt']);

// Sidik jari = seluruh isi kecuali timestamp. Record contoh yang sidik jarinya
// masih sama berarti tidak pernah disentuh pengguna.
function fingerprint(record: any): string {
  const keys = Object.keys(record || {}).filter(k => !VOLATILE_FIELDS.has(k)).sort();
  return JSON.stringify(keys.map(k => [k, (record as any)[k]]));
}

function sampleFingerprints(collection: string): Set<string> {
  return new Set((SAMPLE_COLLECTIONS[collection] || []).map(fingerprint));
}

function naturalValue(record: any, keys: string[]): string {
  for (const k of keys) {
    const v = record?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim().toLowerCase();
  }
  return '';
}

function readLegacyRows(key: string): any[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(r => r && typeof r === 'object') : [];
  } catch {
    return [];
  }
}

function ensureFreeId(existing: any[], wanted: string): string {
  const taken = new Set(existing.map(r => String(r.id)));
  if (!taken.has(String(wanted))) return String(wanted);
  let suffix = 2;
  while (taken.has(`${wanted}-${suffix}`)) suffix += 1;
  return `${wanted}-${suffix}`;
}

function backfillInvoices(store: Record<string, any[]>): number {
  const invoices = store.invoices;
  const existing = (source: string, number: string) => {
    const needle = String(number || '').trim().toLowerCase();
    if (!needle) return true;
    return invoices.some(inv => {
      if (inv.sourceType === source && String(inv.sourceNumber || '').trim().toLowerCase() === needle) return true;
      return String(inv.invoiceNo || '').toLowerCase().includes(needle);
    });
  };
  let created = 0;

  for (const sale of store.sales) {
    const ref = sale.orderNo ?? sale.orderNumber ?? sale.id;
    if (existing('SALES', ref)) continue;
    invoices.push(invoiceFromSale(sale));
    created += 1;
  }
  for (const rental of store.rentals) {
    const ref = rental.contractNo ?? rental.rentalNumber ?? rental.id;
    if (existing('RENTAL', ref)) continue;
    invoices.push(invoiceFromRental(rental));
    created += 1;
  }
  for (const wo of store.services) {
    if (wo.status !== 'COMPLETED') continue;
    const ref = wo.woNumber ?? wo.workOrderNumber ?? wo.id;
    if (existing('SERVICE', ref)) continue;
    invoices.push(invoiceFromService(wo));
    created += 1;
  }
  return created;
}

export function migrateStore(input: Record<string, any[]>): { store: Record<string, any[]>; report: MigrationReport } {
  const store: Record<string, any[]> = {};
  for (const [name, rows] of Object.entries(input)) store[name] = Array.isArray(rows) ? [...rows] : [];

  // 1. buang data contoh yang tak tersentuh
  const removedSamples: Record<string, number> = {};
  for (const name of Object.keys(store)) {
    const samples = sampleFingerprints(name);
    if (samples.size === 0) continue;
    const before = store[name].length;
    store[name] = store[name].filter(r => !samples.has(fingerprint(r)));
    const removed = before - store[name].length;
    if (removed > 0) removedSamples[name] = removed;
  }

  // 2. impor data asli dari kunci warisan
  const imported: Record<string, number> = {};
  let legacyRowsSeen = 0;
  for (const source of LEGACY_SOURCES) {
    const rows = readLegacyRows(source.key);
    legacyRowsSeen += rows.length;
    if (rows.length === 0) continue;
    const target = store[source.collection] || (store[source.collection] = []);
    const taken = new Set(target.map(r => naturalValue(r, source.naturalKeys)).filter(Boolean));
    for (const row of rows) {
      const key = naturalValue(row, source.naturalKeys);
      if (key && taken.has(key)) continue;
      if (key) taken.add(key);
      target.push({ ...row, id: ensureFreeId(target, String(row.id ?? `${source.key}-${target.length + 1}`)) });
      imported[source.collection] = (imported[source.collection] || 0) + 1;
    }
  }

  // 3. tagihan yang belum pernah dibuat
  for (const name of ['invoices', 'sales', 'rentals', 'services']) {
    if (!store[name]) store[name] = [];
  }
  const backfilledInvoices = backfillInvoices(store);

  const report: MigrationReport = {
    at: new Date().toISOString(),
    removedSamples,
    imported,
    backfilledInvoices,
    legacyRowsSeen,
  };
  return { store, report };
}

export function readMigrationMarker(): MigrationReport | null {
  try {
    const raw = localStorage.getItem(MIGRATION_MARKER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.at === 'string' ? (parsed as MigrationReport) : null;
  } catch {
    return null;
  }
}

export function writeMigrationMarker(report: MigrationReport): void {
  try {
    localStorage.setItem(MIGRATION_MARKER_KEY, JSON.stringify(report));
  } catch {
    // Marker gagal ditulis tidak boleh menghentikan aplikasi; migrasi hanya
    // akan dijalankan ulang dan langkah-langkahnya aditif/dedup.
  }
}

/** Migrasi yang benar-benar mengubah sesuatu layak dilaporkan ke pengguna. */
export function hasMigrationWork(report: MigrationReport | null): boolean {
  if (!report) return false;
  return report.backfilledInvoices > 0
    || sumCounts(report.imported) > 0
    || sumCounts(report.removedSamples) > 0;
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts || {}).reduce((a, n) => a + (Number(n) || 0), 0);
}
