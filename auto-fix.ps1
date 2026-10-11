# auto-fix.ps1 — PREFLIGHT FATHONI EQUIPMENT OS
#
# Versi 2 (Oktober 2026). Versi 1 skrip ini merusak: ia menghapus dist/,
# dist-electron/, dist-electron-portable/, node_modules/, package-lock.json,
# menjalankan `npm cache clean --force`, lalu `git reset` + `git clean -fd` —
# semuanya otomatis tanpa diminta. Empat akibat nyata:
#   * `git clean -fd` menghapus berkas tak-terlacak, termasuk dist-app/ (paket
#     yang sedang diuji) dan tmp-harness/ (log rantai regresi) = bukti rilis hilang.
#   * package-lock.json adalah satu-satunya tempat versi modul native
#     (better-sqlite3) dikunci; menghapusnya membuat `npm install` memilih ulang
#     dan bisa mengambil build untuk ABI Node, bukan Electron -> aplikasi mati
#     saat start-up dengan MODULE_VERSION salah.
#   * `npm cache clean --force` menghapus cache prebuild electron, jadi build
#     berikutnya butuh jaringan (mesin ini sering offline).
#   * menghapus dist*/ lalu `npm run build` di mesin 3,8 GB tanpa batas heap bisa
#     membuat Vite mati di tengah.
# Sekarang skrip ini MEMERIKSA dan melapor. Tidak ada satu pun penghancuran
# yang berjalan tanpa -Apply, dan -Apply hanya regenerasi berkas yang memang
# dihasilkan ulang oleh npm script.
#
# Pemakaian:
#   powershell -NoProfile -ExecutionPolicy Bypass -File auto-fix.ps1          # periksa saja
#   powershell -NoProfile -ExecutionPolicy Bypass -File auto-fix.ps1 -Apply   # periksa + perbaiki yang aman

