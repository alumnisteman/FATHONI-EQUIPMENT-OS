; ============================================================
; FATHONI EQUIPMENT OS - Sistem Operasional Alat Berat Terintegrasi
; Inno Setup Script v6/v7
; ============================================================

#define AppName "FATHONI"
#define AppFullName "FATHONI EQUIPMENT OS - Sistem Operasional Alat Berat Terintegrasi"
#define AppVersion "1.0.0"
#define AppPublisher "PT. SANY Heavy Industry Indonesia"
#define AppURL "https://www.sanygroup.com"
#define AppExeName "FATHONI.exe"
#define AppDescription "Sistem Operasional Alat Berat Terintegrasi"

[Setup]
; --- Identitas Aplikasi ---
AppId={{B9F3A2D1-4C8E-4F7A-9B2E-1A3C5D7E9F01}
AppName={#AppFullName}
AppVersion={#AppVersion}
AppVerName={#AppFullName} v{#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
AppCopyright=Copyright (C) 2024 {#AppPublisher}
AppComments={#AppDescription}

; --- Direktori Instalasi ---
DefaultDirName={autopf}\FATHONI
DefaultGroupName={#AppFullName}
AllowNoIcons=yes

; --- Output ---
OutputDir=d:\SANY\dist-installer
OutputBaseFilename=FATHONI-Setup-{#AppVersion}
; SetupIconFile=d:\SANY\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppFullName}

; --- Kompresi ---
Compression=lzma2/normal
SolidCompression=yes

; --- Arsitektur ---
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

; --- Tampilan Wizard ---
WizardStyle=modern
WizardResizable=yes
WizardSizePercent=110
DisableWelcomePage=no
DisableDirPage=no
DisableProgramGroupPage=no

; --- Hak Akses ---
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; --- Restart ---
RestartIfNeededByRun=yes
CloseApplications=yes
CloseApplicationsFilter=*{#AppExeName}

; --- Info Lisensi ---
; LicenseFile=d:\SANY\assets\LICENSE.rtf
; InfoBeforeFile=d:\SANY\assets\README-BEFORE.rtf
; InfoAfterFile=d:\SANY\assets\README-AFTER.rtf

; --- Bahasa ---
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
english.AppDesc={#AppDescription}
english.CreateDesktopShortcutMsg=Buat Shortcut di Desktop
english.CreateQuickLaunchShortcutMsg=Buat Shortcut di Quick Launch
english.LaunchAppAfterInstall=Jalankan {#AppName} setelah instalasi selesai
english.LangSelect=Pilih bahasa installer:

[Tasks]
Name: "desktopicon"; \
  Description: "{cm:CreateDesktopShortcutMsg}"; \
  GroupDescription: "{cm:AdditionalIcons}"; \
  Flags: checkedonce
Name: "quicklaunchicon"; \
  Description: "{cm:CreateQuickLaunchShortcutMsg}"; \
  GroupDescription: "{cm:AdditionalIcons}"; \
  Flags: unchecked; \
  OnlyBelowVersion: 6.1

[Files]
; --- File Utama Aplikasi Electron ---
Source: "d:\SANY\dist-electron-portable\win-unpacked\{#AppExeName}"; \
  DestDir: "{app}"; \
  Flags: ignoreversion

Source: "d:\SANY\dist-electron-portable\win-unpacked\*"; \
  DestDir: "{app}"; \
  Flags: ignoreversion recursesubdirs createallsubdirs; \
  Excludes: "*.pdb,*.map"

; --- Aset & Resources ---
; Source: "d:\SANY\assets\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
; Buat folder data database lokal (dapat ditulis pengguna)
Name: "{userappdata}\FATHONI\data"
Name: "{userappdata}\FATHONI\backups"
Name: "{userappdata}\FATHONI\logs"
Name: "{userappdata}\FATHONI\exports"

[Icons]
; Start Menu
Name: "{group}\{#AppFullName}"; \
  Filename: "{app}\{#AppExeName}"; \
  IconFilename: "{app}\{#AppExeName}"; \
  Comment: "{#AppDescription}"

Name: "{group}\{cm:UninstallProgram,{#AppFullName}}"; \
  Filename: "{uninstallexe}"

; Desktop
Name: "{autodesktop}\{#AppName}"; \
  Filename: "{app}\{#AppExeName}"; \
  IconFilename: "{app}\{#AppExeName}"; \
  Tasks: desktopicon; \
  Comment: "{#AppDescription}"

; Quick Launch
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#AppName}"; \
  Filename: "{app}\{#AppExeName}"; \
  Tasks: quicklaunchicon

[Registry]
; Simpan path instalasi untuk keperluan update/uninstall
Root: HKCU; \
  Subkey: "Software\{#AppPublisher}\{#AppName}"; \
  ValueType: string; \
  ValueName: "InstallPath"; \
  ValueData: "{app}"; \
  Flags: uninsdeletekey

Root: HKCU; \
  Subkey: "Software\{#AppPublisher}\{#AppName}"; \
  ValueType: string; \
  ValueName: "Version"; \
  ValueData: "{#AppVersion}"; \
  Flags: uninsdeletekey

Root: HKCU; \
  Subkey: "Software\{#AppPublisher}\{#AppName}"; \
  ValueType: string; \
  ValueName: "DataPath"; \
  ValueData: "{userappdata}\FATHONI"; \
  Flags: uninsdeletekey

[Run]
; Jalankan aplikasi setelah instalasi
Filename: "{app}\{#AppExeName}"; \
  Description: "{cm:LaunchAppAfterInstall}"; \
  Flags: nowait postinstall skipifsilent unchecked shellexec

[UninstallRun]
; Tutup proses yang berjalan sebelum uninstall
Filename: "{cmd}"; \
  Parameters: "/C taskkill /IM {#AppExeName} /F"; \
  RunOnceId: "KillFATHONI"; \
  Flags: skipifdoesntexist

[UninstallDelete]
; Hapus file log & cache saat uninstall
Type: filesandordirs; \
  Name: "{userappdata}\FATHONI\logs"

; CATATAN: Data database (backups, data/) TIDAK dihapus otomatis
; agar data pengguna tetap aman.

[Code]
{ ============================================================
  Pascal Script: Validasi & UI Kustom
  ============================================================ }

var
  DataDirPage: TInputDirWizardPage;

function InitializeSetup(): Boolean;
var
  Version: String;
begin
  Result := True;

  { Cek apakah aplikasi lama sudah terpasang }
  if RegQueryStringValue(HKCU,
    'Software\{#AppPublisher}\{#AppName}',
    'Version', Version) then
  begin
    if MsgBox(
      'FATHONI versi ' + Version + ' sudah terinstal.' + #13#10 +
      'Apakah Anda ingin menginstal ulang atau memperbarui?',
      mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
    end;
  end;
end;

procedure InitializeWizard();
begin
  { Halaman pilihan folder data (opsional) }
  DataDirPage := CreateInputDirPage(
    wpSelectDir,
    'Lokasi Folder Data',
    'Di mana FATHONI menyimpan database dan file data?',
    'Pilih folder untuk menyimpan database, backup, dan ekspor FATHONI.' + #13#10 +
    'Disarankan membiarkan default agar data terorganisir dengan baik.',
    False,
    'Baru'
  );
  DataDirPage.Add('Folder Data FATHONI:');
  DataDirPage.Values[0] := ExpandConstant('{userappdata}\FATHONI');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = DataDirPage.ID then
  begin
    if DataDirPage.Values[0] = '' then
    begin
      MsgBox('Harap pilih folder data untuk FATHONI.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  DataPath: String;
begin
  if CurStep = ssPostInstall then
  begin
    DataPath := DataDirPage.Values[0];
    { Tulis path data yang dipilih ke registry }
    RegWriteStringValue(HKCU,
      'Software\{#AppPublisher}\{#AppName}',
      'CustomDataPath', DataPath);
    { Buat folder data jika belum ada }
    ForceDirectories(DataPath);
    ForceDirectories(DataPath + '\data');
    ForceDirectories(DataPath + '\backups');
    ForceDirectories(DataPath + '\logs');
    ForceDirectories(DataPath + '\exports');
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataPath: String;
  Answer: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    if RegQueryStringValue(HKCU,
      'Software\{#AppPublisher}\{#AppName}',
      'DataPath', DataPath) then
    begin
      Answer := MsgBox(
        'Apakah Anda ingin menghapus data FATHONI (database, backup, dan ekspor)?' + #13#10 +
        'Folder: ' + DataPath + #13#10#13#10 +
        'PERINGATAN: Tindakan ini tidak dapat dibatalkan!',
        mbConfirmation, MB_YESNO);
      if Answer = IDYES then
      begin
        DelTree(DataPath, True, True, True);
      end;
    end;
  end;
end;
