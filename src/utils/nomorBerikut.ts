// src/utils/nomorBerikut.ts
// Nomor dokumen berikutnya dihitung dari NOMOR TERBESAR yang ada di file, lalu
// dicek ulang supaya tidak menabrak nomor yang sudah dipakai.
//
// Kenapa bukan "jumlah baris + 1": menghapus satu record meninggalkan celah.
// Delapan pesanan 001..008 yang satu di antaranya terhapus membuat saran
// berikutnya 008 — nomor yang masih ada di file. Kunci antar menu di aplikasi
// ini adalah nomor bisnis (lihat electron/referential.ts): SPK, Surat Jalan,
// Invoice, dan Mutasi Kas saling menunjuk lewat nomor itu, jadi dua dokumen
// ber-nomor sama membuat rujukan tidak bisa dibaca lagi dan penolakan hapus
// salah alamat.
//
// Kenapa dari database, bukan array halaman: sejak hidrasi per menu (#38), array
// yang dipegang sebuah halaman bisa hanya berisi sebagian collection. Sumber
// nomornya file, jadi filenya yang ditanya.
//
// Kenapa masih perlu dicek: query mengurutkan kolom nomor secara lexicographic.
// Selama lebarnya sama (001..999) urutan itu sama dengan urutan angka, tapi di
// atas 999 'SO-2026-1000' justru lebih kecil dari 'SO-2026-999' saat dibaca
// per karakter. Kandidatnya diperiksa ke file (satu query IN per kelompok)
// sebelum diserahkan ke form, jadi lebar nomor berapa pun aman.

import { dbQuery } from '../services/dbClient';

/** Berapa kandidat yang diperiksa sekaligus. Query-nya satu SELECT ... IN. */
const KELOMPOK_KANDIDAT = 50;
/** Pagarnya; mencapai 1.000 nomor beruntun yang sudah terpakai berarti file rusak. */
const MAKS_KELOMPOK = 20;

/** Deretan digit terakhir sebuah nomor dokumen; 0 bila nomornya tidak berakhir dengan angka. */
export function urutanTerakhir(nomor: unknown): number {
  const m = /(\d+)$/.exec(String(nomor === undefined || nomor === null ? '' : nomor).trim());
  return m ? Number(m[1]) : 0;
}

/** Nomor terbesar yang terlihat pada baris yang sudah ada di memori. */
export function urutanTertinggi(rows: any[] | undefined, field: string): number {
  let tertinggi = 0;
  for (const r of rows || []) {
    const n = urutanTerakhir(r ? r[field] : undefined);
    if (n > tertinggi) tertinggi = n;
  }
  return tertinggi;
}

/** Bagian depan nomor, tanpa digit ekornya, dibandingkan tanpa tanda baca/besar-kecil. */
function embelNomor(nomor: string): string {
  return String(nomor).replace(/\d+$/, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Cari urutan pertama yang nomornya belum ada, mulai dari `mulai`.
 * `ada` menerima daftar kandidat dan mengembalikan nomor yang ternyata sudah
 * dipakai — pemisahan ini membuat seluruh logikanya teruji tanpa database.
 *
 * Kecocokan dibaca dari (embel, urutan), bukan dari string utuh: file lama bisa
 * berisi 'INV-2026-0011' hasil template lebar tiga digit yang tumbuh, dan nomor
 * itu adalah urutan 11 yang sama dengan 'INV-2026-011'. Dua dokumen dengan
 * urutan yang sama tetap tabrakan meskipun teksnya beda.
 */
export async function cariUrutanBebas(
  mulai: number,
  buat: (urutan: number) => string,
  ada: (kandidat: string[]) => Promise<string[]>,
): Promise<number> {
  let kandidat = Math.max(1, Math.floor(mulai) || 1);
  for (let i = 0; i < MAKS_KELOMPOK; i++) {
    const daftar: string[] = [];
    const kunci = new Map<string, number>();
    for (let n = 0; n < KELOMPOK_KANDIDAT; n++) {
      const urutan = kandidat + n;
      const nomor = buat(urutan);
      daftar.push(nomor);
      kunci.set(`${embelNomor(nomor)}#${urutan}`, urutan);
    }
    const terpakai = await ada(daftar);
    // Hanya kandidat yang memang cocok dengan salah satu nomor di file dihitung.
    // Kalau kolom penyaringnya tidak dikenali, file mengembalikan baris apa saja
    // dan itu tidak boleh dibaca sebagai "nomor ini sudah dipakai".
    for (const nomor of terpakai) {
      kunci.delete(`${embelNomor(String(nomor))}#${urutanTerakhir(nomor)}`);
    }
    for (const urutan of kunci.values()) return urutan;
    kandidat += KELOMPOK_KANDIDAT;
  }
  return kandidat;
}

/**
 * Saran nomor berikutnya. `buat` menerima urutan (1, 2, ...) dan yang mencetak
 * bentuk nomornya, supaya setiap halaman tetap memakai formatnya sendiri.
 * Tanpa database (mode browser) hanya array di memori yang bisa dibaca.
 */
export async function nomorBerikut(
  collection: string,
  field: string,
  rows: any[] | undefined,
  buat: (urutan: number) => string,
): Promise<string> {
  let tertinggi = urutanTertinggi(rows, field);
  const hasil = await dbQuery({ collection, sort: field, desc: true, limit: 1 });
  if (hasil && hasil.rows.length > 0) {
    const n = urutanTerakhir(hasil.rows[0][field]);
    if (n > tertinggi) tertinggi = n;
  }

  // Tetap diperiksa walau tertingginya 0: collection kosong memberi nomor pertama,
  // dan file lama bisa berisi nomor yang tidak berakhir dengan angka.
  const bebas = await cariUrutanBebas(tertinggi + 1, buat, async daftar => {
    const cek = await dbQuery({ collection, where: { [field]: daftar }, limit: daftar.length });
    if (!cek) return [];
    return cek.rows.map(r => String(r ? r[field] : '')).filter(v => v !== '');
  });
  return buat(bebas);
}

/** Versi sinkron untuk keadaan awal form, sebelum ada aksi yang boleh menunggu. */
export function nomorSementara(rows: any[] | undefined, field: string, buat: (urutan: number) => string): string {
  return buat(urutanTertinggi(rows, field) + 1);
}
