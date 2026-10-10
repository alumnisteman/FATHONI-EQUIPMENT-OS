// src/pages/Users.tsx — Manajemen akun & hak akses
//
// Halaman ini tidak lagi menyimpan daftar penggunanya sendiri. Setiap aksi
// (daftar, buat, ubah, nonaktifkan, hapus, reset password) diteruskan ke main
// process lewat authClient, dan main process yang memutuskan boleh atau tidak
// berdasarkan token sesi. Password bawaan instalasi ditandai mustChangePassword
// supaya terlihat di sini.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../store/authStore';
import { listAccounts, saveAccount, deleteAccount, type AccountInput } from '../services/authClient';
import { matchesQuery } from '../utils/searchMatch';
import type { User, UserRole } from '../types';

const LABEL_ROLE: Record<UserRole, string> = {
  SUPERADMIN: 'Super Admin',
  SALES: 'Staff Penjualan',
  WAREHOUSE: 'Petugas Gudang',
  SERVICE: 'Teknisi / Mekanik',
  FINANCE: 'Staf Keuangan',
};

const BADGE_ROLE: Record<UserRole, string> = {
  SUPERADMIN: 'badge-danger',
  SALES: 'badge-info',
  WAREHOUSE: 'badge-warning',
  SERVICE: 'badge-muted',
  FINANCE: 'badge-success',
};

const HAK_AKSES: Record<UserRole, string[]> = {
  SUPERADMIN: ['Semua Modul', 'Pengaturan Sistem', 'Manajemen Pengguna', 'Backup & Restore'],
  SALES: ['Pelanggan', 'Penjualan & SPK', 'Invoice', 'Laporan Penjualan'],
  WAREHOUSE: ['Gudang', 'Suku Cadang', 'Pembelian (Lihat)'],
  SERVICE: ['Work Order & Servis', 'Suku Cadang (Lihat)', 'Unit (Lihat)'],
  FINANCE: ['Invoice', 'Kas & Bank', 'Laporan Keuangan'],
};

const ALL_ROLES = Object.keys(LABEL_ROLE) as UserRole[];

