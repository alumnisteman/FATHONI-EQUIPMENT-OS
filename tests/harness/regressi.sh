#!/bin/sh
# tests/harness/regressi.sh
# Rantai regresi lengkap: limabelas harness berjalan BERURUTAN, ditambah satu
# audit dependensi. Urutan bukan hiasan — mesin ini hanya 3,8 GB RAM, dua
# harness Electron paralel langsung membuat yang kedua macet di tengah layar.
# Setiap harness electron membuka profil baru (HEMS_DATA_DIR dibersihkan lebih
# dulu) karena marker migrasi hems_data_migration_v1 hanya berlaku sekali per
# profil. Harness bertenaga node (migration, unit, store, backup) tidak butuh
# profil dan tidak memakan RAM Electron.
#
# Langkah terakhir (paket) menguji FATHONI.exe HASIL PAKET, jadi ia butuh
# `npm run make:installer` atau `npm run dist:dir` lebih dulu; tanpa paket harness
# itu mencetak LEWAT dan rantai tetap hijau. Profil uji dibuat di sandbox sendiri
# (--user-data-dir), sehingga rantai tidak pernah menyentuh data pengguna nyata.
#
# Hasil tiap harness dibaca dari baris "SELESAI kode=N" yang dicetak harness itu
# sendiri (tests/harness/selesai.cjs), bukan dari kode keluar proses: rantai ini
# pernah ditandai rusak karena `Segmentation fault` (139) yang muncul TEPAT
# SETELAH semua assertion tercetak lulus. Sejak harness menutup koneksi SQLite
# lebih dulu, 24 keluar proses sengaja (12 dengan koneksi ditutup, 12 dibiarkan
# terbuka) dan 8 gui-check penuh keluar bersih — jadi yang tersisa hanya lapisan
# di antara rantai dan Electron: `npx`. Lapisan itu adalah proses node npm yang
# menunggu electron.exe, dan ia menambah satu proses ~60 MB di mesin 3,8 GB ini
# sekaligus satu tempat baru untuk mati tidak bersih. Karena itu rantai memanggil
# electron.exe langsung: kode keluar yang sekarang selalu milik Electron, dan
# langkah yang tidak bersih tinggal dituduh ke satu suspects saja.
#
# Jalankan dari folder proyek setelah `npm run build && npm run build:electron`:
#   sh tests/harness/regressi.sh
# Hasil lengkap tiap harness tertulis di D:/SANY/tmp-harness/logs/<nama>.log.

set -u
cd "$(dirname "$0")/../.." || exit 9
LOG=D:/SANY/tmp-harness/logs
mkdir -p "$LOG" /d/SANY/tmp-harness

# electron.exe dipakai langsung, bukan lewat npx (lihat catatan di atas).
ELEKTRON=node_modules/electron/dist/electron.exe
if [ ! -f "$ELEKTRON" ]; then
  echo "RAMBU: $ELEKTRON tidak ada — jalankan npm install lebih dulu, rantai tidak dijalankan."
  exit 8
fi


