// src/pages/Operators.tsx - Modul Operator Management FATHONI EQUIPMENT OS

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { Operator, OperatorStatus } from '../types';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';
import { nomorBerikut, nomorSementara } from '../utils/nomorBerikut';
import {
  validateField,
  validateName,
  validatePhone,
  validateEmail
} from '../utils/validation';

const STATUS_MAP: Record<OperatorStatus, { label: string; badge: string }> = {
  ACTIVE: { label: 'Aktif', badge: 'badge-success' },
  INACTIVE: { label: 'Non-Aktif', badge: 'badge-muted' },
  ON_LEAVE: { label: 'Cuti', badge: 'badge-warning' },
  SUSPENDED: { label: 'Suspensi', badge: 'badge-danger' },
};

export default function Operators() {
  const { operators, setOperators, units, removeRow } = useDataStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);

  const nomorOperator = (urutan: number) =>
    `OP-${new Date().getFullYear()}-${String(urutan).padStart(3, '0')}`;

  const formKosong = {
    operatorNumber: nomorSementara(operators, 'operatorNumber', nomorOperator),
    name: '',
    phone: '',
    email: '',
    nik: '',
    status: 'ACTIVE' as OperatorStatus,
    assignedUnit: '',
    assignedProject: '',
    totalHours: 0,
    startDate: '',
    licenseNumber: '',
    licenseExpiry: '',
    notes: '',
  };
  const [form, setForm] = useState(formKosong);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openCreateModal = async () => {
    setEditingId(null);
    const operatorNumber = await nomorBerikut('operators', 'operatorNumber', operators, nomorOperator);
    setForm({ ...formKosong, operatorNumber });
    setShowModal(true);
  };

  const filtered = operators.filter(item => {
    const matchSearch = matchesQuery([item.operatorNumber, item.name, item.phone, item.assignedUnit], search);
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalOperators = operators.length;
  const activeOperators = operators.filter(o => o.status === 'ACTIVE').length;
  const onLeave = operators.filter(o => o.status === 'ON_LEAVE').length;
  const suspended = operators.filter(o => o.status === 'SUSPENDED').length;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    // Validasi nama
    const nameError = validateName(form.name, 3, 100);
    if (nameError) {
      alert(nameError);
      return;
    }

    // Validasi telepon
    const phoneError = validatePhone(form.phone);
    if (phoneError) {
      alert(phoneError);
      return;
    }

    // Validasi email jika diisi
    if (form.email) {
      const emailError = validateEmail(form.email);
      if (emailError) {
        alert(emailError);
        return;
      }
    }

    // Validasi NIK jika diisi
    if (form.nik && form.nik.length !== 16) {
      alert('NIK harus 16 digit');
      return;
    }

    // Validasi tanggal mulai
    const dateError = validateField(form.startDate, { required: true }, 'Tanggal Mulai');
    if (dateError) {
      alert(dateError);
      return;
    }

    if (editingId) {
      setOperators(operators.map(o => o.id === editingId ? {
        ...o,
        operatorNumber: form.operatorNumber,
        name: form.name,
        phone: form.phone,
        email: form.email,
        nik: form.nik,
        status: form.status,
        assignedUnit: form.assignedUnit,
        assignedProject: form.assignedProject,
        totalHours: form.totalHours,
        startDate: form.startDate,
        licenseNumber: form.licenseNumber,
        licenseExpiry: form.licenseExpiry,
        notes: form.notes,
      } : o));
    } else {
      const newItem: Operator = {
        id: Date.now().toString(),
        operatorNumber: form.operatorNumber,
        name: form.name,
        phone: form.phone,
        email: form.email,
        nik: form.nik,
        status: form.status,
        certifications: [],
        assignedUnit: form.assignedUnit,
        assignedProject: form.assignedProject,
        totalHours: form.totalHours,
        startDate: form.startDate,
        licenseNumber: form.licenseNumber,
        licenseExpiry: form.licenseExpiry,
        notes: form.notes,
      };
      setOperators([newItem, ...operators]);
    }
    setShowModal(false);
    setEditingId(null);
    setForm(formKosong);
  };

  const handleEdit = (item: Operator) => {
    setEditingId(item.id);
    setForm({
      operatorNumber: item.operatorNumber,
      name: item.name,
      phone: item.phone,
      email: item.email || '',
      nik: item.nik || '',
      status: item.status,
      assignedUnit: item.assignedUnit || '',
      assignedProject: item.assignedProject || '',
      totalHours: item.totalHours,
      startDate: item.startDate,
      licenseNumber: item.licenseNumber || '',
      licenseExpiry: item.licenseExpiry || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  // Lewat removeRow: hanya baris ini yang dikirim ke database, dan pemeriksaan
  // rujukan di main process ikut berjalan. Menyaring array berarti menulis ulang
  // seluruh collection operators setiap kali satu nama dihapus.
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus data operator ini?')) return;
    const hasil = await removeRow('operators', id);
    if (!hasil.ok) alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
  };

  const handlePrint = (item: Operator) => {
    if (confirm(`Cetak Operator Profile ${item.operatorNumber}?`)) {
      const companyName = getCompanyName();

      const htmlContent = `
        <html>
          <head>
            <title>Operator Profile ${sanitize(item.operatorNumber)}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
              .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
              .header h1 { margin: 0; font-size: 24px; }
              .header p { margin: 5px 0; color: #666; }
              .info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
              .info-item { margin-bottom: 10px; }
              .info-item label { font-weight: bold; display: block; margin-bottom: 5px; }
              .section { margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px; }
              .section h3 { margin-top: 0; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
              .status { display: inline-block; padding: 5px 15px; border-radius: 20px; font-weight: bold; margin-bottom: 20px; }
              .status-active { background: #efe; color: #080; }
              .status-inactive { background: #eee; color: #666; }
              .status-on_leave { background: #ffd; color: #b80; }
              .status-suspended { background: #fee; color: #c00; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background: #f0f0f0; }
              .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>${sanitize(companyName)}</h1>
              <p>Operator Profile</p>
            </div>

            <div class="status status-${(item.status ?? '').toLowerCase().replace('_', '-')}">
              Status: ${STATUS_MAP[item.status]?.label ?? item.status}
            </div>

            <div class="info">
              <div class="info-item">
                <label>Operator Number:</label>
                <span>${sanitize(item.operatorNumber)}</span>
              </div>
              <div class="info-item">
                <label>Name:</label>
                <span>${sanitize(item.name)}</span>
              </div>
              <div class="info-item">
                <label>Phone:</label>
                <span>${sanitize(item.phone)}</span>
              </div>
              <div class="info-item">
                <label>Email:</label>
                <span>${item.email ? sanitize(item.email) : '-'}</span>
              </div>
              <div class="info-item">
                <label>NIK:</label>
                <span>${item.nik ? sanitize(item.nik) : '-'}</span>
              </div>
              <div class="info-item">
                <label>Start Date:</label>
                <span>${new Date(item.startDate).toLocaleDateString('id-ID')}</span>
              </div>
            </div>

            <div class="section">
              <h3>Assignment</h3>
              <p>Assigned Unit: ${item.assignedUnit ? sanitize(item.assignedUnit) : 'Not assigned'}</p>
              <p>Assigned Project: ${item.assignedProject ? sanitize(item.assignedProject) : 'Not assigned'}</p>
              <p>Total Hours: ${(item.totalHours ?? 0).toLocaleString('id-ID')} hours</p>
            </div>

            ${item.licenseNumber ? `
            <div class="section">
              <h3>License Information</h3>
              <p>License Number: ${sanitize(item.licenseNumber)}</p>
              <p>License Expiry: ${item.licenseExpiry ? new Date(item.licenseExpiry).toLocaleDateString('id-ID') : '-'}</p>
            </div>
            ` : ''}

            ${item.certifications && item.certifications.length > 0 ? `
            <div class="section">
              <h3>Certifications</h3>
              <table>
                <thead>
                  <tr>
                    <th>Certification</th>
                    <th>Issue Date</th>
                    <th>Expiry Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${item.certifications.map(cert => `
                    <tr>
                      <td>${sanitize(cert.name)}</td>
                      <td>${new Date(cert.issueDate).toLocaleDateString('id-ID')}</td>
                      <td>${new Date(cert.expiryDate).toLocaleDateString('id-ID')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ` : ''}

            ${item.notes ? `
            <div class="section">
              <h3>Notes</h3>
              <p>${sanitize(item.notes)}</p>
            </div>
            ` : ''}

            <div class="footer">
              <p>Generated by FATHONI EQUIPMENT OS - Sistem Operasional Alat Berat Terintegrasi</p>
              <p>${new Date().toLocaleString('id-ID')}</p>
            </div>
          </body>
        </html>
      `;

      printDocument(htmlContent);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>👷 Operator Management</h1>
        <p>Manajemen data operator alat berat</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{totalOperators}</div>
          <div className="stat-label">Total Operator</div>
        </div>
        <div className="stat-card" style={{ background: '#efe', border: '1px solid #8f8' }}>
          <div className="stat-value">{activeOperators}</div>
          <div className="stat-label">Aktif</div>
        </div>
        <div className="stat-card" style={{ background: '#ffd', border: '1px solid #fc0' }}>
          <div className="stat-value">{onLeave}</div>
          <div className="stat-label">Cuti</div>
        </div>
        <div className="stat-card" style={{ background: '#fee', border: '1px solid #fcc' }}>
          <div className="stat-value">{suspended}</div>
          <div className="stat-label">Suspensi</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Cari operator..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="search-input"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="filter-select"
        >
          <option value="ALL">Semua Status</option>
          <option value="ACTIVE">Aktif</option>
          <option value="INACTIVE">Non-Aktif</option>
          <option value="ON_LEAVE">Cuti</option>
          <option value="SUSPENDED">Suspensi</option>
        </select>
        <button onClick={openCreateModal} className="btn btn-primary">
          + Tambah Operator
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>No. Operator</th>
              <th>Nama</th>
              <th>Telepon</th>
              <th>Unit Terassign</th>
              <th>Project</th>
              <th>Total Jam</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id}>
                <td>
                  <strong>{item.operatorNumber}</strong>
                  {item.nik && <div style={{ fontSize: 11, color: '#666' }}>NIK: {item.nik}</div>}
                </td>
                <td>
                  <div>{item.name}</div>
                  {item.email && <div style={{ fontSize: 11, color: '#666' }}>{item.email}</div>}
                </td>
                <td>{item.phone}</td>
                <td>{item.assignedUnit || '-'}</td>
                <td>{item.assignedProject || '-'}</td>
                <td>{(item.totalHours ?? 0).toLocaleString('id-ID')}h</td>
                <td>
                  <span className={`badge ${STATUS_MAP[item.status]?.badge ?? 'badge-muted'}`}>
                    {STATUS_MAP[item.status]?.label ?? item.status}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button onClick={() => handleEdit(item)} className="btn btn-sm" title="Edit">
                      ✏️
                    </button>
                    <button onClick={() => handlePrint(item)} className="btn btn-sm" title="Print">
                      🖨️
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="btn btn-sm btn-danger" title="Delete">
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal">
          <div className="modal-content" style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Operator' : 'Tambah Operator Baru'}</h2>
              <button onClick={() => setShowModal(false)} className="modal-close">×</button>
            </div>
            <form onSubmit={handleCreate} className="modal-body">
              <div className="form-group">
                <label>No. Operator</label>
                <input
                  type="text"
                  value={form.operatorNumber}
                  onChange={e => setForm({ ...form, operatorNumber: e.target.value })}
                  disabled
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nama Lengkap *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Nama lengkap operator"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Telepon *</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="08xxxxxxxxxx"
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="email@example.com"
                  />
                </div>
                <div className="form-group">
                  <label>NIK</label>
                  <input
                    type="text"
                    value={form.nik}
                    onChange={e => setForm({ ...form, nik: e.target.value })}
                    placeholder="16 digit NIK"
                    maxLength={16}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Status *</label>
                  <select
                    value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value as OperatorStatus })}
                  >
                    <option value="ACTIVE">Aktif</option>
                    <option value="INACTIVE">Non-Aktif</option>
                    <option value="ON_LEAVE">Cuti</option>
                    <option value="SUSPENDED">Suspensi</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Tanggal Mulai *</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm({ ...form, startDate: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Unit Terassign</label>
                  <select
                    value={form.assignedUnit}
                    onChange={e => setForm({ ...form, assignedUnit: e.target.value })}
                  >
                    <option value="">Tidak ada</option>
                    {units.map((u: any) => (
                      <option key={u.id} value={u.serialNumber}>
                        {u.serialNumber} - {u.model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Project Terassign</label>
                  <input
                    type="text"
                    value={form.assignedProject}
                    onChange={e => setForm({ ...form, assignedProject: e.target.value })}
                    placeholder="Nama project"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Total Jam Kerja</label>
                  <input
                    type="number"
                    value={form.totalHours}
                    onChange={e => setForm({ ...form, totalHours: Number(e.target.value) })}
                    placeholder="0"
                    min={0}
                  />
                </div>
                <div className="form-group">
                  <label>No. Lisensi</label>
                  <input
                    type="text"
                    value={form.licenseNumber}
                    onChange={e => setForm({ ...form, licenseNumber: e.target.value })}
                    placeholder="Nomor lisensi operator"
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Masa Berlaku Lisensi</label>
                <input
                  type="date"
                  value={form.licenseExpiry}
                  onChange={e => setForm({ ...form, licenseExpiry: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Catatan</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Catatan tambahan..."
                  rows={3}
                />
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Batal
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingId ? 'Simpan Perubahan' : 'Tambah Operator'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
