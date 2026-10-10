import { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { pathToFileURL } from 'url';
import {
  initAuth, login, logout, session as authSession, changePassword,
  listAccounts, saveAccount, deleteAccount, auditLog,
  type SaveAccountInput,
} from './auth';
import {
  openDatabase, closeDatabase, databaseFile, collectionNames,
  loadStore, rowCounts, saveStore, saveRows, queryCollection, sumCollection, groupCollection, stats, integrity,
  getMeta, setMeta, getMetaNumber, transact, rowReferences,
} from './db';
import {
  createSnapshot, listSnapshots, restoreSnapshot, clearSnapshots,
} from './backup';
import { isCollectionName } from './dbSchema';

// Kunci meta: menandai bahwa isi localStorage lama sudah dipindahkan ke SQLite.
const META_IMPORTED = 'localStorageImportedAt';

// Electron menurunkan folder userData dari app.getName(), yang ikut berubah saat
// aplikasi di-rebrand. Lokasi data dipin di sini supaya pergantian nama aplikasi tidak
// pernah memindahkan database pengguna ke folder kosong.
// HEMS_DATA_DIR hanya berlaku pada build dev: pengujian otomasi wajib memakai folder
// data sendiri, karena Windows mengabaikan variabel APPDATA pada proses anak dan
// Chromium selalu membuka profil asli pengguna.
const DATA_DIR_NAME = 'hems-heavy-equipment-system';
const forcedDataDir = app.isPackaged ? '' : (process.env.HEMS_DATA_DIR || '');
app.setPath('userData', forcedDataDir
  ? path.resolve(forcedDataDir)
  : path.join(app.getPath('appData'), DATA_DIR_NAME));

// Semua jendela memakai origin localStorage yang sama; dua instance akan saling
// menimpa tulis tanpa peringatan.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

// ── Origin aplikasi ────────────────────────────────────────────────────────
// Origin kepercayaan TIDAK boleh disimpulkan dari environment saja: jendela yang
// sama bisa berpindah dari dev server ke berkas dist. Yang dicatat di sini adalah
// apa yang benar-benar dimuat, sehingga halaman lain — termasuk file:// di bagian
// disk manapun — tidak pernah dianggap aplikasi.
const APP_DIR_URL = pathToFileURL(path.join(__dirname, '../dist')).href + '/';
const DEV_SERVER_URL = app.isPackaged ? '' : (process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');

const allowedOrigins = new Set<string>();

function allowOrigin(base: string) {
  if (base) allowedOrigins.add(base);
}

function isAppUrl(url: string): boolean {
  if (!url) return false;
  for (const base of allowedOrigins) {
    if (url.startsWith(base)) return true;
  }
  return false;
}

/**
 * Hanya frame milik aplikasi yang boleh memanggil IPC sensitif. Tanpa checks ini,
 * halaman pihak ketiga yang berhasil terbuka di jendela yang sama akan mendapat
 * akses penuh ke berkas, pencetakan, dan akun.
 */
function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  try {
    const frameUrl = event.senderFrame?.url || '';
    if (frameUrl && isAppUrl(frameUrl)) return true;
    return isAppUrl(event.sender?.getURL?.() || '');
  } catch {
    return false;
  }
}

const MAX_BACKUP_BYTES = 64 * 1024 * 1024; // 64 MB

let mainWindow: BrowserWindow | null = null;

function getLanIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (netList) {
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }
  return '127.0.0.1';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    title: 'FATHONI EQUIPMENT OS — Sistem Operasional Alat Berat Terintegrasi',
    backgroundColor: '#121316',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Preload hanya memakai contextBridge + ipcRenderer, jadi sandbox bisa
      // dinyalakan: renderer tidak punya jalan ke Node sama sekali.
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
    show: false,
  });

  const distPath = path.join(__dirname, '../dist/index.html');
  const devServerUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    allowOrigin(devServerUrl);
    mainWindow.loadURL(devServerUrl);
  } else if (fs.existsSync(distPath)) {
    allowOrigin(APP_DIR_URL);
    mainWindow.loadFile(distPath);
  } else if (!app.isPackaged) {
    allowOrigin(DEV_SERVER_URL);
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // Build terpasang tanpa dist/ tidak boleh diam-diam memuat dev server:
    // origin berbeda berarti database berbeda.
    dialog.showErrorBox(
      'Instalasi tidak lengkap',
      `File aplikasi tidak ditemukan:\n${distPath}\n\nPasang ulang aplikasi.`
    );
    app.quit();
  }

  // Fallback jika koneksi dev server gagal
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.warn('Gagal memuat URL:', validatedURL, errorDescription);
    if (validatedURL.includes('localhost:5173') && fs.existsSync(distPath)) {
      allowOrigin(APP_DIR_URL);
      mainWindow?.loadFile(distPath);
    }
  });

  // DevTools hanya untuk pengembangan; di build terpasang ini adalah jalan pintas
  // langsung ke konsol dengan akses penuh ke data.
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        mainWindow?.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  } else {
    // Percepatan menu/keyboard tetap bisa mencoba membuka DevTools; tutup lagi.
    mainWindow.webContents.on('devtools-opened', () => mainWindow?.webContents.closeDevTools());
  }

  let shown = false;
  mainWindow.once('ready-to-show', () => {
    if (!shown) {
      shown = true;
      mainWindow?.show();
    }
  });

  // Pengaman jika ready-to-show tertunda
  setTimeout(() => {
    if (!shown && mainWindow && !mainWindow.isDestroyed()) {
      shown = true;
      mainWindow.show();
    }
  }, 1500);

  // Simpanan tertunda harus tuntas sebelum jendela benar-benar tertutup.
  let closeFlushed = false;
  mainWindow.on('close', (event) => {
    if (closeFlushed || quitApproved) return;
    closeFlushed = true;
    event.preventDefault();
    requestFlush(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Tautan eksternal hanya boleh dibuka di browser biasa, dan hanya skema http/https.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Navigasi keluar dari aplikasi akan mengganti origin — berarti juga mengganti
  // database yang terlihat — jadi selalu dibatalkan.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
}

// ── Pengerasan sistemik ────────────────────────────────────────────────────
// Isi hanya boleh datang dari berkas aplikasi; apa pun yang mencoba muncul di
// jendela baru atau menempelkan webview dihentikan.
function installSessionHardening() {
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler(() => false);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // CSP dikirim sebagai header untuk dev server (http). Build terpasang memakai
  // <meta> yang disuntikkan Vite ke dist/index.html, karena webRequest tidak
  // melihat respons file://.
  if (!app.isPackaged) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",   // React Fast Refresh menyuntik skrip inline saat dev
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' ws: http://localhost:5173",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; ');
      const headers = { ...details.responseHeaders };
      if (headers['Content-Security-Policy']) delete headers['Content-Security-Policy'];
      headers['Content-Security-Policy'] = [csp];
      callback({ responseHeaders: headers });
    });
  }
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'fileMenu' },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as Electron.MenuItemConstructorOptions]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// App lifecycle
if (hasInstanceLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    installSessionHardening();
    initDatabase();
    buildMenu();
    createWindow();
    // Berkas akun dibuat sebelum jendela sempat menampilkan form login.
    initAuth().catch(err => console.error('[auth] Gagal menyiapkan akun:', err));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

/**
 * Database dibuka sebelum jendela pertama: renderer langsung minta data saat mount.
 * Berkas yang rusak tidak boleh membuat aplikasi mati — dipisahkan (bukan dihapus)
 * lalu dibuka yang baru, karena satu-satunya jalan pemulihan adalah backup.
 */
function initDatabase(): void {
  const dir = app.getPath('userData');
  try {
    const info = openDatabase(dir);
    console.log(`[db] Database siap: ${path.basename(info.file)}${info.createdNow ? ' (baru dibuat)' : ''}`);
    return;
  } catch (err: any) {
    console.error('[db] Gagal membuka database:', err?.message ?? err);
  }
  try {
    const broken = path.join(dir, 'fathoni.db');
    const moved = `${broken}.rusak-${Date.now()}`;
    if (fs.existsSync(broken)) fs.renameSync(broken, moved);
    for (const suffix of ['-wal', '-shm']) {
      const extra = broken + suffix;
      if (fs.existsSync(extra)) fs.renameSync(extra, extra + '.rusak-' + Date.now());
    }
    openDatabase(dir);
    dialog.showErrorBox(
      'Database lama tidak bisa dibaca',
      `Berkas database rusak dan sudah dipisahkan ke:\n${moved}\n\n`
      + 'Aplikasi dibuka dengan database kosong. Pulihkan lewat menu Backup & Restore, '
      + 'dan JANGAN menutup aplikasi sebelum data aman.'
    );
  } catch (err2: any) {
    dialog.showErrorBox('Database tidak bisa disiapkan', String(err2?.message ?? err2));
    app.quit();
  }
}

app.on('will-quit', () => {
  // WAL dirapikan ke file utama supaya salinan cadangan selalu utuh.
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ── Pembungkus IPC ─────────────────────────────────────────────────────────
// Setiap kanal memvalidasi pengirim dan tidak pernah melempar exception mentah
// ke renderer (pesan error internal sering berisi path berkas).
function trustedHandle(
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn(`[ipc] Kanal "${channel}" ditolak: pengirim bukan origin aplikasi`);
      return { success: false, error: 'Permintaan ditolak: sumber tidak dikenal' };
    }
    try {
      const result = await fn(event, ...args);
      return result ?? { success: true };
    } catch (err: any) {
      console.error(`[ipc] Kanal "${channel}" gagal:`, err?.message ?? err);
      return { success: false, error: 'Operasi gagal diproses' };
    }
  });
}

