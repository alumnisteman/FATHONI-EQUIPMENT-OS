// src/utils/searchMatch.ts
// Pencarian daftar di seluruh aplikasi: SETIAP kata yang diketik harus muncul
// di SALAH SATU kolom. Sebelumnya seluruh kalimat dibandingkan per kolom,
// sehingga "SANY SY215C" tidak pernah cocok — tidak ada satu kolom pun yang
// memuat kedua kata itu.

/** Cocokkan record: setiap kata di query harus ada di salah satu kolom. */
export function matchesQuery(
  fields: Array<string | number | null | undefined>,
  query: string
): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;

  // Setiap kolom dinormalisasi sendiri-sendiri, lalu digabung dengan spasi,
  // supaya satu kata tidak kebetulan terbentuk dari gabungan dua kolom.
  const haystack = fields
    .map(field => (field === null || field === undefined ? '' : normalize(String(field))))
    .filter(Boolean)
    .join(' ');

  return tokens.every(token => haystack.includes(token));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

function tokenize(query: string): string[] {
  return query
    .split(/[\s,;]+/)
    .map(normalize)
    .filter(Boolean);
}
