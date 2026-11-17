// electron/auth.ts
// Penyimpanan akun dan sesi di MAIN process.
//
// Prinsip: renderer tidak pernah melihat password, hash, maupun salt.
// Renderer mengirim kredensial sekali saat login, lalu hanya memegang token sesi.
// Dengan begitu, membuka DevTools atau menyuntik XSS ke halaman tidak memberi
// jalan untuk membaca kredensial atau membuat sesi baru.

import { app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type AccountRole = 'SUPERADMIN' | 'SALES' | 'WAREHOUSE' | 'SERVICE' | 'FINANCE';

const ROLES: AccountRole[] = ['SUPERADMIN', 'SALES', 'WAREHOUSE', 'SERVICE', 'FINANCE'];

interface StoredAccount {
  id: string;
  username: string;          // selalu lowercase
  name: string;
  email: string;
  role: AccountRole;
  active: boolean;
  mustChangePassword: boolean;
  salt: string;              // hex
  hash: string;              // hex
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
}

export interface PublicAccount {
  id: string;
  username: string;
  name: string;
  email: string;
  role: AccountRole;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface AuditEntry {
  at: string;
  event: 'LOGIN_OK' | 'LOGIN_FAIL' | 'LOGIN_LOCKED' | 'LOGOUT' | 'PASSWORD_CHANGED'
       | 'USER_CREATED' | 'USER_UPDATED' | 'USER_DELETED' | 'PASSWORD_RESET'
       | 'DATA_DELETE' | 'DATA_DENY';
  username: string;
  actor?: string;
  detail?: string;
}

interface AccountFile {
  version: number;
  users: StoredAccount[];
  audit: AuditEntry[];
}

type Result<T = {}> = ({ success: true } & T) | { success: false; error: string };

// --- Parameter keamanan ----------------------------------------------------
// scrypt dipilih karena bawaan Node (tanpa dependency native baru).
// N=2^14 tetap kuat untuk aplikasi desktop lokal dan tidak membuat mesin
// dengan RAM kecil tersendat saat login.
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;
const SALT_BYTES = 16;

const MAX_FAILED = 5;
const LOCK_MS = 5 * 60_000;          // 5 menit terkunci setelah 5x salah
const SESSION_IDLE_MS = 12 * 3600_000;
const SESSION_ABS_MS = 24 * 3600_000;
const MAX_AUDIT = 300;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

// Akun awal. Password bawaan hanya dipakai sekali untuk membuat hash saat
// instalasi pertama; setiap akun ditandai wajib ganti password.
const DEFAULT_ACCOUNTS: { username: string; password: string; name: string; email: string; role: AccountRole }[] = [
  { username: 'admin',   password: 'admin123',   name: 'Administrator', email: 'admin@fathoni.id',   role: 'SUPERADMIN' },
  { username: 'sales',   password: 'sales123',   name: 'Budi Santoso',  email: 'sales@fathoni.id',   role: 'SALES' },
  { username: 'gudang',  password: 'gudang123',  name: 'Hendra Wijaya', email: 'gudang@fathoni.id',  role: 'WAREHOUSE' },
  { username: 'service', password: 'service123', name: 'Agus Mekanik',  email: 'service@fathoni.id', role: 'SERVICE' },
  { username: 'finance', password: 'finance123', name: 'Siti Rahayu',   email: 'finance@fathoni.id', role: 'FINANCE' },
];

const GENERIC_LOGIN_ERROR = 'Username atau password salah, atau akun sedang terkunci sementara.';

// --- Berkas akun -----------------------------------------------------------
function accountFile(): string {
  return path.join(app.getPath('userData'), 'accounts.json');
}

function hashPassword(password: string, saltHex: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LEN, SCRYPT_OPTS, (err, derived) => {
      if (err) reject(err); else resolve(derived.toString('hex'));
    });
  });
}

function newSalt(): string {
  return crypto.randomBytes(SALT_BYTES).toString('hex');
}

async function buildAccount(seed: { username: string; password: string; name: string; email: string; role: AccountRole }): Promise<StoredAccount> {
  const salt = newSalt();
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    username: seed.username,
    name: seed.name,
    email: seed.email,
    role: seed.role,
    active: true,
    mustChangePassword: true,
    salt,
    hash: await hashPassword(seed.password, salt),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    failedAttempts: 0,
    lockedUntil: null,
  };
}

