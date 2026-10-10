// src/store/authStore.ts
// State autentikasi renderer.
//
// File ini sengaja tidak tahu apa pun tentang password akun: semua perbandingan
// terjadi di main process (electron/auth.ts). Yang disimpan di sini hanya token
// sesi dan data akun tanpa kredensial, lewat src/services/authClient.ts.

import {
  createContext, useContext, useState, useCallback, useEffect, useMemo,
  ReactNode, createElement,
} from 'react';
import type { User, AuthState } from '../types';
import * as auth from '../services/authClient';

// ── Tipe context ──────────────────────────────────────────────
interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  changePassword: (current: string, next: string) => Promise<{ success: boolean; error?: string }>;
  hasRole: (...roles: User['role'][]) => boolean;
  // Password masih bawaan instalasi dan wajib diganti sebelum memakai aplikasi.
  mustChangePassword: boolean;
  // Browser tidak punya proses utama: login di sana murni mode demo.
  demoMode: boolean;
}

// ── Context ───────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | null>(null);

// Sesi desktop diverifikasi ulang selagi aplikasi terbuka. Tanpa ini, akun yang
// dinonaktifkan atau turun peran oleh Super Admin lain tetap bisa memakai
// aplikasi sampai pengguna menutup jendela.
const REVALIDATE_MS = 5 * 60_000;

// ── Provider ──────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, isAuthenticated: false, isLoading: true });
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const demoMode = !auth.isDesktopApp();

  const applyUser = useCallback((user: User | null) => {
    setState({ user, isAuthenticated: !!user, isLoading: false });
    setMustChangePassword(user?.mustChangePassword ?? false);
  }, []);

  // Validasi sesi tersimpan saat aplikasi dibuka.
  useEffect(() => {
    let cancelled = false;
    auth.restoreSession()
      .then(user => { if (!cancelled) applyUser(user); })
      .catch(() => { if (!cancelled) applyUser(null); });
    return () => { cancelled = true; };
  }, [applyUser]);

  useEffect(() => {
    if (demoMode || !state.isAuthenticated) return;
    const timer = setInterval(() => {
      auth.restoreSession()
        .then(user => { if (!user) applyUser(null); else setMustChangePassword(user.mustChangePassword); })
        .catch(() => undefined);
    }, REVALIDATE_MS);
    return () => clearInterval(timer);
  }, [demoMode, state.isAuthenticated, applyUser]);

  const login = useCallback(async (username: string, password: string) => {
    setState(s => ({ ...s, isLoading: true }));
    try {
      const result = await auth.login(username, password);
      if (result.success && result.user) {
        applyUser(result.user);
        return { success: true };
      }
      setState(s => ({ ...s, isLoading: false }));
      return { success: false, error: result.error || 'Username atau password salah.' };
    } catch (err: any) {
      setState(s => ({ ...s, isLoading: false }));
      return { success: false, error: err?.message || 'Login gagal diproses.' };
    }
  }, [applyUser]);

  const logout = useCallback(() => {
    // Token dibuang di main process; renderer tidak boleh menahan sesi.
    void auth.logout();
    applyUser(null);
  }, [applyUser]);

  const changePassword = useCallback(async (current: string, next: string) => {
    const result = await auth.changePassword(current, next);
    if (result.success) {
      if (result.user) applyUser(result.user);
      else setMustChangePassword(false);
    }
    return { success: result.success, error: result.error };
  }, [applyUser]);

  const hasRole = useCallback((...roles: User['role'][]) => {
    return state.user ? roles.includes(state.user.role) : false;
  }, [state.user]);

  // Nilai context dibungkus useMemo agar identitas objek stabil selama
  // sesi dan aksi tidak berubah.
  const contextValue = useMemo<AuthContextType>(
    () => ({ ...state, login, logout, changePassword, hasRole, mustChangePassword, demoMode }),
    [state, login, logout, changePassword, hasRole, mustChangePassword, demoMode],
  );

  return createElement(
    AuthContext.Provider,
    { value: contextValue },
    children
  );
}

// ── Hook ──────────────────────────────────────────────────────
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus digunakan di dalam AuthProvider');
  return ctx;
}

export type { AuthContextType };
