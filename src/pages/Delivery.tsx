// src/pages/Delivery.tsx - Modul Pengiriman Unit Alat Berat FATHONI EQUIPMENT OS

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';

interface DeliveryOrder {
  id: string;
  doNumber: string;
  salesOrderRef: string;
  customerName: string;
  unitModel: string;
  serialNumber: string;
  deliveryDate: string;
  destination: string;
  driverName: string;
  truckPlate: string;
  status: 'MENUNGGU' | 'DALAM_PERJALANAN' | 'TIBA' | 'SELESAI' | 'DIBATALKAN';
  notes: string;
}



const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  MENUNGGU: { label: 'Menunggu Jadwal', badge: 'badge-muted' },
  DALAM_PERJALANAN: { label: 'Dalam Perjalanan', badge: 'badge-info' },
  TIBA: { label: 'Tiba di Lokasi', badge: 'badge-warning' },
  SELESAI: { label: 'Serah Terima Selesai', badge: 'badge-success' },
  DIBATALKAN: { label: 'Dibatalkan', badge: 'badge-danger' },
};

export default function Delivery() {
  const { sales, deliveries: data, setDeliveries: setData, addDelivery } = useDataStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    doNumber: `DO-2026-00${data.length + 1}`,
    salesOrderRef: '',
    customerName: '',
    unitModel: '',
    serialNumber: '',
    deliveryDate: new Date().toISOString().split('T')[0],
    destination: '',
    driverName: '',
    truckPlate: '',
    notes: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = data.filter(item => {
    const matchSearch = matchesQuery([item.doNumber, item.customerName, item.unitModel, item.destination], search);
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName || !form.unitModel) {
      alert('Isi nama penerima dan model unit');
      return;
    }
    if (editingId) {
      setData(data.map(i => i.id === editingId ? { ...i, ...form } : i));
    } else {
      const newItem: DeliveryOrder = {
        id: Date.now().toString(),
        ...form,
        status: 'MENUNGGU',
      };
      // Add delivery to store (setData sudah menggunakan setDeliveries)
      setData([newItem, ...data]);
    }
    setShowModal(false);
    setEditingId(null);
    setForm({ doNumber: `DO-${new Date().getFullYear()}-${String(data.length + 2).padStart(3,'0')}`, salesOrderRef: '', customerName: '', unitModel: '', serialNumber: '', deliveryDate: new Date().toISOString().split('T')[0], destination: '', driverName: '', truckPlate: '', notes: '' });
  };


  const handleEdit = (item: DeliveryOrder) => {
    setEditingId(item.id);
    setForm({ doNumber: item.doNumber, salesOrderRef: item.salesOrderRef, customerName: item.customerName, unitModel: item.unitModel, serialNumber: item.serialNumber, deliveryDate: item.deliveryDate, destination: item.destination, driverName: item.driverName, truckPlate: item.truckPlate, notes: item.notes });
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Hapus data pengiriman ini?')) setData(data.filter(i => i.id !== id));
  };

  const handleUpdateStatus = (id: string, newStatus: DeliveryOrder['status']) => {
    setData(data.map(i => (i.id === id ? { ...i, status: newStatus } : i)));
  };

  const openCreateModal = () => {
    setEditingId(null);
    setForm({ doNumber: `DO-${new Date().getFullYear()}-${String(data.length + 1).padStart(3,'0')}`, salesOrderRef: '', customerName: '', unitModel: '', serialNumber: '', deliveryDate: new Date().toISOString().split('T')[0], destination: '', driverName: '', truckPlate: '', notes: '' });
    setShowModal(true);
  };

  const handlePrint = (item: DeliveryOrder) => {
    if (confirm(`Cetak Surat Jalan ${item.doNumber}?`)) {
      const companyName = getCompanyName();
      const htmlContent = `
        <html><head><title>SJ ${sanitize(item.doNumber)}</title><style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #111; }
          h2 { color: #C00; margin-bottom: 8px; }
          .header { margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #C00; }
          .company { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
          table { width:100%; border-collapse:collapse; margin-top:16px; }
          th,td { border:1px solid #ccc; padding:8px 12px; text-align:left; }
          th { background:#f0f0f0; font-weight: bold; }
          .footer { margin-top:40px; display:flex; justify-content:space-between; }
          .sign { text-align:center; width:160px; } .sign-line { border-top:1px solid #111; margin-top:60px; }
          @media print { body { padding: 20px; } }
        </style></head><body>
        <div class="header">
          <div class="company">${sanitize(companyName)}</div>
          <h2>SURAT JALAN PENGIRIMAN UNIT</h2>
        </div>
        <p><strong>No. SJ:</strong> ${sanitize(item.doNumber)} &nbsp;&nbsp; <strong>Tanggal:</strong> ${item.deliveryDate}</p>
        <table>
          <tr><th>Pelanggan</th><td>${sanitize(item.customerName)}</td></tr>
          <tr><th>Tujuan Pengiriman</th><td>${sanitize(item.destination)}</td></tr>
          <tr><th>Unit Alat Berat</th><td>${sanitize(item.unitModel)}</td></tr>
          <tr><th>Serial Number</th><td>${sanitize(item.serialNumber)}</td></tr>
          <tr><th>Driver</th><td>${sanitize(item.driverName)}</td></tr>
          <tr><th>Plat Kendaraan</th><td>${sanitize(item.truckPlate)}</td></tr>
          <tr><th>Referensi SPK</th><td>${sanitize(item.salesOrderRef || '-')}</td></tr>
          <tr><th>Catatan</th><td>${sanitize(item.notes || '-')}</td></tr>
        </table>
        <div class="footer">
          <div class="sign"><div class="sign-line"></div><div>Pengirim (Driver)</div></div>
          <div class="sign"><div class="sign-line"></div><div>Admin Logistik</div></div>
          <div class="sign"><div class="sign-line"></div><div>Penerima</div></div>
        </div>
      </body></html>
      `;
      printDocument(htmlContent, `SJ ${item.doNumber}`);
    }
  };

  const selesai = data.filter(i => i.status === 'SELESAI').length;
  const berjalan = data.filter(i => i.status === 'DALAM_PERJALANAN').length;
  const menunggu = data.filter(i => i.status === 'MENUNGGU').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pengiriman & Mobilisasi Unit</h1>
          <p className="page-subtitle">Kelola jadwal pengiriman, serah terima unit kepada pelanggan, dan mobilisasi armada ke jobsite</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Buat Surat Jalan
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid-3 mb-4">
        <div className="card stat-card">
          <div className="card-title">Pengiriman Selesai</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{selesai} Unit</div>
          <div className="card-sub">Sudah Diterima Pelanggan</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Dalam Perjalanan</div>
          <div className="card-value" style={{ color: 'var(--accent-blue)' }}>{berjalan} Unit</div>
          <div className="card-sub">Armada Sedang Dimobilisasi</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Menunggu Jadwal</div>
          <div className="card-value" style={{ color: 'var(--status-maintenance)' }}>{menunggu} Unit</div>
          <div className="card-sub">Perlu Konfirmasi Customer</div>
        </div>
      </div>

      {/* Filter */}
      <div className="card mb-4" style={{ padding: '14px 20px', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status:</span>
          {['ALL', 'MENUNGGU', 'DALAM_PERJALANAN', 'TIBA', 'SELESAI'].map(st => (
            <button
              key={st}
              className={`btn btn-sm ${statusFilter === st ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusFilter(st)}
            >
              {st === 'ALL' ? 'Semua' : STATUS_MAP[st]?.label.split(' ')[0] ?? st}
            </button>
          ))}
        </div>
        <div className="topbar-search" style={{ width: 280 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input type="text" placeholder="Cari surat jalan, customer, tujuan..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Tabel */}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>No. Surat Jalan</th>
              <th>Pelanggan & Tujuan</th>
              <th>Unit & Serial Number</th>
              <th>Tanggal Kirim</th>
              <th>Driver / Kendaraan</th>
              <th>Referensi Dok.</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>Tidak ada data pengiriman yang sesuai.</td></tr>
            ) : filtered.map(item => (
              <tr key={item.id}>
                <td>
                  <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{item.doNumber}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.deliveryDate}</div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{item.customerName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>📍 {item.destination}</div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{item.unitModel}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>SN: {item.serialNumber}</div>
                </td>
                <td style={{ fontSize: 13 }}>{item.deliveryDate}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>🚚 {item.driverName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{item.truckPlate}</div>
                </td>
                <td><span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--accent-blue)' }}>{item.salesOrderRef}</span></td>
                <td>
                  <span className={`badge ${STATUS_MAP[item.status]?.badge}`}>{STATUS_MAP[item.status]?.label}</span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                    {item.status === 'MENUNGGU' && (
                      <button className="btn btn-sm btn-primary"
                        onClick={() => handleUpdateStatus(item.id, 'DALAM_PERJALANAN')}>Berangkat</button>
                    )}
                    {item.status === 'DALAM_PERJALANAN' && (
                      <button className="btn btn-sm btn-primary" style={{ background: 'var(--status-operating)' }}
                        onClick={() => handleUpdateStatus(item.id, 'SELESAI')}>Serah Terima</button>
                    )}
                    <button className="btn btn-sm btn-secondary"
                      onClick={() => handleEdit(item)}>Edit</button>
                    <button className="btn btn-sm btn-secondary"
                      onClick={() => handlePrint(item)}>🖨 Cetak SJ</button>
                    <button className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(item.id)}>Hapus</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">{editingId ? 'Edit Surat Jalan' : 'Buat Surat Jalan Pengiriman'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Nomor Surat Jalan</label>
                    <input type="text" className="form-input" value={form.doNumber} onChange={e => setForm({ ...form, doNumber: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Referensi SPK (Belum Dikirim)</label>
                    <select
                      className="form-select"
                      value={form.salesOrderRef}
                      onChange={e => {
                        const so = sales.find((s: any) => s.orderNo === e.target.value);
                        if (so) {
                          setForm({ ...form, salesOrderRef: so.orderNo, customerName: so.customerName, unitModel: so.unitModel, serialNumber: so.serialNumber });
                        } else {
                          setForm({ ...form, salesOrderRef: e.target.value });
                        }
                      }}
                    >
                      <option value="">-- Pilih SPK --</option>
                      {sales.filter((s: any) => s.status !== 'COMPLETED').map((s: any) => (
                        <option key={s.id} value={s.orderNo}>{s.orderNo} - {s.customerName}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Nama Pelanggan / Penerima</label>
                  <input type="text" className="form-input" placeholder="PT. ..." value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Model Unit</label>
                    <input type="text" className="form-input" placeholder="Komatsu PC200-8" value={form.unitModel} onChange={e => setForm({ ...form, unitModel: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Serial Number</label>
                    <input type="text" className="form-input" placeholder="KMT-XXX-XXXX" value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Tujuan Pengiriman / Jobsite</label>
                  <input type="text" className="form-input" placeholder="Contoh: Morowali, Sulawesi Tengah" value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Tanggal Kirim</label>
                    <input type="date" className="form-input" value={form.deliveryDate} onChange={e => setForm({ ...form, deliveryDate: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nama Driver</label>
                    <input type="text" className="form-input" value={form.driverName} onChange={e => setForm({ ...form, driverName: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Plat Kendaraan</label>
                    <input type="text" className="form-input" placeholder="B 1234 XX" value={form.truckPlate} onChange={e => setForm({ ...form, truckPlate: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Catatan</label>
                  <input type="text" className="form-input" placeholder="Catatan pengiriman..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Simpan Perubahan' : 'Terbitkan Surat Jalan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