// ── Autentikasi lokal ──────────────────────────────────────────────────────
// Password dan hash hanya hidup di process ini. Lihat electron/auth.ts.
trustedHandle('auth-login', (_e, username: unknown, password: unknown) => login(username, password));

trustedHandle('auth-logout', (_e, token: unknown) => logout(token));

trustedHandle('auth-session', (_e, token: unknown) => authSession(token));

trustedHandle('auth-change-password', (_e, token: unknown, current: unknown, next: unknown) =>
  changePassword(token, current, next));

trustedHandle('auth-list-accounts', (_e, token: unknown) => listAccounts(token));

trustedHandle('auth-save-account', (_e, token: unknown, input: SaveAccountInput) =>
  saveAccount(token, input));

trustedHandle('auth-delete-account', (_e, token: unknown, id: unknown) => deleteAccount(token, id));

trustedHandle('auth-audit-log', (_e, token: unknown) => auditLog(token));

// ── Database SQLite ────────────────────────────────────────────────────────
// Renderer sandboxed tidak punya akses fs; semua baca/tulis data lewat kanal ini.
// Nama collection divalidasi terhadap daftar putih di dbSchema, jadi tidak ada
// satu pun string dari renderer yang bisa menjadi nama tabel atau kolom SQL.
trustedHandle('db-info', () => {
  const counts = rowCounts();
  return {
    file: path.basename(databaseFile()),
    collections: collectionNames(),
    schemaVersion: getMetaNumber('schema_version'),
    importedFromLocalStorage: getMeta(META_IMPORTED) !== null,
    perCollection: counts.perCollection,
    totalRows: counts.totalRows,
  };
});

