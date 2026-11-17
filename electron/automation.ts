// electron/automation.ts
// Penjaga otomatisasi untuk jalur tulis db-patch.
//
// Sampai siklus ini, kontrak `duplicates` di dbSchema hanya DIBACA oleh
// integrity(): nomor dokumen kembar baru ketahuan setelah laporan integritas
// dijalankan, bukan saat barisnya ditulis. Fungsi-fungsi di sini memindahkan
// kontrak itu ke titik tulis, dengan tiga aturan yang semuanya sudah menjadi
// kebiasaan aplikasi:
//
//   1. Hanya baris BARU yang dinilai. Menyunting baris yang sudah ada selalu
//      lolos — sama seperti penjaga kas kembar — supaya profil yang terlanjur
//      memuat data kembar masih bisa diperbaiki tanpa terkunci.
//   2. Nilai kosong tidak pernah dianggap bentrok. Banyak baris warisan tidak
//      punya nomor dokumen; menolaknya membuat aplikasi tidak bisa dipakai.
//   3. Berlaku pada jalur patch (layar), bukan db-save penuh (migrasi boot dan
//      Restore) yang tugasnya memang membawa berkas lama apa adanya.
//
// Fungsi di sini murni (tidak menyentuh SQLite) supaya bisa diuji tanpa
// Electron: tests/harness/automation-check.cjs memanggil modul hasil build ini
// langsung, sedangkan tests/harness/otorisasi-check.cjs membuktikan jalur IPC
// yang sebenarnya memakainya.

export interface BarisOtomatisasi {
  id?: unknown;
  [kolom: string]: unknown;
}

const teks = (nilai: unknown): string => String(nilai ?? '').trim();
const kunci = (nilai: unknown): string => teks(nilai).toLowerCase();

/** Tanggal `YYYY-MM-DD` dari string ISO; null bila bentuknya tidak bisa dipakai. */
function tanggal(v: unknown): string | null {
  const cocok = /^(\d{4})-(\d{2})-(\d{2})/.exec(teks(v));
  return cocok ? `${cocok[1]}-${cocok[2]}-${cocok[3]}` : null;
}

const tanggalSah = (v: string | null): v is string => v !== null;

/**
 * Satu nilai dokumen hanya boleh dipakai satu baris. Dipakai untuk setiap kolom
 * di `spec.duplicates` (serialNumber, invoiceNo, poNumber, contractNo, dst).
 *
 * `lama` adalah isi tabel sebelum patch, `upsert` baris yang akan ditulis, dan
 * `removeIds` baris yang dihapus pada patch yang sama (nomornya tidak lagi
 * menahan pemakaian baru).
 */
export function dokumenKembarCacat(
  nama: string,
  kolomNomor: string[] | undefined,
  lama: unknown[],
  upsert: unknown[],
  removeIds: unknown[],
): string | null {
  if (!kolomNomor || kolomNomor.length === 0 || upsert.length === 0) return null;

  const akanHilang = new Set(removeIds.map(String));
  const idLama = new Set(lama.map(r => String((r as BarisOtomatisasi)?.id)));

  for (const kolom of kolomNomor) {
    const pemakai = new Map<string, string>();
    for (const row of lama) {
      const r = row as BarisOtomatisasi;
      if (akanHilang.has(String(r?.id))) continue;
      const v = kunci(r?.[kolom]);
      if (v !== '') pemakai.set(v, String(r.id));
    }
    for (const row of upsert) {
      const r = row as BarisOtomatisasi;
      const id = String(r?.id);
      // Sunting baris yang sudah ada: jalur perbaikan data warisan.
      if (idLama.has(id)) continue;
      const v = kunci(r?.[kolom]);
      if (v === '') continue;
      const sudah = pemakai.get(v);
      if (sudah !== undefined && sudah !== id) {
        return `Baris ${id} pada "${nama}": nomor "${teks(r?.[kolom])}" pada kolom ${kolom} `
          + `sudah dipakai baris ${sudah}. Satu dokumen hanya boleh punya satu nomor — pakai nomor yang lain.`;
      }
      pemakai.set(v, id);
    }
  }
  return null;
}

/**
 * Satu sumber transaksi hanya boleh menagih sekali. Invoice otomatis memang
 * memakai id tetap (`INV-SVC-<nomor WO>`), tetapi invoice yang dibuat manual
 * atau oleh versi aplikasi lain bisa memakai id berbeda untuk sumber yang sama.
 * Kuncinya sama dengan yang dipakai layar (sourceType + sourceNumber).
 */
