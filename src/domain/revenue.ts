// src/domain/revenue.ts
// Satu sumber kebenaran untuk angka pendapatan. Dasbor dan Laporan memakai fungsi
// ini supaya keduanya tidak lagi menampilkan angka yang berbeda untuk periode sama.

export interface MonthKey {
  key: string;   // 'YYYY-MM'
  label: string; // 'Okt 26'
}

export interface RevenueRow extends MonthKey {
  rental: number;
  penjualan: number;
  service: number;
  total: number;
}

const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Kunci tanggal 'YYYY-MM-DD' dengan offset hari, dihitung dari zona waktu lokal.
 * Kolom tanggal di SQLite disimpan sebagai TEXT hasil tulisan manusia ('2026-10-10'),
 * jadi pembandingnya harus berbentuk sama dan tidak boleh berasal dari toISOString()
 * yang bergeser ke UTC.
 */
export function isoDay(offsetDays: number, endDate: Date = new Date()): string {
  const d = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function labelForMonthKey(key: string): string {
  const [year, month] = String(key).split('-');
  const idx = Number(month) - 1;
  if (!/^\d{4}$/.test(year) || !Number.isInteger(idx) || idx < 0 || idx > 11) return key;
  return `${BULAN_SINGKAT[idx]} ${year.slice(2)}`;
}

// Daftar `count` bulan terakhir, urut dari yang tertua.
export function lastMonthKeys(count: number, endDate: Date = new Date()): MonthKey[] {
  const out: MonthKey[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(endDate.getFullYear(), endDate.getMonth() - i, 1);
    const key = monthKey(d);
    out.push({ key, label: labelForMonthKey(key) });
  }
  return out;
}

function amountFor(invoices: any[], type: string): number {
  return invoices.reduce((acc, i) => acc + (i?.type === type ? Number(i.totalAmount) || 0 : 0), 0);
}

// Invoice dikelompokkan berdasarkan issueDate. Invoice tanpa tanggal yang bisa
// dibaca diabaikan agar tidak menumpuk di bulan yang salah.
export function revenueByMonth(invoices: any[], months: MonthKey[]): RevenueRow[] {
  return months.map(m => {
    const inMonth = (invoices || []).filter(i => String(i?.issueDate || '').startsWith(m.key));
    const rental = amountFor(inMonth, 'RENTAL');
    const penjualan = amountFor(inMonth, 'PENJUALAN');
    const service = amountFor(inMonth, 'SERVICE');
    return { ...m, rental, penjualan, service, total: rental + penjualan + service };
  });
}