[CmdletBinding()]
param(
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$ROOT = $PSScriptRoot
$HASIL = @()

function Tambah-Hasil([string]$Nama, [string]$Status, [string]$Pesan) {
  $script:HASIL += [pscustomobject]@{ Nama = $Nama; Status = $Status; Pesan = $Pesan }
  $warna = 'Gray'
  if ($Status -eq 'OK') { $warna = 'Green' }
  elseif ($Status -eq 'WARN') { $warna = 'Yellow' }
  elseif ($Status -eq 'FAIL') { $warna = 'Red' }
  Write-Host ("  [{0}] {1} — {2}" -f $Status, $Nama, $Pesan) -ForegroundColor $warna
}

function Tulis-Judul([string]$Teks) {
  Write-Host ''
  Write-Host $Teks -ForegroundColor Cyan
}

Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '  FATHONI EQUIPMENT OS — PREFLIGHT' -ForegroundColor Cyan
Write-Host ("  mode: " + $(if ($Apply) { 'PERIKSA + PERBAIKAN AMAN' } else { 'PERIKSA SAJA (tidak menulis apa pun)' })) -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan

# ── 1. perkakas dasar ───────────────────────────────────────────────────────
Tulis-Judul '[1/6] Perkakas'
try {
  $nodeVer = (node --version)
  $npmVer = (npm --version)
  Tambah-Hasil 'node + npm' 'OK' ("node $nodeVer, npm $npmVer")
} catch {
  Tambah-Hasil 'node + npm' 'FAIL' 'node/npm tidak ada di PATH; tidak ada pemeriksaan lanjutan yang berguna'
  Write-Host ''
  Write-Host '  Preflight berhenti di sini.' -ForegroundColor Red
  exit 1
}

$pkg = Get-Content (Join-Path $ROOT 'package.json') -Raw | ConvertFrom-Json
$lockPath = Join-Path $ROOT 'package-lock.json'
if (Test-Path $lockPath) {
  # ConvertFrom-Json Windows PowerShell 5.1 tidak bisa membaca lock v3 (kunci
  # "packages" berisi string kosong), jadi nama dibaca dari baris pertamanya.
  $lockNama = $null
  $lockAwal = (Get-Content $lockPath -TotalCount 12) -join "`n"
  if ($lockAwal -match '"name"\s*:\s*"([^"]+)"') { $lockNama = $Matches[1] }
  if ($lockNama -eq $pkg.name) {
    Tambah-Hasil 'package-lock.json' 'OK' ("kunci dependensi ada dan namanya sinkron ($($pkg.name))")
  } elseif (-not $lockNama) {
    Tambah-Hasil 'package-lock.json' 'WARN' 'file ada tetapi nama tidak terbaca; pastikan lock v3 milik proyek ini'
  } else {
    Tambah-Hasil 'package-lock.json' 'FAIL' ("lock nama=$lockNama, package.json nama=$($pkg.name) — jangan hapus lock; pulihkan berkasnya dari git")
  }
} else {
  Tambah-Hasil 'package-lock.json' 'FAIL' 'hilang. VERSI better-sqlite3 + electron tidak terkunci lagi; jangan jalankan npm install buta, pulihkan dari git dulu'
}

$npmrc = Join-Path $ROOT '.npmrc'
$nodeModules = Join-Path $ROOT 'node_modules'
if (-not (Test-Path $nodeModules)) {
  Tambah-Hasil 'node_modules' 'FAIL' 'belum ada; jalankan npm install sekali, bukan siklus hapus-install berulang'
} else {
  Tambah-Hasil 'node_modules' 'OK' 'ada'
}

# ── 2. electron + modul native (ABI) ────────────────────────────────────────
# Ini penyebab kegagalan yang paling sering disalahartikan sebagai "aplikasi
# korup": better-sqlite3 ter-build untuk ABI Node, padahal yang memakainya
# Electron. Kelihatannya semua hijau saat install, aplikasi mati saat dibuka.
Tulis-Judul '[2/6] Electron dan modul native'
$elePkgPath = Join-Path $nodeModules 'electron\package.json'
$eleVer = $null
if (Test-Path $elePkgPath) {
  $eleVer = (Get-Content $elePkgPath -Raw | ConvertFrom-Json).version
  Tambah-Hasil 'electron terpasang' 'OK' "versi $eleVer"
} else {
  Tambah-Hasil 'electron terpasang' 'FAIL' 'node_modules/electron tidak ada'
}

if (Test-Path $npmrc) {
  $npmrcTeks = Get-Content $npmrc -Raw
  $target = $null
  if ($npmrcTeks -match '(?m)^target\s*=\s*(\S+)') { $target = $Matches[1] }
  $runtime = $null
  if ($npmrcTeks -match '(?m)^runtime\s*=\s*(\S+)') { $runtime = $Matches[1] }
  if ($runtime -ne 'electron') {
    Tambah-Hasil '.npmrc' 'FAIL' "runtime=$runtime; harus electron, kalau tidak npm membangun untuk ABI Node"
  } elseif ($eleVer -and $target -and $target -ne $eleVer) {
    Tambah-Hasil '.npmrc' 'FAIL' "target=$target tetapi electron terpasang $eleVer — prebuild yang diunduh bisa salah ABI; samakan lalu npm run rebuild:native"
  } else {
    Tambah-Hasil '.npmrc' 'OK' "runtime=electron, target=$target"
  }
} else {
  Tambah-Hasil '.npmrc' 'FAIL' 'hilang; tanpa berkas ini npm memakai toolchain node-gyp yang tidak ada di mesin ini'
}

# Muat better-sqlite3 di dalam Electron sungguhan, lewat skrip sementara di TEMP.
# Tidak ada window, tidak ada profil, tidak menyentuh data pengguna.
$probe = Join-Path ([System.IO.Path]::GetTempPath()) 'fathoni-preflight-native.js'
$probeSrc = @'
const { app } = require('electron');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  let out = { abi: process.versions.modules, sqlite: 'ok', err: '' };
  try { const db = require('__ROOT__\\node_modules\\better-sqlite3'); const d = new db(':memory:'); d.exec("select 1"); d.close(); }
  catch (e) { out.sqlite = 'gagal'; out.err = String(e && e.message || e).split('\n')[0]; }
  console.log('PREFLIGHT_JSON ' + JSON.stringify(out));
  app.exit(0);
});
'@
# Jalur modul native dibaca dari folder skrip, bukan ditulis mati di dalam probe.
$probeSrc -replace '__ROOT__', ($ROOT -replace '\\', '/') | Set-Content -Path $probe -Encoding ASCII
$eleBin = Join-Path $nodeModules 'electron\dist\electron.exe'
if (Test-Path $eleBin) {
  try {
    $probeOut = & $eleBin $probe 2>&1 | Select-String 'PREFLIGHT_JSON' | Select-Object -First 1
    if ($probeOut) {
      $info = ($probeOut.ToString() -split 'PREFLIGHT_JSON ',2)[1] | ConvertFrom-Json
      if ($info.sqlite -eq 'ok') {
        Tambah-Hasil 'better-sqlite3 di Electron' 'OK' ("termuat, ABI node=" + $info.abi)
      } else {
        Tambah-Hasil 'better-sqlite3 di Electron' 'FAIL' ("tidak termuat: $($info.err) — perbaikan: npm run rebuild:native")
      }
    } else {
      Tambah-Hasil 'better-sqlite3 di Electron' 'WARN' 'probe tidak mencetak hasil (elektron mungkin gagal start); periksa manual'
    }
  } catch {
    Tambah-Hasil 'better-sqlite3 di Electron' 'WARN' "probe gagal dijalankan: $($_.Exception.Message)"
  }
} else {
  Tambah-Hasil 'better-sqlite3 di Electron' 'WARN' 'electron.exe belum ada, probe dilewati'
}
Remove-Item $probe -Force -ErrorAction SilentlyContinue

