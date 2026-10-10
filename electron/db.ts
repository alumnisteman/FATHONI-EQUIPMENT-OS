// electron/db.ts
// Lapisan SQLite untuk FATHONI EQUIPMENT OS. Semua akses data lewat sini, dari
// main process; renderer tetap sandboxed dan hanya bicara lewat IPC.
//
// Kenapa di main process: renderer bisa dimuat ulang (dan setiap reload membuat
// koneksi baru ke file yang sama), sedangkan satu koneksi tunggal di main mudah
// dijaga tetap konsisten lewat WAL + transaksi.

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import {
  COLLECTION_SPECS, SPEC_BY_NAME, isCollectionName, searchBlob,
  storageKeys, tokenizeSearch, toColumnValue, type CollectionSpec, type ColumnSpec,
} from './dbSchema';
import { findReferences, type ReferenceReport } from './referential';

const SCHEMA_VERSION = 1;
// Naikkan setiap kali dbSchema mengubah cara kolom turunan/blob pencarian
// dihasilkan dari record. Isi tabel tidak berubah oleh revisi ini — yang berubah
// hanya turunannya, dan itu baru dihitung ulang saat boot oleh refreshDerivedColumns.
// Diekspor supaya harness bisa membandingkan revisi di file dengan revisi kode ini
// tanpa menyalin angka yang selalu berganti.
export const DERIVED_REVISION = 5;
export const DB_FILE_NAME = 'fathoni.db';
const SAFE_NAME = /^[a-z][a-z0-9_]*$/i;

export const MAX_PAGE_LIMIT = 500;
const DEFAULT_PAGE_LIMIT = 100;

let db: Database.Database | null = null;
let dbFilePath = '';

function tableOf(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`Nama tabel tidak diizinkan: ${name}`);
  return `"${name}"`;
}

