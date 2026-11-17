// electron/authorization.ts
// Satu-satunya tempat jawaban atas pertanyaan "akun ini boleh menulis ke collection apa".
//
// Kenapa di main process dan bukan hanya di renderer: halaman yang disembunyikan dari
// menu bukan pagar. Selama penjagaannya hanya "menu tidak ditampilkan", satu permintaan
// IPC yang dikirim dari konsol (atau dari renderer build lama) tetap bisa menulis ke
// tabel mana pun. Kanal tulis di `main.ts` karena itu menilai ulang setiap request
// terhadap peta ini, memakai sesi yang sebenarnya, bukan klaim renderer.
//
// Peta ini DAN `requiredRoles` di src/components/Layout.tsx adalah satu keputusan yang
// sama, dilihat dari dua sisi: menu yang tidak menawarkan collection pada daftar peran
// itu tidak ditampilkan, jadi aplikasi tidak pernah menawari tombol yang tahu-tahu
// ditolak saat disimpan. Kalau salah satu sisi berubah tanpa yang lain, harness
// (tests/harness/otorisasi-check.cjs) yang menemukannya.

import { SPEC_BY_NAME } from './dbSchema';
import type { AccountRole } from './auth';

/** Semua collection yang dikenal skema — SUPERADMIN dapat menulis semuanya. */
export const ALL_COLLECTIONS: string[] = Object.keys(SPEC_BY_NAME);

const MENU_SALES = ['customers', 'sales', 'rentals', 'deliveries', 'invoices', 'documents', 'units', 'brands', 'models'];
const MENU_GUDANG = ['purchases', 'suppliers', 'spareParts', 'warehouse', 'deliveries', 'documents', 'units', 'brands', 'models'];
const MENU_SERVIS = ['services', 'breakdowns', 'spareParts', 'warehouse', 'invoices', 'technicians', 'documents', 'units', 'brands', 'models'];
const MENU_KEUANGAN = ['kas', 'invoices', 'bankAccounts', 'documents'];

/**
 * Peran → collection yang boleh ditulis.
 *
 * `units` ikut di SALES/WAREHOUSE/SERVICE karena tiga menu itu menulis unit lewat
 * EFEK SAMPING aksi yang sah — penjualan menandai unit SOLD, gudang menerima PO
 * unit, servis menyelesaikan Work Order (status + HM + lastServiceHM). Tanpa itu,
 * aksi yang benar justru ditolak.
 *
 * `kas` hanya FINANCE: pembayaran yang masuk lewat halaman Faktur dicatat bagian
 * keuangan, dan pemisahan itu memang maksudnya ada peran.
 *
 * `brands` + `models` (katalog Merek & Model) ikut tiga peran yang memegang `units`:
 * katalog adalah rujukan saat sebuah unit didaftarkan — unit baru tidak bisa dibuat
 * tanpa tahu merek/modelnya — jadi peran yang menambah unit boleh menambah entri
 * katalognya. FINANCE tidak ikut, dan menunya memang tidak ditawarkan ke peran itu
 * (src/components/Layout.tsx, `/brands`).
 *
 * `approvals` tidak ada di daftar peran mana pun selain SUPERADMIN: memberi atau
 * mengubah persetujuan adalah keputusan wewenang, bukan pekerjaan harian menu.
 */
export const WRITABLE_BY_ROLE: Record<AccountRole, string[]> = {
  SUPERADMIN: ALL_COLLECTIONS,
  SALES: MENU_SALES,
  WAREHOUSE: MENU_GUDANG,
  SERVICE: MENU_SERVIS,
  FINANCE: MENU_KEUANGAN,
};

export function bolehTulis(role: unknown, collection: string): boolean {
  const daftar = WRITABLE_BY_ROLE[role as AccountRole];
  return Array.isArray(daftar) && daftar.includes(collection);
}

/** Pesan untuk renderer — menyebut peran DAN collection supaya bisa dilaporkan apa adanya. */
export function alasanTulis(role: AccountRole, collection: string): string {
  return `Akun dengan peran ${role} tidak berwenang menulis ke "${collection}". `
    + 'Catatannya harus dibuat oleh peran yang memegang menu itu, atau Super Admin.';
}