function isStoredAccount(v: any): v is StoredAccount {
  return !!v
    && typeof v.id === 'string'
    && typeof v.username === 'string'
    && typeof v.salt === 'string' && /^[0-9a-f]+$/i.test(v.salt)
    && typeof v.hash === 'string' && /^[0-9a-f]+$/i.test(v.hash)
    && ROLES.includes(v.role);
}

let cache: AccountFile | null = null;

async function loadFile(): Promise<AccountFile> {
  if (cache) return cache;

  const file = accountFile();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (parsed && Array.isArray(parsed.users) && parsed.users.every(isStoredAccount) && parsed.users.length > 0) {
        cache = { version: 1, users: parsed.users, audit: Array.isArray(parsed.audit) ? parsed.audit : [] };
        return cache;
      }
      // Struktur tidak dikenali, atau daftar akun kosong (tidak mungkin terjadi
      // lewat aplikasi karena Super Admin terakhir tidak bisa dihapus).
      // Berkasnya dikarantina, lalu dibangun ulang — jangan pernah membiarkan
      // aplikasi terkunci tanpa satu pun akun.
      const backup = `${file}_corrupt_${Date.now()}`;
      fs.copyFileSync(file, backup);
      console.error(`[auth] accounts.json tidak valid dan sudah dikarantina ke ${backup}`);
    }
  } catch (err: any) {
    // Berkas rusak/terpotong: karantina lalu bangun ulang dari nol.
    try { fs.copyFileSync(file, `${file}_corrupt_${Date.now()}`); } catch { /* biarkan */ }
    console.error('[auth] Gagal membaca accounts.json:', err?.message ?? err);
  }

  const users: StoredAccount[] = [];
  for (const seed of DEFAULT_ACCOUNTS) users.push(await buildAccount(seed));
  cache = { version: 1, users, audit: [] };
  persist();
  console.warn('[auth] Akun awal dibuat dari template. Setiap akun wajib ganti password saat login pertama.');
  return cache;
}

function persist() {
  if (!cache) return;
  const file = accountFile();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err: any) {
    console.error('[auth] Gagal menyimpan akun:', err?.message ?? err);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* abaikan */ }
  }
}

function record(entry: Omit<AuditEntry, 'at'>) {
  if (!cache) return;
  cache.audit.push({ at: new Date().toISOString(), ...entry });
  if (cache.audit.length > MAX_AUDIT) cache.audit.splice(0, cache.audit.length - MAX_AUDIT);
}

/**
 * Jejak tulis dari main process (kanal `db-save`/`db-patch`).
 *
 * Yang dicatat hanya yang tidak bisa dibaca kembali dari datanya sendiri:
 * DATA_DENY (percobaan tulis yang ditolak sesi/peran) dan DATA_DELETE (baris yang
 * dihapus — kejadiannya justru hilang dari tabel kalau tidak dicatat). Tulisan
 * biasa TIDAK dicatat: autosave renderer bisa terjadi tiap beberapa detik, dan
 * mengisi 300 baris terakhir accounts.json dengan "units tersimpan" akan
 * menyingkirkan peristiwa login gagal dari halaman Jejak Audit — log akses jadi
 * tidak berguna tepat ketika log itu dibutuhkan. Berkarnya sendiri sudah menjadi
 * bukti tulisan yang sah.
 */
export async function auditData(
  username: string, event: 'DATA_DELETE' | 'DATA_DENY', detail: string
): Promise<void> {
  await loadFile();
  record({ event, username, detail });
  persist();
}

function publicOf(a: StoredAccount): PublicAccount {
  return {
    id: a.id, username: a.username, name: a.name, email: a.email, role: a.role,
    active: a.active, mustChangePassword: a.mustChangePassword,
    createdAt: a.createdAt, lastLoginAt: a.lastLoginAt,
  };
}

// --- Sesi ------------------------------------------------------------------
interface Session { userId: string; issuedAt: number; lastSeen: number; absoluteExpiry: number }
const sessions = new Map<string, Session>();

function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, { userId, issuedAt: now, lastSeen: now, absoluteExpiry: now + SESSION_ABS_MS });
  return token;
}

function dropUserSessions(userId: string) {
  for (const [token, s] of sessions) if (s.userId === userId) sessions.delete(token);
}

