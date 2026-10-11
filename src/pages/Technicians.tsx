// src/pages/Technicians.tsx - Modul Technician Management FATHONI EQUIPMENT OS

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { Technician, TechnicianStatus } from '../types';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';
import { nomorBerikut, nomorSementara } from '../utils/nomorBerikut';
import {
  validateField,
  validateName,
  validatePhone,
  validateEmail
} from '../utils/validation';

const STATUS_MAP: Record<TechnicianStatus, { label: string; badge: string }> = {
  ACTIVE: { label: 'Aktif', badge: 'badge-success' },
  INACTIVE: { label: 'Non-Aktif', badge: 'badge-muted' },
  ON_LEAVE: { label: 'Cuti', badge: 'badge-warning' },
  SUSPENDED: { label: 'Suspensi', badge: 'badge-danger' },
};

// Kolom daftar pada baris lama atau hasil restore bisa terisi teks, bukan
// daftar. Tanpa penjaga ini `.map`/`.slice().map` melempar — di layar daftar
// seluruh halaman ikut runtuh, di dokumen cetak dokumennya tidak pernah jadi.
const daftar = (nilai: any): any[] => (Array.isArray(nilai) ? nilai : []);

export default function Technicians() {
  const { technicians, setTechnicians, removeRow } = useDataStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);

  const nomorTeknisi = (urutan: number) =>
    `TECH-${new Date().getFullYear()}-${String(urutan).padStart(3, '0')}`;

  const formKosong = {
    technicianNumber: nomorSementara(technicians, 'technicianNumber', nomorTeknisi),
    name: '',
    phone: '',
    email: '',
    nik: '',
    status: 'ACTIVE' as TechnicianStatus,
    specializations: [] as string[],
    skills: [] as string[],
    totalWorkOrders: 0,
    totalHours: 0,
    startDate: '',
    notes: '',
  };
  const [form, setForm] = useState(formKosong);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openCreateModal = async () => {
    setEditingId(null);
    const technicianNumber = await nomorBerikut('technicians', 'technicianNumber', technicians, nomorTeknisi);
    setForm({ ...formKosong, technicianNumber });
    setShowModal(true);
  };

  const filtered = technicians.filter(item => {
    const matchSearch = matchesQuery([item.technicianNumber, item.name, item.phone, ...(item.specializations || [])], search);
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalTechnicians = technicians.length;
  const activeTechnicians = technicians.filter(t => t.status === 'ACTIVE').length;
  const onLeave = technicians.filter(t => t.status === 'ON_LEAVE').length;
  const suspended = technicians.filter(t => t.status === 'SUSPENDED').length;

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
      setTechnicians(technicians.map(t => t.id === editingId ? {
        ...t,
        technicianNumber: form.technicianNumber,
        name: form.name,
        phone: form.phone,
        email: form.email,
        nik: form.nik,
        status: form.status,
        specializations: form.specializations,
        skills: form.skills,
        totalWorkOrders: form.totalWorkOrders,
        totalHours: form.totalHours,
        startDate: form.startDate,
        notes: form.notes,
      } : t));
    } else {
      const newItem: Technician = {
        id: Date.now().toString(),
        technicianNumber: form.technicianNumber,
        name: form.name,
        phone: form.phone,
        email: form.email,
        nik: form.nik,
        status: form.status,
        specializations: form.specializations,
        certifications: [],
        totalWorkOrders: form.totalWorkOrders,
        totalHours: form.totalHours,
        startDate: form.startDate,
        skills: form.skills,
        notes: form.notes,
      };
      setTechnicians([newItem, ...technicians]);
    }
    setShowModal(false);
    setEditingId(null);
    setForm(formKosong);
  };

  const handleEdit = (item: Technician) => {
    setEditingId(item.id);
    setForm({
      technicianNumber: item.technicianNumber,
      name: item.name,
      phone: item.phone,
      email: item.email || '',
      nik: item.nik || '',
      status: item.status,
      specializations: item.specializations,
      skills: item.skills,
      totalWorkOrders: item.totalWorkOrders,
      totalHours: item.totalHours,
      startDate: item.startDate,
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  // Lewat removeRow, bukan filter array: satu baris dikirim ke database dan
  // pemeriksaan rujukan di main process ikut berjalan.
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus data teknisi ini?')) return;
    const hasil = await removeRow('technicians', id);
    if (!hasil.ok) alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
  };

  const handleAddSpecialization = () => {
    const spec = prompt('Masukkan spesialisasi baru:');
    if (spec && spec.trim()) {
      setForm({ ...form, specializations: [...form.specializations, spec.trim()] });
    }
  };

  const handleRemoveSpecialization = (index: number) => {
    setForm({ ...form, specializations: form.specializations.filter((_, i) => i !== index) });
  };

  const handleAddSkill = () => {
    const skill = prompt('Masukkan skill baru:');
    if (skill && skill.trim()) {
      setForm({ ...form, skills: [...form.skills, skill.trim()] });
    }
  };

  const handleRemoveSkill = (index: number) => {
    setForm({ ...form, skills: form.skills.filter((_, i) => i !== index) });
  };

  const handlePrint = (item: Technician) => {
    if (confirm(`Cetak Technician Profile ${item.technicianNumber}?`)) {
      const companyName = getCompanyName();
      // Sama seperti Operator: sertifikat bisa tidak ada atau berbentuk teks.
      const sertifikat = daftar(item.certifications);

      const htmlContent = `
        <html>
          <head>
            <title>Technician Profile ${sanitize(item.technicianNumber)}</title>
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
              .tags { display: flex; flex-wrap: wrap; gap: 8px; }
              .tag { background: #e0e0e0; padding: 4px 12px; border-radius: 16px; font-size: 11px; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background: #f0f0f0; }
              .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>${sanitize(companyName)}</h1>
              <p>Technician Profile</p>
            </div>

            <div class="status status-${(item.status ?? '').toLowerCase().replace('_', '-')}">
              Status: ${STATUS_MAP[item.status]?.label ?? item.status}
            </div>

            <div class="info">
              <div class="info-item">
                <label>Technician Number:</label>
                <span>${sanitize(item.technicianNumber)}</span>
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
              <h3>Performance</h3>
              <p>Total Work Orders: ${item.totalWorkOrders}</p>
              <p>Total Hours: ${(item.totalHours ?? 0).toLocaleString('id-ID')} hours</p>
            </div>

            <div class="section">
              <h3>Specializations</h3>
              <div class="tags">
                ${daftar(item.specializations).map(spec => `<span class="tag">${sanitize(spec)}</span>`).join('')}
              </div>
            </div>

            <div class="section">
              <h3>Skills</h3>
              <div class="tags">
                ${daftar(item.skills).map(skill => `<span class="tag">${sanitize(skill)}</span>`).join('')}
              </div>
            </div>

            ${sertifikat.length > 0 ? `
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
                  ${sertifikat.map(cert => `
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
        <h1>🔧 Technician Management</h1>
        <p>Manajemen data teknisi dan keahlian</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{totalTechnicians}</div>
          <div className="stat-label">Total Teknisi</div>
        </div>
        <div className="stat-card" style={{ background: '#efe', border: '1px solid #8f8' }}>
          <div className="stat-value">{activeTechnicians}</div>
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
          placeholder="Cari teknisi..."
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
          + Tambah Teknisi
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>No. Teknisi</th>
              <th>Nama</th>
              <th>Telepon</th>
              <th>Spesialisasi</th>
              <th>Total WO</th>
              <th>Total Jam</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id}>
                <td>
                  <strong>{item.technicianNumber}</strong>
                  {item.nik && <div style={{ fontSize: 11, color: '#666' }}>NIK: {item.nik}</div>}
                </td>
                <td>
                  <div>{item.name}</div>
                  {item.email && <div style={{ fontSize: 11, color: '#666' }}>{item.email}</div>}
                </td>
                <td>{item.phone}</td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {daftar(item.specializations).slice(0, 2).map((spec, i) => (
                      <span key={i} style={{ fontSize: 10, background: '#e0e0e0', padding: '2px 8px', borderRadius: 12 }}>
                        {spec}
                      </span>
                    ))}
                    {daftar(item.specializations).length > 2 && (
                      <span style={{ fontSize: 10, color: '#666' }}>+{daftar(item.specializations).length - 2}</span>
                    )}
                  </div>
                </td>
                <td>{item.totalWorkOrders}</td>
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
              <h2>{editingId ? 'Edit Teknisi' : 'Tambah Teknisi Baru'}</h2>
              <button onClick={() => setShowModal(false)} className="modal-close">×</button>
            </div>
            <form onSubmit={handleCreate} className="modal-body">
              <div className="form-group">
                <label>No. Teknisi</label>
                <input
                  type="text"
                  value={form.technicianNumber}
                  onChange={e => setForm({ ...form, technicianNumber: e.target.value })}
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
                    placeholder="Nama lengkap teknisi"
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
                    onChange={e => setForm({ ...form, status: e.target.value as TechnicianStatus })}
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
              <div className="form-group">
                <label>Spesialisasi</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {form.specializations.map((spec, index) => (
                    <span key={index} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#e0e0e0', padding: '4px 12px', borderRadius: 16, fontSize: 12 }}>
                      {spec}
                      <button type="button" onClick={() => handleRemoveSpecialization(index)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}>×</button>
                    </span>
                  ))}
                </div>
                <button type="button" onClick={handleAddSpecialization} className="btn btn-sm btn-secondary">
                  + Tambah Spesialisasi
                </button>
              </div>
              <div className="form-group">
                <label>Skills</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {form.skills.map((skill, index) => (
                    <span key={index} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#e0e0e0', padding: '4px 12px', borderRadius: 16, fontSize: 12 }}>
                      {skill}
                      <button type="button" onClick={() => handleRemoveSkill(index)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}>×</button>
                    </span>
                  ))}
                </div>
                <button type="button" onClick={handleAddSkill} className="btn btn-sm btn-secondary">
                  + Tambah Skill
                </button>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Total Work Orders</label>
                  <input
                    type="number"
                    value={form.totalWorkOrders}
                    onChange={e => setForm({ ...form, totalWorkOrders: Number(e.target.value) })}
                    placeholder="0"
                    min={0}
                  />
                </div>
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
                  {editingId ? 'Simpan Perubahan' : 'Tambah Teknisi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
