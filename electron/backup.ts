// electron/backup.ts
// Snapshot berkas database: satu folder per cadangan berisi salinan fathoni.db,
// settings yang belum pindah ke SQLite, dan meta (checksum + jumlah baris).
//
// Kenapa di level berkas: sejak Fase 4 database hidup di SQLite, sedangkan
// hems_data_store_v1 di localStorage hanyalah arsip pra-migrasi. Menyalin arsip
// itu menghasilkan cadangan basi — justru data yang sedang dipakai pengguna yang
// harus ikut.
//
// Restore tidak pernah langsung menggantikan berkas: snapshot pengaman dibuat
// lebih dulu, dan quick_check sesudah restore menentukan apakah salinan
// pengaman itu dikembalikan lagi atau tidak.

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { backupTo, closeDatabase, integrity, openDatabase, stats, DB_FILE_NAME } from './db';

const SNAP_DIR_NAME = 'snapshots';
const KEEP_SNAPSHOTS = 7;

// 20261009T121530-manual, dan 20261009T121530-manual-002 bila dua snapshot jatuh
// pada detik yang sama. Nama inilah yang menjadi batas: tidak ada string dari
// renderer yang boleh membentuk path. Sufiks ditulis tiga digit supaya urutan
// lexicographic tetap sama dengan urutan waktu.
const NAME_RE = /^\d{8}T\d{6}-(auto|manual|pra-restore)(-\d{1,3})?$/;
const REASONS = ['auto', 'manual', 'pra-restore'];

// Settings masih tinggal di localStorage, jadi ikut ke dalam snapshot. Isi
// database (hems_data_store_v1), sesi login, log, dan arsip lama sengaja tidak
// pernah diterima di sini.
const SETTING_KEY_RE = /^(hems_|HEMS_)[A-Za-z0-9_]{1,64}$/;
const FORBIDDEN_KEY = /backup|session|health|error|store/i;
const MAX_SETTING_KEYS = 100;
const MAX_SETTINGS_BYTES = 1024 * 1024;

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

// Bentuk hasil memakai flag `ok` plus anggota opsional, bukan union berdiskriminan:
// tsconfig.electron.json berjalan tanpa strictNullChecks, jadi penyempitan tipe
// lewat `ok === false` tidak berlaku di dalam modul ini. Pembatas di sisi renderer
// (src/services/dbClient.ts) yang mengubah hasil ini menjadi union ketat.
export type SnapshotResult = { ok: boolean; snapshot?: SnapshotMeta; error?: string };
export type RestoreResult = {
  ok: boolean;
  snapshot?: SnapshotMeta;
  settings?: Record<string, string>;
  quickCheck?: string[];
  error?: string;
  rolledBack?: boolean;
};

const IO_FAILURE: Record<string, string> = {
  ENOENT: 'Berkas cadangan tidak ditemukan di folder data aplikasi',
  EACCES: 'Tidak ada izin menulis di folder data aplikasi',
  EPERM: 'Berkas database sedang dipakai proses lain, tutup aplikasi lain yang membukanya',
  ENOSPC: 'Disk penuh — cadangan tidak bisa ditulis',
  EBUSY: 'Berkas database sedang dipakai, coba lagi sebentar',
};

function ioMessage(err: any): string {
  console.error('[backup] Operasi berkas gagal:', err);
  return IO_FAILURE[err?.code] || 'Operasi berkas gagal — periksa folder data aplikasi';
}