// `db-load` tanpa argument tetap memuat semua collection (dipakai jalur impor dan
// layar Backup). Dengan daftar, hanya collection yang disebut yang lewat — ini
// yang membuat boot tidak lagi menyalin seluruh isi file ke renderer. Nama asing
// DITOLAK, bukan dilewati: diam-diam mengembalikan sebagian hasil akan membuat
// halaman mengira collection itu kosong.
trustedHandle('db-load', (_e, names?: unknown) => {
  if (names === undefined || names === null) return loadStore();
  if (!Array.isArray(names)) throw new Error('Daftar collection tidak valid');
  for (const name of names) {
    if (!isCollectionName(name)) throw new Error(`Collection tidak dikenal: ${name}`);
  }
  return loadStore(names.map(String));
});

trustedHandle('db-save', (_e, partial: unknown) => {
  if (!partial || typeof partial !== 'object') throw new Error('Muatan simpan tidak valid');
  const allowed = new Set(collectionNames());
  const clean: Record<string, any[]> = {};
  for (const [name, rows] of Object.entries(partial as Record<string, unknown>)) {
    if (!allowed.has(name)) throw new Error(`Collection tidak dikenal: ${name}`);
    if (!Array.isArray(rows)) throw new Error(`Isi "${name}" bukan daftar`);
    clean[name] = rows;
  }
  return saveStore(clean);
});

