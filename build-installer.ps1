# build-installer.ps1
# Script otomatis: Build Electron + Compile Inno Setup -> FATHONI-Setup-<versi>.exe
# Versi installer selalu diambil dari package.json, tidak ditulis di sini.
# Enam langkah berurutan. Langkah 5 dan penandatanganan installer bersifat
# opsional: hanya jalan kalau HEMS_SIGN_PFX diset, dan laporan akhir selalu
# menyebut apakah paket ini tersign atau tidak.
# Jalankan dari root folder d:\SANY dengan:
#   powershell -ExecutionPolicy Bypass -File build-installer.ps1

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot

$appVersion = (Get-Content "$ROOT\package.json" -Raw | ConvertFrom-Json).version
if (-not $appVersion) {
    Write-Host "GAGAL: versi tidak ditemukan di package.json" -ForegroundColor Red
    exit 1
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  FATHONI EQUIPMENT OS v$appVersion - Build Installer" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Penandatanganan kode bersifat OPSIONAL dan opt-in. Mesin build ini tidak punya
# sertifikat (OV/EV harus dibeli dan diverifikasi penerbitnya), karena itu skrip
# ini tidak pernah menganggap absennya HEMS_SIGN_PFX sebagai kegagalan — tapi
# juga tidak pernah diam-diam: hasil akhir selalu menyebut paket ini tersign
# atau tidak, supaya tidak ada yang menyangka exe bawaan sudah bertanda.
#   HEMS_SIGN_PFX  : path .pfx
#   HEMS_SIGN_PASS : password .pfx (atau lewat HEMS_SIGN_PASS, jangan ditulis di repo)
$signPfx = $env:HEMS_SIGN_PFX
$signPass = $env:HEMS_SIGN_PASS
$signTs = 'http://timestamp.digicert.com'
$signtool = $null
if ($signPfx) {
    $candidates = @((Get-Command signtool.exe -ErrorAction SilentlyContinue).Source)
    $candidates += Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -ExpandProperty FullName
    $signtool = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    # Kegagalan tanda tangan harus diketahui SEBELUM pekerjaan build yang memakan
    # +-15 menit, bukan sesudahnya. Diukur di mesin ini dengan sertifikat
    # self-signed di C:\tmp: `signtool sign` dengan /tr yang tidak terjangkau
    # keluar 1 dan meninggalkan exe TANPA tanda tangan, dan `verify /pa` keluar 1
    # untuk rantai yang tidak dipercaya. Build offline karena itu tetap berhenti
    # (sengaja: paket separuh bertanda lebih buruk daripada tidak ada paket), tapi
    # berhenti di sini, bukan di langkah 5 setelah semua hasil build tertelan.
    if (-not $signtool) {
        throw "HEMS_SIGN_PFX diset tapi signtool.exe tidak ditemukan (Windows Kits\10\bin\*\x64)."
    }
    if (-not (Test-Path $signPfx)) { throw "HEMS_SIGN_PFX menunjuk berkas yang tidak ada: $signPfx" }
    Write-Host "  sign AKTIF via $signtool, pfx ada, timestamp $signTs" -ForegroundColor DarkGray
}
function Sign-Exe([string]$file) {
    if (-not $signPfx) {
        Write-Host "  LEWAT sign: paket ini TIDAK ditandatangani (HEMS_SIGN_PFX tidak diset)" -ForegroundColor Yellow
        return $false
    }
    # signtool sudah diverifikasi ada di blok periksa di atas.
    # /tr bukan hiasan: tanpa timestamp, tanda tangan ikut mati pada tanggal
    # kedaluwarsa sertifikat dan paket yang sudah diedarkan tidak bisa dibuka lagi
    # dengan penjelasan. Kalau timestamp tidak terjangkau, signtool keluar 1 dan
    # berkas TINGGAL TANPA tanda tangan (terukur) - jadi jangan pernah lanjut.
    & $signtool sign /fd SHA256 /tr $signTs /td SHA256 /f "$signPfx" /p "$signPass" "$file" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "signtool GAGAL pada $file (kode $LASTEXITCODE). Penyebab tersering: timestamp $signTs tidak terjangkau (mesin build offline) atau pfx/password salah. Berkas itu masih tanpa tanda tangan - build dihentikan sengaja, paket separuh bertanda lebih buruk daripada tidak ada paket."
    }
    & $signtool verify /pa /q "$file" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "signtool verify /pa GAGAL pada ${file} - tanda tangannya menempel tapi rantainya tidak dipercaya Windows. Untuk sertifikat OV/EV resmi ini tidak boleh terjadi; kalau yang dipakai sertifikat uji self-signed, kegagalan ini benar dan paketnya jangan diedarkan."
    }
    Write-Host "  TERSIGN: $(Split-Path $file -Leaf)" -ForegroundColor Green
    return $true
}

# Langkah 1: Build React (Vite)
Write-Host "`n[1/6] Membangun React Frontend..." -ForegroundColor Yellow
& npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "GAGAL: npm run build" -ForegroundColor Red; exit 1 }
Write-Host "      Selesai." -ForegroundColor Green

