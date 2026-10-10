// src/store/configStore.tsx
// BUG-013 FIX: Perbaiki race condition di completeSetup()
// State digunakan langsung dari React state, bukan re-read dari localStorage

import { createContext, useContext, useState, useEffect, useMemo, ReactNode, useCallback } from 'react';

export type BusinessMode = 'PERSONAL' | 'CONTRACTOR' | 'RENTAL' | 'DEALER' | 'WORKSHOP' | 'TRADER';

export const PROFILE_INFO: Record<BusinessMode, { title: string; shortTitle: string; icon: string; color: string; desc: string }> = {
  PERSONAL:   { title: 'Pemilik Alat (Perorangan)', shortTitle: 'Pemilik Alat', icon: '🚜', color: '#10B981', desc: 'Fokus pada 1–5 unit alat berat, HM, & pendapatan operasional' },
  DEALER:     { title: 'Dealer / Distributor',      shortTitle: 'Dealer',       icon: '🏢', color: '#3B82F6', desc: 'Fokus penjualan unit baru, penawaran, & komisi dealer' },
  CONTRACTOR: { title: 'Kontraktor Project',        shortTitle: 'Kontraktor',   icon: '🏗️', color: '#F59E0B', desc: 'Fokus utilisasi armada tambang/proyek, BBM, & maintenance' },
  RENTAL:     { title: 'Perusahaan Sewa (Rental)',  shortTitle: 'Rental',       icon: '🚚', color: '#8B5CF6', desc: 'Fokus kontrak sewa bulanan, jobsite, & billing piutang' },
  WORKSHOP:   { title: 'Bengkel / Workshop',        shortTitle: 'Workshop',     icon: '🔧', color: '#EC4899', desc: 'Fokus Work Order, teknisi mekanik, & stok suku cadang' },
  TRADER:     { title: 'Pedagang Alat Bekas',       shortTitle: 'Trader Bekas', icon: '💰', color: '#06B6D4', desc: 'Fokus stok jual-beli alat bekas & marjin keuntungan' },
};

interface ConfigState {
  modes:             BusinessMode[];
  customMenus:       string[];
  isSetupComplete:   boolean;
  setModes:          (modes: BusinessMode[]) => void;
  toggleCustomMenu:  (path: string) => void;
  enableAllMenus:    () => void;
  completeSetup:     () => void;
  resetSetup:        () => void;
  hasMode:           (mode: BusinessMode) => boolean;
  isMenuEnabled:     (path: string, requiredModes?: BusinessMode[]) => boolean;
  getActiveProfileBadge: () => { title: string; icon: string; color: string };
}

const ConfigContext = createContext<ConfigState | undefined>(undefined);

const STORAGE_KEY = 'hems_business_modes'; // BUG-006: konsisten lowercase

interface StoredConfig {
  modes:          BusinessMode[];
  customMenus?:   string[];
  isSetupComplete: boolean;
}