function root(userDataDir: string): string {
  const dir = path.join(userDataDir, SNAP_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Nama yang sudah lolos pola -> folder mutlak di dalam folder snapshot. */
function dirOf(userDataDir: string, rawName: unknown): string {
  const name = String(rawName);
  if (!NAME_RE.test(name)) throw new Error('Nama cadangan tidak dikenali');
  const base = root(userDataDir);
  const dir = path.join(base, name);
  if (!dir.startsWith(base + path.sep)) throw new Error('Nama cadangan di luar folder snapshot');
  return dir;
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, '');
}

function uniqueName(userDataDir: string, reason: string): string {
  const base = `${stamp()}-${reason}`;
  const snapRoot = root(userDataDir);

  // Label yang pernah dipakai pada detik ini tidak boleh dipakai ulang, bahkan
  // kalau foldernya sudah dibuang rotasi: tanpa sufiks, namanya secara
  // lexicographic adalah yang paling tua, sehingga cadangan terbaru justru dibuang
  // lebih dulu pada rotasi berikutnya.
  const terpakai = names(userDataDir).filter(n => n === base || n.startsWith(`${base}-`));
  if (terpakai.length === 0) return base;

  let highest = 1;
  for (const nama of terpakai) {
    const match = /-(\d{1,3})$/.exec(nama);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  for (let n = highest + 1; n <= 999; n++) {
    const candidate = `${base}-${String(n).padStart(3, '0')}`;
    if (!fs.existsSync(path.join(snapRoot, candidate))) return candidate;
  }
  throw new Error('Terlalu banyak cadangan pada detik yang sama');
}

function sha1File(file: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Hanya key settings berbentuk JSON yang boleh menempel pada snapshot. Nilai
 * dikirim renderer sebagai teks mentah supaya bentuk aslinya (termasuk key yang
 * tidak dikenali aplikasi) tidak berubah karena proses parse ulang.
 */
function sanitizeSettings(raw: unknown): Record<string, string> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object') throw new Error('Settings cadangan bukan object');

  const out: Record<string, string> = {};
  let bytes = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SETTING_KEY_RE.test(key) || FORBIDDEN_KEY.test(key)) {
      throw new Error(`Key "${key}" tidak boleh ikut cadangan`);
    }
    if (typeof value !== 'string') throw new Error(`Isi "${key}" bukan teks JSON`);
    if (value.length > MAX_SETTINGS_BYTES) throw new Error(`Isi "${key}" terlalu besar`);
    JSON.parse(value);
    out[key] = value;
    bytes += key.length + value.length;
    if (Object.keys(out).length > MAX_SETTING_KEYS || bytes > MAX_SETTINGS_BYTES) {
      throw new Error('Terlalu banyak settings untuk dicadangkan');
    }
  }
  return out;
}

function names(userDataDir: string): string[] {
  let entries: string[] = [];
  try { entries = fs.readdirSync(root(userDataDir)); } catch { return []; }
  // Urutan lexicographic = urutan waktu karena cap waktunya fixed-width.
  return entries.filter(n => NAME_RE.test(n)).sort().reverse();
}

function readMeta(userDataDir: string, name: string): SnapshotMeta | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dirOf(userDataDir, name), 'meta.json'), 'utf-8'));
    return typeof meta?.name === 'string' && typeof meta?.checksum === 'string' ? meta as SnapshotMeta : null;
  } catch {
    return null;
  }
}

function readSettings(userDataDir: string, name: string): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dirOf(userDataDir, name), 'settings.json'), 'utf-8'));
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (SETTING_KEY_RE.test(key) && !FORBIDDEN_KEY.test(key) && typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function removeDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* snapshot tua gagal dibuang, tidak mengancam yang baru */ }
}

/** Snapshot terbaru dipertahankan; yang paling tua dipangkas sampai KEEP_SNAPSHOTS. */
function rotate(userDataDir: string): number {
  let removed = 0;
  names(userDataDir).slice(KEEP_SNAPSHOTS).forEach(name => {
    removeDir(path.join(root(userDataDir), name));
    removed++;
  });
  return removed;
}

/**
 * Buat satu snapshot. Kegagalan di tengah jalan tidak meninggalkan folder
 * setengah jadi — folder itu dihapus lagi, karena snapshot separuh adalah
 * ilusi keamanan.
 */
