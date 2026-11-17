; ============================================================
; FATHONI EQUIPMENT OS - Sistem Operasional Alat Berat Terintegrasi
; Installer Inno Setup 6
;
; Versi TIDAK ditulis di sini: build-installer.ps1 membacanya dari
; package.json lalu meneruskannya ke ISCC:
;   ISCC /DMyAppVersion=<versi> installer\FATHONI-InnoSetup.iss
; Compile manual tanpa /D memakai fallback 0.0.0-dev (lihat #ifndef di bawah).
; ============================================================

#define MyAppName "FATHONI EQUIPMENT OS"
#define MyAppPublisher "CV. MUGHNY NAMASKARABUMI KURNIA"
#define MyAppURL "https://www.hems-system.co.id"
#define MyAppExeName "FATHONI.exe"

; Diisi oleh build-installer.ps1 lewat ISCC /DMyAppVersion=<versi package.json>.
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

; Sumber file aplikasi hasil electron-builder (target dir). Nama folder mengikuti
; "directories.output" di package.json; keduanya pindah ke dist-app pada Oktober
; 2026 karena dist-electron-portable masih berisi paket lama yang ikut membungkus
; seluruh node_modules (app.asar 147 MB) dan sebagian terkunci proses lain. Bisa
; dialihkan lewat ISCC /DAppUnpackedDir=<path> bila folder default sedang dipakai.
#ifndef AppUnpackedDir
  #define AppUnpackedDir "..\dist-app\win-unpacked"
#endif

; AppId = kunci upgrade, nilainya PERMANEN dan hanya ditulis di satu tempat ini.
; Instalasi 1.0.0 dan 2.0.0 terdaftar di
;   HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{E8B71C02-A23B-4921-99A1-HEMS-2026}_is1
; Jika nilai ini berubah, setup baru tidak mengenali instalasi lama: akan ada dua
; instalasi yang berbagi satu folder data (%APPDATA%\hems-heavy-equipment-system).
; 'AppId' harus diawali '{{' (escape Inno Setup) - hasil akhirnya satu '{'.
; Jangan memindahkannya ke #define: escape '{{' hanya dijamin berlaku pada teks
; sumber, bukan pada hasil ekspansi macro, jadi menaranya berisiko mengubah identity
; secara diam-diam. Nilai di baris ini sudah terbukti dipakai instalasi yang ada.
[Setup]
AppId={{E8B71C02-A23B-4921-99A1-HEMS-2026}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
; nama pendek, tanpa spasi: path instalasi yang panjang menambah risiko
; masalah MAX_PATH pada isi node_modules yang dibungkus electron-builder
DefaultDirName={autopf}\FATHONI
DisableProgramGroupPage=yes
; ARP/Programs & Features: "FATHONI EQUIPMENT OS" (bukan "HEMS - Heavy Equipment
; Management System version 2.0.0" seperti registrasi lama)
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
OutputBaseFilename=FATHONI-Setup-{#MyAppVersion}
OutputDir=..\dist-installer
Compression=lzma2
SolidCompression=yes
; --- Tampilan wizard: maroon + krem ---
; Artwork digambar oleh installer\assets\generate-wizard-art.ps1; PNG dan .ico
; hasilnya ikut disimpan di installer\assets supaya build tidak perlu PowerShell.
WizardStyle=modern
WizardSizePercent=110
DisableWelcomePage=no
; gambar besar hanya tampil di halaman Selamat Datang dan Selesai
WizardImageFile=assets\fathoni-wizard-side.png
WizardSmallImageFile=assets\fathoni-wizard-small.png
; ikon exe installer + title bar wizard
SetupIconFile=assets\fathoni.ico
; warna bingkai di sekitar gambar, samakan dengan latar gambar
WizardImageBackColor=#7E1015
WizardSmallImageBackColor=#F6EFE4
; WizardBackColor otomatis mengaktifkan custom style windows11; label jadi
; transparan sehingga krem ini tampil di seluruh halaman dan dialog.
WizardBackColor=#F6EFE4
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#AppUnpackedDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; "unchecked" = padanan runAfterFinish false: halaman Finish tidak mencentang
; "jalankan aplikasi" secara diam-diam, jadi instal senyap maupun yang diklik
; sampai Finish tidak membuka profil hidup pengguna tanpa diminta.
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent unchecked