/** Kembalikan akun pemilik token, atau null bila token tidak dikenal/kedaluwarsa. */
async function userByToken(token: unknown): Promise<StoredAccount | null> {
  if (typeof token !== 'string' || token.length < 16) return null;
  const s = sessions.get(token);
  if (!s) return null;

  const now = Date.now();
  if (now > s.absoluteExpiry || now - s.lastSeen > SESSION_IDLE_MS) {
    sessions.delete(token);
    return null;
  }

  const data = await loadFile();
  const user = data.users.find(u => u.id === s.userId);
  if (!user || !user.active) {
    sessions.delete(token);
    return null;
  }
  s.lastSeen = now;
  return user;
}

// --- Validasi input --------------------------------------------------------
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function checkPasswordPolicy(password: unknown, username: string): string | null {
  if (typeof password !== 'string') return 'Password tidak valid.';
  if (password.length < MIN_PASSWORD) return `Password minimal ${MIN_PASSWORD} karakter.`;
  if (password.length > MAX_PASSWORD) return `Password maksimal ${MAX_PASSWORD} karakter.`;
  // Spasi di awal/akhir hampir selalu salah ketik dan membuat pengguna terkunci
  // dari password yang sebenarnya ia tulis. Karakter kontrol ditolak karena tidak
  // bisa diketik dengan andal di form mana pun.
  if (/^\s|\s$/.test(password)) return 'Password tidak boleh diawali atau diakhiri spasi.';
  if (/[\u0000-\u001f\u007f]/.test(password)) return 'Password mengandung karakter yang tidak valid.';
  if (username && password.toLowerCase() === username.toLowerCase()) return 'Password tidak boleh sama dengan username.';
  const known = DEFAULT_ACCOUNTS.map(d => d.password);
  if (known.includes(password)) return 'Password masih memakai bawaan instalasi. Tentukan password sendiri.';
  return null;
}

// Hash dummy agar attempts ke username yang tidak ada memakan waktu sama,
// supaya waktu respons tidak membocorkan ada/tidaknya akun.
let dummyHashPromise: Promise<{ salt: string; hash: string }> | null = null;
function dummyHash() {
  if (!dummyHashPromise) {
    const salt = newSalt();
    dummyHashPromise = hashPassword('timing-equalizer-placeholder', salt).then(hash => ({ salt, hash }));
  }
  return dummyHashPromise;
}

async function verify(password: string, salt: string, hash: string): Promise<boolean> {
  const derived = await hashPassword(password, salt);
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- API -------------------------------------------------------------------
export async function login(rawUsername: unknown, rawPassword: unknown): Promise<Result<{ token: string; user: PublicAccount }>> {
  const username = typeof rawUsername === 'string' ? rawUsername.trim().toLowerCase() : '';
  const password = typeof rawPassword === 'string' ? rawPassword : '';
  const data = await loadFile();

  const user = data.users.find(u => u.username === username);
  if (!user) {
    await dummyHash().then(d => verify(password, d.salt, d.hash));
    record({ event: 'LOGIN_FAIL', username: username || '(kosong)', detail: 'username tidak dikenal' });
    persist();
    return { success: false, error: GENERIC_LOGIN_ERROR };
  }

  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60_000);
    record({ event: 'LOGIN_LOCKED', username });
    persist();
    return { success: false, error: `Akun dikunci sementara. Coba lagi dalam ${mins} menit.` };
  }
  if (user.lockedUntil) { user.lockedUntil = null; user.failedAttempts = 0; }

  if (!user.active) {
    record({ event: 'LOGIN_FAIL', username, detail: 'akun nonaktif' });
    persist();
    return { success: false, error: 'Akun dinonaktifkan. Hubungi Super Admin.' };
  }

  if (!password || !(await verify(password, user.salt, user.hash))) {
    user.failedAttempts += 1;
    if (user.failedAttempts >= MAX_FAILED) {
      user.lockedUntil = new Date(Date.now() + LOCK_MS).toISOString();
      user.failedAttempts = 0;
      record({ event: 'LOGIN_LOCKED', username, detail: `terkunci ${LOCK_MS / 60000} menit` });
      persist();
      return { success: false, error: `Terlalu banyak percobaan gagal. Akun dikunci ${LOCK_MS / 60000} menit.` };
    }
    record({ event: 'LOGIN_FAIL', username, detail: `percobaan gagal ${user.failedAttempts}/${MAX_FAILED}` });
    persist();
    return { success: false, error: GENERIC_LOGIN_ERROR };
  }

  user.failedAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date().toISOString();
  const token = createSession(user.id);
  record({ event: 'LOGIN_OK', username });
  persist();
  return { success: true, token, user: publicOf(user) };
}