export function invoiceSumberKembarCacat(
  lama: unknown[],
  upsert: unknown[],
  removeIds: unknown[],
): string | null {
  if (upsert.length === 0) return null;

  const akanHilang = new Set(removeIds.map(String));
  const idLama = new Set(lama.map(r => String((r as BarisOtomatisasi)?.id)));
  const kunciSumber = (r: BarisOtomatisasi): string => {
    const nomor = kunci(r?.sourceNumber);
    if (nomor === '') return '';
    return `${kunci(r?.sourceType).toUpperCase()}|${nomor}`;
  };

  const pemakai = new Map<string, string>();
  for (const row of lama) {
    const r = row as BarisOtomatisasi;
    if (akanHilang.has(String(r?.id))) continue;
    const k = kunciSumber(r);
    if (k !== '') pemakai.set(k, String(r.id));
  }

  for (const row of upsert) {
    const r = row as BarisOtomatisasi;
    const id = String(r?.id);
    if (idLama.has(id)) continue;
    const k = kunciSumber(r);
    if (k === '') continue;
    const sudah = pemakai.get(k);
    if (sudah !== undefined && sudah !== id) {
      return `Baris ${id} pada "invoices": sumber ${teks(r?.sourceType)} "${teks(r?.sourceNumber)}" `
        + `sudah punya invoice di baris ${sudah}. Satu sumber hanya boleh menagih sekali — `
        + 'periksa invoice yang sudah ada sebelum menyimpan.';
    }
    pemakai.set(k, id);
  }
  return null;
}

/**
 * Satu unit tidak boleh berada di dua kontrak sewa aktif pada periode yang
 * beririsan. Batas tanggal dihitung inklusif: kontrak yang berakhir pada hari
 * yang sama dengan kontrak berikutnya mulai masih dianggap bentrok, karena unit
 * belum tentu sudah kembali ke yard pada pagi hari itu.
 *
 * Baris tanpa serial atau tanpa tanggal tidak dinilai: menebak akan menolak
 * kontrak yang sah, dan itu lebih merusak daripada membiarkannya.
 */
export function sewaTumpangTindihCacat(
  lama: unknown[],
  upsert: unknown[],
  removeIds: unknown[],
): string | null {
  if (upsert.length === 0) return null;

  const akanHilang = new Set(removeIds.map(String));
  const idLama = new Set(lama.map(r => String((r as BarisOtomatisasi)?.id)));
  const aktif = (r: BarisOtomatisasi): boolean => kunci(r?.status) === 'active';

  const terpakai = lama
    .map(r => r as BarisOtomatisasi)
    .filter(r => !akanHilang.has(String(r?.id)) && aktif(r));

  for (const row of upsert) {
    const r = row as BarisOtomatisasi;
    const id = String(r?.id);
    if (idLama.has(id) || !aktif(r)) continue;
    const serial = kunci(r?.serialNumber);
    if (serial === '') continue;
    const mulai = tanggal(r?.startDate);
    const selesai = tanggal(r?.endDate);
    if (!tanggalSah(mulai) || !tanggalSah(selesai) || mulai > selesai) continue;

    const bentrok = terpakai.find(lain => {
      if (kunci(lain?.serialNumber) !== serial) return false;
      if (String(lain?.id) === id) return false;
      const lainMulai = tanggal(lain?.startDate);
      const lainSelesai = tanggal(lain?.endDate);
      if (!tanggalSah(lainMulai) || !tanggalSah(lainSelesai)) return false;
      return mulai <= lainSelesai && lainMulai <= selesai;
    });

    if (bentrok) {
      return `Baris ${id} pada "rentals": unit ${teks(r?.serialNumber)} sudah disewa kontrak `
        + `${teks(bentrok.contractNo) || String(bentrok.id)} untuk `
        + `${tanggal(bentrok.startDate)} s/d ${tanggal(bentrok.endDate)}, beririsan dengan `
        + `${mulai} s/d ${selesai}. Satu unit tidak boleh disewakan dua kali pada periode yang sama.`;
    }
    // Kontrak yang sudah lolos ikut menjadi pembanding: satu patch bisa memuat
    // dua kontrak baru, dan keduanya tidak boleh saling menumpuk.
    terpakai.push(r);
  }
  return null;
}
