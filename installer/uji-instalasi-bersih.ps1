#Requires -Version 5.1
<#
.SYNOPSIS
  Uji instalasi otomatis FATHONI EQUIPMENT OS 3.1.0 pada Windows bersih (VM/PC).

.DESCRIPTION
  Jalankan sebagai pengguna biasa (BUKAN administrator) di VM Windows 10/11 x64
  yang belum memiliki FATHONI terpasang. Skrip tidak memakai dependensi luar.

  Windows 10/11 bersih memakai kebijakan eksekusi PowerShell "Restricted", sehingga
  berkas .ps1 ditolak. Panggil lewat:
    powershell -ExecutionPolicy Bypass -File .\uji-instalasi-bersih.ps1

  Bila installer disalin dari jaringan/USB, berkas membawa tanda unduhan
  (Mark of the Web) yang membuat SmartScreen menghalangi instalasi senyap.
  Setelah hash dan tanda tangan lolos, skrip menghapus tanda itu (Unblock-File)
  dan mencatatnya di log.

  Urutan uji:
    1. Preflight: installer ada, hash SHA-256 cocok, tanda tangan internal cocok,
       timestamp ada, tidak ada proses/instalasi FATHONI lama, disk cukup.
    2. Menyiapkan penanda data pengguna (opsional -SampleDb menyalin fathoni.db)
       untuk membuktikan uninstaller tidak menghapus data.
    3. Install senyap: /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG.
    4. Verifikasi exe + app.asar identik dengan paket bertanda tangan, versi 3.1.0,
       entri uninstall per-pengguna, shortcut Start Menu.
    5. Boot aplikasi dengan --user-data-dir ke folder sandbox: jendela muncul,
       database sandbox terbentuk, data pengguna nyata tidak berubah.
    6. Uninstall senyap: program + entri uninstall + shortcut hilang,
       data pengguna (penanda/sample) tetap utuh.
  Hasil ditulis ke <WorkDir>\hasil.txt. Kode keluar 0 = semua lulus.

  Catatan tanda tangan: sertifikat 3.1.0 adalah sertifikat internal (self-signed).
  Di VM bersih rantai sertifikat tidak dipercaya sehingga status Authenticode
  dapat "UnknownError"; itu wajar. Integritas file dikunci oleh hash SHA-256,
  dan identitas penandatangan dikunci oleh thumbprint sertifikat.

.PARAMETER Installer
  Lokasi FATHONI-Setup-3.1.0.exe. Default: di folder yang sama dengan skrip.

.PARAMETER WorkDir
  Folder log dan profil sandbox. Default: %TEMP%\uji-fathoni-<tanggal-jam>.

.PARAMETER SampleDb
  Opsional. fathoni.db contoh untuk disalin ke profil pengguna sebelum install,
  sehingga uji "data bertahan" memakai database sungguhan. Hanya boleh dipakai
  bila profil pengguna belum berisi fathoni.db.

.PARAMETER PreflightOnly
  Hanya jalankan pemeriksaan awal (tanpa install/uninstall).

.PARAMETER BootOnly
  Hanya uji boot aplikasi yang sudah terpasang (tanpa install/uninstall).
  Berguna untuk regresi cepat pada mesin yang sudah terpasang 3.1.0.

.PARAMETER SkipBoot
  Lewati langkah boot aplikasi.

.PARAMETER KeepInstalled
  Jangan uninstall di akhir (aplikasi 3.1.0 dibiarkan terpasang).

.PARAMETER HapusDataUji
  Setelah selesai, hapus penanda/sample yang dibuat skrip ini. Data pengguna
  yang sudah ada sebelumnya tidak pernah dihapus.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\uji-instalasi-bersih.ps1 -Installer .\FATHONI-Setup-3.1.0.exe

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\uji-instalasi-bersih.ps1 -PreflightOnly

.EXAMPLE
  .\uji-instalasi-bersih.ps1 -SampleDb .\fathoni.db -HapusDataUji
#>
[CmdletBinding()]
param(
  [string]$Installer = '',
  [string]$WorkDir,
  [string]$SampleDb,
  [string]$ExpectedInstallerSha256 = '4a49e2a695c3b76d335cd12bf4ada69c462ea064ad70a0e2f74ae3c99ea39732',
  [string]$ExpectedExeSha256 = 'dd790ef702f9059b4b90cf952c625fb85406ad8c01c443bbfe093a05b9f01b4b',
  [string]$ExpectedAsarSha256 = '6cbdb3e72923a3ff7c265b397e1d9ff5bea78c1df81be466046e40b34c931ff5',
  [string]$ExpectedSignerThumbprint = '2D4FAE84A234BBA7043B86A575161B370EB722DB',
  [int]$BootTimeoutSec = 90,
  [switch]$PreflightOnly,
  [switch]$BootOnly,
  [switch]$SkipBoot,
  [switch]$KeepInstalled,
  [switch]$HapusDataUji
)

