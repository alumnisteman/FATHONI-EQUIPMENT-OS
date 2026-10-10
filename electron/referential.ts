// electron/referential.ts
// Aturan "record ini masih dipakai dokumen lain" untuk jalan hapus.
//
// Kenapa tidak dipakai FOREIGN KEY saja: tabel SQLite di aplikasi ini menyimpan
// record sebagai payload JSON plus kolom turunan, dan rujukan antar menu berjalan
// atas KUNCI BISNIS (serialNumber, invoiceNo, poNumber), bukan atas baris. Serial
// number di dalam penjualannya dibuat sebelum unitnya dimasukkan, dan satu unit
// bisa diganti serialnya sambil membawa dokumen lama. Constraint relasional tidak
// bisa menyatakan itu; yang bisa adalah aturan di bawah, dan aturan ini hanya
// membaca kolom turunan yang sudah terindeks (db.ts indexSql), jadi biayanya satu
// query indeks per aturan — bukan pemindaian seluruh file.
//
// Aturan ini sengaja TIDAK dipakai di jalur simpan collection penuh: restore dan
// impor memang menggantikan seluruh isi file, dan di situ "baris hilang" adalah
// maksud pengguna. Yang dijaga di sini hanya satu tindakan: menghapus satu record
// sambil meninggalkan dokumen yang menyebutnya.

import type Database from 'better-sqlite3';
import { SPEC_BY_NAME, isCollectionName, normalizeSearch } from './dbSchema';

export type MatchCara = 'eq' | 'prefix' | 'contains';

export interface ReferenceRule {
  /** Collection anak tempat rujukan dicari. */
  child: string;
  /** Kolom turunan anak (harus ada di COLLECTION_SPECS, tidak boleh string bebas). */
  column: string;
  /** Field record induk yang menjadi kunci rujukan (salah satu dari ini atau parentFields). */
  parentField?: string;
  /** Label anak untuk pesan pengguna. */
  label: string;
  /** Kolom turunan anak yang ditampilkan sebagai contoh nomor dokumen. */
  show: string;
  /** Cara membandingkan; default persamaan persis. */
  match?: MatchCara;
  /** Ditambah di depan kunci sebelum dibandingkan (mis. 'GR-' pada trxNo). */
  keyPrefix?: string;
  /** Syarat tambahan pada baris anak, mis. sourceType invoice. */
  where?: { column: string; eq: string };
  /** Beberapa kunci induk sekaligus (mis. nama dan sku suku cadang). */
  parentFields?: string[];
}

/**
 * Daftar rujukannya. Kolom dan tabel diambil dari COLLECTION_SPECS, dan
 * findReferences menolak aturan yang kolomnya tidak ada di sana — jadi tidak ada
 * satu pun string di file ini yang bisa menjadi identifier SQL yang liar.
 */
