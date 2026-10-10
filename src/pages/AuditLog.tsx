// src/pages/AuditLog.tsx - Jejak audit FATHONI EQUIPMENT OS
//
// Sumber datanya main process (electron/auth.ts, kanal auth-audit-log) lewat
// authClient.auditLog(). Halaman ini sebelumnya men-hardcode lima baris
// "Simulate audit logs" (SY215-2023001, USER-001, BD-2026-001), jadi yang dibaca
// pengelola tidak pernah menggambarkan kejadian nyata — dan percobaan login gagal
// yang justru paling perlu dilihat, tidak pernah muncul di layar.

import { useEffect, useState } from 'react';
import { auditLog, isDesktopApp, type AuditEntry } from '../services/authClient';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';
import { buildCsv, downloadCsv } from '../utils/csvExport';

type Kejadian = AuditEntry['event'];

const LABEL: Record<Kejadian, string> = {
  LOGIN_OK: 'Login berhasil',
  LOGIN_FAIL: 'Login gagal',
  LOGIN_LOCKED: 'Akun terkunci',
  LOGOUT: 'Keluar',
  PASSWORD_CHANGED: 'Password diganti',
  PASSWORD_RESET: 'Password direset',
  USER_CREATED: 'Akun dibuat',
  USER_UPDATED: 'Akun diubah',
  USER_DELETED: 'Akun dihapus',
};

const BADGE: Record<Kejadian, string> = {
  LOGIN_OK: 'badge-success',
  LOGIN_FAIL: 'badge-danger',
  LOGIN_LOCKED: 'badge-danger',
  LOGOUT: 'badge-muted',
  PASSWORD_CHANGED: 'badge-warning',
  PASSWORD_RESET: 'badge-warning',
  USER_CREATED: 'badge-success',
  USER_UPDATED: 'badge-warning',
  USER_DELETED: 'badge-danger',
};

