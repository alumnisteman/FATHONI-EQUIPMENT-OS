// tests/harness/selesai.cjs
// Penutup proses untuk semua harness Electron.
//
// Dua alasan harness tidak boleh sekadar memanggil app.exit():
//
// 1. app.exit() melompati before-quit yang dipasang electron/main.ts, jadi
//    koneksi better-sqlite3 ikut terbuka saat Windows membongkar DLL-nya.
//    Ditutup lebih dulu membuat keluar proses sama dengan aplikasi sungguhan.
//
// 2. Kode keluar proses induk tidak bisa dipercaya sebagai hasil uji. Di mesin
//    ini pernah terlihat `Segmentation fault` (139) dari pembungkus node/npx
//    TEPAT SETELAH 72 assertion tercetak lulus — rantai regresi kemudian
//    ditandai rusak tanpa ada satu pun uji yang gagal. Karena itu harness
//    mengumumkan sendiri hasil akhirnya lewat baris "SELESAI kode=N"; rantai
//    regresi membaca baris itu, dan kode keluar proses hanya dipakai sebagai
//    peringatan bahwa ada yang tidak bersih di sekitar proses.
//
// Harness yang tidak memakai lapisan database (mis. auth-check) tetap aman:
// closeDatabase hanya menutup koneksi yang memang pernah dibuka.

module.exports = function selesai(app, kode) {
  try {
    require('../../dist-electron/db.js').closeDatabase();
  } catch {
    /* harness ini tidak menyentuh database */
  }
  console.log(`SELESAI kode=${kode}`);
  app.exit(kode);
};
