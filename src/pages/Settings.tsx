// src/pages/Settings.tsx - Pengaturan Sistem & Kustomisasi Modul FATHONI EQUIPMENT OS

import { useState, useEffect } from 'react';
import { useConfig } from '../store/configStore';
import { useNavigate } from 'react-router-dom';
import BankAccounts from '../components/BankAccounts';
import { validateEmail, validatePhone, validateName, validateAddress, sanitizeInput } from '../utils/validation';

interface CompanySettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  npwp: string;
  logo: string;
  currency: string;
  timezone: string;
}

const DEFAULT: CompanySettings = {
  name: 'CV. MUGHNY NAMASKARABUMI KURNIA',
  address: 'Jakarta Selatan, DKI Jakarta 12190',
  phone: '021-5555-1234',
  email: 'info@namaskarabumi.co.id',
  npwp: '12.345.678.9-021.000',
  logo: '',
  currency: 'IDR',
  timezone: 'Asia/Jakarta',
};

// Katalog modul di tab Pengaturan. URUTAN dan `cat`-nya mengikuti sidebar
// (NAV_GROUPS di src/components/Layout.tsx) supaya siklus kerja yang dibaca user
// di dua tempat sama: beli unit -> jual/sewa -> tagih -> stok & servis -> kas ->
// laporan -> sistem. Kategori 'Alat Berat'/'CRM & Mitra' keduanya berada di grup
// sidebar 'Master Data'. Dikunci validation-check §25: kalau menu dipindah atau
// dikategori-ulang tanpa memperbarui daftar ini, pemeriksaan gagal.
const ALL_MODULES = [
  { path: '/brands',     name: 'Merek & Model',       cat: 'Alat Berat',   desc: 'Katalog merek, spesifikasi teknis, dan brosur model unit' },
  { path: '/units',      name: 'Unit / Armada',       cat: 'Alat Berat',   desc: 'Kelola data fisik alat berat, status operasional, dan jam kerja (HM)' },
  { path: '/customers',  name: 'Pelanggan (CRM)',      cat: 'CRM & Mitra',  desc: 'Database pelanggan, kontak, limit kredit, dan histori transaksi' },
  { path: '/suppliers',  name: 'Pemasok (Supplier)',  cat: 'CRM & Mitra',  desc: 'Pemasok unit, spare part, pelumas, dan vendor layanan' },
  { path: '/purchase',   name: 'Pembelian Unit',      cat: 'Transaksi',    desc: 'Purchase order unit baru/bekas dan impor barang' },
  { path: '/sales',      name: 'Penjualan Unit',      cat: 'Transaksi',    desc: 'Sales order, penawaran harga, skema pembayaran, dan komisi' },
  { path: '/rental',     name: 'Sewa & Rental',       cat: 'Transaksi',    desc: 'Kontrak sewa, alokasi jobsite, timesheet, dan billing bulanan' },
  { path: '/invoices',   name: 'Faktur & Penagihan',  cat: 'Transaksi',    desc: 'Faktur penjualan/sewa, kwitansi, dan penagihan piutang (AR)' },
  { path: '/warehouse',  name: 'Gudang & Stok',       cat: 'Operasional',  desc: 'Stok gudang, stok opname, dan mutasi barang antar gudang' },
  { path: '/spareparts', name: 'Suku Cadang & Parts', cat: 'Operasional',  desc: 'Katalog spare part, interchange number, dan harga jual' },
  { path: '/service',    name: 'Servis & Work Order', cat: 'Operasional',  desc: 'Jadwal PM, Work Order perbaikan, dan histori perawatan unit' },
  { path: '/delivery',   name: 'Pengiriman & Mobilisasi', cat: 'Operasional', desc: 'Surat Jalan (DO), pengiriman unit, dan biaya mobilisasi' },
  { path: '/finance',    name: 'Kas & Bank',          cat: 'Keuangan',     desc: 'Pencatatan kas masuk/keluar, saldo bank, dan arus kas' },
  { path: '/reports',    name: 'Laporan & Analitik',  cat: 'Keuangan',     desc: 'Laporan laba rugi, utilisasi unit, dan piutang' },
  { path: '/users',      name: 'Pengguna & Role',     cat: 'Sistem',       desc: 'Kelola akun staf, hak akses, dan matriks wewenang' },
  { path: '/documents',  name: 'Dokumen Legal',       cat: 'Sistem',       desc: 'Kelola dokumen legal, perizinan, dan sertifikat perusahaan' },
  { path: '/backup',     name: 'Backup & Restore',    cat: 'Sistem',       desc: 'Cadangan data lokal dan pemulihan basis data' },
];