function hashOf(payload: string): string {
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function createTableSql(spec: CollectionSpec): string {
  const cols = spec.columns.map(c => `"${c.col}" ${c.type}`).join(',\n  ');
  return `CREATE TABLE IF NOT EXISTS ${tableOf(spec.name)} (
  "pk" TEXT PRIMARY KEY,
  "id" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "search" TEXT NOT NULL DEFAULT '',
  ${cols}
)`;
}

function indexSql(spec: CollectionSpec): string[] {
  const out = spec.columns
    .filter(c => c.type !== 'REAL')
    .map(c => `CREATE INDEX IF NOT EXISTS "ix_${spec.name}_${c.col}" ON ${tableOf(spec.name)} ("${c.col}")`);
  // INDEKS biasa, bukan UNIQUE: sumber data lama bisa berisi id ganda, dan
  // constraint yang menolak satu baris akan membatalkan seluruh autosave
  // sehingga perubahan lain ikut hilang. Duplikat dilaporkan lewat integrity().
  out.push(`CREATE INDEX IF NOT EXISTS "ix_${spec.name}_id" ON ${tableOf(spec.name)} ("id")`);
  return out;
}

/**
 * Tambah kolom turunan yang belum ada di tabel profil lama.
 * CREATE TABLE IF NOT EXISTS tidak pernah memperbaiki tabel yang sudah berdiri,
 * jadi tanpa langkah ini setiap INSERT gagal begitu dbSchema menambah kolom
 * (mis. kategori dan lokasi rak suku cadang).
 */
function ensureColumns(handle: Database.Database): string[] {
  const added: string[] = [];
  for (const spec of COLLECTION_SPECS) {
    const table = tableOf(spec.name);
    const have = new Set(
      (handle.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(r => String(r.name))
    );
    for (const col of spec.columns) {
      if (have.has(col.col)) continue;
      handle.exec(`ALTER TABLE ${table} ADD COLUMN "${col.col}" ${col.type}`);
      added.push(`${spec.name}.${col.col}`);
    }
    // Indeks kolom baru dibuat setelah kolomnya ada.
    for (const stmt of indexSql(spec)) handle.exec(stmt);
  }
  return added;
}

/**
 * Buka (dan buat bila belum ada) database profil. Fungsi ini idempoten: aplikasi
 * boleh memanggilnya lagi setelah restore menggantikan berkas.
 */
export function openDatabase(userDataDir: string): { file: string; createdNow: boolean } {
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = path.join(userDataDir, DB_FILE_NAME);
  const createdNow = !fs.existsSync(file);
  if (db) { try { db.close(); } catch { /* koneksi lama dibiarkan tertutup paksa */ } }
  // Statement lama terikat koneksi yang barusan ditutup.
  stmtCache.clear();
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 4000');

  db.exec('CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const tx = db.transaction(() => {
    for (const spec of COLLECTION_SPECS) db!.exec(createTableSql(spec));
  });
  tx();
  // Indeks dibuat SETELAH kolom turunan lengkap: pada profil lama tabelnya sudah
  // ada tapi bisa kehilangan kolom, dan CREATE INDEX di atas kolom yang belum ada
  // membuat seluruh pembukaan database gagal.
  const baru = ensureColumns(db);

  const current = getMetaNumber('schema_version');
  if (current !== SCHEMA_VERSION) setMeta('schema_version', String(SCHEMA_VERSION));
  const derived = getMetaNumber('derived_revision');
  if (derived !== DERIVED_REVISION || baru.length > 0) {
    // Kolom turunan dari data lama dihitung ulang sekali, supaya perubahan
    // dbSchema (mis. nama field yang sebenarnya) benar-benar terlihat di query.
    // Kolom hasil ALTER juga masih kosong dan perlu diisi.
    refreshDerivedColumns();
    setMeta('derived_revision', String(DERIVED_REVISION));
  }
  dbFilePath = file;
  return { file, createdNow };
}

function need(): Database.Database {
  if (!db) throw new Error('Database belum dibuka');
  return db;
}

export function databaseFile(): string {
  return dbFilePath;
}

/** Daftar putih nama collection — dipakai IPC dan renderer. */
export function collectionNames(): string[] {
  return COLLECTION_SPECS.map(s => s.name);
}

// ── Meta ────────────────────────────────────────────────────────────────────
export function getMeta(key: string): string | null {
  const row = need().prepare('SELECT value FROM db_meta WHERE key = ?').get(key) as any;
  return row ? row.value : null;
}

export function getMetaNumber(key: string): number {
  const raw = getMeta(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function setMeta(key: string, value: string): void {
  need().prepare('INSERT INTO db_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// ── Baca ────────────────────────────────────────────────────────────────────
function payloadRows<T = any>(rows: { payload: string }[]): T[] {
  const out: T[] = [];
  for (const r of rows) {
    try { out.push(JSON.parse(r.payload)); } catch { /* baris rusak dilewati, lihat integrity() */ }
  }
  return out;
}

/** Muat seluruh isi satu collection (dipakai saat boot, sampai halaman besar pindah ke query). */
export function loadCollection(name: unknown): any[] {
  if (!isCollectionName(name)) return [];
  const spec = SPEC_BY_NAME[name];
  const rows = need().prepare(
    `SELECT payload FROM ${tableOf(spec.name)} ORDER BY "${spec.sort}" ASC, "pk" ASC`
  ).all() as { payload: string }[];
  return payloadRows(rows);
}

export interface QueryRequest {
  collection: string;
  search?: string;
  /** Penyaringan pada kolom turunan yang ada di spesifikasi; lihat filterClauses. */
  where?: Record<string, unknown>;
  sort?: string;
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export interface QueryResult {
  rows: any[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Nilai penyaringan dari renderer dilewatkan apa adanya ke SQLite, jadi bentuknya
 * harus dipastikan sebelum di-ikat:
 *   - kolom TEXT menampung string, jadi angka dan boolean ikut dikonversi
 *     seperti cara penulis mengisinya (isActive: true -> 'true');
 *   - kolom angka memakai Number, nilai tak terhingga menjadi NULL seperti
 *     toColumnValue saat menulis;
 *   - objek, daftar, fungsi, symbol dan bigint DILEWATI, tidak diikat —
 *     better-sqlite3 menolak semuanya, dan satu entri rusak tidak boleh
 *     menggagalkan seluruh halaman.
 */
function bindableWhere(col: ColumnSpec, value: unknown): unknown | undefined {
  if (value === null) return col.type === 'TEXT' ? '' : null;
  const t = typeof value;
  if (t === 'string') return value;
  if (t === 'boolean') return col.type === 'TEXT' ? String(value) : (value ? 1 : 0);
  if (t !== 'number') return undefined;
  if (col.type === 'TEXT') return String(value);
  return Number.isFinite(value) ? value : null;
}

/**
 * Operator penyaringan yang boleh dipakai renderer. Peta dibuat sebagai Map, bukan
 * objek biasa, supaya nama kunci seperti 'constructor' tidak pernah berbalik
 * menjadi klausa SQL.
 */
const OPERATOR_SQL = new Map<string, string>([
  ['eq', '='], ['ne', '<>'], ['gt', '>'], ['gte', '>='], ['lt', '<'], ['lte', '<='],
]);

/** Bentuk benda penyaringan yang dikenali; selain itu DILEWATI. */
const FILTER_KEYS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'between'];

/**
 * Satu entri penyaringan menjadi satu atau lebih klausa.
 *
 * Bentuk yang didukung:
 *   { status: 'LUNAS' }                        -> kesamaan, seperti sebelumnya
 *   { serviceDueIn: [1, 2, 3] }                -> IN
 *   { serviceDueIn: { in: [...] } }            -> IN
 *   { status: { nin: ['COMPLETED','CANCELLED'] } } -> BUKAN salah satu (「aktif」)
 *   { serviceDueIn: { gte: 1, lte: 50 } }      -> dua batas sekaligus (AND)
 *   { stockShortfall: { op: 'lte', value: 0 } } -> bentuk panjang
 * Nama kolom sudah divalidasi ke spec sebelum mari, dan SETIAP nilai di-ikat
 * sebagai parameter, jadi tidak ada teks dari renderer yang pernah menjadi SQL.
 *
 * Kunci yang tidak dikenal, operator asing, dan nilai non-bindable (objek,
 * fungsi, symbol, bigint) dilewati tanpa mengubah klausa lain — sama seperti
 * aturan bindableWhere: satu entri rusak tidak boleh menggagalkan seluruh halaman.
 * Yang TIDAK boleh dilewati diam-diam adalah bentuk pemfilteran itu sendiri:
 * `{lte: 50}` dengan kunci salah cetak akan mengembalikan SEMUA baris, jadi
 * bentuk benda hanya ditafsirkan sebagai penyaring bila kuncinya ada di FILTER_KEYS.
 */
function filterClauses(col: ColumnSpec, name: string, value: unknown): { sql: string[]; params: unknown[] } {
  const out: { sql: string[]; params: unknown[] } = { sql: [], params: [] };
  const column = `"${name}"`;

  const addOperator = (op: unknown, raw: unknown): void => {
    const sqlOp = typeof op === 'string' ? OPERATOR_SQL.get(op) : undefined;
    if (!sqlOp) return;
    const bound = bindableWhere(col, raw);
    if (bound === undefined) return;
    out.sql.push(`${column} ${sqlOp} ?`);
    out.params.push(bound);
  };

  const addList = (kind: 'in' | 'nin' | 'between', raw: unknown): void => {
    if (!Array.isArray(raw)) return;
    const bound = raw.map(v => bindableWhere(col, v));
    if (kind === 'between') {
      if (bound.length !== 2 || bound.some(v => v === undefined)) return;
      out.sql.push(`${column} BETWEEN ? AND ?`);
      out.params.push(bound[0], bound[1]);
      return;
    }
    const values = bound.filter(v => v !== undefined);
    // IN () kosong bukan sintaks yang sah; lebih baik entri ini dilewati daripada
    // membuat seluruh query gagal. Untuk NOT IN, melewatkan entri berarti "tidak
    // menyaring apa pun" — bukan "semua baris keluar".
    if (values.length === 0) return;
    const sqlIn = values.map(() => '?').join(', ');
    out.sql.push(kind === 'nin' ? `${column} NOT IN (${sqlIn})` : `${column} IN (${sqlIn})`);
    out.params.push(...values);
  };

  if (Array.isArray(value)) {
    addList('in', value);
    return out;
  }

  if (value && typeof value === 'object') {
    const spec = value as Record<string, unknown>;
    let dikenali = false;
    if (typeof spec.op === 'string') {
      dikenali = true;
      addOperator(spec.op, spec.value);
    }
    for (const key of FILTER_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(spec, key)) continue;
      dikenali = true;
      if (key === 'in' || key === 'nin' || key === 'between') addList(key, spec[key]);
      else addOperator(key, spec[key]);
    }
    // Benda yang bukan penyaring (mis. kolom JSON yang dikirim utuh) tidak diikat.
    if (!dikenali) return out;
    return out;
  }

  const bound = bindableWhere(col, value);
  if (bound !== undefined) {
    out.sql.push(`${column} = ?`);
    out.params.push(bound);
  }
  return out;
}

/**
 * Kolom 'id' dikenal di semua tabel (NOT NULL, terindeks) tetapi sengaja BUKAN
 * bagian spec.columns: INSERT menyusun daftar kolom dari 'pk','id',... lalu
 * spec.columns, jadi menamainya di spec akan mendaftarkannya dua kali.
 * Penyaringan lewat id tetap dibutuhkan — Equipment Passport membuka unit dari
 * id di URL, dan pada profil kerja besar collection units tidak pernah dimuat
 * seluruhnya ke renderer, jadi pencarian di array store saja tidak cukup.
 */
const ID_COLUMN: ColumnSpec = { col: 'id', type: 'TEXT', get: r => r?.id };

/** Klausa WHERE untuk satu objek penyaringan; entri tak dikenal dilewati. */
function whereClauses(spec: CollectionSpec, where?: Record<string, unknown>): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (!where || typeof where !== 'object') return { sql, params };
  const byName = new Map(spec.columns.map(c => [c.col, c]));
  for (const [col, value] of Object.entries(where)) {
    const found = col === 'id' ? ID_COLUMN : byName.get(col);
    if (!found || value === undefined) continue;
    const one = filterClauses(found, col, value);
    sql.push(...one.sql);
    params.push(...one.params);
  }
  return { sql, params };
}

/**
 * Query berpaginasi. Hanya baris satu halaman yang keluar dari SQLite, jadi
 * halaman dengan jutaan record tetap ringan untuk renderer.
 */
export function queryCollection(req: QueryRequest): QueryResult {
  if (!isCollectionName(req.collection)) throw new Error('Collection tidak dikenal');
  const spec = SPEC_BY_NAME[req.collection];

  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const token of tokenizeSearch(req.search || '')) {
    clauses.push('"search" LIKE ?');
    params.push(`%${token}%`);
  }
  const saring = whereClauses(spec, req.where);
  clauses.push(...saring.sql);
  params.push(...saring.params);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const allowed = new Set(spec.columns.map(c => c.col));

  const sortCol = req.sort && allowed.has(req.sort) ? req.sort : spec.sort;
  const dir = req.desc ? 'DESC' : 'ASC';
  const limit = Math.min(Math.max(Number(req.limit) || DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(Number(req.offset) || 0, 0);

  const handle = need();
  const total = (handle.prepare(`SELECT COUNT(*) AS c FROM ${tableOf(spec.name)} ${where}`).get(...params) as any).c as number;
  const rows = handle.prepare(
    `SELECT payload FROM ${tableOf(spec.name)} ${where} ORDER BY "${sortCol}" ${dir}, "pk" ${dir} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as { payload: string }[];

  return { rows: payloadRows(rows), total, limit, offset };
}

/** Jumlah agregat yang sering dibutuhkan laporan tanpa memuat baris ke renderer. */
export function sumCollection(collection: unknown, column: unknown, where?: Record<string, unknown>): number {
  if (!isCollectionName(collection)) return 0;
  const spec = SPEC_BY_NAME[collection];
  const col = String(column);
  if (!spec.columns.some(c => c.col === col && c.type !== 'TEXT')) return 0;
  const clauses: string[] = [];
  const params: unknown[] = [];
  const saring = whereClauses(spec, where);
  clauses.push(...saring.sql);
  params.push(...saring.params);
  const sql = `SELECT COALESCE(SUM("${col}"), 0) AS s FROM ${tableOf(spec.name)}${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''}`;
  return Number((need().prepare(sql).get(...params) as any).s) || 0;
}

/**
 * Agregat kelompok — bentuk yang dibutuhkan Dasbor dan Laporan (pendapatan per
 * bulan, unit per status, biaya per kategori) tanpa memuat barisnya ke renderer.
 * Hanya kelompok yang keluar dari SQLite, jadi kartunya tetap ringan walau
 * collection-nya ratusan ribu baris.
 */
export interface GroupRequest {
  collection: string;
  /** 1..3 kolom turunan tempat mengelompokkan; kolom asing dilewati. */
  by?: string[];
  /** Kolom angka yang dijumlahkan; kolom TEXT tidak boleh dijumlahkan. */
  sum?: string;
  where?: Record<string, unknown>;
  search?: string;
  limit?: number;
}

export interface GroupRow {
  /** Kunci gabungan dari nilai kelompok, dipisah spasi tunggal. */
  key: string;
  keys: string[];
  count: number;
  sum: number;
}

function groupKey(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function groupCollection(req: GroupRequest): { groups: GroupRow[] } {
  if (!isCollectionName(req.collection)) return { groups: [] };
  const spec = SPEC_BY_NAME[req.collection];
  const byName = new Map(spec.columns.map(c => [c.col, c]));

  // Kolom kelompok divalidasi satu per satu dan diambil maksimum 3, supaya nama
  // kolom dari renderer tidak pernah masuk ke SQL sebagai teks mentah.
  const by: string[] = [];
  for (const raw of Array.isArray(req.by) ? req.by : []) {
    const col = typeof raw === 'string' ? raw : '';
    if (!col || !byName.has(col) || by.includes(col)) continue;
    by.push(col);
    if (by.length === 3) break;
  }
  if (by.length === 0) return { groups: [] };

  let sumCol = '';
  if (typeof req.sum === 'string' && byName.has(req.sum)) {
    const found = byName.get(req.sum)!;
    if (found.type !== 'TEXT') sumCol = found.col;
  }

  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const token of tokenizeSearch(req.search || '')) {
    clauses.push('"search" LIKE ?');
    params.push(`%${token}%`);
  }
  const saring = whereClauses(spec, req.where);
  clauses.push(...saring.sql);
  params.push(...saring.params);
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const cols = by.map(c => `"${c}"`);
  const limit = Math.min(Math.max(Number(req.limit) || MAX_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  const rows = need().prepare(
    `SELECT ${cols.join(', ')}, COUNT(*) AS c${sumCol ? `, COALESCE(SUM("${sumCol}"), 0) AS s` : ''}
     FROM ${tableOf(spec.name)}${where}
     GROUP BY ${cols.join(', ')}
     ORDER BY ${by.map(c => `"${c}" ASC`).join(', ')}
     LIMIT ?`
  ).all(...params, limit) as any[];

  return {
    groups: rows.map(r => {
      const keys = by.map(c => groupKey(r[c]));
      return { key: keys.join(' '), keys, count: Number(r.c) || 0, sum: sumCol ? Number(r.s) || 0 : 0 };
    }),
  };
}

// ── Tulis ───────────────────────────────────────────────────────────────────
function prepareRow(spec: CollectionSpec, row: any, pk: string, id: string) {
  const payload = JSON.stringify(row === undefined || row === null ? {} : row);
  return {
    pk,
    id,
    payload,
    hash: hashOf(payload),
    search: searchBlob(row, spec.search),
    values: spec.columns.map(c => toColumnValue(spec, c, row)),
  };
}

// Statement ditulis ulang tiap collection dan disimpan: menyiapkan statement
// berulang kali pada autosave yang sama hanya memakan waktu.
interface WriteStmts {
  insert: Database.Statement;
  update: Database.Statement;
  remove: Database.Statement;
  byPk: Database.Statement;
}
const stmtCache = new Map<string, WriteStmts>();

function writeStatements(spec: CollectionSpec): WriteStmts {
  const cached = stmtCache.get(spec.name);
  if (cached) return cached;
  const handle = need();
  const table = tableOf(spec.name);
  const columns = ['pk', 'id', 'payload', 'hash', 'search', ...spec.columns.map(c => c.col)]
    .map(c => `"${c}"`).join(', ');
  const placeholders = new Array(5 + spec.columns.length).fill('?').join(', ');
  const updates = ['payload', 'hash', 'search', ...spec.columns.map(c => c.col)].map(c => `"${c}" = ?`).join(', ');
  const built: WriteStmts = {
    insert: handle.prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`),
    update: handle.prepare(`UPDATE ${table} SET ${updates} WHERE "pk" = ?`),
    remove: handle.prepare(`DELETE FROM ${table} WHERE "pk" = ?`),
    byPk: handle.prepare(`SELECT hash FROM ${table} WHERE "pk" = ?`),
  };
  stmtCache.set(spec.name, built);
  return built;
}

export interface RowPatch {
  upsert?: unknown[];
  removeIds?: unknown[];
}

/**
 * Catatan jalur tulis sejak database dibuka. Dipakai harness dan layar
 * Pemeliharaan Sistem untuk membuktikan bahwa satu perubahan di halaman
 * berpaginasi hanya mengirim satu baris: `fullRows` yang tumbuh tiap klik
 * berarti sebuah halaman kembali menggabungkan collection penuh — bentuk yang
 * justru menghapus baris yang tidak pernah dimuatnya.
 */
/**
 * Catatan jalur BACA sejak database dibuka. `fullCalls` yang naik berarti ada
 * permintaan seluruh isi file sekaligus — jalur yang sejak Fase 4 hanya dipakai
 * layar Backup/ekspor, bukan boot aplikasi. Bentuk assertion-nya ada di
 * perf-check: boot harus menaikkan subsetCalls saja, bukan fullCalls.
 */
export interface ReadTrace {
  fullCalls: number;
  subsetCalls: number;
  subsetCollections: number;
  rows: number;
}

const EMPTY_READ: ReadTrace = { fullCalls: 0, subsetCalls: 0, subsetCollections: 0, rows: 0 };
let readTrace: ReadTrace = { ...EMPTY_READ };

export function getReadTrace(): ReadTrace {
  return { ...readTrace };
}

export interface WriteTrace {
  patchCalls: number;
  patchUpsertRows: number;
  patchRemoveIds: number;
  fullCalls: number;
  fullRows: number;
}

const EMPTY_TRACE: WriteTrace = { patchCalls: 0, patchUpsertRows: 0, patchRemoveIds: 0, fullCalls: 0, fullRows: 0 };
let writeTrace: WriteTrace = { ...EMPTY_TRACE };

export function getWriteTrace(): WriteTrace {
  return { ...writeTrace };
}

export interface RowPatchResult {
  inserted: number;
  updated: number;
  deleted: number;
  skipped: number;
}

/**
 * Tulis HANYA baris yang disebut. Ini jalur yang dipakai autosave setelah
 * renderer membandingkan identitas objeknya sendiri, jadi satu edit tidak lagi
 * menyalin seluruh collection ke main process.
 *
 * Baris ditarget lewat kunci penyimpanan pertamanya (pk = id). Collection yang
 * berisi id rangkap punya baris dengan pk "id#2"; jalur itu tetap lewat
 * saveCollection penuh, sehingga pemanggil renderer wajib mengirim patch hanya
 * bila tidak ada id rangkap (dijaga oleh diffRows di dataStore).
 */
export function saveRows(collection: unknown, patch: RowPatch): RowPatchResult {
  if (!isCollectionName(collection)) throw new Error('Collection tidak dikenal untuk disimpan');
  const spec = SPEC_BY_NAME[collection];
  const handle = need();
  const stmts = writeStatements(spec);
  const out: RowPatchResult = { inserted: 0, updated: 0, deleted: 0, skipped: 0 };

  const upsert = Array.isArray(patch && patch.upsert) ? patch.upsert : [];
  const removeIds = Array.isArray(patch && patch.removeIds) ? patch.removeIds : [];
  writeTrace.patchCalls++;
  writeTrace.patchUpsertRows += upsert.length;
  writeTrace.patchRemoveIds += removeIds.length;

  const tx = handle.transaction(() => {
    for (const raw of upsert) {
      const row = raw as any;
      const id = row && row.id !== undefined && row.id !== null ? String(row.id) : '';
      if (!id) { out.skipped++; continue; }
      const prepared = prepareRow(spec, row, id, id);
      const before = stmts.byPk.get(id) as any;
      if (!before) {
        stmts.insert.run(prepared.pk, prepared.id, prepared.payload, prepared.hash, prepared.search, ...prepared.values);
        out.inserted++;
      } else if (before.hash !== prepared.hash) {
        stmts.update.run(prepared.payload, prepared.hash, prepared.search, ...prepared.values, id);
        out.updated++;
      } else out.skipped++;
    }
    for (const raw of removeIds) {
      const pk = raw === undefined || raw === null ? '' : String(raw);
      if (!pk) { out.skipped++; continue; }
      if (stmts.remove.run(pk).changes > 0) out.deleted++;
      else out.skipped++;
    }
  });
  tx();
  return out;
}

/**
 * Terapkan kembali kolom turunan dan blob pencarian dari payload yang tersimpan.
 * Dipanggil sekali saat DERIVED_REVISION berubah: kolom turunan dihasilkan dari
 * record, jadi mengubah dbSchema (mis. nama field yang benar) tidak mengubah
 * isi tabel sampai sini dijalankan — dan saveCollection melewatkan baris yang
 * hash payload-nya sama, sehingga tanpa langkah itu data lama tetap salah.
 */
function refreshDerivedColumns(): number {
  const handle = need();
  let rewritten = 0;
  for (const spec of COLLECTION_SPECS) {
    // Hanya kolom turunan yang ditulis: payload dan hash adalah sumber
    // kebenaran baris, dan keduanya tidak berubah oleh revisi skema.
    const sets = ['"search" = ?', ...spec.columns.map(c => `"${c.col}" = ?`)].join(', ');
    const stmt = handle.prepare(`UPDATE ${tableOf(spec.name)} SET ${sets} WHERE "pk" = ?`);
    const rows = handle.prepare(`SELECT "pk", "payload" FROM ${tableOf(spec.name)}`).all() as any[];
    const tx = handle.transaction(() => {
      for (const r of rows) {
        let row: any;
        try { row = JSON.parse(r.payload); } catch { continue; }
        const prepared = prepareRow(spec, row, r.pk, String(row && row.id != null ? row.id : r.pk));
        stmt.run(prepared.search, ...prepared.values, r.pk);
        rewritten++;
      }
    });
    tx();
  }
  return rewritten;
}

/**
 * Simpan satu collection penuh, tetapi hanya baris yang benar-benar berubah yang
 * ditulis. Ganti-semua akan memaksa SQLite menulis ulang seluruh tabel setiap
 * autosave, dan itu yang membuat aplikasi melambat saat data membesar.
 */
export function saveCollection(name: unknown, rows: unknown): { inserted: number; updated: number; deleted: number } {
  if (!isCollectionName(name)) throw new Error('Collection tidak dikenal untuk disimpan');
  if (!Array.isArray(rows)) throw new Error('Isi collection harus berupa array');
  const spec = SPEC_BY_NAME[name];
  const table = tableOf(spec.name);
  writeTrace.fullCalls++;
  writeTrace.fullRows += (rows as any[]).length;

  const keys = storageKeys(rows as any[]);
  const targets = rows.map((row, index) => prepareRow(spec, row, keys[index].pk, keys[index].id));

  const handle = need();
  const existing = new Map<string, string>();
  for (const r of handle.prepare(`SELECT pk, hash FROM ${table}`).all() as any[]) existing.set(r.pk, r.hash);

  const stmts = writeStatements(spec);
  const insert = stmts.insert, update = stmts.update, remove = stmts.remove;

  let inserted = 0, updated = 0, deleted = 0;
  const keep = new Set<string>();

  const tx = handle.transaction(() => {
    for (const row of targets) {
      keep.add(row.pk);
      const before = existing.get(row.pk);
      if (before === undefined) {
        insert.run(row.pk, row.id, row.payload, row.hash, row.search, ...row.values);
        inserted++;
      } else if (before !== row.hash) {
        update.run(row.payload, row.hash, row.search, ...row.values, row.pk);
        updated++;
      }
    }
    for (const pk of existing.keys()) {
      if (!keep.has(pk)) { remove.run(pk); deleted++; }
    }
  });
  tx();

  return { inserted, updated, deleted };
}

/**
 * Simpan collection yang benar-benar dikirim, dan hanya itu. Autosave sengaja
 * mengirim collection yang berubah saja, jadi dianggap-penuh akan menghapus
 * seluruh isi collection lain: satu edit pelanggan berarti seluruh invoice,
 * kas, dan armada hilang dari file. Pemanggil yang memang mau mengosongkan
 * sebuah collection harus mengirim key-nya dengan daftar kosong — restore dan
 * impor mengirim semua key, jadi keduanya tetap bekerja seperti sebelumnya.
 */
export function saveStore(data: Record<string, any[]>): Record<string, { inserted: number; updated: number; deleted: number }> {
  const handle = need();
  const result: Record<string, any> = {};
  const tx = handle.transaction(() => {
    for (const spec of COLLECTION_SPECS) {
      if (!Object.prototype.hasOwnProperty.call(data, spec.name)) continue;
      const rows = Array.isArray(data[spec.name]) ? data[spec.name] : [];
      result[spec.name] = saveCollection(spec.name, rows);
    }
  });
  tx();
  return result;
}

/**
 * Jalankan beberapa tulis dalam SATU transaksi. Dipakai kanal db-patch, yang bisa
 * membawa lebih dari satu collection sekaligus: tanpa pembungkus ini setiap
 * saveRows punya transaksi sendiri, jadi patch yang gagal di collection kedua
 * meninggalkan collection pertama sudah tertulis — separuh perubahan tersimpan,
 * separuh hilang, dan renderer mengira seluruh patch ditolak.
 * Transaksi better-sqlite3 boleh bersarang (yang dalam menjadi SAVEPOINT), jadi
 * saveRows/saveCollection di dalamnya tetap aman dipanggil sendiri.
 */
export function transact<T>(fn: () => T): T {
  const handle = need();
  return handle.transaction(fn)();
}

/**
 * Apakah record ini masih disebut dokumen lain? Hanya membaca — pemanggil yang
 * memutuskan penolakannya, supaya pesan bisa ditampilkan sebelum apa pun hilang.
 */
export function rowReferences(collection: unknown, id: unknown): ReferenceReport {
  return findReferences(need(), collection, id);
}

/**
 * Muat hanya collection yang disebut. Boot desktop tidak lagi menyalin seluruh isi
 * file ke renderer — halaman meminta collection yang memang ia tampilkan, jadi biaya
 * IPC tumbuh mengikuti layar yang dibuka, bukan mengikuti jumlah record. Nama yang
 * tidak dikenal diabaikan di sini; penolakannya terjadi di lapisan IPC supaya
 * renderer tidak pernah bisa membaca tabel di luar daftar putih.
 */
export function loadStore(names?: string[]): Record<string, any[]> {
  const picked = Array.isArray(names) ? new Set(names) : null;
  const out: Record<string, any[]> = {};
  for (const spec of COLLECTION_SPECS) {
    if (picked && !picked.has(spec.name)) continue;
    out[spec.name] = loadCollection(spec.name);
  }
  const muat = Object.values(out).reduce((total, rows) => total + rows.length, 0);
  if (picked) {
    readTrace.subsetCalls++;
    readTrace.subsetCollections += Object.keys(out).length;
  } else {
    readTrace.fullCalls++;
  }
  readTrace.rows += muat;
  return out;
}

/**
 * Jumlah baris per collection dari COUNT(*) — cukup untuk memutuskan "profil ini
 * masih kosong atau tidak" tanpa memindahkan satu baris pun lewat IPC.
 */
export function rowCounts(): { perCollection: { name: string; rows: number }[]; totalRows: number } {
  const perCollection = COLLECTION_SPECS.map(spec => ({ name: spec.name, rows: rowCount(spec.name) }));
  return { perCollection, totalRows: perCollection.reduce((total, c) => total + c.rows, 0) };
}

export function rowCount(name: unknown): number {
  if (!isCollectionName(name)) return 0;
  return (need().prepare(`SELECT COUNT(*) AS c FROM ${tableOf(name)}`).get() as any).c as number;
}

// ── Diagnostik ──────────────────────────────────────────────────────────────
export interface DbStats {
  file: string;
  sizeBytes: number;
  journalMode: string;
  schemaVersion: number;
  perCollection: { name: string; rows: number; payloadBytes: number }[];
  totalRows: number;
  writes: WriteTrace;
  reads: ReadTrace;
}

export function stats(): DbStats {
  const handle = need();
  const perCollection = COLLECTION_SPECS.map(spec => {
    const row = handle.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(payload)), 0) AS bytes FROM ${tableOf(spec.name)}`
    ).get() as any;
    return { name: spec.name, rows: Number(row.n), payloadBytes: Number(row.bytes) };
  });
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(dbFilePath).size; } catch { /* file belum ada */ }
  return {
    file: dbFilePath,
    sizeBytes,
    journalMode: String(handle.pragma('journal_mode', { simple: true })),
    schemaVersion: getMetaNumber('schema_version'),
    perCollection,
    totalRows: perCollection.reduce((a, b) => a + b.rows, 0),
    writes: getWriteTrace(),
    reads: getReadTrace(),
  };
}

/**
 * Periksa keandalan file dan cari kunci alamiah ganda. Duplikat tidak dihapus
 * otomatis — pengguna yang memutuskannya, lewat halaman Pemeliharaan Sistem.
 */
export function integrity(): { ok: boolean; quickCheck: string[]; duplicates: { collection: string; column: string; value: string; count: number }[] } {
  const handle = need();
  const quickCheck = (handle.pragma('quick_check') as any[]).map(r => String(Object.values(r)[0]));
  const duplicates: { collection: string; column: string; value: string; count: number }[] = [];
  for (const spec of COLLECTION_SPECS) {
    for (const col of spec.duplicates || []) {
      const rows = handle.prepare(
        `SELECT "${col}" AS v, COUNT(*) AS c FROM ${tableOf(spec.name)} WHERE "${col}" <> '' GROUP BY "${col}" HAVING c > 1 ORDER BY c DESC LIMIT 20`
      ).all() as any[];
      for (const r of rows) duplicates.push({ collection: spec.name, column: col, value: String(r.v), count: Number(r.c) });
    }
  }
  return { ok: quickCheck.every(v => v === 'ok'), quickCheck, duplicates };
}

/**
 * Salinan konsisten lewat online backup API SQLite. Dibanding copyFileSync,
 * cara ini tidak memerlukan WAL dirapikan lebih dulu dan tidak bisa menghasilkan
 * berkas setengah jadi walau aplikasi sedang menulis.
 */
export async function backupTo(destFile: string): Promise<void> {
  await need().backup(destFile);
}

/** Rapikan WAL ke file utama — dipakai sebelum menutup atau menyalin manual. */
export function checkpoint(): void {
  need().pragma('wal_checkpoint(TRUNCATE)');
}

export function closeDatabase(): void {
  if (!db) return;
  try { checkpoint(); } catch { /* sedang tidak ada WAL */ }
  try { db.close(); } catch { /* sudah tertutup */ }
  db = null;
  stmtCache.clear();
}