// Patch baris: hanya baris yang benar-benar berubah yang melintasi IPC dan hanya
// baris yang disebut yang ditulis. Ini jalur autosave untuk collection besar —
// db-save penuh memaksa renderer menyalin seluruh isi collection (dan main
// process mem-parse-nya) setiap kali satu record berubah.
trustedHandle('db-patch', (_e, patches: unknown) => {
  if (!patches || typeof patches !== 'object') throw new Error('Muatan patch tidak valid');
  const siap: { name: string; upsert: unknown[]; removeIds: unknown[] }[] = [];
  for (const [name, patch] of Object.entries(patches as Record<string, unknown>)) {
    if (!isCollectionName(name)) throw new Error(`Collection tidak dikenal: ${name}`);
    if (!patch || typeof patch !== 'object') throw new Error(`Patch "${name}" bukan objek`);
    const p = patch as { upsert?: unknown; removeIds?: unknown };
    const upsert = p.upsert === undefined ? [] : p.upsert;
    const removeIds = p.removeIds === undefined ? [] : p.removeIds;
    if (!Array.isArray(upsert) || !Array.isArray(removeIds)) throw new Error(`Patch "${name}" bukan daftar`);
    // Baris tanpa id tidak bisa ditarget; lebih baik seluruh patch ditolak dan
    // renderer mengulang lewat jalur penuh daripada ada perubahan yang hilang.
    for (const row of upsert) {
      if (!row || typeof row !== 'object' || (row as any).id === undefined || (row as any).id === null) {
        throw new Error(`Baris tanpa id pada patch "${name}"`);
      }
    }
    for (const pk of removeIds) {
      if (pk === undefined || pk === null || String(pk) === '') throw new Error(`Kunci hapus kosong pada patch "${name}"`);
    }
    siap.push({ name, upsert, removeIds });
  }
  // Semua collection ditulis dalam SATU transaksi: autosave yang membawa tiga
  // collection tidak boleh menyisakan dua di antaranya tertulis kalau yang
  // ketiga gagal di tengah jalan.
  return transact(() => {
    const out: Record<string, unknown> = {};
    for (const p of siap) out[p.name] = saveRows(p.name, { upsert: p.upsert, removeIds: p.removeIds });
    return out;
  });
});

// Pemeriksaan "masih dirujuk" untuk tindakan hapus. Hanya membaca; yang menolak
// hapusnya adalah renderer, supaya nomor dokumen yang menahan bisa ditampilkan.
trustedHandle('db-references', (_e, collection: unknown, id: unknown) => {
  if (!isCollectionName(collection)) throw new Error('Collection tidak dikenal untuk diperiksa');
  return rowReferences(collection, id);
});

trustedHandle('db-query', (_e, req: unknown) => {
  const r = (req || {}) as any;
  if (!isCollectionName(r.collection)) throw new Error('Collection tidak dikenal untuk dibaca');
  return queryCollection({
    collection: r.collection,
    search: typeof r.search === 'string' ? r.search.slice(0, 200) : '',
    where: r.where && typeof r.where === 'object' ? r.where : undefined,
    sort: typeof r.sort === 'string' ? r.sort : undefined,
    desc: r.desc === true,
    limit: Number(r.limit) || undefined,
    offset: Math.max(Number(r.offset) || 0, 0),
  });
});

trustedHandle('db-sum', (_e, collection: unknown, column: unknown, where: unknown) =>
  sumCollection(collection, column, where && typeof where === 'object' ? (where as Record<string, unknown>) : undefined));

// Agregat kelompok untuk Dasbor/Laporan. Sama seperti db-query: nama collection
// wajib ada di daftar putih dan seluruh nama kolom dinilai ulang di lapisan db,
// jadi tidak ada nama kolom atau nilai dari renderer yang pernah menjadi SQL.
trustedHandle('db-group', (_e, req: unknown) => {
  const r = (req || {}) as any;
  if (!isCollectionName(r.collection)) throw new Error('Collection tidak dikenal untuk dibaca');
  return groupCollection({
    collection: r.collection,
    by: Array.isArray(r.by) ? r.by.slice(0, 3) : [],
    sum: typeof r.sum === 'string' ? r.sum : undefined,
    where: r.where && typeof r.where === 'object' ? r.where : undefined,
    search: typeof r.search === 'string' ? r.search.slice(0, 200) : '',
    limit: Number(r.limit) || undefined,
  });
});