# ── 3. kesegaran build dan bukti rilis ──────────────────────────────────────
Tulis-Judul '[3/6] Build, paket, dan versi'
# Waktu sumber paling akhir PER JALUR build. Satu angka gabungan untuk src/ dan
# electron/ akan menuduh dist-electron basi hanya karena sebuah komentar di
# src/ berubah, dan tuduhan yang salah membuat peringatan yang benar diabaikan.
function Sumber-Terbaru([string[]]$Dirs) {
  $t = $null
  foreach ($d in $Dirs) {
    $p = Join-Path $ROOT $d
    if (-not (Test-Path $p)) { continue }
    foreach ($f in (Get-ChildItem -Path $p -Recurse -File -Include *.ts,*.tsx,*.js,*.css,*.html)) {
      if (-not $t -or $f.LastWriteTime -gt $t) { $t = $f.LastWriteTime }
    }
  }
  return $t
}
function Waktu-Berkas([string]$rel) {
  $f = Waktu-BerkasObj $rel
  if ($f) { return $f.LastWriteTime }
  return $null
}
function Waktu-BerkasObj([string]$rel) {
  $f = Join-Path $ROOT $rel
  if (Test-Path $f) { return (Get-Item $f) }
  return $null
}
$srcTerbaru = Sumber-Terbaru @('src')
$eleTerbaru = Sumber-Terbaru @('electron')
$distHtml = Waktu-Berkas 'dist\index.html'
$distMain = Waktu-Berkas 'dist-electron\main.js'
$asarObj = Waktu-BerkasObj 'dist-app\win-unpacked\resources\app.asar'
$asar = if ($asarObj) { $asarObj.LastWriteTime } else { $null }
if (-not $distHtml) {
  Tambah-Hasil 'build renderer' 'WARN' 'dist/ belum ada; jalankan npm run build'
} elseif ($srcTerbaru -and $distHtml -lt $srcTerbaru) {
  Tambah-Hasil 'build renderer' 'WARN' ("dist/ lebih tua dari sumber terbaru di src/; rantai yang dijalankan sekarang menguji kode lama — npm run build")
} else {
  Tambah-Hasil 'build renderer' 'OK' 'dist/ lebih baru dari seluruh src/'
}
if (-not $distMain) {
  Tambah-Hasil 'build electron' 'WARN' 'dist-electron/main.js belum ada; jalankan npm run build:electron'
} elseif ($eleTerbaru -and $distMain -lt $eleTerbaru) {
  Tambah-Hasil 'build electron' 'WARN' ("dist-electron/ lebih tua dari sumber terbaru di electron/ ($eleTerbaru); jalankan npm run build:electron")
} else {
  Tambah-Hasil 'build electron' 'OK' 'dist-electron/ lebih baru dari seluruh electron/'
}