function fmtTanggal(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface FormState {
  username: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  password: string;
}

const FORM_KOSONG: FormState = { username: '', name: '', email: '', role: 'SALES', active: true, password: '' };

export default function Users() {
  const { user: akunSaatIni, hasRole, demoMode } = useAuth();
  const [accounts, setAccounts] = useState<User[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(FORM_KOSONG);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = hasRole('SUPERADMIN');

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await listAccounts();
    setLoading(false);
    if (res.success && res.accounts) {
      setAccounts(res.accounts);
      setLoadError('');
    } else {
      setAccounts([]);
      setLoadError(res.error || 'Daftar akun tidak dapat dimuat.');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const filtered = useMemo(
    () => accounts.filter(u => matchesQuery([u.name, u.username, u.email, LABEL_ROLE[u.role]], search)),
    [accounts, search]
  );

  const stat = useMemo(() => ({
    total: accounts.length,
    aktif: accounts.filter(u => u.active).length,
    admin: accounts.filter(u => u.role === 'SUPERADMIN').length,
    wajibGanti: accounts.filter(u => u.mustChangePassword).length,
  }), [accounts]);

  const openAdd = () => {
    setSelected(null);
    setForm(FORM_KOSONG);
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (u: User) => {
    setSelected(u);
    setForm({ username: u.username, name: u.name, email: u.email, role: u.role, active: u.active, password: '' });
    setFormError('');
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!selected && !form.password) {
      setFormError('Akun baru wajib dibuatkan password awal (minimal 8 karakter).');
      return;
    }

    const input: AccountInput = {
      id: selected?.id,
      username: selected ? undefined : form.username,
      name: form.name,
      email: form.email,
      role: form.role,
      active: form.active,
    };
    if (form.password) input.password = form.password;

    setBusy(true);
    const res = await saveAccount(input);
    setBusy(false);
    if (!res.success) {
      setFormError(res.error || 'Akun tidak tersimpan.');
      return;
    }
    setShowModal(false);
    void reload();
  };

  const handleToggleAktif = async (u: User) => {
    setFormError('');
    const res = await saveAccount({
      id: u.id, name: u.name, email: u.email, role: u.role, active: !u.active,
    });
    if (!res.success) setFormError(res.error || 'Status akun tidak berubah.');
    else void reload();
  };

  const handleDelete = async (u: User) => {
    if (!window.confirm(`Hapus akun "${u.username}"? Riwayat operasinya tetap tercatat.`)) return;
    const res = await deleteAccount(u.id);
    if (res.success) void reload();
    else setFormError(res.error || 'Akun tidak dapat dihapus.');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pengguna & Hak Akses</h1>
          <p className="page-subtitle">
            Akun, peran (role), dan hak akses tersimpan di aplikasi desktop dengan password ter-hash.
            Halaman ini tidak dapat menampilkan maupun mengirim password.
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Memuat...' : 'Muat ulang'}
          </button>
          {canManage && (
            <button className="btn btn-primary" onClick={openAdd}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
                <path d="M12 5v14M5 12h14" />
              </svg>
              Tambah Pengguna
            </button>
          )}
        </div>
      </div>

      {demoMode && (
        <div className="card mb-4" style={{ padding: 14, fontSize: 12, color: 'var(--text-secondary)' }}>
          Mode demo browser: daftar di bawah ini contoh, bukan akun nyata. Membuat, mengubah,
          dan menghapus akun hanya berjalan di aplikasi desktop.
        </div>
      )}

      {!canManage && (
        <div className="card mb-4" style={{ padding: 14, fontSize: 12, color: 'var(--text-secondary)' }}>
          Hanya Super Admin yang dapat mengelola akun.
        </div>
      )}

      {loadError && (
        <div className="card mb-4" style={{ padding: 14, fontSize: 12, color: 'var(--status-out)' }}>
          {loadError}
        </div>
      )}

      {/* KPI */}
      <div className="grid-4 mb-4">
        <div className="card stat-card">
          <div className="card-title">Total Pengguna</div>
          <div className="card-value" style={{ color: 'var(--text-primary)' }}>{stat.total} Akun</div>
          <div className="card-sub">Terdaftar di Sistem</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Pengguna Aktif</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{stat.aktif} Akun</div>
          <div className="card-sub">Dapat Login Saat Ini</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Tidak Aktif</div>
          <div className="card-value" style={{ color: 'var(--text-muted)' }}>{stat.total - stat.aktif} Akun</div>
          <div className="card-sub">Akses Diblokir</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Wajib Ganti Password</div>
          <div className="card-value" style={{ color: 'var(--status-maintenance)' }}>{stat.wajibGanti} Akun</div>
          <div className="card-sub">Masih Pakai Bawaan Instalasi</div>
        </div>
      </div>

      {/* Hak Akses Ringkasan */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 14 }}>Matriks Hak Akses per Peran</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {ALL_ROLES.map(role => (
            <div key={role} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 12 }}>
              <div className="mb-2">
                <span className={`badge ${BADGE_ROLE[role]}`}>{LABEL_ROLE[role]}</span>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {HAK_AKSES[role].map(h => (
                  <li key={h} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>✓ {h}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Filter & Cari */}
      <div className="card mb-4" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end' }}>
        <div className="topbar-search" style={{ width: 280 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input type="text" placeholder="Cari nama, username, email, peran..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Tabel */}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nama Pengguna</th>
              <th>Username</th>
              <th>Email</th>
              <th>Peran (Role)</th>
              <th>Terakhir Login</th>
              <th>Status</th>
              {canManage && <th style={{ textAlign: 'center' }}>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 7 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                  {loading ? 'Memuat daftar akun...' : 'Tidak ada pengguna yang sesuai.'}
                </td>
              </tr>
            ) : filtered.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: `hsl(${u.username.charCodeAt(0) * 37 % 360}, 60%, 40%)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0,
                    }}>
                      {u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      {u.mustChangePassword && (
                        <div style={{ fontSize: 10, color: 'var(--status-maintenance)' }}>Wajib ganti password</div>
                      )}
                      {akunSaatIni?.id === u.id && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Anda</div>
                      )}
                    </div>
                  </div>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{u.username}</td>
                <td style={{ fontSize: 12, color: 'var(--accent-blue)' }}>{u.email}</td>
                <td><span className={`badge ${BADGE_ROLE[u.role]}`}>{LABEL_ROLE[u.role]}</span></td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtTanggal(u.lastLoginAt)}</td>
                <td>
                  <span className={`badge ${u.active ? 'badge-success' : 'badge-muted'}`}>
                    {u.active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                {canManage && (
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(u)}>Ubah</button>
                      <button
                        className={`btn btn-sm ${u.active ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() => void handleToggleAktif(u)}
                        disabled={u.id === akunSaatIni?.id}
                        title={u.id === akunSaatIni?.id ? 'Anda tidak dapat menonaktifkan akun sendiri' : undefined}
                      >
                        {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => void handleDelete(u)}
                        disabled={u.id === akunSaatIni?.id}
                      >
                        Hapus
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Tambah/Edit */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <span className="modal-title">{selected ? `Ubah Akun ${selected.username}` : 'Tambah Pengguna Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input
                    type="text" className="form-input" placeholder="mis. mekanik1"
                    value={form.username}
                    onChange={e => setForm({ ...form, username: e.target.value })}
                    disabled={!!selected}
                    autoComplete="off"
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    3-32 karakter: huruf kecil, angka, titik, garis bawah, tanda hubung. Tidak dapat diubah setelah dibuat.
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Nama Lengkap</label>
                  <input type="text" className="form-input" placeholder="Nama pengguna" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" className="form-input" placeholder="nama@perusahaan.co.id" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Peran (Role)</label>
                  <select className="form-select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as UserRole })}>
                    {ALL_ROLES.map(r => (
                      <option key={r} value={r}>{LABEL_ROLE[r]}</option>
                    ))}
                  </select>
                </div>
                <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Hak akses peran ini:</div>
                  {HAK_AKSES[form.role].map(h => <div key={h} style={{ color: 'var(--text-secondary)', padding: '1px 0' }}>✓ {h}</div>)}
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acct-password">
                    {selected ? 'Reset password (kosongkan bila tidak diganti)' : 'Password awal'}
                  </label>
                  <input
                    id="acct-password" type="password" className="form-input" autoComplete="new-password"
                    placeholder={selected ? 'Tidak diubah' : 'Minimal 8 karakter'}
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Password langsung di-hash di aplikasi dan tidak dapat dibaca kembali.
                  </div>
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="chkAktif" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
                  <label htmlFor="chkAktif" style={{ fontSize: 13, cursor: 'pointer' }}>Akun Aktif (dapat login)</label>
                </div>

                {formError && (
                  <div style={{ fontSize: 12, color: 'var(--status-out)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '9px 12px' }}>
                    {formError}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={busy}>Batal</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Menyimpan...' : selected ? 'Simpan Perubahan' : 'Buat Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