$ErrorActionPreference = 'Stop'

if (-not $Installer) { $Installer = Join-Path $PSScriptRoot 'FATHONI-Setup-3.1.0.exe' }

$script:lulus = 0
$script:gagal = 0
$script:gagalNama = New-Object System.Collections.Generic.List[string]
$script:logBaris = New-Object System.Collections.Generic.List[string]

if (-not $WorkDir) { $WorkDir = Join-Path $env:TEMP ('uji-fathoni-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
try { New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null } catch { $WorkDir = $env:TEMP }
$script:logJalur = Join-Path $WorkDir 'hasil.txt'

function Catat([string]$teks) {
  $script:logBaris.Add($teks)
  Write-Host $teks
}

function Cek([string]$nama, [bool]$ok, [string]$detail = '') {
  $ekor = if ($detail) { '  [' + $detail + ']' } else { '' }
  if ($ok) {
    $script:lulus++
    $script:logBaris.Add('LULUS  ' + $nama + $ekor)
    Write-Host ('LULUS  ' + $nama + $ekor) -ForegroundColor Green
  } else {
    $script:gagal++
    $script:gagalNama.Add($nama)
    $script:logBaris.Add('GAGAL  ' + $nama + $ekor)
    Write-Host ('GAGAL  ' + $nama + $ekor) -ForegroundColor Red
  }
}

function HashFile([string]$jalur) {
  if (-not (Test-Path -LiteralPath $jalur -PathType Leaf)) { return '' }
  try { return (Get-FileHash -LiteralPath $jalur -Algorithm SHA256).Hash.ToLowerInvariant() } catch { return '' }
}

function RuangBebasMB([string]$jalur) {
  try {
    $akar = [System.IO.Path]::GetPathRoot($jalur)
    return [int64]([System.IO.DriveInfo]::new($akar).AvailableFreeSpace / 1MB)
  } catch { return -1 }
}

function Tunggu([scriptblock]$syarat, [int]$detik, [int]$jeda = 1) {
  $batas = (Get-Date).AddSeconds($detik)
  while ((Get-Date) -lt $batas) {
    try { if (& $syarat) { return $true } } catch { }
    Start-Sleep -Seconds $jeda
  }
  return $false
}

function ProsesFathoni {
  return @(Get-Process -Name 'FATHONI' -ErrorAction SilentlyContinue)
}

function EntriArp {
  return @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'FATHONI*' })
}

function Selesai {
  Catat ''
  $kode = if ($script:gagal -eq 0) { 0 } else { 1 }
  Catat ('HASIL AKHIR: ' + $script:lulus + ' lulus, ' + $script:gagal + ' gagal')
  if ($script:gagal -gt 0) { Catat ('YANG GAGAL: ' + ($script:gagalNama -join '; ')) }
  Catat ('LOG: ' + $script:logJalur)
  Catat ('SELESAI kode=' + $kode)
  try {
    [System.IO.File]::WriteAllLines($script:logJalur, $script:logBaris, (New-Object System.Text.UTF8Encoding($true)))
  } catch { }
  exit $kode
}

$dataDir = Join-Path $env:APPDATA 'hems-heavy-equipment-system'
$dbLive = Join-Path $dataDir 'fathoni.db'
$marker = Join-Path $dataDir 'penanda-data-uji.txt'
$exeTarget = Join-Path $env:LOCALAPPDATA 'Programs\FATHONI\FATHONI.exe'
$asarTarget = Join-Path (Split-Path -Parent $exeTarget) 'resources\app.asar'
$unins = Join-Path (Split-Path -Parent $exeTarget) 'unins000.exe'
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\FATHONI EQUIPMENT OS.lnk'