# Aturan bukti rilis: yang dinyatakan lulus adalah PAKET, bukan jalur dev.
# Waktu berkas hanya dugaan: sumber yang lebih baru dari app.asar belum tentu
# mengubah isi paket (perubahan komentar tidak masuk bundel yang sudah
# diminify). Karena itu ini peringatan, bukan vonis — yang memvonis adalah
# langkah 'paket' di rantai (isi asar dibandingkan dengan hasil build), dan
# jalannya kalau isinya memang beda: npm run make:installer lalu rantai penuh.
if (-not $asarObj) {
  Tambah-Hasil 'paket vs sumber' 'FAIL' 'dist-app/win-unpacked/resources/app.asar tidak ada — tidak ada paket untuk diuji; npm run make:installer'
} else {
  $paketBasi = @($srcTerbaru, $eleTerbaru) | Where-Object { $_ -and $asar -lt $_ }
  if ($paketBasi.Count -gt 0) {
    Tambah-Hasil 'paket vs sumber' 'WARN' ("app.asar ($asar) lebih tua dari sumber terbaru; belum tentu isinya beda, tapi bukti rilis harus dibuktikan ulang lewat langkah 'paket' di rantai (sh tests/harness/regressi.sh) — kalau isinya memang berubah, bangun ulang dengan npm run make:installer")
  } else {
    Tambah-Hasil 'paket vs sumber' 'OK' 'app.asar lebih baru dari seluruh sumber (bukti rilis paket ini masih berlaku)'
  }
  if ((Waktu-Berkas 'package.json') -gt $asar) {
    Tambah-Hasil 'paket vs konfigurasi' 'WARN' 'package.json berubah setelah paket dibangun; cek versi dan isi asar sebelum mengklaim lulus'
  }
  if (-not (Waktu-Berkas 'dist-app\win-unpacked\FATHONI.exe')) {
    Tambah-Hasil 'exe paket' 'FAIL' 'dist-app/win-unpacked/FATHONI.exe tidak ada; uji asap paket tidak akan berjalan'
  } else {
    Tambah-Hasil 'exe paket' 'OK' 'FATHONI.exe ada di paket'
  }
}

$setupDir = Join-Path $ROOT 'dist-installer'
if (Test-Path $setupDir) {
  $exe = @(Get-ChildItem $setupDir -Filter '*.exe' | Sort-Object LastWriteTime -Descending)
  $terbaru = $exe[0]
  $namaVersi = if ($terbaru.Name -match '(\d+\.\d+\.\d+)') { $Matches[1] } else { 'tanpa-versi' }
  if ($namaVersi -eq $pkg.version) {
    Tambah-Hasil 'installer' 'OK' ("$($terbaru.Name) cocok dengan package.json versi $($pkg.version) ($([math]::Round($terbaru.Length/1MB,1)) MiB)")
  } else {
    Tambah-Hasil 'installer' 'WARN' ("installer terbaru $($terbaru.Name) berbeda dari package.json versi $($pkg.version); yang boleh diedarkan hanya yang versinya sama")
  }
  foreach ($lama in @($exe | Where-Object { $_.Name -notlike "*$($pkg.version)*" })) {
    Tambah-Hasil 'installer lama tetap utuh' 'OK' "$($lama.Name) tidak dihapus skrip ini — pembuangan artefak adalah keputusan manual"
  }
} else {
  Tambah-Hasil 'installer' 'WARN' 'dist-installer/ belum ada'
}

