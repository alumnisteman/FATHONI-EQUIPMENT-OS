// src/App.tsx
import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './store/authStore';
import Layout from './components/Layout';
import Login from './pages/Login';
import ChangePasswordGate from './components/ChangePasswordGate';
import ErrorBoundary from './components/ErrorBoundary';
import { DataProvider, useDataStore } from './store/dataStore';
import { needsForPath } from './store/collectionNeeds';

// ── Lazy load halaman modul ───────────────────────────────────
import { lazy, Suspense } from 'react';

const Dashboard      = lazy(() => import('./pages/Dashboard'));
const Customers      = lazy(() => import('./pages/Customers'));
const Suppliers      = lazy(() => import('./pages/Suppliers'));
const Units          = lazy(() => import('./pages/Units'));
const Brands         = lazy(() => import('./pages/Brands'));
const Sales          = lazy(() => import('./pages/Sales'));
const Purchase       = lazy(() => import('./pages/Purchase'));
const Invoices       = lazy(() => import('./pages/Invoices'));
const Warehouse      = lazy(() => import('./pages/Warehouse'));
const SpareParts     = lazy(() => import('./pages/SpareParts'));
const Service        = lazy(() => import('./pages/Service'));
const Rental         = lazy(() => import('./pages/Rental'));
const Delivery       = lazy(() => import('./pages/Delivery'));
const Finance        = lazy(() => import('./pages/Finance'));
const Reports        = lazy(() => import('./pages/Reports'));
const Users          = lazy(() => import('./pages/Users'));
const Settings       = lazy(() => import('./pages/Settings'));
const Backup         = lazy(() => import('./pages/Backup'));
const ProfileSetup   = lazy(() => import('./pages/ProfileSetup'));
const SystemMaintenance = lazy(() => import('./pages/SystemMaintenance'));
const Documents      = lazy(() => import('./pages/Documents'));
const EquipmentPassport = lazy(() => import('./pages/EquipmentPassport'));
const ControlTower   = lazy(() => import('./pages/ControlTower'));
const Breakdown      = lazy(() => import('./pages/Breakdown'));
const Operators      = lazy(() => import('./pages/Operators'));
const Technicians    = lazy(() => import('./pages/Technicians'));
const Approvals      = lazy(() => import('./pages/Approvals'));
const AuditLog       = lazy(() => import('./pages/AuditLog'));

// ── Loading spinner ───────────────────────────────────────────
function PageLoader() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '60vh',
      flexDirection: 'column',
      gap: 12,
    }}>
      <svg
        className="animate-spin"
        width={32} height={32}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--sany-red)"
        strokeWidth={2}
      >
        <path d="M21 12a9 9 0 11-6.219-8.56"/>
      </svg>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Memuat modul...</span>
    </div>
  );
}

import { ConfigProvider, useConfig } from './store/configStore';

// ── Protected Route ───────────────────────────────────────────
/**
 * Gerbang hidrasi per menu. Boot tidak lagi memuat seluruh store ke renderer,
 * jadi collection yang memang dipakai sebuah menu dibaca lebih dulu: halaman yang
 * tampil selalu memegang array yang lengkap, dan tulisan apa pun di dalamnya bisa
 * dianggap mewakili isi file. Kebutuhan tiap rute ada di
 * src/store/collectionNeeds.ts — satu tempat, supaya tambahan menu baru tidak
 * lupa mendaftarkan collection-nya.
 */
function RouteGate({ children }: { children: React.ReactNode }) {
  const { ensureLoaded } = useDataStore();
  const location = useLocation();
  // needsForPath mengembalikan objek daftar yang sama untuk rute yang sama, jadi
  // efek di bawah hanya berjalan saat berpindah menu, bukan saat data berubah.
  const needs = needsForPath(location.pathname);
  const [siap, setSiap] = useState(needs.length === 0);

  useEffect(() => {
    if (needs.length === 0) { setSiap(true); return undefined; }
    let batal = false;
    setSiap(false);
    void ensureLoaded(needs).then(() => { if (!batal) setSiap(true); });
    return () => { batal = true; };
  }, [needs, ensureLoaded]);

  if (!siap) return <PageLoader />;
  return <>{children}</>;
}

function ProtectedRoute({ children, requireSetup = true }: { children: React.ReactNode, requireSetup?: boolean }) {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
  const { isSetupComplete } = useConfig();

  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Password bawaan instalasi: layar ini tampil penuh, tanpa navigasi aplikasi,
  // sampai password pribadi ditentukan.
  if (mustChangePassword) return <ChangePasswordGate />;
  if (requireSetup && !isSetupComplete) return <Navigate to="/setup" replace />;

  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <RouteGate>{children}</RouteGate>
      </Suspense>
    </Layout>
  );
}