export const REFERENCE_RULES: Record<string, ReferenceRule[]> = {
  units: [
    { child: 'sales', column: 'serialNumber', parentField: 'serialNumber', label: 'Pesanan Penjualan', show: 'orderNo' },
    { child: 'rentals', column: 'serialNumber', parentField: 'serialNumber', label: 'Kontrak Rental', show: 'contractNo' },
    { child: 'services', column: 'serialNumber', parentField: 'serialNumber', label: 'Work Order Servis', show: 'woNumber' },
    { child: 'deliveries', column: 'serialNumber', parentField: 'serialNumber', label: 'Surat Jalan', show: 'doNumber' },
    { child: 'breakdowns', column: 'unitSerialNumber', parentField: 'serialNumber', label: 'Laporan Kerusakan', show: 'breakdownNumber' },
  ],
  customers: [
    { child: 'sales', column: 'customerName', parentField: 'name', label: 'Pesanan Penjualan', show: 'orderNo' },
    { child: 'rentals', column: 'customerName', parentField: 'name', label: 'Kontrak Rental', show: 'contractNo' },
    { child: 'invoices', column: 'customerName', parentField: 'name', label: 'Invoice', show: 'invoiceNo' },
    { child: 'deliveries', column: 'customerName', parentField: 'name', label: 'Surat Jalan', show: 'doNumber' },
  ],
  suppliers: [
    { child: 'purchases', column: 'supplierName', parentField: 'name', label: 'Purchase Order', show: 'poNumber' },
  ],
  spareParts: [
    {
      child: 'warehouse', column: 'itemDescription', parentFields: ['name', 'sku'],
      label: 'Mutasi Gudang', show: 'trxNo', match: 'contains',
    },
  ],
  invoices: [
    // Kas mencatat pembayaran sebagai "INV-2026-001 · Bayar 5.000.000", jadi
    // nomornya selalu di awal string referensi.
    { child: 'kas', column: 'referensi', parentField: 'invoiceNo', label: 'Mutasi Kas', show: 'tanggal', match: 'prefix' },
  ],
  sales: [
    { child: 'deliveries', column: 'salesOrderRef', parentField: 'orderNo', label: 'Surat Jalan', show: 'doNumber' },
    {
      child: 'invoices', column: 'sourceNumber', parentField: 'orderNo', label: 'Invoice', show: 'invoiceNo',
      where: { column: 'sourceType', eq: 'SALES' },
    },
    { child: 'kas', column: 'referensi', parentField: 'orderNo', label: 'Mutasi Kas', show: 'tanggal' },
  ],
  rentals: [
    {
      child: 'invoices', column: 'sourceNumber', parentField: 'contractNo', label: 'Invoice', show: 'invoiceNo',
      where: { column: 'sourceType', eq: 'RENTAL' },
    },
    { child: 'kas', column: 'referensi', parentField: 'contractNo', label: 'Mutasi Kas', show: 'tanggal' },
  ],
  services: [
    {
      child: 'invoices', column: 'sourceNumber', parentField: 'woNumber', label: 'Invoice', show: 'invoiceNo',
      where: { column: 'sourceType', eq: 'SERVICE' },
    },
    // Pemakaian suku cadang mencatat mutasi GI-<nomor WO>.
    { child: 'warehouse', column: 'trxNo', parentField: 'woNumber', label: 'Mutasi Gudang', show: 'trxNo', match: 'prefix', keyPrefix: 'GI-' },
  ],
  purchases: [
    { child: 'warehouse', column: 'trxNo', parentField: 'poNumber', label: 'Mutasi Gudang', show: 'trxNo', match: 'prefix', keyPrefix: 'GR-' },
    { child: 'kas', column: 'referensi', parentField: 'poNumber', label: 'Mutasi Kas', show: 'tanggal' },
  ],
  bankAccounts: [
    // Kas menyimpan rekening sebagai label gabungan 'BCA - 1234567890' (lihat
    // REKENING_LIST di Finance/Invoices), dan data lama ada yang hanya menulisi
    // nama banknya. Contains pada kedua bagian menjangkau dua bentuk itu.
    {
      child: 'kas', column: 'rekening', parentFields: ['namaBank', 'nomorRekening'],
      label: 'Mutasi Kas', show: 'tanggal', match: 'contains',
    },
  ],
};

export interface ReferenceHit {
  collection: string;
  label: string;
  jumlah: number;
  contoh: string[];
}

export interface ReferenceReport {
  blocked: boolean;
  hits: ReferenceHit[];
  /** Terisi bila pemeriksaan tidak bisa selesai — pemanggil harus menahan hapus. */
  error?: string;
}

const IDENT = /^[a-z][a-z0-9_]*$/i;

/**
 * Kunci sepanjang ini dianggap cukup khas untuk dicari di blob pencarian. Di bawah
 * itu ("PT X", "ABC") terlalu mudah terselip di kolom lain dan akan menolak hapus
 * yang sebenarnya aman.
 */
const PANJANG_TOKEN_MIN = 6;

/** Kolom turunan yang benar-benar ada di tabel — penjaga agar aturan tidak salah tulis. */
function hasColumn(collection: string, column: string): boolean {
  const spec = SPEC_BY_NAME[collection];
  return !!spec && (column === 'id' || spec.columns.some(c => c.col === column));
}

/** Nilai kunci rujukan dari satu record induk; string kosong berarti tidak bisa dirujuk. */
function parentKeys(spec: ReferenceRule, row: any): string[] {
  const fields = (spec.parentFields && spec.parentFields.length > 0)
    ? spec.parentFields
    : (spec.parentField ? [spec.parentField] : []);
  const out: string[] = [];
  for (const f of fields) {
    const v = String(row && row[f] !== undefined && row[f] !== null ? row[f] : '').trim();
    if (v) out.push((spec.keyPrefix || '') + v);
  }
  return out;
}

/** Karakter liar LIKE dijinakkan supaya "INV_10" tidak cocok dengan "INVX10". */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, c => '\\' + c);
}