# ── 4. memori dan proses yang mengganggu ────────────────────────────────────
Tulis-Judul '[4/6] Kondisi mesin'
$os = Get-CimInstance Win32_OperatingSystem
$bebasMB = [math]::Round($os.FreePhysicalMemory / 1KB)
if ($bebasMB -lt 250) {
  Tambah-Hasil 'RAM bebas' 'FAIL' ("$bebasMB MB bebas — build Vite dan Electron kemungkinan mati di tengah; tutup aplikasi lain, dan jangan jalankan dua harness paralel")
} elseif ($bebasMB -lt 500) {
  Tambah-Hasil 'RAM bebas' 'WARN' ("$bebasMB MB bebas — cukup untuk satu Electron/rantai, tapi jangan jalankan perintah berat paralel (pengukuran waktu jadi tidak valid)")
} else {
  Tambah-Hasil 'RAM bebas' 'OK' "$bebasMB MB bebas"
}
if ($env:NODE_OPTIONS -notmatch 'max-old-space-size') {
  Tambah-Hasil 'NODE_OPTIONS' 'WARN' 'batas heap tidak diset di shell ini; npm run build sudah menyematkan --max-old-space-size=2048, tapi jalur manual perlu sendiri'
} else {
  Tambah-Hasil 'NODE_OPTIONS' 'OK' $env:NODE_OPTIONS
}
$hidup = @(Get-Process -Name 'electron', 'FATHONI' -ErrorAction SilentlyContinue)
if ($hidup.Count -gt 0) {
  Tambah-Hasil 'proses Electron hidup' 'WARN' ("$($hidup.Count) proses — aplikasi memakai single-instance lock, jadi harness baru akan keluar lebih awal sebelum satu pun assertion tercetak")
} else {
  Tambah-Hasil 'proses Electron hidup' 'OK' 'tidak ada'
}

# ── 5. repository ───────────────────────────────────────────────────────────
# Sengaja HANYA membaca. Skrip ini tidak akan pernah menjalankan git reset atau
# git clean: keduanya menghapus pekerjaan yang belum ter-commit dan artefak
# uji yang tidak pernah masuk git.
Tulis-Judul '[5/6] Repository'
try {
  Push-Location $ROOT
  $porcelain = @(git status --porcelain 2>$null)
  if ($LASTEXITCODE -ne 0) {
    Tambah-Hasil 'git' 'WARN' 'status git tidak bisa dibaca (mungkin bukan repository)'
  } else {
    $belum = @($porcelain | Where-Object { $_ -like '??*' })
    $ubah = @($porcelain | Where-Object { $_ -notlike '??*' })
    Tambah-Hasil 'git (hanya baca)' $(if ($ubah.Count -eq 0) { 'OK' } else { 'WARN' }) ("$($ubah.Count) berkas berubah, $($belum.Count) belum terlacak — commit dulu sebelum membangun paket yang dipakai sebagai bukti")
    $diffPkg = @(git diff --name-only -- package.json 2>$null)
    if ($diffPkg.Count -gt 0) {
      Tambah-Hasil 'package.json berubah' 'WARN' 'konfigurasi build + sumber versi berubah sejak commit terakhir; cocokkan dengan berkas QA sebelum packing'
    }
    $branch = (git rev-parse --abbrev-ref HEAD 2>$null)
    $head = (git log -1 --pretty='%h %s' 2>$null)
    Tambah-Hasil 'HEAD' 'OK' "branch $branch : $head"
  }
} catch {
  Tambah-Hasil 'git' 'WARN' "pemeriksaan git dilewati: $($_.Exception.Message)"
} finally {
  Pop-Location
}