function UjiBoot([string]$exe, [string]$sandbox) {
  $hashSebelum = HashFile $dbLive
  $adaDbSebelum = [bool]$hashSebelum
  if (Test-Path -LiteralPath $sandbox) { Remove-Item -LiteralPath $sandbox -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $sandbox | Out-Null
  $proc = $null
  try {
    $proc = Start-Process -FilePath $exe -ArgumentList ('--user-data-dir="' + $sandbox + '"') -PassThru
    $judul = ''
    $batas = (Get-Date).AddSeconds($BootTimeoutSec)
    while ((Get-Date) -lt $batas) {
      $pr = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
      if (-not $pr) { break }
      if ($pr.MainWindowTitle) { $judul = $pr.MainWindowTitle; break }
      Start-Sleep -Seconds 2
    }
    Cek 'B.1 jendela aplikasi muncul' ($judul -like 'FATHONI EQUIPMENT OS*') ('judul="' + $judul + '"')

    $dbSandbox = Join-Path $sandbox 'fathoni.db'
    $okDb = Tunggu { (Test-Path -LiteralPath $dbSandbox) -and ((Get-Item -LiteralPath $dbSandbox).Length -ge 4096) } 45 1
    $ukuranDb = if (Test-Path -LiteralPath $dbSandbox) { (Get-Item -LiteralPath $dbSandbox).Length } else { 0 }
    Cek 'B.2 database profil sandbox terbentuk' $okDb ('ukuran=' + $ukuranDb + ' B')
  } finally {
    for ($i = 0; $i -lt 10; $i++) {
      $sisa = @(ProsesFathoni)
      if ($sisa.Count -eq 0) { break }
      $sisa | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    }
    Cek 'B.3 semua proses FATHONI berhenti' (@(ProsesFathoni).Count -eq 0)
  }

  if ($adaDbSebelum) {
    Cek 'B.4 data pengguna tidak berubah saat boot' ((HashFile $dbLive) -eq $hashSebelum) ('sha256=' + (HashFile $dbLive))
  } else {
    Cek 'B.4 aplikasi tidak membuat profil pengguna nyata' (-not (Test-Path -LiteralPath $dbLive)) $dbLive
  }
}

try {
  Catat '=== UJI INSTALASI FATHONI EQUIPMENT OS 3.1.0 (mesin bersih)'
  Catat ('installer : ' + $Installer)
  Catat ('workdir   : ' + $WorkDir)
  Catat ('waktu     : ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  Catat ''

  if ($BootOnly) {
    Catat '=== MODE BootOnly: aplikasi terpasang diuji tanpa install/uninstall'
    $exeBoot = $exeTarget
    if (-not (Test-Path -LiteralPath $exeBoot)) {
      $arpAda = @(EntriArp)
      if ($arpAda.Count -gt 0 -and $arpAda[0].InstallLocation) { $exeBoot = Join-Path $arpAda[0].InstallLocation 'FATHONI.exe' }
    }
    Cek 'BOOT.0 FATHONI.exe ditemukan' (Test-Path -LiteralPath $exeBoot) $exeBoot
    if (Test-Path -LiteralPath $exeBoot) {
      $viBoot = (Get-Item -LiteralPath $exeBoot).VersionInfo
      Cek 'BOOT.0b ProductVersion 3.1.0' ($viBoot.ProductVersion -eq '3.1.0') ('product=' + $viBoot.ProductVersion)
      UjiBoot $exeBoot (Join-Path $WorkDir 'profil-sandbox')
    }
    Selesai
  }

  Catat '--- Preflight'
  $adaInstaller = Test-Path -LiteralPath $Installer -PathType Leaf
  Cek 'P.1 installer ditemukan' $adaInstaller $Installer
  if (-not $adaInstaller) { Selesai }

  $hashInstaller = HashFile $Installer
  Cek 'P.2 hash installer cocok dengan paket rilis' ($hashInstaller -eq $ExpectedInstallerSha256.ToLowerInvariant()) ('sha256=' + $hashInstaller)

  $sig = Get-AuthenticodeSignature -LiteralPath $Installer
  $thumb = if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { '' }
  Cek 'P.3 penandatangan installer sesuai' ([bool]$sig.SignerCertificate -and $thumb -eq $ExpectedSignerThumbprint.ToUpperInvariant()) ('status=' + $sig.Status + '; thumb=' + $thumb)
  Catat ('       status rantai "' + $sig.Status + '" wajar di VM tanpa sertifikat internal; integritas dikunci P.2 dan identitas oleh P.3')
  $adaTs = [bool]$sig.TimeStamperCertificate
  Cek 'P.3b timestamp tersemat' $adaTs $(if ($adaTs) { $sig.TimeStamperCertificate.Subject } else { 'tidak ada' })
  $sertAkhir = if ($sig.SignerCertificate) { $sig.SignerCertificate.NotAfter } else { $null }
  Cek 'P.3c sertifikat belum kedaluwarsa' ([bool]$sertAkhir -and $sertAkhir -gt (Get-Date)) $(if ($sertAkhir) { 'sampai ' + $sertAkhir.ToString('yyyy-MM-dd') } else { '-' })

  # Dihapus hanya setelah integritas (P.2) dan identitas (P.3) terbukti: SmartScreen
  # memeriksa Mark of the Web sebelum proses dibuat, jadi tanda itu harus hilang
  # agar /VERYSILENT tidak berhenti di dialog "Windows protected your PC".
  $zona = Get-Item -LiteralPath $Installer -Stream Zone.Identifier -ErrorAction SilentlyContinue
  if ($zona) {
    try {
      Unblock-File -LiteralPath $Installer -ErrorAction Stop
      Catat '       Mark of the Web dihapus dari installer (hash & tanda tangan sudah lolos); SmartScreen tidak menghalangi mode senyap'
    } catch {
      Catat ('       peringatan: gagal menghapus Mark of the Web: ' + $_.Exception.Message)
    }
  } else {
    Catat '       installer tanpa Mark of the Web'
  }

  Cek 'P.4 sistem operasi 64-bit' ([Environment]::Is64BitOperatingSystem) ([Environment]::OSVersion.VersionString)

  $procAwal = @(ProsesFathoni)
  Cek 'P.5 tidak ada proses FATHONI berjalan' ($procAwal.Count -eq 0) ('jumlah=' + $procAwal.Count)

  $arpAwal = @(EntriArp)
  $bersihAwal = ($arpAwal.Count -eq 0)
  Cek 'P.6 belum ada instalasi FATHONI (VM bersih)' $bersihAwal $(if ($arpAwal.Count -gt 0) { $arpAwal[0].DisplayName + ' ' + $arpAwal[0].DisplayVersion } else { 'bersih' })

  $bebasMB = RuangBebasMB $env:LOCALAPPDATA
  Cek 'P.7 ruang disk cukup (minimal 800 MB)' ($bebasMB -ge 800) ('bebas=' + $bebasMB + ' MB')

  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($admin) { Catat '       peringatan: sesi administrator; uji paling sah adalah sesi pengguna biasa (installer memasang per-pengguna)' }

  if ($PreflightOnly) { Selesai }

  if (-not $bersihAwal -or $procAwal.Count -gt 0) {
    Catat ''
    Catat 'Berhenti: mesin ini belum bersih. Uninstall FATHONI lebih dulu, atau pakai -BootOnly untuk uji boot saja.'
    Selesai
  }

  Catat ''
  Catat '--- Data pengguna uji'
  $adaDataDirAwal = Test-Path -LiteralPath $dataDir
  $hashDbAwal = HashFile $dbLive

  if ($SampleDb) {
    $adaSample = Test-Path -LiteralPath $SampleDb -PathType Leaf
    Cek 'D.1 sample database ditemukan' $adaSample $SampleDb
    if ($adaSample -and $hashDbAwal) {
      Cek 'D.2 profil pengguna masih kosong' $false 'sudah ada fathoni.db; jangan memakai -SampleDb di mesin ini'
      Selesai
    }
  }

  if (-not $adaDataDirAwal) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }
  Set-Content -LiteralPath $marker -Value ('dibuat ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' oleh uji-instalasi-bersih.ps1') -Encoding ASCII
  Cek 'D.3 penanda data pengguna disiapkan' (Test-Path -LiteralPath $marker) $marker

  if ($SampleDb -and (Test-Path -LiteralPath $SampleDb -PathType Leaf)) {
    Copy-Item -LiteralPath $SampleDb -Destination $dbLive -Force
    $hashDbAwal = HashFile $dbLive
    Cek 'D.4 sample database disalin ke profil pengguna' ($hashDbAwal -ne '') ('sha256=' + $hashDbAwal)
  } else {
    Catat '       catatan: tanpa -SampleDb, uji data-bertahan memakai penanda teks saja'
  }

  Catat ''
  Catat '--- Instalasi'
  $logInstall = Join-Path $WorkDir 'install.log'
  $p = Start-Process -FilePath $Installer -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/LOG="' + $logInstall + '"') -Wait -PassThru
  Cek 'I.1 installer selesai tanpa galat' ($p.ExitCode -eq 0) ('exit=' + $p.ExitCode)

  $terpasang = Tunggu { Test-Path -LiteralPath $exeTarget } 120 2
  Cek 'I.2 FATHONI.exe terpasang' $terpasang $exeTarget
  if (-not $terpasang) {
    Catat 'Instalasi tidak menghasilkan exe; periksa ' + $logInstall
    Selesai
  }

  $hashExe = HashFile $exeTarget
  Cek 'I.3 exe terpasang identik dengan paket bertanda tangan' ($hashExe -eq $ExpectedExeSha256.ToLowerInvariant()) ('sha256=' + $hashExe)

  $sigExe = Get-AuthenticodeSignature -LiteralPath $exeTarget
  $thumbExe = if ($sigExe.SignerCertificate) { $sigExe.SignerCertificate.Thumbprint } else { '' }
  Cek 'I.4 tanda tangan exe terpasang sesuai' ([bool]$sigExe.SignerCertificate -and $thumbExe -eq $ExpectedSignerThumbprint.ToUpperInvariant()) ('status=' + $sigExe.Status)

  $hashAsar = HashFile $asarTarget
  Cek 'I.5 app.asar sesuai paket' ($hashAsar -eq $ExpectedAsarSha256.ToLowerInvariant()) ('sha256=' + $hashAsar)

  $vi = (Get-Item -LiteralPath $exeTarget).VersionInfo
  Cek 'I.6 versi produk 3.1.0' ($vi.ProductVersion -eq '3.1.0') ('product=' + $vi.ProductVersion + '; file=' + $vi.FileVersion)

  $arp = @(EntriArp)
  $arpOk = ($arp.Count -eq 1 -and $arp[0].DisplayVersion -eq '3.1.0')
  Cek 'I.7 entri uninstall 3.1.0 terdaftar' $arpOk $(if ($arp.Count -gt 0) { $arp[0].DisplayName + ' ' + $arp[0].DisplayVersion } else { 'tidak ada' })

  $lokasi = if ($arp.Count -gt 0) { [string]$arp[0].InstallLocation } else { '' }
  $perUser = ($lokasi -ne '' -and $lokasi.ToLowerInvariant().StartsWith($env:LOCALAPPDATA.ToLowerInvariant()))
  Cek 'I.8 terpasang per-pengguna tanpa admin' $perUser $lokasi

  Cek 'I.9 shortcut Start Menu dibuat' (Test-Path -LiteralPath $shortcut) $shortcut

  if ($hashDbAwal) { Cek 'I.10 data pengguna tidak berubah saat install' ((HashFile $dbLive) -eq $hashDbAwal) ('sha256=' + (HashFile $dbLive)) }
  Cek 'I.11 penanda data pengguna masih ada' (Test-Path -LiteralPath $marker)

  if (-not $SkipBoot) {
    Catat ''
    Catat '--- Boot aplikasi (profil sandbox)'
    UjiBoot $exeTarget (Join-Path $WorkDir 'profil-sandbox')
  }

  if (-not $KeepInstalled) {
    Catat ''
    Catat '--- Uninstall'
    $logUnins = Join-Path $WorkDir 'uninstall.log'
    $pu = Start-Process -FilePath $unins -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/LOG="' + $logUnins + '"') -Wait -PassThru
    Cek 'U.1 uninstaller selesai tanpa galat' ($pu.ExitCode -eq 0) ('exit=' + $pu.ExitCode)

    $hilang = Tunggu { (-not (Test-Path -LiteralPath $exeTarget)) -and (@(EntriArp).Count -eq 0) } 90 2
    Cek 'U.2 program dan entri uninstall hilang' $hilang

    Cek 'U.3 folder instalasi sudah bersih' (-not (Test-Path -LiteralPath (Split-Path -Parent $exeTarget)))
    Cek 'U.4 shortcut Start Menu hilang' (-not (Test-Path -LiteralPath $shortcut))

    if ($hashDbAwal) {
      Cek 'U.5 data pengguna bertahan' ((HashFile $dbLive) -eq $hashDbAwal) ('sha256=' + (HashFile $dbLive))
    } else {
      Cek 'U.5 data pengguna bertahan' (Test-Path -LiteralPath $marker)
      Cek 'U.5b aplikasi tidak membuat profil pengguna nyata' (-not (Test-Path -LiteralPath $dbLive)) $dbLive
    }

    if ($HapusDataUji) {
      Catat '--- Membersihkan artefak uji'
      if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }
      if ($SampleDb -and -not $adaDataDirAwal) {
        foreach ($f in @($dbLive, ($dbLive + '-wal'), ($dbLive + '-shm'))) {
          if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
        }
        if ((Test-Path -LiteralPath $dataDir) -and -not (Get-ChildItem -LiteralPath $dataDir -Force)) {
          Remove-Item -LiteralPath $dataDir -Force
        }
      }
      Catat 'artefak penanda/sample dihapus; folder program sudah dihapus uninstaller'
    }
  }

  Selesai
} catch {
  Catat ''
  Catat ('ERROR TAK TERDUGA: ' + $_.Exception.Message)
  try { ProsesFathoni | Stop-Process -Force -ErrorAction SilentlyContinue } catch { }
  if ($script:gagal -eq 0) { $script:gagal = 1 }
  $script:gagalNama.Add('error tak terduga')
  Selesai
}