trustedHandle('db-stats', () => stats());

trustedHandle('db-integrity', () => integrity());

trustedHandle('db-mark-imported', () => { setMeta(META_IMPORTED, new Date().toISOString()); return { at: getMeta(META_IMPORTED) }; });

// ── Snapshot berkas SQLite ─────────────────────────────────────────────────
// Setiap snapshot dibuat setelah simpanan tertunda renderer masuk ke file,
// memakai handshake yang sama dengan penutupan jendela. Tanpa itu, cadangan
// yang diambil di tengah jendela debounce berisi data yang lebih tua dari
// yang sedang tampil di layar.
trustedHandle('db-snapshot-create', async (_e, input: unknown) => {
  await flushPending();
  return createSnapshot(app.getPath('userData'), (input || {}) as { reason?: unknown; settings?: unknown });
});

trustedHandle('db-snapshot-list', () => ({ snapshots: listSnapshots(app.getPath('userData')) }));

trustedHandle('db-snapshot-restore', async (_e, name: unknown, settings: unknown) => {
  await flushPending();
  return restoreSnapshot(app.getPath('userData'), name, settings);
});

trustedHandle('db-snapshot-clear', () => ({ removed: clearSnapshots(app.getPath('userData')) }));

// ── Flush sebelum jendela atau aplikasi ditutup ─────────────────────────────
// Simpanan di-renderer di-debounce. Kalau jendela ditutup di tengah jendela
// itu, perubahan terakhir hilang. Jadi main process menahan penutupan, meminta
// renderer menuntaskan simpanan, dan baru melanjutkan setelah ada konfirmasi
// (atau setelah 1,5 detik — tidak boleh macet kalau renderer sudah mati).
// Setelah jendela mati, before-quit tidak punya webContents untuk dimintai
// simpanan, jadi handshake yang sama dijalankan sejak peristiwa close.
const FLUSH_BUDGET_MS = 1500;

let flushActions: (() => void)[] = [];
let quitApproved = false;

function runFlushActions(): void {
  const actions = flushActions;
  flushActions = [];
  for (const action of actions) {
    try { action(); } catch (err) { console.error('[flush] Aksi setelah simpanan tuntas gagal:', err); }
  }
}

function requestFlush(after: () => void): void {
  if (!mainWindow || mainWindow.isDestroyed()) { after(); return; }

  const starting = flushActions.length === 0;
  flushActions.push(after);
  // Sudah ada flush yang berjalan; aksi ini ikut dijalankan saat ia selesai.
  if (!starting) return;

  try {
    mainWindow.webContents.send('db-flush-request');
  } catch {
    runFlushActions();
    return;
  }
  setTimeout(runFlushActions, FLUSH_BUDGET_MS);
}

/** Menunggu simpanan renderer masuk ke file sebelum melanjutkan (budget tetap 1,5 detik). */
function flushPending(): Promise<void> {
  return new Promise(resolve => requestFlush(resolve));
}

app.on('before-quit', (event) => {
  if (quitApproved || !mainWindow || mainWindow.isDestroyed()) return;
  event.preventDefault();
  quitApproved = true;
  requestFlush(() => {
    closeDatabase();
    app.exit(0);
  });
});

trustedHandle('db-flush-done', () => runFlushActions());

// ── Foto unit: disimpan sebagai file, bukan base64 di database ─────────
// Nama file dihasilkan renderer dan dibatasi pola ketat: tanpa pemisah path,
// tanpa titik ganda, ekstensi hanya dari daftar yang diizinkan.
const PHOTO_ID_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.(jpg|jpeg|png|webp)$/i;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_PHOTO_COPY_BATCH = 5000;

function photoPath(rawId: unknown): string | null {
  if (typeof rawId !== 'string' || !PHOTO_ID_RE.test(rawId)) return null;
  const dir = path.join(app.getPath('userData'), 'photos');
  const target = path.join(dir, rawId);
  // Pertahanan kedua: hasil akhir harus tetap di dalam folder foto.
  if (!target.startsWith(dir + path.sep)) return null;
  return target;
}

