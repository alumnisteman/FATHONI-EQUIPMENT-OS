// src/hooks/usePagedCollection.ts
// Halaman daftar besar tidak boleh memfilter seluruh isi database di renderer:
// satu halaman record diminta ke SQLite, pencarian dan penyaringan dikerjakan di
// sisi SQL. Hasil pencarian identik dengan matchesQuery karena blob pencarian
// dibangun dengan normalisasi yang sama (dijaga db-check.cjs bagian 5).
//
// Mode browser (vite dev tanpa Electron) tidak punya SQLite, jadi jalur cadangan
// memfilter array dari store lalu memotong halaman yang sama.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dbQuery, type DbQueryRequest } from '../services/dbClient';
import { matchesQuery } from '../utils/searchMatch';

export interface PagedSource<T = any> {
  collection: string;
  /** Kueri pencarian bebas, dikirim apa adanya ke SQL. */
  search: string;
  /** Penyaringan equality pada kolom turunan, mis. { type: 'INBOUND' }. */
  where?: Record<string, unknown>;
  sort?: string;
  desc?: boolean;
  pageSize: number;
  /** Nomor halaman berbasis nol. */
  page: number;
  /** Sumber untuk mode browser: array penuh dari store. */
  localRows: T[];
  /** Sumber untuk mode browser: field yang dicari, sama seperti halaman lama. */
  localFields: (row: T) => Array<string | number | null | undefined>;
  /** savedTick dari store: naik begitu collection ini masuk file. */
  revision?: number;
}

export interface PagedResult<T = any> {
  rows: T[];
  total: number;
  pages: number;
  from: number;
  to: number;
  loading: boolean;
  /** true bila hasil datang dari SQLite; false bila dari array store (mode browser). */
  fromDb: boolean;
  refresh: () => void;
}

/** Waktu jeda antara ketik dan kueri: cukup untuk berhenti mengirim satu kueri
 *  per huruf, tanpa terasa membingungkan saat halaman berganti. */
const QUERY_DEBOUNCE_MS = 200;

/** Kunci stabil untuk objek `where` yang dibuat ulang tiap render. */
function whereKey(where?: Record<string, unknown>): string {
  if (!where) return '';
  return Object.keys(where).sort().map(k => `${k}=${String(where[k])}`).join('&');
}

export function usePagedCollection<T = any>(src: PagedSource<T>): PagedResult<T> {
  const { collection, search, sort, desc, pageSize, page, localRows, localFields, revision } = src;
  const key = whereKey(src.where);

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fromDb, setFromDb] = useState(false);
  const [nonce, setNonce] = useState(0);
  const requestRef = useRef(0);

  // Nilai yang dibaca di dalam timer tanpa ikut menjadi dependensi.
  const whereRef = useRef(src.where);
  whereRef.current = src.where;
  const localRef = useRef(localRows);
  localRef.current = localRows;
  const fieldsRef = useRef(localFields);
  fieldsRef.current = localFields;

  const refresh = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const seq = ++requestRef.current;
    setLoading(true);

    const timer = setTimeout(async () => {
      const req: DbQueryRequest = {
        collection,
        search,
        where: whereRef.current,
        sort,
        desc,
        limit: pageSize,
        offset: page * pageSize,
      };
      const result = await dbQuery<T>(req);
      if (cancelled || seq !== requestRef.current) return;

      if (result) {
        setRows(result.rows);
        setTotal(result.total);
        setFromDb(true);
        setLoading(false);
        return;
      }

      // Mode browser: filter dan potong array store dengan aturan yang sama.
      const whereEntries = Object.entries(whereRef.current || {});
      const filtered = localRef.current.filter(r =>
        matchesQuery(fieldsRef.current(r), search) &&
        whereEntries.every(([field, value]) => String((r as any)[field] ?? '') === String(value))
      );
      const sorted = sort
        ? [...filtered].sort((a: any, b: any) => {
            const x = String(a?.[sort] ?? ''), y = String(b?.[sort] ?? '');
            return desc ? y.localeCompare(x) : x.localeCompare(y);
          })
        : filtered;
      setRows(sorted.slice(page * pageSize, page * pageSize + pageSize));
      setTotal(sorted.length);
      setFromDb(false);
      setLoading(false);
    }, QUERY_DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
    // `revision` naik saat collection ini benar-benar masuk file, termasuk bila
    // ditulis menu lain. Identitas array store sengaja TIDAK menjadi dependensi:
    // saat itu terjadi file belum tentu sudah ditulis, jadi hasilnya justru
    // halaman sempat menampilkan data lama lalu membetulkan diri.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, search, key, sort, desc, pageSize, page, nonce, revision]);

  const pages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return useMemo(
    () => ({ rows, total, pages, from, to, loading, fromDb, refresh }),
    [rows, total, pages, from, to, loading, fromDb, refresh]
  );
}
