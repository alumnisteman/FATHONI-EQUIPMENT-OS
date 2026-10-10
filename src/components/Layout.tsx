// src/components/Layout.tsx
// BUG-010 FIX: Restruktur menu berdasarkan alur kerja bisnis (dari awal sampai selesai)
// BUG-012 FIX: Konfirmasi sebelum reset profil bisnis
// BUG-017 FIX: Global search berfungsi (navigasi ke menu)

import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/authStore';
import { useConfig, BusinessMode } from '../store/configStore';
import { useDataStore } from '../store/dataStore';
import CommandPalette from './CommandPalette';

// ── Ikon SVG mini ──────────────────────────────────────────────
const Icon = ({ d, viewBox = '0 0 24 24' }: { d: string; viewBox?: string }) => (
  <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="sidebar-item-icon">
    <path d={d} />
  </svg>
);

// ── Definisi Menu ─────────────────────────────────────────────
interface NavItem {
  path: string;
  label: string;
  icon: string;
  keywords?: string[];          // Kata kunci tambahan untuk search
  requiredModes?: BusinessMode[];
  requiredRoles?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * MENU DIURUTKAN BERDASARKAN ALUR KERJA BISNIS:
 * 1. Utama        → Dashboard & Control Tower (overview)
 * 2. Master Data  → Setup data referensi (merek, unit, pelanggan, pemasok, SDM)
 * 3. Transaksi    → Kegiatan jual-beli & sewa (sales, purchase, rental, invoice)
 * 4. Operasional  → Pelaksanaan lapangan (gudang, servis, breakdown, pengiriman)
 * 5. Keuangan     → Kas, bank & laporan keuangan
 * 6. Sistem       → Admin, akses, backup, audit
 */
const NAV_GROUPS: NavGroup[] = [
  // ── 1. UTAMA ─────────────────────────────────────────────
  {
    label: 'Utama',
    items: [
      {
        path: '/dashboard',
        label: 'Dasbor',
        keywords: ['dashboard', 'beranda', 'ringkasan', 'statistik'],
        icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
      },
      {
        path: '/control-tower',
        label: 'Control Tower',
        keywords: ['monitor', 'pantau', 'live', 'overview'],
        icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
      },
    ],
  },

  // ── 2. MASTER DATA ────────────────────────────────────────
  {
    label: 'Master Data',
    items: [
      {
        path: '/brands',
        label: 'Merek & Model',
        keywords: ['brand', 'merek', 'model', 'tipe', 'kategori'],
        icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z',
        requiredModes: ['DEALER', 'TRADER', 'WORKSHOP', 'CONTRACTOR', 'RENTAL'],
      },
      {
        path: '/units',
        label: 'Unit / Armada',
        keywords: ['unit', 'armada', 'alat', 'excavator', 'mesin', 'fleet'],
        icon: 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',
      },
      {
        path: '/customers',
        label: 'Pelanggan',
        keywords: ['customer', 'pelanggan', 'klien', 'pembeli', 'buyer'],
        icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
        requiredModes: ['DEALER', 'RENTAL', 'WORKSHOP', 'TRADER', 'CONTRACTOR'],
      },
      {
        path: '/suppliers',
        label: 'Pemasok',
        keywords: ['supplier', 'pemasok', 'vendor', 'rekanan'],
        icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
        requiredModes: ['DEALER', 'CONTRACTOR', 'WORKSHOP', 'TRADER'],
      },
      {
        path: '/operators',
        label: 'Operator',
        keywords: ['operator', 'driver', 'pengemudi', 'supir'],
        icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
        requiredModes: ['CONTRACTOR', 'RENTAL', 'DEALER'],
      },
      {
        path: '/technicians',
        label: 'Teknisi',
        keywords: ['teknisi', 'mekanik', 'teknician', 'montir'],
        icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
        requiredModes: ['WORKSHOP', 'CONTRACTOR', 'DEALER', 'RENTAL'],
      },
    ],
  },

  // ── 3. TRANSAKSI ──────────────────────────────────────────
  {
    label: 'Transaksi',
    items: [
      {
        path: '/sales',
        label: 'Penjualan',
        keywords: ['penjualan', 'jual', 'sales', 'order', 'SO'],
        icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
        requiredModes: ['DEALER', 'TRADER'],
      },
      {
        path: '/purchase',
        label: 'Pembelian',
        keywords: ['pembelian', 'beli', 'purchase', 'PO', 'order pembelian'],
        icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
        requiredModes: ['DEALER', 'CONTRACTOR', 'TRADER'],
      },
      {
        path: '/rental',
        label: 'Sewa / Rental',
        keywords: ['sewa', 'rental', 'kontrak', 'lease'],
        icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
        requiredModes: ['RENTAL', 'CONTRACTOR'],
      },
      {
        path: '/invoices',
        label: 'Faktur / Invoice',
        keywords: ['faktur', 'invoice', 'tagihan', 'billing', 'kwitansi'],
        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
        requiredModes: ['DEALER', 'RENTAL', 'WORKSHOP', 'TRADER'],
      },
      {
        path: '/approvals',
        label: 'Persetujuan (Approval)',
        keywords: ['approval', 'persetujuan', 'otorisasi', 'authorize', 'approve'],
        icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      },
    ],
  },

  // ── 4. OPERASIONAL ────────────────────────────────────────
  {
    label: 'Operasional',
    items: [
      {
        path: '/service',
        label: 'Servis & Work Order',
        keywords: ['servis', 'service', 'WO', 'work order', 'perawatan', 'maintenance'],
        icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z',
      },
      {
        path: '/breakdown',
        label: 'Breakdown',
        keywords: ['breakdown', 'rusak', 'mogok', 'darurat', 'emergency'],
        icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
      },
      {
        path: '/warehouse',
        label: 'Gudang',
        keywords: ['gudang', 'warehouse', 'stok', 'stock', 'inventory'],
        icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
        requiredModes: ['DEALER', 'CONTRACTOR', 'WORKSHOP'],
      },
      {
        path: '/spareparts',
        label: 'Suku Cadang',
        keywords: ['suku cadang', 'spare part', 'onderdil', 'part', 'komponen'],
        icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
        requiredModes: ['DEALER', 'WORKSHOP', 'CONTRACTOR'],
      },
      {
        path: '/delivery',
        label: 'Pengiriman',
        keywords: ['pengiriman', 'delivery', 'DO', 'surat jalan', 'kirim'],
        icon: 'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0',
        requiredModes: ['DEALER', 'RENTAL', 'TRADER', 'CONTRACTOR'],
      },
    ],
  },

  // ── 5. KEUANGAN ───────────────────────────────────────────
  {
    label: 'Keuangan',
    items: [
      {
        path: '/finance',
        label: 'Kas & Bank',
        keywords: ['kas', 'bank', 'keuangan', 'cash', 'jurnal', 'debit', 'kredit'],
        icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      },
      {
        path: '/reports',
        label: 'Laporan',
        keywords: ['laporan', 'report', 'rekapitulasi', 'rekap', 'analisis', 'profit'],
        icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      },
    ],
  },

  // ── 6. SISTEM ─────────────────────────────────────────────
  {
    label: 'Sistem',
    items: [
      {
        path: '/users',
        label: 'Pengguna',
        keywords: ['user', 'pengguna', 'akun', 'akses', 'password'],
        icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
        requiredRoles: ['SUPERADMIN'],
      },
      {
        path: '/audit-log',
        label: 'Audit Log',
        keywords: ['audit', 'log', 'histori', 'riwayat', 'aktivitas'],
        icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
        requiredRoles: ['SUPERADMIN'],
      },
      {
        path: '/documents',
        label: 'Dokumen Legal',
        keywords: ['dokumen', 'legal', 'SIA', 'izin', 'sertifikat', 'BPKB', 'STNK'],
        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      },
      {
        path: '/settings',
        label: 'Pengaturan',
        keywords: ['setting', 'pengaturan', 'konfigurasi', 'profil perusahaan'],
        icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
      },
      {
        path: '/backup',
        label: 'Backup & Restore',
        keywords: ['backup', 'restore', 'cadang', 'pulihkan', 'ekspor data'],
        icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10',
      },
      {
        path: '/maintenance',
        label: 'Pemeliharaan Sistem',
        keywords: ['maintenance', 'sistem', 'pemeliharaan', 'repair', 'clean'],
        icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
      },
    ],
  },
];

// ── Label Role ────────────────────────────────────────────────
const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Super Admin',
  SALES:      'Sales',
  WAREHOUSE:  'Gudang',
  SERVICE:    'Teknisi',
  FINANCE:    'Keuangan',
};