export async function createSnapshot(
  userDataDir: string,
  input: { reason?: unknown; settings?: unknown } = {}
): Promise<SnapshotResult> {
  const reason = REASONS.includes(String(input?.reason)) ? String(input.reason) : 'manual';

  let settings: Record<string, string>;
  let name: string;
  let dir: string;
  try {
    settings = sanitizeSettings(input?.settings);
    name = uniqueName(userDataDir, reason);
    dir = dirOf(userDataDir, name);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Cadangan tidak bisa disiapkan' };
  }

  try {
    fs.mkdirSync(dir);
    await backupTo(path.join(dir, DB_FILE_NAME));
    const dbFile = path.join(dir, DB_FILE_NAME);

    if (Object.keys(settings).length > 0) {
      fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
    }

    const current = stats();
    const meta: SnapshotMeta = {
      name,
      reason,
      createdAt: new Date().toISOString(),
      bytes: fs.statSync(dbFile).size,
      checksum: sha1File(dbFile),
      totalRows: current.totalRows,
      schemaVersion: current.schemaVersion,
      settingsKeys: Object.keys(settings).sort(),
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    rotate(userDataDir);
    return { ok: true, snapshot: meta };
  } catch (err: any) {
    removeDir(dir);
    return { ok: false, error: ioMessage(err) };
  }
}

export function listSnapshots(userDataDir: string): SnapshotMeta[] {
  return names(userDataDir)
    .map(name => readMeta(userDataDir, name))
    .filter((m): m is SnapshotMeta => m !== null);
}

function clearSidecars(liveDb: string): void {
  for (const suffix of ['-wal', '-shm']) {
    try { fs.rmSync(liveDb + suffix, { force: true }); } catch { /* dibiarkan, SQLite akan membuangnya sendiri */ }
  }
}

/**
 * Gantikan database hidup dengan snapshot. Selalu membuat snapshot pengaman
 * lebih dulu supaya restore yang salah pilih (atau rusak) masih bisa balik.
 */
export async function restoreSnapshot(
  userDataDir: string,
  rawName: unknown,
  preflightSettings: unknown
): Promise<RestoreResult> {
  let dir: string;
  try {
    dir = dirOf(userDataDir, rawName);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Cadangan tidak dikenali', rolledBack: false };
  }

  const meta = readMeta(userDataDir, String(rawName));
  if (!meta) return { ok: false, error: 'Meta cadangan tidak terbaca — snapshot dianggap tidak aman', rolledBack: false };

  const snapDb = path.join(dir, DB_FILE_NAME);
  if (!fs.existsSync(snapDb)) return { ok: false, error: 'Berkas database cadangan tidak ada', rolledBack: false };

  let checksumOk = false;
  try { checksumOk = sha1File(snapDb) === meta.checksum; } catch { checksumOk = false; }
  if (!checksumOk) {
    return { ok: false, error: 'Checksum cadangan tidak cocok — berkas mungkin diubah atau terpotong', rolledBack: false };
  }

  const guard = await createSnapshot(userDataDir, { reason: 'pra-restore', settings: preflightSettings });
  if (!guard.ok || !guard.snapshot) {
    return { ok: false, error: `Cadangan pengaman gagal dibuat: ${guard.error || 'penyebab tidak diketahui'}`, rolledBack: false };
  }
  const guardDb = path.join(dirOf(userDataDir, guard.snapshot.name), DB_FILE_NAME);

  const live = path.join(userDataDir, DB_FILE_NAME);
  try {
    closeDatabase();
    clearSidecars(live);
    fs.copyFileSync(snapDb, live);
    openDatabase(userDataDir);
  } catch (err: any) {
    const rolledBack = rollBack(userDataDir, guardDb);
    return { ok: false, error: ioMessage(err), rolledBack };
  }

  const check = integrity();
  if (!check.ok) {
    const rolledBack = rollBack(userDataDir, guardDb);
    return {
      ok: false,
      error: rolledBack
        ? 'Hasil periksa integritas buruk, database dikembalikan ke keadaan sebelum restore'
        : 'Hasil periksa integritas buruk DAN pengembalian gagal — jangan tutup aplikasi, pulihkan dari snapshot pengaman',
      rolledBack,
    };
  }

  return {
    ok: true,
    snapshot: meta,
    settings: readSettings(userDataDir, String(rawName)),
    quickCheck: check.quickCheck,
  };
}

function rollBack(userDataDir: string, guardDb: string): boolean {
  const live = path.join(userDataDir, DB_FILE_NAME);
  try {
    closeDatabase();
    clearSidecars(live);
    fs.copyFileSync(guardDb, live);
    openDatabase(userDataDir);
    return true;
  } catch (err) {
    console.error('[backup] Pengembalian ke snapshot pengaman gagal:', err);
    return false;
  }
}

export function clearSnapshots(userDataDir: string): number {
  const all = names(userDataDir);
  all.forEach(name => removeDir(path.join(root(userDataDir), name)));
  return all.length;
}
