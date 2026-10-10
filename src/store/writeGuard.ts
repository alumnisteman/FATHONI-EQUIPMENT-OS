// src/store/writeGuard.ts
// Bagi satu snapshot store menjadi jalur tulis yang AMAN terhadap file SQLite.
//
// Dua jalur itu ada sejak lama: patch per baris (hanya record yang berubah yang
// melintasi IPC) dan collection penuh (daftar lengkap yang dianggap mewakili isi
// tabel). Yang kedua hanya benar kalau array di memori memang dibacakan penuh dari
// file. Sejak boot tidak lagi memuat seluruh store (Fase 4 #38), sebagian
// collection berstatus "belum termuat" — dan kalau yang belum termuat itu ikut
// dikirim sebagai collection penuh, SQLite menghapus setiap baris yang tidak ikut
// terbaca layar tadi. Itulah kehilangan data yang dijaga di sini, bukan sekadar
// optimasi.
//
// Aturan penjaga:
//  - collection BELUM termuat tidak pernah masuk jalur penuh;
//  - diff-nya hanya boleh membawa upsert, removeIds dibuang dan dilaporkan, karena
//    "tidak ada di memori" bukan berarti "tidak ada di file";
//  - diff yang tidak bisa dipercaya (baris tanpa id / id rangkap) pada collection
//    belum termuat ditahan seluruhnya — tidak ada tulisan yang lebih baik daripada
//    tulisan yang menghapus data orang lain;
//  - collection SUDAH termuat berperilaku seperti sebelumnya.

import type { RowPatch } from '../services/dbClient';

export const rowKey = (row: any): string | null =>
  row && row.id !== undefined && row.id !== null ? String(row.id) : null;

/**
 * Bandingkan dua versi satu collection atas IDENTITAS objek barisnya. Seluruh
 * mutation halaman membuat salinan baru untuk baris yang berubah
 * ({ ...u, status }) dan mempertahankan objek lama untuk sisanya, jadi
 * perbandingan ini menemukan persis apa yang perlu ditulis.
 *
 * Mengembalikan null bila perbandingan tidak bisa dipercaya — baris tanpa id,
 * atau id rangkap (warisan data lama). Pada dua bentuk itu kunci penyimpanan
 * baris bukan lagi id-nya sendiri, jadi satu-satunya cara yang aman adalah
 * mengirim collection penuh seperti sebelumnya — dan hanya bila collection itu
 * memang termuat penuh (lihat penjaga di bawah).
 */
export function diffRows(
  prev: any[] | undefined,
  next: any[] | undefined
): { upsert: any[]; removeIds: string[] } | null {
  if (!Array.isArray(prev) || !Array.isArray(next)) return null;

  const before = new Map<string, any>();
  for (const row of prev) {
    const key = rowKey(row);
    if (key === null || before.has(key)) return null;
    before.set(key, row);
  }
  const after = new Set<string>();
  for (const row of next) {
    const key = rowKey(row);
    if (key === null || after.has(key)) return null;
    after.add(key);
  }

  const upsert = next.filter(row => before.get(rowKey(row)!) !== row);
  const removeIds: string[] = [];
  for (const key of before.keys()) if (!after.has(key)) removeIds.push(key);
  return { upsert, removeIds };
}

export interface RencanaTulis {
  /** Ditulis lewat kanal db-patch: hanya baris yang berubah. */
  patches: Record<string, RowPatch>;
  /** Ditulis lewat kanal db-save: collection penuh, hanya yang sudah termuat. */
  full: Record<string, any[]>;
  /** Perubahan yang TAHAN_total: collection belum termuat dan diff tidak tepercaya. */
  tertahan: string[];
  /** Berapa id yang tidak jadi dihapus per collection karena belum termuat. */
  buangan: Record<string, number>;
}

/**
 * `prevOf`/`nextOf` adalah isi memori "yang sudah ada di file" dan "yang sekarang"
 * per collection; `loadedOf` menandai collection yang pernah dibacakan penuh.
 */
export function rencanakanTulis(
  dirty: string[],
  prevOf: Record<string, any[]>,
  nextOf: Record<string, any[]>,
  loadedOf: Record<string, boolean>
): RencanaTulis {
  const rencana: RencanaTulis = { patches: {}, full: {}, tertahan: [], buangan: {} };

  for (const name of dirty) {
    const patch = diffRows(prevOf[name], nextOf[name]);

    if (!loadedOf[name]) {
      if (!patch) {
        rencana.tertahan.push(name);
        continue;
      }
      if (patch.removeIds.length > 0) rencana.buangan[name] = patch.removeIds.length;
      rencana.patches[name] = { upsert: patch.upsert, removeIds: [] };
      continue;
    }

    if (patch) rencana.patches[name] = patch;
    else rencana.full[name] = nextOf[name];
  }

  return rencana;
}