// ── Semua item menu (flat) untuk search ───────────────────────
const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout }                        = useAuth();
  const { resetSetup, isMenuEnabled, getActiveProfileBadge } = useConfig();
  const { storageWarning, loadError, hasUnsavedChanges } = useDataStore();
  const location                                = useLocation();
  const navigate                                = useNavigate();
  const [collapsed, setCollapsed]               = useState(false);
  const [search, setSearch]                     = useState('');
  const [showUserMenu, setShowUserMenu]          = useState(false);
  const [showSearch, setShowSearch]             = useState(false);
  const searchRef                               = useRef<HTMLInputElement>(null);

  const activeBadge = getActiveProfileBadge();

  // Filter group berdasarkan Business Profile aktif, Custom Menu, & Role Pengguna
  const filteredGroups = NAV_GROUPS.map(g => ({
    ...g,
    items: g.items.filter(i => {
      if (i.requiredRoles?.length) {
        if (!user || !i.requiredRoles.includes(user.role)) return false;
      }
      return isMenuEnabled(i.path, i.requiredModes);
    }),
  })).filter(g => g.items.length > 0);

  const currentTitle = ALL_NAV_ITEMS
    .find(i => location.pathname.startsWith(i.path))?.label ?? 'FATHONI EQUIPMENT OS';

  // BUG-012 FIX: Konfirmasi sebelum reset profil bisnis
  const handleChangeProfile = () => {
    if (window.confirm('Ganti profil bisnis? Halaman akan diarahkan ke halaman setup.')) {
      resetSetup();
      navigate('/setup');
    }
  };

  const handleLogout = () => {
    if (window.confirm('Yakin ingin keluar dari FATHONI EQUIPMENT OS?')) {
      logout();
      navigate('/login', { replace: true });
    }
  };

  // BUG-017 FIX: Global search yang benar-benar berfungsi
  const searchResults = search.trim().length >= 2
    ? ALL_NAV_ITEMS.filter(item => {
        const q   = search.toLowerCase();
        const inLabel    = item.label.toLowerCase().includes(q);
        const inKeywords = item.keywords?.some(k => k.toLowerCase().includes(q));
        return inLabel || inKeywords;
      })
    : [];

  const handleSearchNavigate = (path: string) => {
    setSearch('');
    setShowSearch(false);
    navigate(path);
  };

  // Tutup search saat klik luar
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.closest('.topbar-search-wrapper')?.contains(e.target as Node)) {
        setShowSearch(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initials = user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) ?? 'U';

  const banners = [
    loadError && { text: loadError, danger: true },
    storageWarning && { text: storageWarning, danger: storageWarning.startsWith('🚨') },
  ].filter(Boolean) as { text: string; danger: boolean }[];
  const bannerHeight = banners.length * 38;

  return (
    <div className="app-layout">
      {/* ── Banner Status Database ── */}
      {banners.map((b, i) => (
        <div key={i} style={{
          position: 'fixed', top: i * 38, left: 0, right: 0, zIndex: 9999,
          background: b.danger ? '#dc2626' : '#d97706',
          color: 'white', padding: '8px 16px', textAlign: 'center',
          fontSize: 13, fontWeight: 600,
        }}>
          {b.text}
          <button
            onClick={() => navigate('/backup')}
            style={{ marginLeft: 12, textDecoration: 'underline', background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 13 }}
          >
            Buka Backup →
          </button>
        </div>
      ))}

      {/* ── Sidebar ── */}
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} style={{ marginTop: bannerHeight }}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">F</div>
          {!collapsed && (
            <div className="sidebar-logo-text">
              <div className="sidebar-logo-title">FATHONI EQUIPMENT OS</div>
              <div className="sidebar-logo-sub" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <span style={{ fontSize: 11 }}>{activeBadge.icon}</span>
                <span style={{ color: activeBadge.color, fontWeight: 700, fontSize: 10 }}>{activeBadge.title}</span>
              </div>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {filteredGroups.map(group => (
            <div key={group.label} className="sidebar-group">
              {!collapsed && (
                <div className="sidebar-group-label">{group.label}</div>
              )}
              {group.items.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon d={item.icon} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
            {collapsed
              ? <path d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
              : <path d="M11 19l-7-7 7-7M19 19l-7-7 7-7"/>
            }
          </svg>
        </button>
      </aside>

      {/* ── Konten Utama ── */}
      <div className="app-content" style={{ marginTop: bannerHeight }}>
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="topbar-title">{currentTitle}</span>
            {hasUnsavedChanges && (
              <span title="Perubahan terakhir belum tersimpan ke database." style={{
                fontSize: 11, fontWeight: 700, color: '#fff', background: '#dc2626',
                borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap',
              }}>
                ● Belum tersimpan
              </span>
            )}
            {/* BUG-012 FIX: Pakai handleChangeProfile (dengan konfirmasi) */}
            <button
              onClick={handleChangeProfile}
              title="Klik untuk mengubah profil bisnis aktif"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 12px', borderRadius: '20px',
                background: 'rgba(230,0,18,0.08)', border: '1px solid rgba(230,0,18,0.25)',
                color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: 13 }}>{activeBadge.icon}</span>
              <span style={{ color: activeBadge.color, fontWeight: 700 }}>Profil: {activeBadge.title}</span>
              <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 2 }}>✏️ Ubah</span>
            </button>
          </div>

          {/* BUG-017 FIX: Search berfungsi — navigasi ke menu */}
          <div className="topbar-search-wrapper" style={{ position: 'relative' }}>
            <div className="topbar-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                ref={searchRef}
                type="text"
                placeholder="Cari menu... (ketik 2 huruf)"
                value={search}
                onChange={e => { setSearch(e.target.value); setShowSearch(true); }}
                onFocus={() => setShowSearch(true)}
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); setShowSearch(false); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 4px' }}
                >×</button>
              )}
            </div>

            {/* Dropdown hasil pencarian */}
            {showSearch && searchResults.length > 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 100,
                overflow: 'hidden', minWidth: 240,
              }}>
                {searchResults.map(item => (
                  <button
                    key={item.path}
                    onClick={() => handleSearchNavigate(item.path)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px', background: 'none',
                      border: 'none', color: 'var(--text-secondary)', fontSize: 13,
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                      <path d={item.icon} />
                    </svg>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            {showSearch && search.trim().length >= 2 && searchResults.length === 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', padding: '12px 14px', zIndex: 100,
                color: 'var(--text-muted)', fontSize: 13,
              }}>
                Tidak ada menu yang cocok dengan "<strong>{search}</strong>"
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button
              className="topbar-user-btn"
              onClick={() => setShowUserMenu(v => !v)}
            >
              <div className="topbar-avatar">{initials}</div>
              {!collapsed && (
                <div className="topbar-user-info">
                  <span className="topbar-user-name">{user?.name}</span>
                  <span className="topbar-user-role">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</span>
                </div>
              )}
            </button>

            {showUserMenu && (
              <div className="user-menu" onClick={() => setShowUserMenu(false)}>
                <div className="user-menu-header">
                  <strong>{user?.name}</strong>
                  <span>{user?.email}</span>
                </div>
                <div className="user-menu-divider" />
                <button className="user-menu-item" onClick={handleChangeProfile}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}><path d="M20 7h-9M14 17H5m9-10h6m-6 10H5M9 4v6m6 4v6"/></svg>
                  Ganti Profil Bisnis
                </button>
                <button className="user-menu-item" onClick={() => navigate('/settings')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                  Pengaturan
                </button>
                <button className="user-menu-item" onClick={() => navigate('/backup')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"/></svg>
                  Backup Data
                </button>
                <div className="user-menu-divider" />
                <button className="user-menu-item danger" onClick={handleLogout}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                  Keluar
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="page-container">
          {children}
        </main>
      </div>

      <style>{`
        .topbar-search-wrapper { position: relative; flex: 1; max-width: 360px; }
        .sidebar-toggle {
          display: flex; align-items: center; justify-content: center;
          width: 100%; padding: 12px; background: transparent; border: none;
          border-top: 1px solid var(--border-default); color: var(--text-muted);
          cursor: pointer; transition: var(--transition);
        }
        .sidebar-toggle:hover { color: var(--text-primary); background: rgba(255,255,255,0.04); }
        .topbar-user-btn {
          display: flex; align-items: center; gap: 10px; background: transparent;
          border: none; cursor: pointer; padding: 4px 8px;
          border-radius: var(--radius-sm); transition: var(--transition);
        }
        .topbar-user-btn:hover { background: rgba(255,255,255,0.06); }
        .topbar-user-info { display: flex; flex-direction: column; align-items: flex-start; }
        .topbar-user-name { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
        .topbar-user-role { font-size: 11px; color: var(--text-muted); }
        .user-menu {
          position: absolute; top: calc(100% + 8px); right: 0; width: 220px;
          background: var(--bg-elevated); border: 1px solid var(--border-default);
          border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 50;
          animation: slideUp 0.15s ease-out; overflow: hidden;
        }
        .user-menu-header { padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
        .user-menu-header strong { font-size: 13px; color: var(--text-primary); }
        .user-menu-header span { font-size: 11px; color: var(--text-muted); }
        .user-menu-divider { height: 1px; background: var(--border-default); }
        .user-menu-item {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 10px 16px; background: transparent; border: none;
          color: var(--text-secondary); font-size: 13px; cursor: pointer;
          transition: var(--transition); text-align: left; font-family: inherit;
        }
        .user-menu-item:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
        .user-menu-item.danger { color: var(--status-out); }
        .user-menu-item.danger:hover { background: rgba(239,68,68,0.08); }
      `}</style>
      <CommandPalette />
    </div>
  );
}