# Langkah 2: Compile Electron
Write-Host "`n[2/6] Mengompilasi Electron Main Process (TypeScript)..." -ForegroundColor Yellow
& npm run build:electron
if ($LASTEXITCODE -ne 0) { Write-Host "GAGAL: npm run build:electron" -ForegroundColor Red; exit 1 }
Write-Host "      Selesai." -ForegroundColor Green

# Langkah 3: Bungkus dengan electron-builder (target dir -> win-unpacked)
# Jangan memakai dist:portable di sini: skrip itu menjalankan npm run build dan
# build:electron sekali lagi, jadi React + TypeScript terkompilasi dua kali.
Write-Host "`n[3/6] Membungkus Electron App (unpacked binary)..." -ForegroundColor Yellow
& npm run dist:dir
if ($LASTEXITCODE -ne 0) { Write-Host "GAGAL: npm run dist:dir" -ForegroundColor Red; exit 1 }
Write-Host "      Selesai." -ForegroundColor Green

# Langkah 4: Ikon + metadata merek pada FATHONI.exe. electron-builder tidak bisa
# melakukannya sendiri di mesin ini (butuh arsip winCodeSign yang berisi symlink
# macOS); lihat scripts\apply-exe-branding.cjs untuk alasannya.
Write-Host "`n[4/6] Menandai FATHONI.exe dengan ikon dan metadata merek..." -ForegroundColor Yellow
& node "$ROOT\scripts\apply-exe-branding.cjs"
if ($LASTEXITCODE -ne 0) { Write-Host "GAGAL: apply-exe-branding" -ForegroundColor Red; exit 1 }

# Langkah 5: Tanda tangani FATHONI.exe SEBELUM dibungkus installer — kalau tidak,
# installer berisi exe tanpa tanda dan SmartScreen menolaknya bahkan sebelum
# pengguna membuka aplikasinya.
Write-Host "`n[5/6] Menandatangani binary aplikasi (opsional)..." -ForegroundColor Yellow
$appExe = "$ROOT\dist-app\win-unpacked\FATHONI.exe"
$tersignApp = $false
$tersignInstaller = $false
if (Test-Path $appExe) {
    $tersignApp = Sign-Exe $appExe
} else {
    Write-Host "  LEWAT sign: $appExe tidak ada (dist:dir belum berhasil?)" -ForegroundColor Yellow
}

# Langkah 6: Compile Inno Setup
Write-Host "`n[6/6] Membuat Installer dengan Inno Setup..." -ForegroundColor Yellow

# Cari path ISCC.exe secara otomatis
$isccPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 5\ISCC.exe",
    "C:\Program Files\Inno Setup 5\ISCC.exe"
)

$iscc = $null
foreach ($path in $isccPaths) {
    if (Test-Path $path) {
        $iscc = $path
        break
    }
}

if (-not $iscc) {
    Write-Host "" 
    Write-Host "  Inno Setup tidak ditemukan secara otomatis." -ForegroundColor Yellow
    Write-Host "  Silakan buka file installer\FATHONI-InnoSetup.iss" -ForegroundColor Yellow
    Write-Host "  dan klik Compile di Inno Setup Compiler secara manual." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Atau install Inno Setup dari: https://jrsoftware.org/isdl.php" -ForegroundColor Cyan
} else {
    Write-Host "  Menggunakan: $iscc" -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path "$ROOT\dist-installer" | Out-Null
    & $iscc "/DMyAppVersion=$appVersion" "$ROOT\installer\FATHONI-InnoSetup.iss"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "GAGAL: Inno Setup compilation error" -ForegroundColor Red
        exit 1
    }
    Write-Host "      Selesai." -ForegroundColor Green
    # Installer ditandatangani SESUDAH dicompile: tanda tangan melekat pada
    # berkas, jadi menandatangani lebih dulu akan batal oleh langkah ini.
    $setupTepat = "$ROOT\dist-installer\FATHONI-Setup-$appVersion.exe"
    if (Test-Path $setupTepat) {
        $tersignInstaller = Sign-Exe $setupTepat
    } else {
        $terbaru = Get-ChildItem "$ROOT\dist-installer\FATHONI-Setup-*.exe" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($terbaru) { $tersignInstaller = Sign-Exe $terbaru.FullName }
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  BUILD SELESAI!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan

if ($iscc) {
    $installer = Get-ChildItem "$ROOT\dist-installer\FATHONI-Setup-*.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($installer) {
        $size = [math]::Round($installer.Length / 1MB, 1)
        Write-Host ""
        Write-Host "  Installer: $($installer.Name) ($size MB)" -ForegroundColor Cyan
        $status = if ($tersignApp -and $tersignInstaller) { "TERSIGN (app + installer)" }
                  elseif ($tersignApp -or $tersignInstaller) { "SEBAGIAN TERSIGN - periksa langkah 5 dan 6" }
                  else { "TIDAK TERSIGN - SmartScreen akan menanyakannya saat distribusi luas" }
        Write-Host "  Tanda tangan: $status" -ForegroundColor $(if ($tersignApp -and $tersignInstaller) { "Green" } else { "Yellow" })
        Write-Host ""
        # $open = Read-Host "  Buka folder dist-installer? (y/n)"
        # if ($open -eq 'y') { Start-Process explorer "$ROOT\dist-installer" }
    } else {
        Write-Host "  PERINGATAN: tidak ada FATHONI-Setup-*.exe di dist-installer" -ForegroundColor Yellow
    }
}
