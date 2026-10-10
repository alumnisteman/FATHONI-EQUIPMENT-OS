// src/hooks/useCollectionTotals.ts
// Angka ringkasan (kartu KPI) tidak boleh dihitung dengan menelusuri seluruh isi
// collection di renderer: SQLite menjumlah, menghitung dan mengelompokkan dalam
// satu query, dan itu tetap cepat walau transaksi sudah puluhan ribu baris.
//
// Mode browser (vite dev tanpa Electron) tidak punya database, jadi angka dihitung
// dari array store dengan aturan yang SAMA seperti sisi SQL: lihat
// src/domain/derivedColumns.ts dan matchesWhere di bawah. `revision` (savedTick
// dari store) menjadi pemicu hitung ulang: angkanya ikut berubah begitu tulisan
// dari menu mana pun benar-benar masuk file.

import { useEffect, useState } from 'react';
import { dbGroup, dbQuery, dbSum } from '../services/dbClient';
import { columnValueOf } from '../domain/derivedColumns';

/**
 * Kunci stabil dari satu objek penyaringan. Bentuk operator ({ gte: 1, lte: 50 })
 * harus ikut membedakan, jadi nilainya diserialisasi — String({}) menghasilkan
 * '[object Object]' dan dua penyaringan berbeda akan terlihat sama.
 */
function whereKey(where?: Record<string, unknown>): string {
  if (!where) return '';
  const entries: string[] = [];
  for (const key of Object.keys(where).sort()) {
    try {
      entries.push(`${key}=${JSON.stringify(where[key])}`);
    } catch {
      entries.push(`${key}=~`);
    }
  }
  return entries.join('&');
}

// Kunci penyaringan yang dikenali. Sama seperti daftar putih operator di
// electron/db.ts: bentuk lain tidak menyaring apa pun, bukan menyaring salah.
const FILTER_KEYS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'between'];

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    // '2026-09' adalah kunci bulan, bukan angka: hanya bentuk yang kembali persis
    // sama sesudah dikonversi yang dibandingkan sebagai angka, supaya kunci bulan
    // tetap diurutkan sebagai teks seperti kolom TEXT di SQLite.
    return Number.isFinite(n) && String(n) === t ? n : null;
  }
  return null;
}

/**
 * Satu perbandingan pada satu kolom.
 *
 * Kolom angka dibandingkan sebagai angka; selain itu sebagai teks, meniru cara
 * kolom TEXT SQLite diisi (str() saat menulis, jadi nilai hilang menjadi '').
 * Kolom turunan ('month', 'serviceDueIn', 'stockShortfall') dihitung dulu dari
 * record, karena field itu memang tidak pernah ada di data mentah.
 */
function compareColumn(
  row: any, collection: string, col: string, op: string, filterValue: unknown
): boolean {
  const raw = columnValueOf(collection, col, row);
  const left = asNumber(raw);
  const right = asNumber(filterValue);
  // Kolom angka yang kosong adalah NULL di SQLite, dan NULL tidak pernah cocok
  // dengan operator apa pun — termasuk <> — jadi barisnya ikut terbuang.
  if ((raw === null || raw === undefined) && right !== null) return false;
  const numeric = left !== null && right !== null;

  const lt = numeric ? (left as number) < (right as number) : String(raw ?? '') < String(filterValue ?? '');
  const gt = numeric ? (left as number) > (right as number) : String(raw ?? '') > String(filterValue ?? '');
  const same = numeric
    ? (left as number) === (right as number)
    : String(raw ?? '') === String(filterValue ?? '');

  switch (op) {
    case 'eq': return same;
    case 'ne': return !same;
    case 'gt': return gt;
    case 'gte': return same || gt;
    case 'lt': return lt;
    case 'lte': return same || lt;
    default: return true;
  }
}

function matchOne(row: any, collection: string, col: string, value: unknown): boolean {
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    return value.some(v => compareColumn(row, collection, col, 'eq', v));
  }

  if (value && typeof value === 'object') {
    const spec = value as Record<string, unknown>;
    const ops: [string, unknown][] = [];
    if (typeof spec.op === 'string') ops.push([spec.op, spec.value]);
    for (const key of FILTER_KEYS) {
      if (Object.prototype.hasOwnProperty.call(spec, key)) ops.push([key, spec[key]]);
    }
    // Objek tanpa kunci penyaringan tidak diikat di sisi SQL juga, jadi di sini
    // pun tidak boleh menolak baris.
    if (ops.length === 0) return true;

    return ops.every(([op, raw]) => {
      if (op === 'in') return Array.isArray(raw) && raw.length > 0
        ? raw.some(v => compareColumn(row, collection, col, 'eq', v))
        : true;
      // 'nin' adalah komplemen 'in'. Kolom TEXT menyimpan '' bila field hilang,
      // jadi baris tanpa field tetap ikut (sama seperti SQL). Pada kolom angka
      // SQL mengeluarkan NULL dari NOT IN sementara sini tidak, karena itu 'nin'
      // hanya dipakai untuk kolom status/TEXT — dijaga db-check bagian 13.
      if (op === 'nin') return Array.isArray(raw) && raw.length > 0
        ? !raw.some(v => compareColumn(row, collection, col, 'eq', v))
        : true;
      if (op === 'between') {
        if (!Array.isArray(raw) || raw.length !== 2) return true;
        return compareColumn(row, collection, col, 'gte', raw[0])
          && compareColumn(row, collection, col, 'lte', raw[1]);
      }
      return compareColumn(row, collection, col, op, raw);
    });
  }

  return compareColumn(row, collection, col, 'eq', value);
}

