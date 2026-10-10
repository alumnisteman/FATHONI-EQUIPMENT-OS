// src/services/authClient.ts
// Satu-satunya tempat renderer berbicara soal akun.
//
// Desktop (Electron): kredensial dikirim ke main process, balasan hanya berupa
// token sesi + data akun tanpa password/hash/salt. Semua operasi setelah login
// menyertakan token, dan main process yang memutuskan hak aksesnya.
//
// Browser: tidak ada backend. Yang tersedia hanya mode demo berlabel jelas —
// daftar akun fiktif tanpa password, jadi tidak ada kredensial asli yang
// dikirim atau tersimpan di halaman demo.

import type { User, UserRole } from '../types';

export const SESSION_STORAGE_KEY = 'hems_session_v2';

// Sesi lama disimpan sebagai JSON user polos tanpa token. Bentuk itu tidak bisa
// diverifikasi lagi, jadi key-nya dibersihkan dan pengguna login satu kali lagi.
const LEGACY_SESSION_KEYS = ['hems_session'];

export interface AccountInput {
  id?: string;
  username?: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  password?: string;
}

export interface AuditEntry {
  at: string;
  event: string;
  username: string;
  actor?: string;
  detail?: string;
}

type Res<T = {}> = { success: boolean; error?: string } & Partial<T>;

interface DesktopAuthApi {
  login(username: string, password: string): Promise<Res<{ token: string; user: User }>>;
  logout(token: string): Promise<Res>;
  session(token: string): Promise<Res<{ user: User; mustChangePassword: boolean }>>;
  changePassword(token: string, current: string, next: string): Promise<Res>;
  listAccounts(token: string): Promise<Res<{ accounts: User[] }>>;
  saveAccount(token: string, input: AccountInput): Promise<Res<{ account: User }>>;
  deleteAccount(token: string, id: string): Promise<Res>;
  auditLog(token: string): Promise<Res<{ entries: AuditEntry[] }>>;
}

interface SessionRecord {
  token: string;
  user: User;
}

// ── Jembatan ke main process ────────────────────────────────────────────────
function desktopApi(): DesktopAuthApi | null {
  const api = (window as any).electronAPI;
  return api && typeof api.login === 'function' ? (api as DesktopAuthApi) : null;
}

/** True bila berjalan sebagai aplikasi desktop; mode browser = demo. */
export function isDesktopApp(): boolean {
  return desktopApi() !== null;
}

// ── Akun demo (hanya ada di mode browser) ───────────────────────────────────
const DEMO_ACCOUNTS: User[] = [
  demo('1', 'admin', 'Administrator', 'admin@fathoni.id', 'SUPERADMIN'),
  demo('2', 'sales', 'Budi Santoso', 'sales@fathoni.id', 'SALES'),
  demo('3', 'gudang', 'Hendra Wijaya', 'gudang@fathoni.id', 'WAREHOUSE'),
  demo('4', 'service', 'Agus Mekanik', 'service@fathoni.id', 'SERVICE'),
  demo('5', 'finance', 'Siti Rahayu', 'finance@fathoni.id', 'FINANCE'),
];

function demo(id: string, username: string, name: string, email: string, role: UserRole): User {
  const createdAt = new Date(0).toISOString();
  return { id, username, name, email, role, createdAt, active: true, mustChangePassword: false };
}

export function demoAccounts(): User[] {
  return DEMO_ACCOUNTS.map(u => ({ ...u }));
}

// ── Simpan/baca sesi ────────────────────────────────────────────────────────
function readStored(): SessionRecord | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as SessionRecord;
    const ok = parsed
      && typeof parsed.token === 'string' && parsed.token.length >= 16
      && parsed.user && typeof parsed.user.username === 'string'
      && typeof parsed.user.role === 'string';
    if (!ok) throw new Error('bentuk sesi tidak dikenal');
    return parsed;
  } catch {
    clearStored();
    return null;
  }
}

function writeStored(record: SessionRecord) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* localStorage penuh: sesi tetap berjalan sampai aplikasi ditutup */
  }
}

function clearStored() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    LEGACY_SESSION_KEYS.forEach(k => localStorage.removeItem(k));
  } catch {
    /* private mode: memang tidak ada yang tersimpan */
  }
}

/** Sesi aktif, atau null bila belum login / kedaluwarsa. */
export function currentToken(): string | null {
  return readStored()?.token ?? null;
}

