// src/pages/ProfileSetup.tsx
// BUG-015 FIX: Reset isSaving setelah navigate agar tombol tidak stuck disabled
// BUG-013 FIX: Sesuaikan dengan perbaikan configStore (tidak perlu delay setTimeout)

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig, BusinessMode } from '../store/configStore';
import { useAuth } from '../store/authStore';

const PROFILES: { id: BusinessMode; icon: string; title: string; desc: string; color: string }[] = [
  { id: 'PERSONAL',   icon: '🚜', color: '#10B981', title: 'Pemilik Alat (Perorangan)', desc: 'Kelola 1–5 alat berat milik sendiri, tanpa fitur ERP kompleks' },
  { id: 'DEALER',     icon: '🏢', color: '#3B82F6', title: 'Dealer / Distributor',      desc: 'Distribusi, penjualan, dan after-sales alat berat baru' },
  { id: 'CONTRACTOR', icon: '🏗️', color: '#F59E0B', title: 'Kontraktor',                desc: 'Manajemen armada untuk proyek tambang, jalan, dan gedung' },
  { id: 'RENTAL',     icon: '🚚', color: '#8B5CF6', title: 'Perusahaan Sewa (Rental)',  desc: 'Kelola kontrak sewa, jobsite, dan billing bulanan' },
  { id: 'WORKSHOP',   icon: '🔧', color: '#EC4899', title: 'Bengkel / Workshop',        desc: 'Work Order, perawatan berkala, dan manajemen mekanik' },
  { id: 'TRADER',     icon: '💰', color: '#06B6D4', title: 'Pedagang Alat Bekas',       desc: 'Jual-beli alat berat bekas, stok, dan harga pasar' },
];

export default function ProfileSetup() {
  const { modes: savedModes, setModes, completeSetup, isSetupComplete } = useConfig();
  const { user } = useAuth();
  const navigate  = useNavigate();

  const [selected, setSelected] = useState<BusinessMode[]>(savedModes.length > 0 ? savedModes : []);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const isEditMode = isSetupComplete;

  const toggle = (id: BusinessMode) => {
    setSelected(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const handleContinue = () => {
    if (selected.length === 0) {
      setError('Pilih minimal 1 profil bisnis untuk melanjutkan.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // BUG-013 FIX: Tidak perlu setTimeout — configStore sudah diperbaiki
      setModes(selected);
      completeSetup();

      // BUG-015 FIX: isSaving tidak perlu direset karena kita langsung navigate
      // Navigate menghancurkan komponen ini
      navigate('/dashboard', { replace: true });
    } catch (e) {
      console.error('[ProfileSetup] Gagal menyimpan konfigurasi:', e);
      setError('Gagal menyimpan pengaturan. Silakan coba lagi.');
      setIsSaving(false); // Reset jika ada error
    }
  };

  const handleCancel = () => {
    navigate(-1);
  };

  const selectAll = () => setSelected(PROFILES.map(p => p.id));
  const clearAll  = () => setSelected([]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)', padding: '40px 20px', color: 'var(--text-primary)',
    }}>
      <div style={{
        maxWidth: 780, width: '100%', background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)',
        padding: '48px', boxShadow: 'var(--shadow-lg)',
      }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{
            width: 64, height: 64, background: 'linear-gradient(135deg, var(--sany-red), #FF4455)',
            borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 28, fontWeight: 900, color: 'white',
            boxShadow: '0 8px 24px rgba(230,0,18,0.35)',
          }}>F</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>
            {isEditMode
              ? 'Ubah Profil Bisnis'
              : <>Selamat Datang di <span style={{ color: 'var(--sany-red)' }}>FATHONI EQUIPMENT OS</span></>}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginBottom: 4 }}>
            {isEditMode
              ? `Halo, ${user?.name ?? 'Pengguna'}. Pilih ulang profil bisnis yang sesuai.`
              : `Halo, ${user?.name ?? 'Pengguna'}. Bagaimana Anda menggunakan FATHONI EQUIPMENT OS?`}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
            Pilih satu atau lebih profil — menu dan fitur akan disesuaikan secara otomatis.
          </p>
        </div>

        {/* Tombol quick-select */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 14 }}>
          <button type="button" className="btn btn-secondary"
            style={{ fontSize: 12, padding: '4px 12px' }} onClick={selectAll}>
            ✓ Pilih Semua
          </button>
          {selected.length > 0 && (
            <button type="button" className="btn btn-secondary"
              style={{ fontSize: 12, padding: '4px 12px' }} onClick={clearAll}>
              ✕ Hapus Pilihan
            </button>
          )}
        </div>

        {/* Kartu Profil */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 32 }}>
          {PROFILES.map(p => {
            const isActive = selected.includes(p.id);
            return (
              <div
                key={p.id}
                onClick={() => toggle(p.id)}
                role="checkbox"
                aria-checked={isActive}
                tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', padding: '16px 20px',
                  borderRadius: 'var(--radius-md)',
                  background: isActive ? `${p.color}12` : 'var(--bg-elevated)',
                  border: `1.5px solid ${isActive ? p.color : 'var(--border-default)'}`,
                  cursor: 'pointer', transition: 'all 0.18s ease',
                  transform: isActive ? 'translateY(-2px)' : 'none',
                  boxShadow: isActive ? `0 4px 16px ${p.color}20` : 'none',
                  userSelect: 'none',
                  outline: 'none',
                }}
              >
                <div style={{ fontSize: 26, marginRight: 14, minWidth: 36, textAlign: 'center' }}>{p.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3, color: isActive ? p.color : 'var(--text-primary)' }}>
                    {p.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{p.desc}</div>
                </div>
                {/* Checkbox visual */}
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginLeft: 10,
                  border: `2px solid ${isActive ? p.color : 'var(--border-muted)'}`,
                  background: isActive ? p.color : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}>
                  {isActive && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Ringkasan pilihan */}
        {selected.length > 0 && (
          <div style={{
            background: 'rgba(230,0,18,0.05)', border: '1px solid rgba(230,0,18,0.15)',
            borderRadius: 'var(--radius-sm)', padding: '10px 16px', marginBottom: 20, fontSize: 12,
            color: 'var(--text-secondary)',
          }}>
            <strong style={{ color: 'var(--sany-red)' }}>Profil terpilih:</strong>{' '}
            {selected.map(s => PROFILES.find(p => p.id === s)?.title).filter(Boolean).join(' • ')}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 'var(--radius-sm)', padding: '10px 16px', marginBottom: 20,
            fontSize: 13, color: '#ef4444',
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Tombol Aksi */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          {isEditMode && (
            <button className="btn btn-secondary"
              style={{ padding: '12px 32px', fontSize: 14 }} onClick={handleCancel}>
              ← Kembali ke Dasbor
            </button>
          )}
          <button
            className="btn btn-primary"
            style={{ padding: '14px 48px', fontSize: 16, fontWeight: 600, opacity: (selected.length === 0 || isSaving) ? 0.5 : 1 }}
            onClick={handleContinue}
            disabled={selected.length === 0 || isSaving}
          >
            {isSaving ? '⏳ Menyimpan...' : isEditMode ? 'Simpan Perubahan' : 'Mulai Gunakan FATHONI EQUIPMENT OS →'}
          </button>
        </div>
      </div>
    </div>
  );
}