/** Simpan konfigurasi bisnis ke localStorage */
function persistConfig(modes: BusinessMode[], customMenus: string[], isSetupComplete: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ modes, customMenus, isSetupComplete }));
  } catch (e) {
    console.error('[ConfigStore] Gagal menyimpan konfigurasi:', e);
  }
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [modes, setModesState]               = useState<BusinessMode[]>([]);
  const [customMenus, setCustomMenusState]   = useState<string[]>([]);
  const [isSetupComplete, setIsSetupComplete] = useState<boolean>(false);
  const [isLoaded, setIsLoaded]              = useState(false);

  // Muat konfigurasi dari localStorage saat mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StoredConfig = JSON.parse(stored);
        setModesState(Array.isArray(parsed.modes) ? parsed.modes : []);
        setCustomMenusState(Array.isArray(parsed.customMenus) ? parsed.customMenus : []);
        setIsSetupComplete(Boolean(parsed.isSetupComplete));
      }
    } catch (e) {
      console.error('[ConfigStore] Gagal memuat konfigurasi bisnis:', e);
      // Reset ke default jika rusak
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }
    setIsLoaded(true);
  }, []);

  // BUG-013 FIX: Fungsi setModes yang benar — tidak ada race condition
  const setModes = useCallback((newModes: BusinessMode[]) => {
    setModesState(newModes);
    // Gunakan functional update agar custom menus selalu fresh
    setCustomMenusState(prev => {
      persistConfig(newModes, prev, isSetupComplete);
      return prev;
    });
  }, [isSetupComplete]);

  const toggleCustomMenu = useCallback((path: string) => {
    setCustomMenusState(prev => {
      const updated = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path];
      setModesState(m => { persistConfig(m, updated, isSetupComplete); return m; });
      return updated;
    });
  }, [isSetupComplete]);

  const enableAllMenus = useCallback(() => {
    const ALL_PATHS = [
      '/units', '/brands', '/customers', '/suppliers', '/operators', '/technicians',
      '/sales', '/purchase', '/rental', '/invoices', '/approvals',
      '/service', '/breakdown', '/warehouse', '/spareparts', '/delivery',
      '/finance', '/reports',
      '/users', '/audit-log', '/documents', '/settings', '/backup', '/maintenance',
    ];
    setCustomMenusState(ALL_PATHS);
    setModesState(m => { persistConfig(m, ALL_PATHS, isSetupComplete); return m; });
  }, [isSetupComplete]);

  // BUG-013 FIX: completeSetup() menggunakan React state langsung (bukan re-read dari localStorage)
  const completeSetup = useCallback(() => {
    setIsSetupComplete(true);
    setModesState(m => {
      setCustomMenusState(c => {
        persistConfig(m, c, true);
        return c;
      });
      return m;
    });
  }, []);

  const resetSetup = useCallback(() => {
    setIsSetupComplete(false);
    setModesState(m => {
      setCustomMenusState(c => {
        persistConfig(m, c, false);
        return c;
      });
      return m;
    });
  }, []);

  const hasMode = useCallback((mode: BusinessMode) => modes.includes(mode), [modes]);

  const isMenuEnabled = useCallback((path: string, requiredModes?: BusinessMode[]) => {
    // Jika ada di customMenus, selalu tampilkan
    if (customMenus.includes(path)) return true;
    // Jika tidak ada requiredModes, selalu tampilkan
    if (!requiredModes || requiredModes.length === 0) return true;
    // Tampilkan jika ada mode yang cocok
    return requiredModes.some(req => modes.includes(req));
  }, [customMenus, modes]);

  const getActiveProfileBadge = useCallback(() => {
    if (modes.length === 0) return { title: 'Semua Profil',      icon: '⚡', color: '#E60012' };
    if (modes.length === 1) {
      const info = PROFILE_INFO[modes[0]];
      return { title: info.shortTitle, icon: info.icon, color: info.color };
    }
    return {
      title: `${modes.length} Profil Aktif`,
      icon:  PROFILE_INFO[modes[0]]?.icon || '🏢',
      color: 'var(--sany-red)',
    };
  }, [modes]);

  // Nilai context dibungkus useMemo agar konsumen tidak ikut render ulang
  // setiap kali komponen induk render tanpa ada konfigurasi yang berubah.
  const contextValue = useMemo<ConfigState>(() => ({
    modes, customMenus, isSetupComplete,
    setModes, toggleCustomMenu, enableAllMenus,
    completeSetup, resetSetup, hasMode, isMenuEnabled, getActiveProfileBadge,
  }), [
    modes, customMenus, isSetupComplete,
    toggleCustomMenu, enableAllMenus, completeSetup, resetSetup,
    hasMode, isMenuEnabled, getActiveProfileBadge,
  ]);

  // Jangan render sampai konfigurasi dimuat (hindari flash profil kosong)
  if (!isLoaded) return null;

  return (
    <ConfigContext.Provider value={contextValue}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig harus digunakan di dalam ConfigProvider');
  }
  return context;
}