# ── 6. perbaikan ────────────────────────────────────────────────────────────
Tulis-Judul '[6/6] Perbaikan'
$kotor = @($HASIL | Where-Object { $_.Status -eq 'FAIL' -or $_.Status -eq 'WARN' })
if (-not $Apply) {
  Tambah-Hasil 'perbaikan' 'OK' 'mode periksa saja — tidak ada berkas yang ditulis atau dihapus'
} else {
  # cache Vite: murni hasil build, aman dihapus, dan memang penyebab build aneh
  $viteCache = Join-Path $nodeModules '.vite'
  if (Test-Path $viteCache) {
    Remove-Item -Path $viteCache -Recurse -Force
    Tambah-Hasil 'cache Vite' 'OK' 'node_modules/.vite dibersihkan (hasil build, bukan sumber)'
  }
  $gagalNative = @($HASIL | Where-Object { $_.Nama -eq 'better-sqlite3 di Electron' -and $_.Status -eq 'FAIL' })
  if ($gagalNative.Count -gt 0) {
    Tambah-Hasil 'rebuild native' 'WARN' 'mengambil prebuild better-sqlite3 untuk ABI Electron (npm run rebuild:native)'
    Push-Location $ROOT
    npm run rebuild:native
    $kodeNative = $LASTEXITCODE
    Pop-Location
    Tambah-Hasil 'rebuild native' $(if ($kodeNative -eq 0) { 'OK' } else { 'FAIL' }) "keluar dengan kode $kodeNative; jalankan ulang preflight untuk memastikan modulnya termuat"
  }
  $basi = @($HASIL | Where-Object { $_.Nama -like 'build *' -and $_.Status -eq 'WARN' })
  if ($basi.Count -gt 0) {
    Tambah-Hasil 'regenerasi build' 'WARN' 'menjalankan npm run build lalu build:electron'
    Push-Location $ROOT
    npm run build
    $kodeBuild = $LASTEXITCODE
    npm run build:electron
    $kodeEle = $LASTEXITCODE
    Pop-Location
    Tambah-Hasil 'regenerasi build' $(if ($kodeBuild -eq 0 -and $kodeEle -eq 0) { 'OK' } else { 'FAIL' }) "build renderer=$kodeBuild electron=$kodeEle"
  }
  if ($kotor.Count -eq 0) {
    Tambah-Hasil 'perbaikan' 'OK' 'tidak ada yang perlu diperbaiki'
  }
}

# ── ringkasan ───────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '  RINGKASAN PREFLIGHT' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
foreach ($h in $HASIL) {
  Write-Host ("  {0,-5} {1}" -f $h.Status, $h.Nama)
}
$nFail = @($HASIL | Where-Object { $_.Status -eq 'FAIL' }).Count
$nWarn = @($HASIL | Where-Object { $_.Status -eq 'WARN' }).Count
Write-Host ''
Write-Host ("  FAIL={0} WARN={1} dari {2} pemeriksaan" -f $nFail, $nWarn, $HASIL.Count) -ForegroundColor $(if ($nFail) { 'Red' } elseif ($nWarn) { 'Yellow' } else { 'Green' })
Write-Host ''
Write-Host '  Yang SENGAJA tidak dilakukan skrip ini (lihat kepala berkas):' -ForegroundColor DarkGray
Write-Host '  hapus node_modules / package-lock.json / npm cache / dist* / app.asar,' -ForegroundColor DarkGray
Write-Host '  git reset, git clean, dan pembuangan artefak installer lama.' -ForegroundColor DarkGray
if ($nFail -gt 0) { Write-Host ' _PREFLIGHT GAGAL_ - ada kondisi yang membuat build/rantai tidak bisa dipercaya.' -ForegroundColor Red; exit 1 }
Write-Host '  PREFLIGHT OK' -ForegroundColor Green
exit 0
