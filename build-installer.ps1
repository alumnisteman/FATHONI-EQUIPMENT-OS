# build-installer.ps1
# Script otomatis: Build Electron + Compile Inno Setup -> FATHONI-Setup-<versi>.exe
# Versi installer selalu diambil dari package.json, tidak ditulis di sini.
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

# Langkah 1: Build React (Vite)
Write-Host "`n[1/5] Membangun React Frontend..." -ForegroundColor Yellow
& npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "GAGAL: npm run build" -ForegroundColor Red; exit 1 }
Write-Host "      Selesai." -ForegroundColor Green

# Langkah 2: Compile Electron
Write-Host "`n[2/5] Mengompilasi Electron Main Process (TypeScript)..." -ForegroundColor Yellow
& npm run build:electron
if ($LASTEXITCODE -ne 0) { Write-Host "GAGAL: npm run build:electron" -ForegroundColor Red; exit 1 }
Write-Host "      Selesai." -ForegroundColor Green

# Langkah 3: Bungkus dengan electron-builder (target dir -> win-unpacked)
# Jangan memakai dist:portable di sini: skrip itu menjalankan npm run build dan
# build:electron sekali lagi, jadi React + TypeScript terkompilasi dua kali.
Write-Host "`n[3/5] Membungkus Electron App (unpacked binary)..." -ForegroundColor Yellow
& npm run dist:dir
if ($LASTEXITCODE -ne 0) { Write-Host "GAGAL: npm run dist:dir" -ForegroundColor Red; exit 1 }
Write-Host "      Selesai." -ForegroundColor Green

# Langkah 4: Ikon + metadata merek pada FATHONI.exe. electron-builder tidak bisa
# melakukannya sendiri di mesin ini (butuh arsip winCodeSign yang berisi symlink
# macOS); lihat scripts\apply-exe-branding.cjs untuk alasannya.
Write-Host "`n[4/5] Menandai FATHONI.exe dengan ikon dan metadata merek..." -ForegroundColor Yellow
& node "$ROOT\scripts\apply-exe-branding.cjs"
if ($LASTEXITCODE -ne 0) { Write-Host "GAGAL: apply-exe-branding" -ForegroundColor Red; exit 1 }

# Langkah 5: Compile Inno Setup
Write-Host "`n[5/5] Membuat Installer dengan Inno Setup..." -ForegroundColor Yellow

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
        Write-Host ""
        # $open = Read-Host "  Buka folder dist-installer? (y/n)"
        # if ($open -eq 'y') { Start-Process explorer "$ROOT\dist-installer" }
    } else {
        Write-Host "  PERINGATAN: tidak ada FATHONI-Setup-*.exe di dist-installer" -ForegroundColor Yellow
    }
}
