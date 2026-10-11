// src/pages/Rental.tsx - Modul Manajemen Rental Alat Berat FATHONI EQUIPMENT OS

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';
import { nomorBerikut, nomorSementara } from '../utils/nomorBerikut';
import {
  validateField,
  validateAmount,
  validateDateRange,
  validateName,
  validateHourMeter
} from '../utils/validation';


import { type RentalContract } from '../data/demoTransactions';


const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  ACTIVE: { label: 'Sedang Berjalan', badge: 'badge-success' },
  PENDING: { label: 'Menunggu Mobilisasi', badge: 'badge-warning' },
  COMPLETED: { label: 'Selesai / Demobilisasi', badge: 'badge-muted' },
  EXTENDED: { label: 'Diperpanjang', badge: 'badge-info' },
};

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

export default function Rental() {
  const { rentals: data, setRentals: setData, units, customers, addRental, updateUnitStatus, removeRow } = useDataStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);
  const [viewMode, setViewMode] = useState<'timeline' | 'table'>('timeline');

  const nomorKontrak = (urutan: number) =>
    `RNT-${new Date().getFullYear()}-${String(urutan).padStart(3, '0')}`;

  const formKosong = {
    contractNo: nomorSementara(data, 'contractNo', nomorKontrak),
    customerName: '',
    unitModel: 'Komatsu PC200-8 Excavator',
    serialNumber: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
    location: '',
    monthlyRate: 90_000_000,
    minimumHours: 200,
    operatorIncluded: true,
  };
  const [form, setForm] = useState(formKosong);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = data.filter(item => {
    const matchSearch = matchesQuery([item.contractNo, item.customerName, item.unitModel, item.location], search);
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const activeRentals = data.filter(i => i.status === 'ACTIVE').length;
  const activeMonthlyBilling = data
    .filter(i => i.status === 'ACTIVE')
    .reduce((acc, i) => acc + i.monthlyRate, 0);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    // Validasi nama pelanggan
    const customerError = validateName(form.customerName, 3, 100);
    if (customerError) {
      alert(customerError);
      return;
    }

    // Validasi model unit
    const modelError = validateField(form.unitModel, { required: true, minLength: 2, maxLength: 100 }, 'Model Unit');
    if (modelError) {
      alert(modelError);
      return;
    }

    // Validasi serial number jika diisi
    if (form.serialNumber) {
      const serialError = validateField(form.serialNumber, { minLength: 3, maxLength: 50 }, 'Serial Number');
      if (serialError) {
        alert(serialError);
        return;
      }
    }

    // Validasi tanggal mulai
    const startDateError = validateField(form.startDate, { required: true }, 'Tanggal Mulai');
    if (startDateError) {
      alert(startDateError);
      return;
    }

    // Validasi tanggal selesai
    const endDateError = validateField(form.endDate, { required: true }, 'Tanggal Selesai');
    if (endDateError) {
      alert(endDateError);
      return;
    }

    // Validasi range tanggal
    const dateRangeError = validateDateRange(form.startDate, form.endDate, 'Tanggal Mulai', 'Tanggal Selesai');
    if (dateRangeError) {
      alert(dateRangeError);
      return;
    }

    // Validasi lokasi
    const locationError = validateField(form.location, { required: true, minLength: 3, maxLength: 100 }, 'Lokasi');
    if (locationError) {
      alert(locationError);
      return;
    }

    // Validasi tarif bulanan
    const rateError = validateAmount(form.monthlyRate, 1000000, 500000000);
    if (rateError) {
      alert(rateError);
      return;
    }

    // Validasi jam minimum
    const hmError = validateHourMeter(form.minimumHours);
    if (hmError) {
      alert(hmError);
      return;
    }

    if (editingId) {
      setData(data.map(i => i.id === editingId ? { ...i, contractNo: form.contractNo, customerName: form.customerName, unitModel: form.unitModel, serialNumber: form.serialNumber || i.serialNumber, startDate: form.startDate, endDate: form.endDate, location: form.location, monthlyRate: Number(form.monthlyRate), minimumHours: Number(form.minimumHours), operatorIncluded: form.operatorIncluded } : i));
    } else {
      const newItem: RentalContract = {
        id: Date.now().toString(),
        contractNo: form.contractNo,
        customerName: form.customerName,
        unitModel: form.unitModel,
        serialNumber: form.serialNumber || 'SN-RENTAL-' + Date.now().toString().slice(-4),
        startDate: form.startDate,
        endDate: form.endDate,
        location: form.location,
        monthlyRate: Number(form.monthlyRate),
        minimumHours: Number(form.minimumHours),
        operatorIncluded: form.operatorIncluded,
        status: 'ACTIVE',
      };
      // Unit menjadi RENTED dan invoice bulan pertama dibuat di satu aksi store.
      addRental(newItem);
    }
    setShowModal(false);
    setEditingId(null);
    setForm(formKosong);
  };

  const handleEdit = (item: RentalContract) => {
    setEditingId(item.id);
    setForm({ contractNo: item.contractNo, customerName: item.customerName, unitModel: item.unitModel, serialNumber: item.serialNumber, startDate: item.startDate, endDate: item.endDate, location: item.location, monthlyRate: item.monthlyRate, minimumHours: item.minimumHours, operatorIncluded: item.operatorIncluded });
    setShowModal(true);
  };

  // Kontrak rental yang sudah punya invoice atau surat jalan dibiarkan utuh:
  // penagihan yang kehilangan induknya tidak bisa diverifikasi lagi.
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus data kontrak rental ini?')) return;
    const hasil = await removeRow('rentals', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
    }
  };

  const handleCompleteContract = (id: string) => {
    if (confirm('Selesaikan kontrak sewa ini dan jadwalkan demobilisasi alat?')) {
      setData(data.map(i => (i.id === id ? { ...i, status: 'COMPLETED' } : i)));
      const rental = data.find(i => i.id === id);
      if (rental && rental.serialNumber) {
        const unit = units.find((u: any) => u.serialNumber === rental.serialNumber);
        if (unit) {
          updateUnitStatus(unit.id, 'AVAILABLE');
        }
      }
    }
  };

  const handlePrint = (item: RentalContract) => {
    if (confirm(`Cetak Kontrak Rental ${item.contractNo}?`)) {
      const companyName = getCompanyName();
      
      const htmlContent = `
        <html><head><title>Kontrak Rental ${sanitize(item.contractNo)}</title><style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #111; }
          h2 { color: #C00; margin-bottom: 8px; }
          .header { margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #C00; }
          .company { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
          table { width:100%; border-collapse:collapse; margin-top:16px; }
          th,td { border:1px solid #ccc; padding:8px 12px; text-align:left; }
          th { background:#f0f0f0; } .total { font-weight:bold; font-size:1.1em; }
          .footer { margin-top:40px; display:flex; justify-content:space-between; }
          .sign { text-align:center; width:160px; } .sign-line { border-top:1px solid #111; margin-top:60px; }
          @media print { body { padding: 20px; } }
        </style></head><body>
        <div class="header">
          <div class="company">${sanitize(companyName)}</div>
          <h2>SURAT PERJANJIAN SEWA (RENTAL CONTRACT)</h2>
        </div>
        <p><strong>No. Kontrak:</strong> ${sanitize(item.contractNo)} &nbsp;&nbsp; <strong>Tanggal:</strong> ${item.startDate}</p>
        <table>
          <tr><th>Pelanggan</th><td>${sanitize(item.customerName)}</td></tr>
          <tr><th>Unit Alat Berat</th><td>${sanitize(item.unitModel)}</td></tr>
          <tr><th>Serial Number</th><td>${sanitize(item.serialNumber)}</td></tr>
          <tr><th>Lokasi Proyek</th><td>${sanitize(item.location)}</td></tr>
          <tr><th>Tanggal Mulai</th><td>${item.startDate}</td></tr>
          <tr><th>Tanggal Selesai</th><td>${item.endDate}</td></tr>
          <tr><th>Tarif Bulanan</th><td class="total">Rp ${(item.monthlyRate ?? 0).toLocaleString('id-ID')}</td></tr>
          <tr><th>Jam Minimum</th><td>${item.minimumHours} jam/bulan</td></tr>
          <tr><th>Operator Termasuk</th><td>${item.operatorIncluded ? 'Ya' : 'Tidak'}</td></tr>
          <tr><th>Status</th><td>${sanitize(item.status)}</td></tr>
        </table>
        <div class="footer">
          <div class="sign"><div class="sign-line"></div><div>Pelanggan</div></div>
          <div class="sign"><div class="sign-line"></div><div>Sales Rental</div></div>
          <div class="sign"><div class="sign-line"></div><div>Direktur</div></div>
        </div>
      </body></html>
      `;
      printDocument(htmlContent, `Kontrak Rental ${item.contractNo}`);
    }
  };

  const openCreateModal = async () => {
    setEditingId(null);
    const contractNo = await nomorBerikut('rentals', 'contractNo', data, nomorKontrak);
    setForm({ ...formKosong, contractNo });
    setShowModal(true);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Manajemen Rental & Sewa</h1>
          <p className="page-subtitle">Pencatatan kontrak sewa alat berat, penempatan jobsite, dan jam operasi armada</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Buat Kontrak Sewa
          </button>
        </div>
      </div>

      <div className="grid-3 mb-4">
        <div className="card stat-card">
          <div className="card-title">Armada Aktif Disewa</div>
          <div className="card-value" style={{ color: 'var(--accent-blue)' }}>{activeRentals} Unit</div>
          <div className="card-sub">Beroperasi di Proyek / Tambang</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Billing Rental Bulanan</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{fmt(activeMonthlyBilling)}</div>
          <div className="card-sub">Pendapatan Rutin Per Bulan</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Total Kontrak Sewa</div>
          <div className="card-value" style={{ color: 'var(--text-primary)' }}>{data.length} Kontrak</div>
          <div className="card-sub">Histori Sewa Pelanggan</div>
        </div>
      </div>

      <div className="card mb-4" style={{ padding: '14px 20px', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status:</span>
          {['ALL', 'ACTIVE', 'PENDING', 'COMPLETED'].map(st => (
            <button
              key={st}
              className={`btn btn-sm ${statusFilter === st ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusFilter(st)}
            >
              {st === 'ALL' ? 'Semua' : STATUS_MAP[st]?.label ?? st}
            </button>
          ))}
        </div>

        <div className="topbar-search" style={{ width: 280 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Cari kontrak, penyewa, lokasi..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
          <button 
            className={`btn btn-sm ${viewMode === 'timeline' ? 'btn-primary' : ''}`} 
            style={{ borderRadius: 0, border: 'none', background: viewMode === 'timeline' ? 'var(--primary)' : 'transparent' }}
            onClick={() => setViewMode('timeline')}
          >
            📈 Timeline
          </button>
          <button 
            className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : ''}`} 
            style={{ borderRadius: 0, border: 'none', background: viewMode === 'table' ? 'var(--primary)' : 'transparent' }}
            onClick={() => setViewMode('table')}
          >
            📊 Tabel
          </button>
        </div>
      </div>

      {viewMode === 'timeline' ? (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border-default)', overflowX: 'auto', padding: 20, marginBottom: 20 }}>
          <div style={{ minWidth: 800 }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-default)', paddingBottom: 10, marginBottom: 16 }}>
              <div style={{ width: 250, fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)' }}>Alat Berat & Penyewa</div>
              <div style={{ flex: 1, display: 'flex' }}>
                {['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'].map(m => (
                  <div key={m} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{m}</div>
                ))}
              </div>
            </div>
            
            {filtered.map(item => {
              const currentYear = new Date().getFullYear();
              const start = new Date(item.startDate);
              const end = new Date(item.endDate);
              
              const yearStart = new Date(currentYear, 0, 1);
              const yearEnd = new Date(currentYear, 11, 31);
              
              if (end < yearStart || start > yearEnd) return null;
              
              const s = start < yearStart ? yearStart : start;
              const e = end > yearEnd ? yearEnd : end;
              
              const totalDays = 365;
              const startDay = (s.getTime() - yearStart.getTime()) / (1000 * 3600 * 24);
              const durationDays = (e.getTime() - s.getTime()) / (1000 * 3600 * 24);
              
              const left = (startDay / totalDays) * 100;
              const width = (durationDays / totalDays) * 100;

              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 12, borderBottom: '1px dashed var(--border-default)', paddingBottom: 8 }}>
                  <div style={{ width: 250, paddingRight: 16 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{item.unitModel}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{item.customerName}</div>
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: 26, background: 'var(--bg-card)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
                    <div style={{
                      position: 'absolute', left: `${left}%`, width: `${width}%`, height: '100%',
                      background: item.status === 'ACTIVE' ? 'var(--status-operating)' : item.status === 'COMPLETED' ? 'var(--text-muted)' : 'var(--accent-blue)',
                      borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 6px',
                      cursor: 'pointer'
                    }} title={`${item.contractNo} : ${item.startDate} s/d ${item.endDate}`} onClick={() => handleEdit(item)}>
                      {width > 10 ? item.contractNo : ''}
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Tidak ada kontrak aktif di tahun ini.</div>}
          </div>
        </div>
      ) : (
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>No. Kontrak / Periode</th>
              <th>Penyewa & Lokasi</th>
              <th>Unit Alat Berat</th>
              <th style={{ textAlign: 'right' }}>Rate / Bulan</th>
              <th>Min. Jam (HM)</th>
              <th>Operator</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                  Tidak ada kontrak rental yang sesuai.
                </td>
              </tr>
            ) : (
              filtered.map(item => (
                <tr key={item.id}>
                  <td>
                    <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{item.contractNo}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.startDate} s/d {item.endDate}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.customerName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>📍 {item.location}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.unitModel}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>SN: {item.serialNumber}</div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--status-operating)' }}>
                    {fmt(item.monthlyRate)}
                  </td>
                  <td style={{ fontSize: 13 }}>{item.minimumHours} Jam / Bln</td>
                  <td>
                    <span className={`badge ${item.operatorIncluded ? 'badge-success' : 'badge-muted'}`}>
                      {item.operatorIncluded ? 'Include Operator' : 'Unit Only'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_MAP[item.status]?.badge}`}>
                      {STATUS_MAP[item.status]?.label}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      {item.status === 'ACTIVE' && (
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleCompleteContract(item.id)}
                        >
                          Selesai Sewa
                        </button>
                      )}
                       <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleEdit(item)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handlePrint(item)}
                        >
                          Cetak Perjanjian
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(item.id)}
                        >
                          Hapus
                        </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* Modal Tambah Kontrak */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">{editingId ? 'Edit Kontrak Sewa' : 'Buat Kontrak Sewa Alat Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Nomor Kontrak</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.contractNo}
                      onChange={e => setForm({ ...form, contractNo: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nama Penyewa (Pilih dari Master)</label>
                    <select
                      className="form-select"
                      required
                      value={form.customerName}
                      onChange={e => setForm({ ...form, customerName: e.target.value })}
                    >
                      <option value="">-- Pilih Pelanggan --</option>
                      {customers.map((c: any) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Pilih Unit (AVAILABLE)</label>
                    <select
                      className="form-select"
                      required
                      value={form.serialNumber}
                      onChange={e => {
                        const sn = e.target.value;
                        const selected = units.find((u: any) => u.serialNumber === sn);
                        if (selected) {
                          setForm({ ...form, serialNumber: sn, unitModel: `${selected.brand} ${selected.model}` });
                        } else {
                          setForm({ ...form, serialNumber: '' });
                        }
                      }}
                    >
                      <option value="">-- Pilih Unit --</option>
                      {units.filter((u: any) => u.status === 'AVAILABLE' || u.serialNumber === form.serialNumber).map((u: any) => (
                        <option key={u.id} value={u.serialNumber}>{u.brand} {u.model} - SN: {u.serialNumber}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Model Terpilih</label>
                    <input
                      type="text"
                      className="form-input"
                      disabled
                      value={form.unitModel}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Lokasi Penempatan / Jobsite</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Morowali, Sulawesi Tengah"
                    value={form.location}
                    onChange={e => setForm({ ...form, location: e.target.value })}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Tanggal Mulai</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.startDate}
                      onChange={e => setForm({ ...form, startDate: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tanggal Berakhir</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.endDate}
                      onChange={e => setForm({ ...form, endDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Tarif Bulanan (IDR)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.monthlyRate || ''}
                      onChange={e => setForm({ ...form, monthlyRate: Number(e.target.value) })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Minimal Jam Operasi (HM)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.minimumHours || ''}
                      onChange={e => setForm({ ...form, minimumHours: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    id="chkOperator"
                    checked={form.operatorIncluded}
                    onChange={e => setForm({ ...form, operatorIncluded: e.target.checked })}
                  />
                  <label htmlFor="chkOperator" style={{ fontSize: 13, cursor: 'pointer' }}>
                    Termasuk Tenaga Operator (Include Operator)
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Simpan Perubahan' : 'Simpan Kontrak'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
