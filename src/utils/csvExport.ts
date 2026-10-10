// src/utils/csvExport.ts
// Pembuatan + pengunduhan CSV dalam satu tempat. Tiga halaman ekspor sebelumnya
// merakit string sendiri, sehingga tanda kutip di nama pelanggan merusak kolom dan
// nilai berawalan =, +, -, @ bisa dieksekusi Excel saat file dibuka.

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const guarded = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',') + '\n';
}

export function buildCsv(header: string[], rows: unknown[][]): string {
  return csvRow(header) + rows.map(csvRow).join('');
}

export function downloadCsv(filename: string, content: string): void {
  // BOM agar Excel membaca UTF-8 dengan benar.
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