jalan() {
  nama=$1; shift
  echo "=== MULAI $nama"
  "$@" > "$LOG/$nama.log" 2>&1
  kode=$?
  baris=$(grep -E 'lulus, [0-9]+ gagal' "$LOG/$nama.log" | tail -1)
  gagal=$(grep -c '^FAIL' "$LOG/$nama.log")
  # Penanda dari harness sendiri (tests/harness/selesai.cjs) lebih dipercaya
  # daripada kode keluar proses: rantai ini pernah ditandai rusak oleh
  # Segmentation fault (139) yang keluar TEPAT SETELAH semua assertion tercetak
  # lulus. Harness tanpa penanda (jalur node murni) tetap dinilai dari kode keluar.
  tutup=$(grep -E '^SELESAI kode=[0-9]+' "$LOG/$nama.log" | tail -1)
  if [ -n "$tutup" ]; then
    hasil=${tutup##*kode=}
    sumber=penanda
  else
    hasil=$kode
    sumber=kode-keluar
  fi
  echo "--- $nama exit=$kode nilai=$hasil($sumber) FAIL=$gagal ${baris:-(tidak ada ringkasan)}"
  TOTAL=$((TOTAL + 1))
  if [ "$hasil" != "0" ] || [ "$gagal" -ne 0 ]; then
    RUSAK="$RUSAK $nama"
  elif [ "$kode" -ne 0 ]; then
    # Uji lulus tapi proses induk keluar tidak bersih. Tidak membuat rantai
    # dianggap rusak, tapi harus tetap terlihat di laporan.
    KOTOR="$KOTOR $nama(exit=$kode)"
  fi
}

# Audit dependensi runtime bukan harness: dia butuh registry. Keluar npm audit
# ada dua macam kegagalan yang harus dibedakan — "ada kerentanan" (kode keluar
# 1, JSON-nya tetap lengkap) dan "tidak bisa menghubungi registry" (JSON tidak
# terbentuk). Yang kedua tidak boleh menjadikan rantai regresi dianggap rusak,
# karena aplikasi desktop ini sering dibangun di mesin tanpa jaringan; tapi juga
# tidak boleh dilaporkan seolah-olah sudah periksa.
audit() {
  echo "=== MULAI audit"
  timeout 120 npm audit --json --omit=dev > "$LOG/audit.json" 2>"$LOG/audit.err"
  ringkas=$(node -e '
    const fs = require("fs");
    let j = null;
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { }
    const meta = j && j.metadata && j.metadata.vulnerabilities;
    if (!meta) { console.log("LOMPONG: registry npm tidak terjangkau"); process.exit(0); }
    const berat = (meta.high || 0) + (meta.critical || 0);
    console.log(`tinggi/kritis=${berat} sedang=${meta.moderate || 0} rendah=${meta.low || 0} total=${meta.total || 0}`);
    process.exit(berat > 0 ? 1 : 0);
  ' "$LOG/audit.json")
  kode=$?
  echo "--- audit $ringkas"
  TOTAL=$((TOTAL + 1))
  if [ "$kode" -ne 0 ]; then RUSAK="$RUSAK audit"; fi
}

TOTAL=0
RUSAK=''
KOTOR=''

rm -rf /d/SANY/tmp-harness/r-gui /d/SANY/tmp-harness/r-flow /d/SANY/tmp-harness/r-handoff /d/SANY/tmp-harness/r-usable
jalan migration node tests/harness/migration-check.cjs
jalan unit node tests/harness/validation-check.cjs
jalan auth "$ELEKTRON" tests/harness/auth-check.cjs
jalan gui env HEMS_DATA_DIR=D:/SANY/tmp-harness/r-gui "$ELEKTRON" tests/harness/gui-check.cjs
jalan flow env HEMS_DATA_DIR=D:/SANY/tmp-harness/r-flow "$ELEKTRON" tests/harness/flow-check.cjs
jalan handoff env HEMS_DATA_DIR=D:/SANY/tmp-harness/r-handoff "$ELEKTRON" tests/harness/handoff-check.cjs
jalan usable env HEMS_DATA_DIR=D:/SANY/tmp-harness/r-usable "$ELEKTRON" tests/harness/usable-check.cjs
# cetak-check membuat folder datanya sendiri (mkdtemp) seperti db-check/compat/perf.
jalan cetak "$ELEKTRON" tests/harness/cetak-check.cjs
jalan db "$ELEKTRON" tests/harness/db-check.cjs
jalan integritas "$ELEKTRON" tests/harness/integrity-check.cjs
jalan compat "$ELEKTRON" tests/harness/compat-check.cjs
jalan perf "$ELEKTRON" tests/harness/perf-check.cjs
jalan store node tests/harness/db-store-run.cjs
jalan backup node tests/harness/db-backup-run.cjs
jalan paket node tests/harness/smoke-paket-check.cjs
audit

echo
echo "=== RANTAI SELESAI: $TOTAL harness, rusak:${RUSAK:- tidak}"
echo "    proses keluar tidak bersih:${KOTOR:- tidak}"
[ -z "$RUSAK" ] || exit 1