export default function AuditLogPage() {
  const [entri, setEntri] = useState<AuditEntry[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [pesan, setPesan] = useState('');
  const [cari, setCari] = useState('');
  const [saringKejadian, setSaringKejadian] = useState('ALL');

  useEffect(() => {
    let batal = false;
    auditLog().then(hasil => {
      if (batal) return;
      if (hasil.success) setEntri(hasil.entries ?? []);
      else setPesan(hasil.error ?? 'Log tidak dapat dibaca.');
      setMemuat(false);
    });
    return () => { batal = true; };
  }, []);

  const tersaring = entri.filter(item => {
    if (saringKejadian !== 'ALL' && item.event !== saringKejadian) return false;
    return matchesQuery([LABEL[item.event] ?? item.event, item.username, item.actor ?? '', item.detail ?? ''], cari);
  });

  const hitung = (...kejadian: Kejadian[]) =>
    entri.filter(item => kejadian.includes(item.event)).length;

  const cetakSatu = async (item: AuditEntry) => {
    if (!confirm(`Cetak jejak audit ${LABEL[item.event]} — ${item.username}?`)) return;
    const baris = (label: string, nilai: string) =>
      `<div class="info-item"><label>${label}</label><span>${sanitize(nilai)}</span></div>`;
    await printDocument(`
      <html>
        <head><title>Audit Log</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
            h1 { margin: 0 0 4px; font-size: 22px; }
            .sub { color: #666; margin: 0 0 20px; border-bottom: 2px solid #333; padding-bottom: 12px; }
            .info { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
            .info-item label { font-weight: bold; display: block; margin-bottom: 4px; }
            .footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #ddd; color: #666; }
          </style>
        </head>
        <body>
          <h1>${sanitize(getCompanyName())}</h1>
          <p class="sub">Jejak Audit — ${sanitize(LABEL[item.event])}</p>
          <div class="info">
            ${baris('Waktu', new Date(item.at).toLocaleString('id-ID'))}
            ${baris('Kejadian', LABEL[item.event] ?? item.event)}
            ${baris('Akun', item.username)}
            ${baris('Dilakukan oleh', item.actor || 'Sistem')}
            ${baris('Detail', item.detail || '-')}
          </div>
          <p class="footer">Dicetak ${new Date().toLocaleString('id-ID')} dari FATHONI EQUIPMENT OS.</p>
        </body>
      </html>`, 'Jejak Audit');
  };

  const eksporCsv = () => {
    const csv = buildCsv(
      ['Waktu', 'Kejadian', 'Akun', 'Dilakukan oleh', 'Detail'],
      tersaring.map(item => [
        new Date(item.at).toLocaleString('id-ID'),
        LABEL[item.event] ?? item.event,
        item.username,
        item.actor || 'Sistem',
        item.detail || '',
      ]),
    );
    downloadCsv(`jejak-audit-${new Date().toISOString().split('T')[0]}.csv`, csv);
  };

  const kosong = memuat ? 'Memuat log…'
    : !isDesktopApp() ? 'Jejak audit disimpan aplikasi desktop. Mode demo tidak memilikinya.'
    : pesan ? pesan
    : entri.length === 0
      ? 'Belum ada kejadian tercatat. Log terisi begitu ada login, ganti password, atau perubahan akun.'
      : '';

  return (
    <div className="page">
      <div className="page-header">
        <h1>📋 Audit Log</h1>
        <p>Kejadian nyata pada akun dan sesi: login, password, dan pengelolaan akun</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{entri.length}</div>
          <div className="stat-label">Total Kejadian</div>
        </div>
        <div className="stat-card" style={{ background: '#fee', border: '1px solid #fcc' }}>
          <div className="stat-value">{hitung('LOGIN_FAIL', 'LOGIN_LOCKED')}</div>
          <div className="stat-label">Login Gagal / Terkunci</div>
        </div>
        <div className="stat-card" style={{ background: '#ffd', border: '1px solid #fc0' }}>
          <div className="stat-value">{hitung('PASSWORD_CHANGED', 'PASSWORD_RESET')}</div>
          <div className="stat-label">Perubahan Password</div>
        </div>
        <div className="stat-card" style={{ background: '#efe', border: '1px solid #8f8' }}>
          <div className="stat-value">{hitung('USER_CREATED', 'USER_UPDATED', 'USER_DELETED')}</div>
          <div className="stat-label">Kejadian Akun</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Cari akun, kejadian, atau detail..."
          value={cari}
          onChange={e => setCari(e.target.value)}
          className="search-input"
        />
        <select
          value={saringKejadian}
          onChange={e => setSaringKejadian(e.target.value)}
          className="filter-select"
        >
          <option value="ALL">Semua Kejadian</option>
          {(Object.keys(LABEL) as Kejadian[]).map(k => (
            <option key={k} value={k}>{LABEL[k]}</option>
          ))}
        </select>
        <button onClick={eksporCsv} className="btn btn-secondary" disabled={tersaring.length === 0}>
          📥 Export CSV
        </button>
      </div>

      {kosong ? (
        <div className="empty-state">{kosong}</div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Kejadian</th>
                <th>Akun</th>
                <th>Dilakukan oleh</th>
                <th>Detail</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {tersaring.map((item, indeks) => (
                <tr key={`${item.at}-${indeks}`}>
                  <td>{new Date(item.at).toLocaleString('id-ID')}</td>
                  <td>
                    <span className={`badge ${BADGE[item.event] || 'badge-muted'}`}>
                      {LABEL[item.event] ?? item.event}
                    </span>
                  </td>
                  <td>{item.username}</td>
                  <td>{item.actor || 'Sistem'}</td>
                  <td>{item.detail || '-'}</td>
                  <td>
                    <div className="action-buttons">
                      <button onClick={() => void cetakSatu(item)} className="btn btn-sm" title="Cetak">
                        🖨️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
