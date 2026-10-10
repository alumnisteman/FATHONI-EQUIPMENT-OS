import { contextBridge, ipcRenderer } from 'electron';

// Preload ini berjalan dalam sandbox dan hanya membuka jembatan IPC.
// Tidak ada fs/net/Node yang bocor ke halaman, dan tidak ada fungsi generik
// (mis. "invoke(channel, ...)") yang bisa dipakai pemanggil untuk channel lain.
contextBridge.exposeInMainWorld('electronAPI', {
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  printDocument: (html: string, options?: unknown) => ipcRenderer.invoke('print-document', html, options),
  exportBackup: (data: string) => ipcRenderer.invoke('export-backup-dialog', data),
  restoreBackup: () => ipcRenderer.invoke('restore-backup-dialog'),

  // Foto unit disimpan sebagai file di folder data aplikasi, bukan di database.
  savePhoto: (id: string, data: ArrayBuffer | Uint8Array) => ipcRenderer.invoke('photo-save', id, data),
  readPhoto: (id: string) => ipcRenderer.invoke('photo-read', id),
  deletePhoto: (id: string) => ipcRenderer.invoke('photo-delete', id),
  copyPhotosTo: (ids: string[]) => ipcRenderer.invoke('photo-copy-to', ids),
  restorePhotosFrom: (ids: string[]) => ipcRenderer.invoke('photo-copy-from', ids),

  // Autentikasi: kredensial dikirim sekali, sesudahnya hanya token sesi.
  login: (username: string, password: string) => ipcRenderer.invoke('auth-login', username, password),
  logout: (token: string) => ipcRenderer.invoke('auth-logout', token),
  session: (token: string) => ipcRenderer.invoke('auth-session', token),
  changePassword: (token: string, current: string, next: string) =>
    ipcRenderer.invoke('auth-change-password', token, current, next),
  listAccounts: (token: string) => ipcRenderer.invoke('auth-list-accounts', token),
  saveAccount: (token: string, input: unknown) => ipcRenderer.invoke('auth-save-account', token, input),
  deleteAccount: (token: string, id: string) => ipcRenderer.invoke('auth-delete-account', token, id),
  auditLog: (token: string) => ipcRenderer.invoke('auth-audit-log', token),

  // Database SQLite: renderer tidak pernah menyentuh file, hanya meminta hasil.
  dbInfo: () => ipcRenderer.invoke('db-info'),
  dbLoad: (names?: string[]) => ipcRenderer.invoke('db-load', names),
  dbSave: (partial: unknown) => ipcRenderer.invoke('db-save', partial),
  dbPatch: (patches: unknown) => ipcRenderer.invoke('db-patch', patches),
  dbQuery: (req: unknown) => ipcRenderer.invoke('db-query', req),
  dbSum: (collection: string, column: string, where?: unknown) =>
    ipcRenderer.invoke('db-sum', collection, column, where),
  dbGroup: (req: unknown) => ipcRenderer.invoke('db-group', req),
  dbStats: () => ipcRenderer.invoke('db-stats'),
  dbIntegrity: () => ipcRenderer.invoke('db-integrity'),
  dbReferences: (collection: string, id: string) => ipcRenderer.invoke('db-references', collection, id),
  dbMarkImported: () => ipcRenderer.invoke('db-mark-imported'),

  // Snapshot berkas database: hasil selalu { ok, ... } supaya pesan kegagalan
  // yang aman (checksum, disk penuh) bisa ditampilkan apa adanya.
  dbSnapshotCreate: (input: unknown) => ipcRenderer.invoke('db-snapshot-create', input),
  dbSnapshotList: () => ipcRenderer.invoke('db-snapshot-list'),
  dbSnapshotRestore: (name: string, settings: unknown) => ipcRenderer.invoke('db-snapshot-restore', name, settings),
  dbSnapshotClear: () => ipcRenderer.invoke('db-snapshot-clear'),

  // Main process menahan quit sampai renderer menuntaskan simpanan tertunda.
  onFlushRequest: (cb: () => Promise<void> | void) => {
    ipcRenderer.on('db-flush-request', () => { Promise.resolve(cb()).catch(() => undefined); });
  },
  flushDone: () => ipcRenderer.invoke('db-flush-done'),

  isDesktopApp: true,
});