function photoBuffer(data: unknown): Buffer | null {
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

trustedHandle('photo-save', (_event, rawId: unknown, data: unknown) => {
  const target = photoPath(rawId);
  const buffer = photoBuffer(data);
  if (!target) return { success: false, error: 'Nama file foto tidak valid' };
  if (!buffer) return { success: false, error: 'Data foto tidak dikenali' };
  if (buffer.byteLength === 0) return { success: false, error: 'Data foto kosong' };
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    return { success: false, error: `Foto terlalu besar (maks ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB)` };
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Tulis lewat file sementara supaya kegagalan di tengah tidak merusak foto lama.
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, target);
    return { success: true, bytes: buffer.byteLength };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

trustedHandle('photo-read', (_event, rawId: unknown) => {
  const target = photoPath(rawId);
  if (!target) return { success: false, error: 'Nama file foto tidak valid' };
  if (!fs.existsSync(target)) return { success: true, data: null };
  try {
    return { success: true, data: new Uint8Array(fs.readFileSync(target)) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

trustedHandle('photo-delete', (_event, rawId: unknown) => {
  const target = photoPath(rawId);
  if (!target) return { success: false, error: 'Nama file foto tidak valid' };
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Folder foto tidak ikut teks .sanybak, jadi dicopy terpisah ke tujuan
// yang dipilih pengguna agar backup tetap lengkap.
trustedHandle('photo-copy-to', async (_event, sourceIds: unknown) => {
  if (!mainWindow) return { success: false };
  const ids = Array.isArray(sourceIds) ? sourceIds.filter(x => typeof x === 'string').slice(0, MAX_PHOTO_COPY_BATCH) : [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pilih folder untuk menyimpan foto cadangan',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };

  const destDir = path.join(result.filePaths[0], 'photos');
  const srcDir = path.join(app.getPath('userData'), 'photos');
  let copied = 0;
  let missing = 0;
  try {
    fs.mkdirSync(destDir, { recursive: true });
    for (const id of ids) {
      const src = photoPath(id);
      if (!src || !fs.existsSync(src)) { missing++; continue; }
      fs.copyFileSync(src, path.join(destDir, path.basename(src)));
      copied++;
    }
    return { success: true, dir: destDir, copied, missing };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

trustedHandle('photo-copy-from', async (_event, manifest: unknown) => {
  if (!mainWindow) return { success: false };
  const ids = Array.isArray(manifest) ? manifest.filter(x => typeof x === 'string').slice(0, MAX_PHOTO_COPY_BATCH) : [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pilih folder foto dari cadangan',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };

  const srcDir = path.join(result.filePaths[0], 'photos');
  if (!fs.existsSync(srcDir)) return { success: false, error: 'Subfolder "photos" tidak ada di folder yang dipilih' };
  const destDir = path.join(app.getPath('userData'), 'photos');
  let restored = 0;
  let skipped = 0;
  try {
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir).slice(0, MAX_PHOTO_COPY_BATCH)) {
      const validated = photoPath(file);
      if (!validated) { skipped++; continue; }
      // Folder cadangan bisa berisi berkas apa pun; jangan salin file raksasa
      // ke folder data aplikasi.
      if (fs.statSync(path.join(srcDir, file)).size > MAX_PHOTO_BYTES) { skipped++; continue; }
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      restored++;
    }
    return { success: true, restored, skipped, wanted: ids.length };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Native IPC Listeners
trustedHandle('get-system-info', () => {
  return {
    lanIp: getLanIpAddress(),
    hostname: os.hostname(),
    platform: process.platform,
    version: app.getVersion(),
  };
});

const MAX_PRINT_HTML_BYTES = 1024 * 1024; // 1 MB dokumen cetak
const PRINT_LOAD_TIMEOUT_MS = 15_000;

// Isi dokumen cetak dibatasi tanpa skrip: halaman cetak dibuat oleh renderer dan
// bisa berisi nama pelanggan/serial dari berkas backup, jadi tidak boleh ada
// kesempatan menjalankan kode di jendela yang dibuat main process.
const PRINT_CSP = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:\">";

function withPrintCsp(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, tag => `${tag}${PRINT_CSP}`);
  return `<!doctype html><html><head>${PRINT_CSP}</head><body>${html}</body></html>`;
}

/**
 * Cetak pada jendela khusus yang langsung ditutup.
 * Sebelum ada hardening, renderer membuka popup lewat window.open() dan
 * print-document mencetak isi mainWindow — yang tercetak justru antarmuka
 * aplikasi, bukan dokumennya. Popup kini diblokir, jadi jendela cetak dibuat
 * dari sini dengan HTML yang sudah dibatasi.
 */
function printHtmlDocument(html: string, options: any): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const PAGE_SIZES = ['A4', 'A3', 'A5', 'A6', 'Letter', 'Legal', 'Tabloid'] as const;
    const pageSize = PAGE_SIZES.includes(String(options?.pageSize) as any)
      ? String(options?.pageSize) as typeof PAGE_SIZES[number]
      : 'A4';
    const deviceName = typeof options?.deviceName === 'string' ? options.deviceName.slice(0, 200) : '';
    const silent = options?.silent === true;

    const win = new BrowserWindow({
      width: 900,
      height: 1100,
      show: false,
      title: 'Cetak dokumen',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Tanpa preload: jendela cetak tidak punya akses IPC sama sekali.
        experimentalFeatures: false,
      },
    });

    let settled = false;
    const finish = (result: { success: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (!win.isDestroyed()) win.destroy();
      resolve(result);
    };
    const guard = setTimeout(() => finish({ success: false, error: 'Dokumen gagal disiapkan' }), PRINT_LOAD_TIMEOUT_MS);

    win.webContents.once('did-fail-load', () => finish({ success: false, error: 'Dokumen gagal dibuka' }));
    win.webContents.once('did-finish-load', () => {
      win.webContents.print(
        { silent, printBackground: true, deviceName, pageSize },
        (success, errorType) => finish(success ? { success: true } : { success: false, error: String(errorType || 'Pencetakan gagal') })
      );
    });

    const dataUrl = 'data:text/html;charset=utf-8;base64,' + Buffer.from(withPrintCsp(html), 'utf-8').toString('base64');
    win.loadURL(dataUrl).catch(() => finish({ success: false, error: 'Dokumen gagal dibuka' }));
  });
}

trustedHandle('print-document', async (_event, rawHtml: unknown, rawOptions: unknown) => {
  if (typeof rawHtml !== 'string' || rawHtml.trim().length === 0) {
    return { success: false, error: 'Isi dokumen kosong' };
  }
  if (Buffer.byteLength(rawHtml, 'utf-8') > MAX_PRINT_HTML_BYTES) {
    return { success: false, error: 'Dokumen terlalu besar untuk dicetak (maks 1 MB)' };
  }
  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
  return printHtmlDocument(rawHtml, options);
});

trustedHandle('export-backup-dialog', async (_event, dataToBackup: unknown) => {
  if (!mainWindow) return { success: false };
  if (typeof dataToBackup !== 'string') return { success: false, error: 'Isi backup tidak valid' };
  if (dataToBackup.length === 0) return { success: false, error: 'Isi backup kosong' };
  if (Buffer.byteLength(dataToBackup, 'utf-8') > MAX_BACKUP_BYTES) {
    return { success: false, error: `Backup terlalu besar (maks ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)} MB)` };
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Backup Database FATHONI Equipment OS',
    defaultPath: `FATHONI_Database_Backup_${dateStr}.sanybak`,
    filters: [
      { name: 'SANY Backup (*.sanybak)', extensions: ['sanybak'] },
      { name: 'JSON Backup (*.json)', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!result.canceled && result.filePath) {
    try {
      fs.writeFileSync(result.filePath, dataToBackup, 'utf-8');
      return { success: true, filePath: result.filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, canceled: true };
});

trustedHandle('restore-backup-dialog', async () => {
  if (!mainWindow) return { success: false };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pilih File Backup Database FATHONI',
    properties: ['openFile'],
    filters: [
      { name: 'SANY Backup (*.sanybak, *.json)', extensions: ['sanybak', 'json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    const chosen = result.filePaths[0];
    try {
      // Berkas pilihan pengguna bisa apa pun; baca seluruhnya tanpa batas ukuran
      // akan membekukan aplikasi (dan IPC) sebelum sempat validasi.
      const size = fs.statSync(chosen).size;
      if (size > MAX_BACKUP_BYTES) {
        return { success: false, error: `File terlalu besar (${Math.round(size / 1024 / 1024)} MB, maks ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)} MB)` };
      }
      const content = fs.readFileSync(chosen, 'utf-8');
      return { success: true, data: content, filePath: chosen };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, canceled: true };
});