// ── Routing ───────────────────────────────────────────────────
function AppRoutes() {
  const { isAuthenticated, mustChangePassword } = useAuth();
  const { isSetupComplete } = useConfig();

  // Semua rute di luar login mengarah ke dashboard bila password bawaan masih
  // dipakai; ProtectedRoute-lah yang menampilkan layar wajib ganti password.
  const target = mustChangePassword ? '/dashboard' : (isSetupComplete ? '/dashboard' : '/setup');

  return (
    <Routes>
      {/* Login */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={target} replace /> : <Login />}
      />

      {/* Setup Profil Bisnis */}
      <Route
        path="/setup"
        element={
          !isAuthenticated ? <Navigate to="/login" replace /> :
          mustChangePassword ? <Navigate to="/dashboard" replace /> :
          isSetupComplete ? <Navigate to="/dashboard" replace /> :
          <Suspense fallback={<PageLoader />}><ProfileSetup /></Suspense>
        }
      />

      {/* Root redirect */}
      <Route path="/" element={<Navigate to={isAuthenticated ? target : '/login'} replace />} />

      {/* ── Utama ── */}
      <Route path="/dashboard"      element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/control-tower"  element={<ProtectedRoute><ControlTower /></ProtectedRoute>} />

      {/* ── Master Data ── */}
      <Route path="/customers/*"    element={<ProtectedRoute><Customers /></ProtectedRoute>} />
      <Route path="/suppliers/*"    element={<ProtectedRoute><Suppliers /></ProtectedRoute>} />
      <Route path="/units/*"        element={<ProtectedRoute><Units /></ProtectedRoute>} />
      <Route path="/brands/*"       element={<ProtectedRoute><Brands /></ProtectedRoute>} />
      <Route path="/operators"      element={<ProtectedRoute><Operators /></ProtectedRoute>} />
      <Route path="/technicians"    element={<ProtectedRoute><Technicians /></ProtectedRoute>} />
      <Route path="/equipment-passport/:id" element={<ProtectedRoute><EquipmentPassport /></ProtectedRoute>} />

      {/* ── Transaksi ── */}
      <Route path="/sales/*"        element={<ProtectedRoute><Sales /></ProtectedRoute>} />
      <Route path="/purchase/*"     element={<ProtectedRoute><Purchase /></ProtectedRoute>} />
      <Route path="/rental/*"       element={<ProtectedRoute><Rental /></ProtectedRoute>} />
      <Route path="/invoices/*"     element={<ProtectedRoute><Invoices /></ProtectedRoute>} />

      {/* ── Operasional ── */}
      <Route path="/warehouse/*"    element={<ProtectedRoute><Warehouse /></ProtectedRoute>} />
      <Route path="/spareparts/*"   element={<ProtectedRoute><SpareParts /></ProtectedRoute>} />
      <Route path="/service/*"      element={<ProtectedRoute><Service /></ProtectedRoute>} />
      <Route path="/breakdown"      element={<ProtectedRoute><Breakdown /></ProtectedRoute>} />
      <Route path="/delivery/*"     element={<ProtectedRoute><Delivery /></ProtectedRoute>} />

      {/* ── Keuangan ── */}
      <Route path="/finance/*"      element={<ProtectedRoute><Finance /></ProtectedRoute>} />
      <Route path="/reports/*"      element={<ProtectedRoute><Reports /></ProtectedRoute>} />

      {/* ── Sistem ── */}
      <Route path="/users/*"        element={<ProtectedRoute><Users /></ProtectedRoute>} />
      <Route path="/approvals"      element={<ProtectedRoute><Approvals /></ProtectedRoute>} />
      <Route path="/audit-log"      element={<ProtectedRoute><AuditLog /></ProtectedRoute>} />
      <Route path="/documents"      element={<ProtectedRoute><Documents /></ProtectedRoute>} />
      <Route path="/settings/*"     element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/backup/*"       element={<ProtectedRoute><Backup /></ProtectedRoute>} />
      <Route path="/maintenance"    element={<ProtectedRoute><SystemMaintenance /></ProtectedRoute>} />

      {/* 404 → redirect ke dashboard */}
      <Route path="*" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />} />
    </Routes>
  );
}

// ── Root App ─────────────────────────────────────────────────
export default function App() {
  // BUG-001 FIX: Inisialisasi utilities HANYA sekali menggunakan useEffect
  // Sebelumnya dipanggil langsung di body komponen → setInterval baru setiap render → HANG
  useEffect(() => {
    // Import dinamis untuk menghindari inisialisasi di SSR atau sebelum siap
    const initUtils = async () => {
      try {
        const { getErrorHandler } = await import('./utils/errorHandler');
        const { getDataRecovery } = await import('./utils/dataRecovery');
        const { getHealthCheck }  = await import('./utils/healthCheck');

        getErrorHandler();
        getDataRecovery({
          autoBackup: true,
          // Setiap backup menyalin seluruh database; 30 menit cukup sebagai
          // jaring pengaman tanpa membuat storage dan main thread kelelahan.
          backupInterval: 30,
          maxBackups: 5,       // Kurangi dari 10 → hemat storage
          enableAutoFix: true,
        });
        getHealthCheck();
      } catch (e) {
        console.error('[App] Gagal menginisialisasi utilities:', e);
      }
    };

    initUtils();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Dependency kosong = hanya sekali saat mount

  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConfigProvider>
          {/* Satu-satunya DataProvider: dua instance dipakai bersama akan saling
              menimpa database di localStorage lewat autosave. */}
          <DataProvider>
            <AppRoutes />
          </DataProvider>
        </ConfigProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
