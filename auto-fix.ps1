# auto-fix.ps1
# Script PowerShell untuk memperbaiki common issues secara otomatis

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  FATHONI EQUIPMENT OS Auto-Fix Script" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

function Fix-TypeScriptErrors {
    Write-Host "`n[1/5] Memperbaiki TypeScript Errors..." -ForegroundColor Yellow
    
    # Clean build artifacts
    Write-Host "  - Membersihkan build artifacts..." -ForegroundColor Gray
    Remove-Item -Path "$ROOT\dist" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$ROOT\dist-electron" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$ROOT\dist-electron-portable" -Recurse -Force -ErrorAction SilentlyContinue
    
    # Reinstall dependencies if needed
    Write-Host "  - Memeriksa dependencies..." -ForegroundColor Gray
    if (-not (Test-Path "$ROOT\node_modules")) {
        Write-Host "  - Menginstall dependencies..." -ForegroundColor Gray
        npm install
    }
    
    # Run TypeScript check
    Write-Host "  - Menjalankan TypeScript check..." -ForegroundColor Gray
    npx tsc --noEmit
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ TypeScript errors diperbaiki" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  ⚠ Masih ada TypeScript errors" -ForegroundColor Yellow
        return $false
    }
}

function Fix-NodeModules {
    Write-Host "`n[2/5] Memperbaiki Node Modules..." -ForegroundColor Yellow
    
    # Remove node_modules and package-lock.json
    Write-Host "  - Menghapus node_modules..." -ForegroundColor Gray
    Remove-Item -Path "$ROOT\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$ROOT\package-lock.json" -Force -ErrorAction SilentlyContinue
    
    # Clear npm cache
    Write-Host "  - Membersihkan npm cache..." -ForegroundColor Gray
    npm cache clean --force
    
    # Reinstall dependencies
    Write-Host "  - Menginstall ulang dependencies..." -ForegroundColor Gray
    npm install
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Node modules diperbaiki" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  ✗ Gagal memperbaiki node modules" -ForegroundColor Red
        return $false
    }
}

function Fix-BuildCache {
    Write-Host "`n[3/5] Memperbaiki Build Cache..." -ForegroundColor Yellow
    
    # Clear Vite cache
    Write-Host "  - Membersihkan Vite cache..." -ForegroundColor Gray
    Remove-Item -Path "$ROOT\node_modules\.vite" -Recurse -Force -ErrorAction SilentlyContinue
    
    # Clear TypeScript cache
    Write-Host "  - Membersihkan TypeScript cache..." -ForegroundColor Gray
    Get-ChildItem -Path "$ROOT" -Filter "*.tsbuildinfo" -Recurse | Remove-Item -Force -ErrorAction SilentlyContinue
    
    Write-Host "  ✓ Build cache dibersihkan" -ForegroundColor Green
    return $true
}

function Fix-ElectronCache {
    Write-Host "`n[4/5] Memperbaiki Electron Cache..." -ForegroundColor Yellow
    
    # Clear Electron cache
    Write-Host "  - Membersihkan Electron cache..." -ForegroundColor Gray
    Remove-Item -Path "$ROOT\node_modules\.electron" -Recurse -Force -ErrorAction SilentlyContinue
    
    Write-Host "  ✓ Electron cache dibersihkan" -ForegroundColor Green
    return $true
}

function Fix-GitIssues {
    Write-Host "`n[5/5] Memperbaiki Git Issues..." -ForegroundColor Yellow
    
    if (-not (Test-Path "$ROOT\.git")) {
        Write-Host "  - Bukan repository Git, melewati..." -ForegroundColor Gray
        return $true
    }
    
    # Reset git index
    Write-Host "  - Reset git index..." -ForegroundColor Gray
    git reset
    
    # Clean untracked files
    Write-Host "  - Membersihkan untracked files..." -ForegroundColor Gray
    git clean -fd
    
    Write-Host "  ✓ Git issues diperbaiki" -ForegroundColor Green
    return $true
}

function Test-Build {
    Write-Host "`n[TEST] Menguji Build..." -ForegroundColor Yellow
    
    npm run build
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Build berhasil" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  ✗ Build gagal" -ForegroundColor Red
        return $false
    }
}

# Main execution
$fixTypeScript = Fix-TypeScriptErrors
$fixNodeModules = Fix-NodeModules
$fixBuildCache = Fix-BuildCache
$fixElectronCache = Fix-ElectronCache
$fixGitIssues = Fix-GitIssues

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Menguji Build..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$buildSuccess = Test-Build

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  RINGKASAN AUTO-FIX" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Write-Host "  TypeScript:   $(if ($fixTypeScript) { '✓' } else { '✗' })" -ForegroundColor $(if ($fixTypeScript) { 'Green' } else { 'Red' })
Write-Host "  Node Modules: $(if ($fixNodeModules) { '✓' } else { '✗' })" -ForegroundColor $(if ($fixNodeModules) { 'Green' } else { 'Red' })
Write-Host "  Build Cache:  $(if ($fixBuildCache) { '✓' } else { '✗' })" -ForegroundColor $(if ($fixBuildCache) { 'Green' } else { 'Red' })
Write-Host "  Electron:     $(if ($fixElectronCache) { '✓' } else { '✗' })" -ForegroundColor $(if ($fixElectronCache) { 'Green' } else { 'Red' })
Write-Host "  Git:          $(if ($fixGitIssues) { '✓' } else { '✗' })" -ForegroundColor $(if ($fixGitIssues) { 'Green' } else { 'Red' })
Write-Host "  Build Test:   $(if ($buildSuccess) { '✓' } else { '✗' })" -ForegroundColor $(if ($buildSuccess) { 'Green' } else { 'Red' })

Write-Host ""
if ($buildSuccess) {
    Write-Host "  ✅ AUTO-FIX SELESAI - Build Berhasil!" -ForegroundColor Green
} else {
    Write-Host "  ⚠ AUTO-FIX SELESAI - Build Masih Gagal" -ForegroundColor Yellow
    Write-Host "  Silakan periksa error di atas untuk troubleshooting manual" -ForegroundColor Yellow
}
Write-Host "==========================================" -ForegroundColor Cyan
