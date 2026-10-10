// src/components/ChangePasswordGate.tsx
// Layar wajib ganti password.
//
// Akun hasil instalasi masih memakai password bawaan. Selama flag
// mustChangePassword dari main process masih bernilai true, layar ini menjadi
// satu-satunya isi aplikasi: tidak ada menu atau data yang bisa dibuka sebelum
// password pribadi ditentukan.

import { useState } from 'react';
import { useAuth } from '../store/authStore';

const MIN_LENGTH = 8;

export default function ChangePasswordGate() {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Pemeriksaan di sini hanya penghematan waktu; aturan sebenarnya ada di
  // main process dan hasil akhir selalu berasal dari sana.
  const validate = (): string | null => {
    if (!current) return 'Password saat ini wajib diisi.';
    if (next.length < MIN_LENGTH) return `Password baru minimal ${MIN_LENGTH} karakter.`;
    if (next !== confirm) return 'Konfirmasi password tidak sama dengan password baru.';
    if (user && next.toLowerCase() === user.username.toLowerCase()) return 'Password baru tidak boleh sama dengan username.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const invalid = validate();
    if (invalid) return setError(invalid);

    setBusy(true);
    const result = await changePassword(current, next);
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Password gagal diganti.');
      setCurrent('');
    }
  };

  return (
    <div className="cpw-wrap">
      <div className="cpw-card">
        <h2 className="cpw-title">Ganti password sebelum melanjutkan</h2>
        <p className="cpw-desc">
          Akun <strong>{user?.username}</strong> masih memakai password bawaan instalasi.
          Tentukan password sendiri agar aplikasi ini aman dipakai di komputer bersama.
        </p>

        <form onSubmit={handleSubmit} className="cpw-form" noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="cpw-current">Password saat ini</label>
            <input
              id="cpw-current" type="password" className="form-input" autoComplete="current-password"
              value={current} onChange={e => setCurrent(e.target.value)} disabled={busy}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="cpw-next">Password baru</label>
            <input
              id="cpw-next" type="password" className="form-input" autoComplete="new-password"
              value={next} onChange={e => setNext(e.target.value)} disabled={busy}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="cpw-confirm">Ulangi password baru</label>
            <input
              id="cpw-confirm" type="password" className="form-input" autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy}
            />
          </div>

          {error && <div className="cpw-error">{error}</div>}

          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Menyimpan...' : 'Simpan password baru'}
          </button>
        </form>

        <p className="cpw-note">
          Mengganti password menutup sesi lain pada akun ini. Jika password saat ini tidak diketahui,
          keluar dan mintakan reset oleh Super Admin.
        </p>
        <button type="button" className="cpw-logout" onClick={() => logout()}>
          Keluar
        </button>
      </div>

      <style>{`
        .cpw-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 16px;
          background: var(--bg-base);
        }
        .cpw-card {
          width: 100%; max-width: 440px; background: var(--bg-card);
          border: 1px solid var(--border-default); border-radius: var(--radius-lg);
          padding: 24px; box-shadow: var(--shadow-md);
        }
        .cpw-title { font-size: 18px; font-weight: 800; margin: 0 0 6px; }
        .cpw-desc { font-size: 13px; color: var(--text-muted); margin: 0 0 18px; line-height: 1.5; }
        .cpw-form { display: flex; flex-direction: column; gap: 14px; }
        .cpw-error {
          font-size: 12px; color: #EF4444; background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.25); border-radius: var(--radius-sm); padding: 9px 12px;
        }
        .cpw-note { font-size: 11px; color: var(--text-muted); margin: 16px 0 8px; line-height: 1.5; }
        .cpw-logout {
          background: transparent; border: 1px solid var(--border-default); color: var(--text-muted);
          border-radius: var(--radius-sm); padding: 7px 14px; font-size: 12px; cursor: pointer;
        }
        .cpw-logout:hover { color: var(--text-primary); border-color: var(--text-muted); }
      `}</style>
    </div>
  );
}