function tableOfSafe(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Nama tabel tidak diizinkan: ${name}`);
  return `"${name}"`;
}

/**
 * Cari dokumen yang masih menyebut satu record.
 * `id` adalah id aplikasi (kolom "id" bertabel, terindeks ix_<tabel>_id).
 */
export function findReferences(handle: Database, collection: unknown, id: unknown): ReferenceReport {
  if (!isCollectionName(collection)) return { blocked: false, hits: [], error: 'Collection tidak dikenal' };
  const rules = REFERENCE_RULES[collection];
  if (!rules || rules.length === 0) return { blocked: false, hits: [] };
  const kunci = id === undefined || id === null ? '' : String(id);
  if (!kunci) return { blocked: false, hits: [], error: 'Identitas record tidak ada' };

  // Satu id bisa mempunyai lebih dari satu baris (data warisan dengan id ganda).
  // Semuanya ikut diperiksa supaya hapus tidak lolos karena baris keduanya yang
  // kebetulan tidak dirujuk.
  const parents = handle.prepare(`SELECT payload FROM ${tableOfSafe(collection)} WHERE "id" = ? LIMIT 20`).all(kunci) as any[];
  if (parents.length === 0) return { blocked: false, hits: [] };

  const hits: ReferenceHit[] = [];
  for (const rule of rules) {
    if (!isCollectionName(rule.child) || !hasColumn(rule.child, rule.column) || !hasColumn(rule.child, rule.show)) {
      return { blocked: false, hits: [], error: `Aturan rujukan ${rule.child}.${rule.column} tidak valid` };
    }
    const values = new Set<string>();
    for (const p of parents) {
      let row: any;
      try { row = JSON.parse(p.payload); } catch { continue; }
      parentKeys(rule, row).forEach(v => values.add(v));
    }
    if (values.size === 0) continue;

    const tabel = tableOfSafe(rule.child);
    const kolomKunci = rule.column === 'id' ? '"id"' : `"${rule.column}"`;
    const kolomTampil = rule.show === 'id' ? '"id"' : `"${rule.show}"`;
    // LIKE tidak peka huruf untuk ASCII, persamaan '=' sensitif — karena itu
    // aturan 'eq' masih bisa kehilangan rujukan, lihat fallback blob di bawah.
    const like = rule.match ? " LIKE ? ESCAPE '\\'" : ' = ?';

    const kunciSql: string[] = [];
    const kunciParams: unknown[] = [];
    const pembatas = new Set<string>();
    for (const v of values) {
      const bound = rule.match === 'prefix' ? escapeLike(v) + '%'
        : rule.match === 'contains' ? '%' + escapeLike(v) + '%'
        : v;
      if (pembatas.has(bound)) continue;
      pembatas.add(bound);
      kunciSql.push(`${kolomKunci}${like}`);
      kunciParams.push(bound);
    }

    let indukSql = '';
    const indukParams: unknown[] = [];
    if (rule.where) {
      if (!hasColumn(rule.child, rule.where.column)) {
        return { blocked: false, hits: [], error: `Aturan rujukan ${rule.child}.${rule.where.column} tidak valid` };
      }
      indukSql = ` AND "${rule.where.column}" = ?`;
      indukParams.push(rule.where.eq);
    }

    const hit = (kunciWhere: string, paramsKunci: unknown[]): ReferenceHit | null => {
      // Tanda kurung wajib: AND punya prioritas lebih tinggi daripada OR, jadi
      // "a = ? OR b = ? AND sourceType = ?" tanpa kurung akan membaca
      // "a = ? OR (b = ? AND sourceType = ?)" dan kunci pertama lolos dari syarat.
      const where = `(${kunciWhere})${indukSql}`;
      const semua = paramsKunci.concat(indukParams);
      const jumlah = Number((handle.prepare(
        `SELECT COUNT(*) AS c FROM ${tabel} WHERE ${where}`
      ).get(...semua) as any).c);
      if (!jumlah) return null;
      const contoh = (handle.prepare(
        `SELECT DISTINCT ${kolomTampil} AS v FROM ${tabel} WHERE ${where} LIMIT 4`
      ).all(...semua) as any[]).map(r => String(r.v));
      return { collection: rule.child, label: rule.label, jumlah, contoh };
    };

    let ditemukan = hit(kunciSql.join(' OR '), kunciParams);

    // Kunci bisnis ditulis tangan di menu yang berbeda, jadi 'sy215c 9' di dalam
    // Work Order tidak pernah sama persis dengan 'SY215C-9' di Unit — padahal
    // aplikasi sendiri membandingkan serial dengan toLowerCase() (completeService
    // di dataStore). Blob pencarian sudah menyimpan kedua bentuk dalam
    // normalizeSearch, maka kalau perbandingan persis tidak menemukan apa pun kita
    // baca blob itu. LIKE pada blob tidak memakai indeks, tapi ini satu tindakan
    // hapus yang ditunggu pengguna, bukan jalur render.
    if (!ditemukan) {
      const token = [...values].map(v => normalizeSearch(v)).filter(t => t.length >= PANJANG_TOKEN_MIN);
      if (token.length > 0) {
        ditemukan = hit(token.map(() => '"search" LIKE ?').join(' OR '), token.map(t => `%${escapeLike(t)}%`));
      }
    }
    if (ditemukan) hits.push(ditemukan);
  }

  return { blocked: hits.length > 0, hits };
}