export default function Settings() {
  const [company, setCompany] = useState<CompanySettings>(DEFAULT);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'company' | 'modules' | 'system' | 'print' | 'about' | 'bank'>('company');

  const { modes, customMenus, toggleCustomMenu, enableAllMenus, resetSetup, isMenuEnabled } = useConfig();
  const navigate = useNavigate();

  // Load saved settings on mount
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('hems_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        // Force update company name if it's still the old name
        if (parsed.name === 'PT. SANY Heavy Industry Indonesia') {
          parsed.name = 'CV. MUGHNY NAMASKARABUMI KURNIA';
          localStorage.setItem('hems_settings', JSON.stringify(parsed));
        }
        setCompany(parsed);
      }
    } catch (e) {
      console.error('Gagal memuat pengaturan:', e);
    }
  }, []);

  const save = () => {
    // Validate company settings before saving
    const nameError = validateName(company.name, 3, 100);
    if (nameError) {
      alert(nameError);
      return;
    }
    
    if (company.email) {
      const emailError = validateEmail(company.email);
      if (emailError) {
        alert(emailError);
        return;
      }
    }
    
    if (company.phone) {
      const phoneError = validatePhone(company.phone);
      if (phoneError) {
        alert(phoneError);
        return;
      }
    }
    
    const addressError = validateAddress(company.address);
    if (addressError) {
      alert(addressError);
      return;
    }
    
    // Sanitize sensitive fields
    const sanitizedCompany = {
      ...company,
      name: sanitizeInput(company.name),
      address: sanitizeInput(company.address),
      email: company.email ? sanitizeInput(company.email) : '',
      phone: company.phone ? sanitizeInput(company.phone) : '',
    };
    
    localStorage.setItem('hems_settings', JSON.stringify(sanitizedCompany));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const PROFILE_NAMES: Record<string, string> = {
    PERSONAL: 'Pemilik Alat (Perorangan)',
    DEALER: 'Dealer / Distributor',
    CONTRACTOR: 'Kontraktor',
    RENTAL: 'Perusahaan Sewa (Rental)',
    WORKSHOP: 'Bengkel / Workshop',
    TRADER: 'Pedagang Alat Bekas',
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pengaturan</h1>
          <p className="page-subtitle">Konfigurasi sistem, profil bisnis, dan kustomisasi menu navigasi</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={save}>
            {saved ? '✅ Tersimpan!' : 'Simpan Pengaturan'}
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-default)', paddingBottom: 0 }}>
        {(['company', 'modules', 'system', 'bank', 'print', 'about'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--sany-red)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === tab ? 700 : 500,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            {{
              company: 'Perusahaan',
              modules: 'Modul & Menu',
              system: 'Sistem',
              bank: 'Rekening Bank',
              print: 'Cetak',
              about: 'Tentang',
            }[tab]}
          </button>
        ))}
      </div>

      {/* Tab Data Perusahaan */}
      {activeTab === 'company' && (
        <div className="card">
          <div style={{ marginBottom: 20, fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Data Perusahaan</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Nama Perusahaan</label><input className="form-input" value={company.name} onChange={e => setCompany(c => ({ ...c, name: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={company.npwp} onChange={e => setCompany(c => ({ ...c, npwp: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Alamat Lengkap</label><textarea className="form-textarea" value={company.address} onChange={e => setCompany(c => ({ ...c, address: e.target.value }))} /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Telepon</label><input className="form-input" value={company.phone} onChange={e => setCompany(c => ({ ...c, phone: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={company.email} onChange={e => setCompany(c => ({ ...c, email: e.target.value }))} /></div>
          </div>
        </div>
      )}

      {/* Tab Modul & Menu Navigation */}
      {activeTab === 'modules' && (
        <div>
          {/* Header Profil Bisnis Aktif */}
          <div className="card" style={{ marginBottom: 20, background: 'linear-gradient(135deg, rgba(230,0,18,0.06), rgba(255,255,255,0.01))', border: '1px solid rgba(230,0,18,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--sany-red)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Profil Bisnis Aktif Saat Ini
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                  {modes.length > 0 ? modes.map(m => PROFILE_NAMES[m] || m).join(' • ') : 'Belum memilih profil bisnis'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Profil bisnis mengatur opsi bawaan modul. Anda dapat mengaktifkan modul tambahan secara bebas di bawah ini.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => { resetSetup(); navigate('/setup'); }}
                  style={{ fontSize: 12, padding: '8px 16px' }}
                >
                  ⚙️ Ubah Profil Bisnis
                </button>
                <button
                  className="btn btn-primary"
                  onClick={enableAllMenus}
                  style={{ fontSize: 12, padding: '8px 16px' }}
                >
                  ⚡ Aktifkan Semua Modul
                </button>
              </div>
            </div>
          </div>

          {/* Daftar Modul dengan Toggle */}
          <div className="card">
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Kelola & Tambah Modul Navigasi</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  Aktifkan atau nonaktifkan modul di sidebar sesuai dengan alur kerja operasional Anda.
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
              {ALL_MODULES.map(m => {
                const active = isMenuEnabled(m.path);
                const isCustom = customMenus.includes(m.path);
                return (
                  <div
                    key={m.path}
                    onClick={() => toggleCustomMenu(m.path)}
                    style={{
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-md)',
                      background: active ? 'rgba(255,255,255,0.03)' : 'var(--bg-elevated)',
                      border: `1px solid ${active ? 'var(--border-default)' : 'transparent'}`,
                      opacity: active ? 1 : 0.6,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 12,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {m.name}
                        </span>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
                          {m.cat}
                        </span>
                        {isCustom && (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(230,0,18,0.15)', color: 'var(--sany-red)', fontWeight: 600 }}>
                            Kustom
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {m.desc}
                      </div>
                    </div>

                    {/* Toggle Switch Visual */}
                    <div style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      background: active ? 'var(--sany-red)' : 'var(--border-muted)',
                      position: 'relative',
                      flexShrink: 0,
                      marginTop: 2,
                      transition: 'background 0.2s',
                    }}>
                      <div style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: 'white',
                        position: 'absolute',
                        top: 2,
                        left: active ? 18 : 2,
                        transition: 'left 0.2s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab Konfigurasi Sistem */}
      {activeTab === 'system' && (
        <div className="card">
          <div style={{ marginBottom: 20, fontWeight: 700, fontSize: 15 }}>Konfigurasi Sistem</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Mata Uang</label>
              <select className="form-select" value={company.currency} onChange={e => setCompany(c => ({ ...c, currency: e.target.value }))}>
                <option value="IDR">IDR — Rupiah Indonesia</option>
                <option value="USD">USD — US Dollar</option>
                <option value="SGD">SGD — Singapore Dollar</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Zona Waktu</label>
              <select className="form-select" value={company.timezone} onChange={e => setCompany(c => ({ ...c, timezone: e.target.value }))}>
                <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
                <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
                <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
              </select>
            </div>
          </div>
          <div className="divider" />
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <p>• Perubahan zona waktu berlaku setelah restart aplikasi.</p>
            <p>• Format tanggal menggunakan standar Indonesia: DD/MM/YYYY.</p>
          </div>
        </div>
      )}

      {/* Tab Rekening Bank */}
      {activeTab === 'bank' && (
        <BankAccounts />
      )}

      {/* Tab Pengaturan Cetak */}
      {activeTab === 'print' && (
        <div className="card">
          <div style={{ marginBottom: 20, fontWeight: 700, fontSize: 15 }}>Pengaturan Cetak</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { label: 'Ukuran Kertas Default', opts: ['A4', 'A5', 'Letter', 'Thermal 58mm', 'Thermal 80mm'] },
              { label: 'Orientasi Default', opts: ['Portrait', 'Landscape'] },
            ].map(s => (
              <div key={s.label} className="form-group">
                <label className="form-label">{s.label}</label>
                <select className="form-select">
                  {s.opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <p>• Thermal 58mm: Untuk printer kasir mini.</p>
            <p>• Thermal 80mm: Untuk printer struk standar.</p>
          </div>
        </div>
      )}

      {/* Tab Tentang Application */}
      {activeTab === 'about' && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ width: 80, height: 80, background: 'linear-gradient(135deg, var(--sany-red), #FF4455)', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 36, fontWeight: 900, color: 'white', boxShadow: '0 8px 24px rgba(230,0,18,0.4)' }}>F</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>FATHONI EQUIPMENT OS</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>Sistem Operasional Alat Berat Terintegrasi</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 320, margin: '0 auto', textAlign: 'left' }}>
            {[['Versi', __APP_VERSION__], ['Lisensi', 'Proprietary'], ['Teknologi', 'Electron + React']].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{v}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 24 }}>
            © 2024 {company.name}. Semua hak dilindungi.
          </p>
        </div>
      )}
    </div>
  );
}