export async function session(rawToken: unknown): Promise<Result<{ user: PublicAccount; mustChangePassword: boolean }>> {
  const user = await userByToken(rawToken);
  if (!user) return { success: false, error: 'Sesi tidak valid atau kedaluwarsa.' };
  return { success: true, user: publicOf(user), mustChangePassword: user.mustChangePassword };
}

export async function logout(rawToken: unknown): Promise<Result> {
  const user = await userByToken(rawToken);
  if (typeof rawToken === 'string') sessions.delete(rawToken);
  if (user) { record({ event: 'LOGOUT', username: user.username }); persist(); }
  return { success: true };
}

export async function changePassword(rawToken: unknown, rawCurrent: unknown, rawNext: unknown): Promise<Result> {
  const user = await userByToken(rawToken);
  if (!user) return { success: false, error: 'Sesi tidak valid.' };

  const current = typeof rawCurrent === 'string' ? rawCurrent : '';
  if (!(await verify(current, user.salt, user.hash))) {
    record({ event: 'PASSWORD_CHANGED', username: user.username, detail: 'DITOLAK: password lama salah' });
    persist();
    return { success: false, error: 'Password lama salah.' };
  }

  const policy = checkPasswordPolicy(rawNext, user.username);
  if (policy) return { success: false, error: policy };

  user.salt = newSalt();
  user.hash = await hashPassword(String(rawNext), user.salt);
  user.mustChangePassword = false;
  user.updatedAt = new Date().toISOString();

  // Semua sesi lama dibuang: perubahan password harus menutup pintu sesi lain.
  const keepToken = typeof rawToken === 'string' ? rawToken : '';
  dropUserSessions(user.id);
  if (keepToken) sessions.set(keepToken, { userId: user.id, issuedAt: Date.now(), lastSeen: Date.now(), absoluteExpiry: Date.now() + SESSION_ABS_MS });

  record({ event: 'PASSWORD_CHANGED', username: user.username });
  persist();
  return { success: true };
}

/** Daftar akun untuk halaman Pengguna. Hanya SUPERADMIN. */
export async function listAccounts(rawToken: unknown): Promise<Result<{ accounts: PublicAccount[] }>> {
  const actor = await userByToken(rawToken);
  if (!actor) return { success: false, error: 'Sesi tidak valid.' };
  if (actor.role !== 'SUPERADMIN') return { success: false, error: 'Hanya Super Admin yang dapat mengelola akun.' };
  const data = await loadFile();
  return { success: true, accounts: data.users.map(publicOf) };
}

function sanitizeText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/[\u0000-\u001f]/g, '').trim();
  if (clean.length === 0 || clean.length > max) return null;
  return clean;
}

export interface SaveAccountInput {
  id?: string;
  username?: string;
  name?: string;
  email?: string;
  role?: string;
  active?: boolean;
  password?: string;
}

/** Buat atau ubah akun. Hanya SUPERADMIN. Perubahan role/keaktifan langsung
 *  menutup sesi pemilik akun agar tidak bertahan dengan hak akses lama. */