/** Penyaringan sisi browser: hasil identik dengan klausa WHERE yang sama. */
export function matchesWhere(
  row: any, where: Record<string, unknown> | undefined, collection = ''
): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [col, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (!matchOne(row, collection, col, value)) return false;
  }
  return true;
}

export function useCollectionSum(
  collection: string,
  column: string,
  where: Record<string, unknown> | undefined,
  localRows: any[],
  revision = 0
): number {
  const key = whereKey(where);
  const [value, setValue] = useState(0);

  useEffect(() => {
    let cancelled = false;
    dbSum(collection, column, where).then(sum => {
      if (cancelled) return;
      setValue(sum === null
        ? localRows.reduce(
            (acc, row) => (matchesWhere(row, where, collection) ? acc + (Number(row?.[column]) || 0) : acc), 0)
        : sum);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, column, key, revision]);

  return value;
}

/** Jumlah baris yang cocok dengan satu penyaringan, tanpa memuat barisnya. */
export function useCollectionCount(
  collection: string,
  where: Record<string, unknown> | undefined,
  localRows: any[],
  revision = 0
): number {
  const key = whereKey(where);
  const [value, setValue] = useState(0);

  useEffect(() => {
    let cancelled = false;
    dbQuery({ collection, where, limit: 1 }).then(result => {
      if (cancelled) return;
      setValue(result === null
        ? localRows.filter(row => matchesWhere(row, where, collection)).length
        : result.total);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, key, revision]);

  return value;
}

export interface GroupRequest {
  collection: string;
  /** 1..3 kolom turunan tempat mengelompokkan. */
  by: string[];
  /** Kolom angka yang dijumlahkan; kolom TEXT tidak dijumlahkan oleh SQLite. */
  sum?: string;
  where?: Record<string, unknown>;
}

export interface GroupRow {
  key: string;
  keys: string[];
  count: number;
  sum: number;
}

/** Kelompok agregat dihitung di SQLite; tanpa database, dihitung dari array. */
export function groupLocally(req: GroupRequest, localRows: any[]): GroupRow[] {
  const out = new Map<string, GroupRow>();
  for (const row of localRows) {
    if (!matchesWhere(row, req.where, req.collection)) continue;
    const keys = req.by.map(c => String(columnValueOf(req.collection, c, row) ?? ''));
    const key = keys.join(' ');
    const item = out.get(key) || { key, keys, count: 0, sum: 0 };
    item.count += 1;
    if (req.sum) item.sum += Number(row?.[req.sum]) || 0;
    out.set(key, item);
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Agregat kelompok untuk kartu dan grafik: pendapatan per bulan, unit per status,
 * biaya per kategori. Hanya kelompok yang keluar dari SQLite, bukan barisnya.
 */
export function useCollectionGroup(
  req: GroupRequest,
  localRows: any[],
  revision = 0
): GroupRow[] {
  const key = `${req.collection}|${req.by.join(',')}|${req.sum || ''}|${whereKey(req.where)}`;
  const [groups, setGroups] = useState<GroupRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    dbGroup(req).then(result => {
      if (cancelled) return;
      setGroups(result === null ? groupLocally(req, localRows) : result);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);

  return groups;
}

export interface QueryPage {
  collection: string;
  where?: Record<string, unknown>;
  sort?: string;
  desc?: boolean;
  /** Beberapa baris pertama saja; kartu Dasbor tidak pernah butuh semuanya. */
  limit?: number;
}

export interface QueryPageResult<T = any> {
  rows: T[];
  /** Jumlah baris yang COCOK dengan penyaringan, bukan panjang `rows`. */
  total: number;
}

function sortLocal<T>(rows: T[], sort?: string, desc?: boolean): T[] {
  if (!sort) return rows;
  return [...rows].sort((a: any, b: any) => {
    const x = String(a?.[sort] ?? ''), y = String(b?.[sort] ?? '');
    return desc ? y.localeCompare(x) : x.localeCompare(y);
  });
}

/**
 * Satu HALAMAN baris untuk kartu dan Alert Center: hanya `limit` record yang
 * melintasi IPC, sementara `total` tetap melaporkan jumlah sebenarnya.
 *
 * Tanpa `sort` urutan mengikuti urutan store (muat-balik SQLite memakai ORDER BY
 * kolom urutan baku yang sama), jadi isi kartu tidak berubah setelah pindah query.
 */
export function useCollectionQuery<T = any>(
  req: QueryPage,
  localRows: T[],
  revision = 0
): QueryPageResult<T> {
  const key = `${req.collection}|${whereKey(req.where)}|${req.sort || ''}|${req.desc ? 1 : 0}|${req.limit || 0}`;
  const [page, setPage] = useState<QueryPageResult<T>>({ rows: [], total: 0 });

  useEffect(() => {
    let cancelled = false;
    dbQuery<T>({
      collection: req.collection, where: req.where, sort: req.sort, desc: req.desc, limit: req.limit,
    }).then(result => {
      if (cancelled) return;
      if (result) { setPage({ rows: result.rows, total: result.total }); return; }
      const filtered = sortLocal(localRows.filter(r => matchesWhere(r, req.where, req.collection)), req.sort, req.desc);
      const size = req.limit && req.limit > 0 ? req.limit : filtered.length;
      setPage({ rows: filtered.slice(0, size), total: filtered.length });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);

  return page;
}