export function cachedUser(): User | null {
  return readStored()?.user ?? null;
}

// ── Operasi ─────────────────────────────────────────────────────────────────
export async function login(username: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
  const api = desktopApi();
  if (api) {
    const res = await api.login(username, password);
    if (!res.success || !res.token || !res.user) return { success: false, error: res.error };
    writeStored({ token: res.token, user: res.user });
    return { success: true, user: res.user };
  }

  // Mode demo browser: username saja, tanpa membandingkan password apa pun.
  const name = username.trim().toLowerCase();
  const found = DEMO_ACCOUNTS.find(u => u.username === name);
  if (!found) return { success: false, error: 'Akun demo tidak dikenal. Pilih salah satu akun demo yang terdaftar.' };
  writeStored({ token: `demo-${found.id}-${Date.now()}`, user: { ...found } });
  return { success: true, user: { ...found } };
}

/**
 * Pulihkan sesi saat aplikasi dibuka. Di desktop, token selalu diverifikasi
 * ulang ke main process — peran atau status akun bisa berubah sejak login,
 * dan hanya jawaban main process yang dipercaya.
 */
export async function restoreSession(): Promise<User | null> {
  const stored = readStored();
  if (!stored) return null;

  const api = desktopApi();
  if (api) {
    const res = await api.session(stored.token);
    if (!res.success || !res.user) {
      clearStored();
      return null;
    }
    writeStored({ token: stored.token, user: res.user });
    return res.user;
  }

  const stillDemo = DEMO_ACCOUNTS.find(u => u.id === stored.user.id);
  if (!stillDemo) {
    clearStored();
    return null;
  }
  return stored.user;
}

export async function logout(): Promise<void> {
  const stored = readStored();
  const api = desktopApi();
  if (api && stored) await api.logout(stored.token);
  clearStored();
}

export async function changePassword(current: string, next: string): Promise<{ success: boolean; error?: string; user?: User }> {
  const stored = readStored();
  const api = desktopApi();
  if (!api) return { success: false, error: 'Ganti password hanya tersedia di aplikasi desktop. Mode demo browser tidak memakai password.' };
  if (!stored) return { success: false, error: 'Sesi tidak tersedia.' };

  const res = await api.changePassword(stored.token, current, next);
  if (!res.success) return { success: false, error: res.error };

  // Token lama tetap berlaku, tapi flag wajib-ganti sudah hilang di main process.
  const refreshed = await api.session(stored.token);
  const user = refreshed.success && refreshed.user ? refreshed.user : { ...stored.user, mustChangePassword: false };
  writeStored({ token: stored.token, user });
  return { success: true, user };
}

export async function listAccounts(): Promise<{ success: boolean; accounts?: User[]; error?: string }> {
  const stored = readStored();
  const api = desktopApi();
  if (!api) return { success: true, accounts: demoAccounts() };
  if (!stored) return { success: false, error: 'Sesi tidak tersedia.' };

  const res = await api.listAccounts(stored.token);
  return res.success ? { success: true, accounts: res.accounts } : { success: false, error: res.error };
}

export async function saveAccount(input: AccountInput): Promise<{ success: boolean; account?: User; error?: string }> {
  const stored = readStored();
  const api = desktopApi();
  if (!api) return { success: false, error: 'Pengelolaan akun hanya berjalan di aplikasi desktop.' };
  if (!stored) return { success: false, error: 'Sesi tidak tersedia.' };

  const res = await api.saveAccount(stored.token, input);
  return res.success ? { success: true, account: res.account } : { success: false, error: res.error };
}

export async function deleteAccount(id: string): Promise<{ success: boolean; error?: string }> {
  const stored = readStored();
  const api = desktopApi();
  if (!api) return { success: false, error: 'Pengelolaan akun hanya berjalan di aplikasi desktop.' };
  if (!stored) return { success: false, error: 'Sesi tidak tersedia.' };

  const res = await api.deleteAccount(stored.token, id);
  return res.success ? { success: true } : { success: false, error: res.error };
}

export async function auditLog(): Promise<{ success: boolean; entries?: AuditEntry[]; error?: string }> {
  const stored = readStored();
  const api = desktopApi();
  if (!api) return { success: true, entries: [] };
  if (!stored) return { success: false, error: 'Sesi tidak tersedia.' };

  const res = await api.auditLog(stored.token);
  return res.success ? { success: true, entries: res.entries } : { success: false, error: res.error };
}