export async function saveAccount(rawToken: unknown, input: SaveAccountInput): Promise<Result<{ account: PublicAccount }>> {
  const actor = await userByToken(rawToken);
  if (!actor) return { success: false, error: 'Sesi tidak valid.' };
  if (actor.role !== 'SUPERADMIN') return { success: false, error: 'Hanya Super Admin yang dapat mengelola akun.' };

  const data = await loadFile();
  const name = sanitizeText(input.name, 80);
  const email = sanitizeText(input.email, 120);
  if (!name) return { success: false, error: 'Nama tidak valid (1-80 karakter).' };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, error: 'Email tidak valid.' };
  if (!input.role || !ROLES.includes(input.role as AccountRole)) return { success: false, error: 'Role tidak dikenal.' };
  if (typeof input.active !== 'boolean') return { success: false, error: 'Status aktif tidak valid.' };

  const creating = !input.id;
  const username = creating
    ? (typeof input.username === 'string' ? input.username.trim().toLowerCase() : '')
    : (data.users.find(u => u.id === input.id)?.username ?? '');

  if (creating && !USERNAME_RE.test(username)) {
    return { success: false, error: 'Username 3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.' };
  }
  if (data.users.some(u => u.username === username && u.id !== input.id)) {
    return { success: false, error: 'Username sudah dipakai.' };
  }

  const target = creating ? null : data.users.find(u => u.id === input.id);
  if (!creating && !target) return { success: false, error: 'Akun tidak ditemukan.' };

  // Jangan biarkan Super Admin mengunci dirinya sendiri dari aplikasi.
  if (target && target.id === actor.id) {
    if (!input.active) return { success: false, error: 'Anda tidak dapat menonaktifkan akun sendiri.' };
    if (target.role === 'SUPERADMIN' && input.role !== 'SUPERADMIN') {
      return { success: false, error: 'Anda tidak dapat menurunkan hak akses sendiri.' };
    }
  }
  const superAdmins = data.users.filter(u => u.role === 'SUPERADMIN' && u.active && u.id !== target?.id).length;
  const keepsAdmin = input.role === 'SUPERADMIN' || !input.active;
  if (!keepsAdmin && superAdmins === 0 && target?.role === 'SUPERADMIN') {
    return { success: false, error: 'Harus tetap ada minimal satu Super Admin yang aktif.' };
  }

  if (creating) {
    const policy = checkPasswordPolicy(input.password, username);
    if (policy) return { success: false, error: policy };
    const salt = newSalt();
    const now = new Date().toISOString();
    const account: StoredAccount = {
      id: crypto.randomUUID(), username, name, email, role: input.role as AccountRole,
      active: input.active, mustChangePassword: false, salt,
      hash: await hashPassword(String(input.password), salt),
      createdAt: now, updatedAt: now, lastLoginAt: null, failedAttempts: 0, lockedUntil: null,
    };
    data.users.push(account);
    record({ event: 'USER_CREATED', username: account.username, actor: actor.username });
    persist();
    return { success: true, account: publicOf(account) };
  }

  const existing = target!;
  const roleChanged = existing.role !== input.role || existing.active !== input.active;
  existing.name = name;
  existing.email = email;
  existing.role = input.role as AccountRole;
  existing.active = input.active;
  existing.updatedAt = new Date().toISOString();
  if (input.password) {
    const policy = checkPasswordPolicy(input.password, existing.username);
    if (policy) return { success: false, error: policy };
    existing.salt = newSalt();
    existing.hash = await hashPassword(String(input.password), existing.salt);
    existing.mustChangePassword = false;
    record({ event: 'PASSWORD_RESET', username: existing.username, actor: actor.username });
  }
  if (roleChanged) dropUserSessions(existing.id);

  record({ event: 'USER_UPDATED', username: existing.username, actor: actor.username,
           detail: `role=${existing.role} active=${existing.active}` });
  persist();
  return { success: true, account: publicOf(existing) };
}

export async function deleteAccount(rawToken: unknown, rawId: unknown): Promise<Result> {
  const actor = await userByToken(rawToken);
  if (!actor) return { success: false, error: 'Sesi tidak valid.' };
  if (actor.role !== 'SUPERADMIN') return { success: false, error: 'Hanya Super Admin yang dapat menghapus akun.' };
  if (typeof rawId !== 'string') return { success: false, error: 'Id akun tidak valid.' };
  if (rawId === actor.id) return { success: false, error: 'Anda tidak dapat menghapus akun sendiri.' };

  const data = await loadFile();
  const target = data.users.find(u => u.id === rawId);
  if (!target) return { success: false, error: 'Akun tidak ditemukan.' };
  if (target.role === 'SUPERADMIN' && target.active
      && data.users.filter(u => u.role === 'SUPERADMIN' && u.active && u.id !== rawId).length === 0) {
    return { success: false, error: 'Super Admin terakhir tidak dapat dihapus.' };
  }

  data.users = data.users.filter(u => u.id !== rawId);
  dropUserSessions(rawId);
  record({ event: 'USER_DELETED', username: target.username, actor: actor.username });
  persist();
  return { success: true };
}

export async function auditLog(rawToken: unknown): Promise<Result<{ entries: AuditEntry[] }>> {
  const actor = await userByToken(rawToken);
  if (!actor) return { success: false, error: 'Sesi tidak valid.' };
  if (actor.role !== 'SUPERADMIN') return { success: false, error: 'Hanya Super Admin yang dapat melihat log login.' };
  const data = await loadFile();
  return { success: true, entries: data.audit.slice(-100).reverse() };
}

/** Dipanggil saat aplikasi siap, supaya berkas akun dibuat sebelum login pertama. */
export async function initAuth() {
  await loadFile();
}
