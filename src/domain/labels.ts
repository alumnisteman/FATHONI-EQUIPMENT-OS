// src/domain/labels.ts
// Label layar untuk kode status dan kode tipe yang tersimpan di record.
//
// Kenapa satu file: kartu riwayat di halaman Unit menampilkan Work Order dan
// kontrak sewa yang sama dengan menu Servis dan menu Rental. Kalau setiap halaman
// menyalin daftar labelnya sendiri, satu perubahan kata membuat dua menu
// menyebut record yang sama dengan istilah berbeda — dan harness yang menguji
// teks layar ikut salah tuduh.
//
// Semua lookup diberi pembanding `?.` di sisi pemanggil dan jatuh balik ke kode
// aslinya: nilai asing dari file lama tidak boleh meruntuhkan baris tabel.

export const SERVICE_TYPE_LABEL: Record<string, string> = {
  PERIODIC_250H: 'Servis Berkala 250 Jam',
  PERIODIC_500H: 'Servis Berkala 500 Jam',
  PERIODIC_1000H: 'Servis Berkala 1000 Jam',
  CORRECTIVE: 'Perbaikan Korektif',
  BREAKDOWN: 'Perbaikan Breakdown (Darurat)',
  OVERHAUL: 'Major Overhaul Mesin / Pompa',
  INSPECTION: 'Inspeksi Pra-Kirim (PDI)',
  PREVENTIVE: 'Servis Pencegahan',
};

export const STATUS_WO: Record<string, { label: string; badge: string }> = {
  OPEN: { label: 'Menunggu Teknisi', badge: 'badge-muted' },
  IN_PROGRESS: { label: 'Sedang Dikerjakan', badge: 'badge-info' },
  WAITING_PARTS: { label: 'Menunggu Sparepart', badge: 'badge-warning' },
  COMPLETED: { label: 'Servis Selesai', badge: 'badge-success' },
  CANCELLED: { label: 'Dibatalkan', badge: 'badge-muted' },
};

export const STATUS_SEWA: Record<string, { label: string; badge: string }> = {
  ACTIVE: { label: 'Sedang Berjalan', badge: 'badge-success' },
  PENDING: { label: 'Menunggu Mobilisasi', badge: 'badge-warning' },
  COMPLETED: { label: 'Selesai / Demobilisasi', badge: 'badge-muted' },
  EXTENDED: { label: 'Diperpanjang', badge: 'badge-info' },
  CANCELLED: { label: 'Dibatalkan', badge: 'badge-muted' },
};
