// src/pages/Documents.tsx - Modul Manajemen Dokumen Legal & Administratif

import { useState, useEffect } from 'react';
import { useDataStore } from '../store/dataStore';
import { getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';

interface Document {
  id: string;
  jenisDokumen: string;
  nomorDokumen: string;
  masaBerlaku: string;
  statusLegalitas: 'AKTIF' | 'EXPIRED' | 'REVOKED' | 'PENDING';
  fileUrl?: string;
  fileName?: string;
  keterangan?: string;
}

const JENIS_DOKUMEN = [
  'SIA (Surat Izin Alat)',
  'SIUP (Surat Izin Usaha Perdagangan)',
  'NIB (Nomor Induk Berusaha)',
  'NPWP (Nomor Pokok Wajib Pajak)',
  'Sertifikat Kepemilikan Unit',
  'STNK (Surat Tanda Nomor Kendaraan)',
  'Asuransi Unit',
  'Perjanjian Sewa',
  'Kontrak Kerjasama',
  'Lainnya',
];

const STATUS_CONFIG = {
  AKTIF: { label: 'Aktif', badge: 'badge-success' },
  EXPIRED: { label: 'Kadaluarsa', badge: 'badge-danger' },
  REVOKED: { label: 'Dicabut', badge: 'badge-muted' },
  PENDING: { label: 'Menunggu', badge: 'badge-warning' },
};

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

export default function Documents() {
  const { documents: data, setDocuments: setData, removeRow } = useDataStore();
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [form, setForm] = useState({
    jenisDokumen: 'SIA (Surat Izin Alat)',
    nomorDokumen: '',
    masaBerlaku: '',
    statusLegalitas: 'AKTIF' as Document['statusLegalitas'],
    keterangan: '',
  });

  const filtered = data.filter(item => {
    const matchSearch = matchesQuery([item.jenisDokumen, item.nomorDokumen], search);
    const matchStatus = statusFilter === 'ALL' || item.statusLegalitas === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nomorDokumen || !form.masaBerlaku) {
      alert('Isi nomor dokumen dan masa berlaku');
      return;
    }

    if (editingId) {
      setData(data.map(i => i.id === editingId ? { ...i, ...form } : i));
    } else {
      const newItem: Document = {
        id: Date.now().toString(),
        ...form,
        fileName: selectedFile?.name,
      };
      setData([newItem, ...data]);
    }
    setShowModal(false);
    setEditingId(null);
    setSelectedFile(null);
    setForm({
      jenisDokumen: 'SIA (Surat Izin Alat)',
      nomorDokumen: '',
      masaBerlaku: '',
      statusLegalitas: 'AKTIF',
      keterangan: '',
    });
  };

  const handleEdit = (item: Document) => {
    setEditingId(item.id);
    setForm({
      jenisDokumen: item.jenisDokumen,
      nomorDokumen: item.nomorDokumen,
      masaBerlaku: item.masaBerlaku,
      statusLegalitas: item.statusLegalitas,
      keterangan: item.keterangan || '',
    });
    setShowModal(true);
  };

  // Lewat removeRow, bukan filter array: satu baris dikirim ke database dan
  // pemeriksaan rujukan di main process ikut berjalan.
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus dokumen ini?')) return;
    const hasil = await removeRow('documents', id);
    if (!hasil.ok) alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleDownloadPDF = async (item: Document) => {
    // jspdf ±360 KB — baru diunduh saat tombol cetak ditekan, bukan saat aplikasi buka.
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(20);
    doc.setTextColor(230, 0, 18);
    doc.text('DOKUMEN LEGAL', 105, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(getCompanyName(), 105, 30, { align: 'center' });
    
    // Line separator
    doc.setDrawColor(200, 200, 200);
    doc.line(20, 35, 190, 35);
    
    // Document details
    doc.setFontSize(14);
    doc.setTextColor(50, 50, 50);
    doc.text('Informasi Dokumen', 20, 50);
    
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    
    const details = [
      ['Jenis Dokumen:', item.jenisDokumen],
      ['Nomor Dokumen:', item.nomorDokumen],
      ['Masa Berlaku:', new Date(item.masaBerlaku).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })],
      ['Status Legalitas:', item.statusLegalitas],
      ['Keterangan:', item.keterangan || '-'],
    ];
    
    let y = 65;
    details.forEach(([label, value]) => {
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.text(label, 20, y);
      
      doc.setTextColor(80, 80, 80);
      doc.setFont('helvetica', 'normal');
      doc.text(value, 60, y);
      
      y += 10;
    });
    
    // Status badge
    y += 10;
    const statusColor = item.statusLegalitas === 'AKTIF' ? [34, 197, 94] : 
                       item.statusLegalitas === 'EXPIRED' ? [239, 68, 68] : 
                       item.statusLegalitas === 'REVOKED' ? [128, 128, 128] : [234, 179, 8];
    
    doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.roundedRect(20, y, 40, 8, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text(item.statusLegalitas, 40, y + 5, { align: 'center' });
    
    // Footer
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text('Dokumen ini dibuat secara otomatis oleh FATHONI EQUIPMENT OS', 105, 280, { align: 'center' });
    doc.text(new Date().toLocaleString('id-ID'), 105, 285, { align: 'center' });
    
    // Save PDF
    doc.save(`${(item.jenisDokumen ?? 'dokumen').replace(/\s+/g, '_')}_${item.nomorDokumen}.pdf`);
  };

  const checkExpiry = (dateString: string) => {
    const expiryDate = new Date(dateString);
    const today = new Date();
    const daysDiff = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff < 0) return 'EXPIRED';
    if (daysDiff <= 30) return 'PENDING';
    return 'AKTIF';
  };

  const getDaysUntilExpiry = (dateString: string) => {
    const expiryDate = new Date(dateString);
    const today = new Date();
    const daysDiff = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysDiff;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dokumen Legal & Administratif</h1>
          <p className="page-subtitle">Kelola dokumen legal, perizinan, dan sertifikat perusahaan</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + Upload Dokumen
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Cari dokumen..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--border-default)',
            borderRadius: '6px',
            fontSize: '13px',
            width: '300px',
          }}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--border-default)',
            borderRadius: '6px',
            fontSize: '13px',
          }}
        >
          <option value="ALL">Semua Status</option>
          <option value="AKTIF">Aktif</option>
          <option value="EXPIRED">Kadaluarsa</option>
          <option value="REVOKED">Dicabut</option>
          <option value="PENDING">Menunggu</option>
        </select>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Jenis Dokumen</th>
              <th>Nomor Dokumen</th>
              <th>Masa Berlaku</th>
              <th>Status Legalitas</th>
              <th>Keterangan</th>
              <th style={{ textAlign: 'right' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  Tidak ada dokumen yang ditemukan
                </td>
              </tr>
            ) : (
              filtered.map(item => {
                const daysUntilExpiry = getDaysUntilExpiry(item.masaBerlaku);
                const autoStatus = checkExpiry(item.masaBerlaku);
                const isExpiringSoon = daysUntilExpiry > 0 && daysUntilExpiry <= 30;
                
                return (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.jenisDokumen}</td>
                    <td style={{ fontFamily: 'monospace' }}>{item.nomorDokumen}</td>
                    <td>
                      {new Date(item.masaBerlaku).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {isExpiringSoon && (
                        <span style={{ 
                          marginLeft: 8, 
                          fontSize: 11, 
                          color: 'var(--status-maintenance)',
                          fontWeight: 600 
                        }}>
                          ({daysUntilExpiry} hari lagi)
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_CONFIG[autoStatus]?.badge ?? 'badge-muted'}`}>
                        {STATUS_CONFIG[autoStatus]?.label ?? autoStatus}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {item.keterangan || '-'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleDownloadPDF(item)}
                          className="btn btn-secondary"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                        >
                          📥 Unduh PDF
                        </button>
                        <button
                          onClick={() => handleEdit(item)}
                          className="btn btn-secondary"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="btn btn-secondary"
                          style={{ padding: '6px 12px', fontSize: 12, background: 'var(--status-out)' }}
                        >
                          🗑️ Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <span className="modal-title">{editingId ? 'Edit Dokumen' : 'Upload Dokumen Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Jenis Dokumen</label>
                  <select
                    className="form-select"
                    value={form.jenisDokumen}
                    onChange={e => setForm({ ...form, jenisDokumen: e.target.value })}
                    required
                  >
                    {JENIS_DOKUMEN.map(jenis => (
                      <option key={jenis} value={jenis}>{jenis}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Nomor Dokumen</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.nomorDokumen}
                    onChange={e => setForm({ ...form, nomorDokumen: e.target.value })}
                    placeholder="Contoh: SIA-2024-8891-JKT"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Masa Berlaku (Expiry Date)</label>
                  <input
                    type="date"
                    className="form-input"
                    value={form.masaBerlaku}
                    onChange={e => setForm({ ...form, masaBerlaku: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Status Legalitas</label>
                  <select
                    className="form-select"
                    value={form.statusLegalitas}
                    onChange={e => setForm({ ...form, statusLegalitas: e.target.value as Document['statusLegalitas'] })}
                    required
                  >
                    <option value="AKTIF">Aktif</option>
                    <option value="EXPIRED">Kadaluarsa</option>
                    <option value="REVOKED">Dicabut</option>
                    <option value="PENDING">Menunggu</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Upload File PDF</label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileChange}
                    className="form-input"
                  />
                  {selectedFile && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      File terpilih: {selectedFile.name}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Keterangan</label>
                  <textarea
                    className="form-input"
                    value={form.keterangan}
                    onChange={e => setForm({ ...form, keterangan: e.target.value })}
                    placeholder="Keterangan tambahan..."
                    rows={3}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Simpan Perubahan' : 'Upload Dokumen'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
