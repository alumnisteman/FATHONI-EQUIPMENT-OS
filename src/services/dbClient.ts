// src/services/dbClient.ts
// Satu-satunya tempat renderer berbicara dengan database SQLite.
//
// Main process yang membuka file dan menegakkan daftar putih nama collection;
// renderer hanya mengirim permintaan dan menerima hasil. Karena itu bentuk
// balasannya selalu diperiksa, bukan dipercaya buta.
//
// Mode browser (vite dev tanpa Electron) tidak punya database: dbAvailable()
// false dan halaman tetap jalan lewat localStorage seperti sebelumnya.

export interface DbInfo {
  file: string;
  collections: string[];
  schemaVersion: number;
  importedFromLocalStorage: boolean;
  /**
   * Jumlah baris per collection dari COUNT(*). Boot memakainya untuk memutuskan
   * apakah profil masih perlu diimpor tanpa memindahkan satu baris pun lewat IPC.
   */
  perCollection?: { name: string; rows: number }[];
  totalRows?: number;
}

export interface DbQueryRequest {
  collection: string;
  search?: string;
  where?: Record<string, unknown>;
  sort?: string;
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export interface DbQueryResult<T = any> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Permintaan agregat kelompok (pendapatan per bulan, unit per status, dan
 * sejenisnya). Hanya baris satu HALAMAN yang keluar dari queryCollection —
 * tanpa limit eksplisit batasnya DEFAULT_PAGE_LIMIT (100), jadi daftar yang
 * dipakai untuk perhitungan harus menyebut limit-nya sendiri.
 */
export interface DbGroupRequest {
  collection: string;
  by: string[];
  sum?: string;
  where?: Record<string, unknown>;
  search?: string;
  limit?: number;
}

export interface DbGroupRow {
  key: string;
  keys: string[];
  count: number;
  sum: number;
}

export interface DbStats {
  file: string;
  sizeBytes: number;
  journalMode: string;
  schemaVersion: number;
  totalRows: number;
  perCollection: { name: string; rows: number; payloadBytes: number }[];
  /** Jalur tulis sejak database dibuka: patch = per baris, full = collection penuh. */
  writes: { patchCalls: number; patchUpsertRows: number; patchRemoveIds: number; fullCalls: number; fullRows: number };
  /** Jalur baca: fullCalls naik hanya bila ada yang meminta SELURUH isi file sekali lagi. */
  reads: { fullCalls: number; subsetCalls: number; subsetCollections: number; rows: number };
}

export interface DbIntegrity {
  ok: boolean;
  quickCheck: string[];
  duplicates: { collection: string; column: string; value: string; count: number }[];
}

type SaveCounts = Record<string, { inserted: number; updated: number; deleted: number }>;

/** Patch per baris: hanya record yang berubah yang melintasi IPC. */
export interface RowPatch {
  upsert?: any[];
  removeIds?: string[];
}

export interface RowPatchResult {
  inserted: number;
  updated: number;
  deleted: number;
  skipped: number;
}

/**
 * Hasil pemeriksaan "record ini masih disebut dokumen lain". Bentuknya disalin dari
 * electron/referential.ts (bukan diimpor) karena renderer tidak boleh mengimpor kode
 * main process — sama seperti normalizeSearch di dbSchema.ts.
 */
export interface ReferenceHit {
  collection: string;
  label: string;
  jumlah: number;
  contoh: string[];
}

export interface ReferenceReport {
  blocked: boolean;
  hits: ReferenceHit[];
  error?: string;
}

interface DesktopDbApi {
  dbInfo(): Promise<Partial<DbInfo> & { error?: string }>;
  dbLoad(names?: string[]): Promise<Record<string, any> & { error?: string }>;
  dbSave(partial: Record<string, any[]>): Promise<SaveCounts & { error?: string }>;
  dbPatch(patches: Record<string, RowPatch>): Promise<Record<string, RowPatchResult> & { error?: string }>;
  dbQuery(req: DbQueryRequest): Promise<Partial<DbQueryResult> & { error?: string }>;
  dbSum(collection: string, column: string, where?: Record<string, unknown>): Promise<number | { error?: string }>;
  dbGroup(req: DbGroupRequest): Promise<{ groups?: DbGroupRow[] } & { error?: string }>;
  dbStats(): Promise<Partial<DbStats> & { error?: string }>;
  dbIntegrity(): Promise<Partial<DbIntegrity> & { error?: string }>;
  dbReferences(collection: string, id: string): Promise<Partial<ReferenceReport> & { error?: string }>;
  dbMarkImported(): Promise<{ at?: string; error?: string }>;
}

function api(): DesktopDbApi | null {
  const raw = (window as any).electronAPI;
  return raw && typeof raw.dbLoad === 'function' ? (raw as DesktopDbApi) : null;
}

/** True bila aplikasi berjalan di Electron dengan database tersedia. */
export function dbAvailable(): boolean {
  return api() !== null;
}

function fail(resp: any): string | null {
  if (!resp) return 'Tidak ada balasan dari main process';
  if (typeof resp === 'object' && resp.error) return String(resp.error);
  return null;
}

export async function dbInfo(): Promise<DbInfo | null> {
  const a = api();
  if (!a) return null;
  const resp = await a.dbInfo();
  return fail(resp) ? null : (resp as DbInfo);
}

/**
 * Muat isi database. Tanpa argument seluruh collection ikut dibaca (jalur impor
 * dan layar Backup); dengan daftar, hanya collection itu yang lewat. Pemanggil
 * yang menunda hidrasi selalu menyebut daftarnya — hasil yang diminta tidak boleh
 * diam-diam menjadi "semua".
 */
export async function dbLoadStore(names?: string[]): Promise<Record<string, any[]> | null> {
  const a = api();
  if (!a) return null;
  const resp = await a.dbLoad(names);
  if (fail(resp)) return null;
  const out: Record<string, any[]> = {};
  for (const [name, rows] of Object.entries(resp || {})) out[name] = Array.isArray(rows) ? rows : [];
  return out;
}

/** Simpan hanya collection yang berubah. Mengembalikan null bila gagal. */
export async function dbSaveStore(partial: Record<string, any[]>): Promise<SaveCounts | null> {
  const a = api();
  if (!a) return null;
  const resp = await a.dbSave(partial);
  return fail(resp) ? null : (resp as SaveCounts);
}

/**
 * Tulis hanya baris yang berubah. Mengembalikan null bila main process menolak
 * patch itu — pemanggil harus mengulang lewat dbSaveStore penuh, bukan
 * membiarkan perubahan hilang.
 */
export async function dbPatchStore(patches: Record<string, RowPatch>): Promise<Record<string, RowPatchResult> | null> {
  const raw = (window as any).electronAPI;
  if (!raw || typeof raw.dbPatch !== 'function' || !api()) return null;
  const resp = await (raw as DesktopDbApi).dbPatch(patches);
  return fail(resp) ? null : (resp as Record<string, RowPatchResult>);
}

export async function dbQuery<T = any>(req: DbQueryRequest): Promise<DbQueryResult<T> | null> {
  const a = api();
  if (!a) return null;
  const resp = await a.dbQuery(req);
  if (fail(resp)) return null;
  return {
    rows: Array.isArray(resp?.rows) ? resp!.rows : [],
    total: Number(resp?.total) || 0,
    limit: Number(resp?.limit) || 0,
    offset: Number(resp?.offset) || 0,
  };
}

export async function dbSum(collection: string, column: string, where?: Record<string, unknown>): Promise<number | null> {
  const a = api();
  if (!a) return null;
  const resp = await a.dbSum(collection, column, where);
  // jumlah 0 yang sah tidak boleh dianggap kegagalan hanya karena falsy
  return typeof resp === 'number' && Number.isFinite(resp) ? resp : null;
}

/**
 * Agregat kelompok. Mengembalikan null bila main process menolak permintaannya
 * (collection asing, error membaca) supaya pemanggil bisa jatuh ke jalur lokal;
 * daftar kosong yang sah tetap daftar kosong, bukan null.
 */
export async function dbGroup(req: DbGroupRequest): Promise<DbGroupRow[] | null> {
  const a = api();
  if (!a) return null;
  const resp = await a.dbGroup(req);
  if (fail(resp)) return null;
  const groups = resp?.groups;
  if (!Array.isArray(groups)) return null;
  return groups.map(g => ({
    key: String(g?.key ?? ''),
    keys: Array.isArray(g?.keys) ? g.keys.map(String) : [],
    count: Number(g?.count) || 0,
    sum: Number(g?.sum) || 0,
  }));
}

export async function dbStats(): Promise<DbStats | null> {
  const a = api();
  if (!a) return null;
  const resp = await a.dbStats();
  return fail(resp) ? null : (resp as DbStats);
}

export async function dbIntegrity(): Promise<DbIntegrity | null> {
  const a = api();
  if (!a) return null;
  const resp = await a.dbIntegrity();
  return fail(resp) ? null : (resp as DbIntegrity);
}

/**
 * Periksa apakah satu record masih disebut dokumen lain sebelum menghapusnya.
 * null = tidak ada database (mode browser, semuanya sudah di memori) dan pemanggil
 * boleh lanjut; objek = hasil pemeriksaan, termasuk bentuk error yang berarti
 * TIDAK ADA JAWABAN. Yang terakhir sengaja dianggap menghalangi: menghapus tanpa
 * tahu apa yang akan yatim tidak bisa dibatalkan, sedangkan menolak hapus bisa
 * diulang pengguna.
 */
export async function dbReferences(collection: string, id: string): Promise<ReferenceReport | null> {
  const a = api();
  if (!a || typeof a.dbReferences !== 'function') return null;
  const resp = await a.dbReferences(collection, id);
  const pesan = fail(resp);
  if (pesan) return { blocked: true, hits: [], error: pesan };
  return {
    blocked: resp!.blocked === true,
    hits: Array.isArray(resp!.hits) ? (resp!.hits as ReferenceHit[]) : [],
  };
}

/** Tandai bahwa isi localStorage lama sudah dipindahkan; dipanggil sekali. */
export async function dbMarkImported(): Promise<boolean> {
  const a = api();
  if (!a) return false;
  return !fail(await a.dbMarkImported());
}

// ── Snapshot berkas ─────────────────────────────────────────────────────────
// Cadangan desktop berupa berkas SQLite, bukan JSON di localStorage: sejak
// Fase 4 isi hems_data_store_v1 di localStorage hanyalah arsip pra-migrasi,
// jadi menyalinnya menghasilkan cadangan basi.

export interface SnapshotMeta {
  name: string;
  reason: string;
  createdAt: string;
  bytes: number;
  checksum: string;
  totalRows: number;
  schemaVersion: number;
  settingsKeys: string[];
}

export type SnapshotResult = { ok: true; snapshot: SnapshotMeta } | { ok: false; error: string };
export type SnapshotRestoreResult =
  | { ok: true; snapshot: SnapshotMeta; settings: Record<string, string>; quickCheck: string[] }
  | { ok: false; error: string; rolledBack: boolean };

interface SnapshotApi {
  dbSnapshotCreate(input: { reason: string; settings: Record<string, string> }): Promise<any>;
  dbSnapshotList(): Promise<any>;
  dbSnapshotRestore(name: string, settings: Record<string, string>): Promise<any>;
  dbSnapshotClear(): Promise<any>;
}

function snapshotApi(): SnapshotApi | null {
  const raw = (window as any).electronAPI;
  return raw && typeof raw.dbSnapshotCreate === 'function' ? (raw as SnapshotApi) : null;
}

/** True bila cadangan berupa berkas SQLite tersedia. */
export function snapshotAvailable(): boolean {
  return snapshotApi() !== null;
}

function toSnapshotResult(resp: any): SnapshotResult {
  if (resp && resp.ok === true && resp.snapshot) return { ok: true, snapshot: resp.snapshot };
  return { ok: false, error: String(resp?.error || 'Tidak ada balasan dari main process') };
}

export async function dbSnapshotCreate(
  reason: 'auto' | 'manual' | 'pra-restore',
  settings: Record<string, string>
): Promise<SnapshotResult> {
  const a = snapshotApi();
  if (!a) return { ok: false, error: 'Cadangan berkas hanya tersedia di aplikasi desktop' };
  try {
    return toSnapshotResult(await a.dbSnapshotCreate({ reason, settings }));
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export async function dbSnapshotList(): Promise<SnapshotMeta[]> {
  const a = snapshotApi();
  if (!a) return [];
  try {
    const resp = await a.dbSnapshotList();
    return Array.isArray(resp?.snapshots) ? resp.snapshots : [];
  } catch {
    return [];
  }
}

export async function dbSnapshotRestore(
  name: string,
  settings: Record<string, string>
): Promise<SnapshotRestoreResult> {
  const a = snapshotApi();
  if (!a) return { ok: false, error: 'Cadangan berkas hanya tersedia di aplikasi desktop', rolledBack: false };
  try {
    const resp = await a.dbSnapshotRestore(name, settings);
    if (resp && resp.ok === true) {
      return {
        ok: true,
        snapshot: resp.snapshot,
        settings: resp.settings && typeof resp.settings === 'object' ? resp.settings : {},
        quickCheck: Array.isArray(resp.quickCheck) ? resp.quickCheck : [],
      };
    }
    return {
      ok: false,
      error: String(resp?.error || 'Tidak ada balasan dari main process'),
      rolledBack: resp?.rolledBack === true,
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err), rolledBack: false };
  }
}

export async function dbSnapshotClear(): Promise<number> {
  const a = snapshotApi();
  if (!a) return 0;
  try {
    const resp = await a.dbSnapshotClear();
    return Number(resp?.removed) || 0;
  } catch {
    return 0;
  }
}

// Satu listener untuk seluruh umur halaman: efek React bisa terpasang ulang
// (StrictMode), dan listener ganda akan mengirim konfirmasi berkali-kali.
let flushListenerInstalled = false;
let currentFlushHandler: (() => void | Promise<void>) | null = null;

/** Main process minta simpanan tuntas sebelum jendela ditutup. */
export function dbOnFlushRequest(cb: () => Promise<void> | void): void {
  currentFlushHandler = cb;
  if (flushListenerInstalled) return;
  const raw = (window as any).electronAPI;
  if (!raw || typeof raw.onFlushRequest !== 'function') return;
  flushListenerInstalled = true;
  raw.onFlushRequest(() => {
    // Konfirmasi selalu dikirim, walau simpanan gagal — kalau tidak, main
    // process menahan penutupan jendela sampai timeout dan aplikasi terasa macet.
    try {
      Promise.resolve(currentFlushHandler?.()).then(
        () => dbFlushDone(),
        () => dbFlushDone()
      );
    } catch {
      dbFlushDone();
    }
  });
}

/** Konfirmasi bahwa simpanan sudah di dalam file; main process boleh keluar. */
export function dbFlushDone(): void {
  const raw = (window as any).electronAPI;
  if (raw && typeof raw.flushDone === 'function') raw.flushDone();
}
