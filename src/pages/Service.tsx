// src/pages/Service.tsx - Modul Servis, Bengkel & Maintenance Alat Berat FATHONI EQUIPMENT OS

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';
import {
  validateField,
  validateAmount,
  validateHourMeter,
  validateName,
  validateServiceType
} from '../utils/validation';


import { type WorkOrder } from '../data/demoTransactions';



const SERVICE_TYPE_LABEL: Record<string, string> = {
  PERIODIC_250H: 'Servis Berkala 250 Jam',
  PERIODIC_500H: 'Servis Berkala 500 Jam',
  PERIODIC_1000H: 'Servis Berkala 1000 Jam',
  BREAKDOWN: 'Perbaikan Breakdown (Darurat)',
  OVERHAUL: 'Major Overhaul Mesin / Pompa',
  INSPECTION: 'Inspeksi Pra-Kirim (PDI)',
};

const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  OPEN: { label: 'Menunggu Teknisi', badge: 'badge-muted' },
  IN_PROGRESS: { label: 'Sedang Dikerjakan', badge: 'badge-info' },
  WAITING_PARTS: { label: 'Menunggu Sparepart', badge: 'badge-warning' },
  COMPLETED: { label: 'Servis Selesai', badge: 'badge-success' },
};

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

export default function Service() {
  const { services: data, setServices: setData, units, customers, spareParts, completeService, updateUnitStatus, removeRow } = useDataStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const [form, setForm] = useState({
    woNumber: `WO-2026-00${data.length + 1}`,
    unitModel: 'Komatsu PC200-8',
    serialNumber: '',
    customerOrProject: '',
    serviceType: 'PERIODIC_250H' as any,
    mechanicName: 'Agus Sutrisno',
    hourMeter: 0,
    openDate: new Date().toISOString().split('T')[0],
    estimatedCost: 5_000_000,
    complaintNotes: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  // Selesai WO lewat modal: biaya aktual & part terpakai harus tercatat agar stok dan Invoice SERVICE tidak kosong.
  const [completing, setCompleting] = useState<WorkOrder | null>(null);
  const [partsDraft, setPartsDraft] = useState<{ partId: string; quantity: number }[]>([]);
  const [actualCostDraft, setActualCostDraft] = useState(0);

  const filtered = data.filter(item => {
    const matchSearch = matchesQuery([item.woNumber, item.unitModel, item.serialNumber, item.mechanicName], search);
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const activeJobs = data.filter(i => i.status === 'IN_PROGRESS' || i.status === 'WAITING_PARTS').length;
  const waitingParts = data.filter(i => i.status === 'WAITING_PARTS').length;
  const completedJobs = data.filter(i => i.status === 'COMPLETED').length;

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    if (draggedId) {
      handleUpdateStatus(draggedId, status);
    }
    setDraggedId(null);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

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

    // Validasi pelanggan/lokasi
    const customerError = validateField(form.customerOrProject, { required: true, minLength: 3, maxLength: 100 }, 'Pelanggan/Lokasi');
    if (customerError) {
      alert(customerError);
      return;
    }

    // Validasi tipe servis
    const typeError = validateServiceType(form.serviceType);
    if (typeError) {
      alert(typeError);
      return;
    }

    // Validasi nama teknisi
    const mechanicError = validateName(form.mechanicName, 2, 50);
    if (mechanicError) {
      alert(mechanicError);
      return;
    }

    // Validasi hour meter
    const hmError = validateHourMeter(form.hourMeter);
    if (hmError) {
      alert(hmError);
      return;
    }

    // Validasi tanggal buka
    const dateError = validateField(form.openDate, { required: true }, 'Tanggal Buka');
    if (dateError) {
      alert(dateError);
      return;
    }

    // Validasi estimasi biaya
    const costError = validateAmount(form.estimatedCost, 0, 100000000);
    if (costError) {
      alert(costError);
      return;
    }

    if (editingId) {
      setData(data.map(i => i.id === editingId ? { ...i, woNumber: form.woNumber, unitModel: form.unitModel, serialNumber: form.serialNumber || i.serialNumber, customerOrProject: form.customerOrProject, serviceType: form.serviceType, mechanicName: form.mechanicName, hourMeter: Number(form.hourMeter), openDate: form.openDate, estimatedCost: Number(form.estimatedCost), complaintNotes: form.complaintNotes } : i));
    } else {
      const newItem: WorkOrder = {
        id: Date.now().toString(),
        woNumber: form.woNumber,
        unitModel: form.unitModel,
        serialNumber: form.serialNumber || 'SN-' + Date.now().toString().slice(-4),
        customerOrProject: form.customerOrProject,
        serviceType: form.serviceType,
        mechanicName: form.mechanicName,
        hourMeter: Number(form.hourMeter),
        openDate: form.openDate,
        estimatedCost: Number(form.estimatedCost),
        status: 'OPEN',
        complaintNotes: form.complaintNotes,
      };
      setData([newItem, ...data]);
    }
    setShowModal(false);
    setEditingId(null);
    setForm({ woNumber: `WO-${new Date().getFullYear()}-${String(data.length + 2).padStart(3,'0')}`, unitModel: 'Komatsu PC200-8', serialNumber: '', customerOrProject: '', serviceType: 'PERIODIC_250H', mechanicName: 'Agus Sutrisno', hourMeter: 0, openDate: new Date().toISOString().split('T')[0], estimatedCost: 5_000_000, complaintNotes: '' });
  };

  const handleEdit = (item: WorkOrder) => {
    setEditingId(item.id);
    setForm({ woNumber: item.woNumber, unitModel: item.unitModel, serialNumber: item.serialNumber, customerOrProject: item.customerOrProject, serviceType: item.serviceType, mechanicName: item.mechanicName, hourMeter: item.hourMeter, openDate: item.openDate, estimatedCost: item.estimatedCost, complaintNotes: item.complaintNotes });
    setShowModal(true);
  };

  // Work Order yang sudah melahirkan invoice servis atau pengeluaran suku cadang
  // di gudang (GI-) tidak dihapus: biaya yang terlanjur tercatat jadi yatim.
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus data Work Order ini?')) return;
    const hasil = await removeRow('services', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
    }
  };

  const handleUpdateStatus = (id: string, newStatus: any) => {
    const wo = data.find(i => i.id === id);
    if (!wo) return;

    if (newStatus === 'COMPLETED') {
      openCompleteModal(wo);
      return;
    }

    setData(data.map(i => (i.id === id ? { ...i, status: newStatus } : i)));

    if (wo.serialNumber && newStatus === 'IN_PROGRESS') {
      const unit = units.find((u: any) => u.serialNumber === wo.serialNumber);
      if (unit) updateUnitStatus(unit.id, 'MAINTENANCE');
    }
  };

  const openCompleteModal = (wo: WorkOrder) => {
    setCompleting(wo);
    setPartsDraft([]);
    setActualCostDraft(Number(wo.estimatedCost) || 0);
  };

  const addPartLine = () => setPartsDraft(prev => [...prev, { partId: '', quantity: 1 }]);

  const setPartLine = (index: number, patch: Partial<{ partId: string; quantity: number }>) =>
    setPartsDraft(prev => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const removePartLine = (index: number) =>
    setPartsDraft(prev => prev.filter((_, i) => i !== index));

  const partsTotal = partsDraft.reduce((acc, line) => {
    const part = spareParts.find(p => p.id === line.partId);
    return acc + (part ? part.price * line.quantity : 0);
  }, 0);

  const handleCompleteConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!completing) return;

    const lines = partsDraft.filter(l => l.partId && Number(l.quantity) > 0);

    for (const line of lines) {
      const part = spareParts.find(p => p.id === line.partId);
      if (!part) {
        alert('Suku cadang pada baris pemakaian tidak ditemukan. Pilih ulang dari daftar.');
        return;
      }
      if (line.quantity > part.stock) {
        alert(`Stok ${part.name} hanya ${part.stock} ${part.unit}. Kurangi jumlah pemakaian.`);
        return;
      }
    }

    const costError = validateAmount(actualCostDraft, 0, 1_000_000_000);
    if (costError) {
      alert(costError);
      return;
    }

    completeService(completing.id, lines, Number(actualCostDraft));
    setCompleting(null);
    setPartsDraft([]);
  };

  const openCreateModal = () => {
    setEditingId(null);
    setForm({ woNumber: `WO-${new Date().getFullYear()}-${String(data.length + 1).padStart(3,'0')}`, unitModel: 'Komatsu PC200-8', serialNumber: '', customerOrProject: '', serviceType: 'PERIODIC_250H', mechanicName: 'Agus Sutrisno', hourMeter: 0, openDate: new Date().toISOString().split('T')[0], estimatedCost: 5_000_000, complaintNotes: '' });
    setShowModal(true);
  };

  const handlePrint = (item: WorkOrder) => {
    if (confirm(`Cetak Work Order ${item.woNumber}?`)) {
      const companyName = getCompanyName();
      
      const htmlContent = `
        <html><head><title>WO ${sanitize(item.woNumber)}</title><style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #111; }
          h2 { color: #C00; margin-bottom: 8px; }
          .header { margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #C00; }
          .company { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
          table { width:100%; border-collapse:collapse; margin-top:16px; }
          th,td { border:1px solid #ccc; padding:8px 12px; text-align:left; }
          th { background:#f0f0f0; } .total { font-weight:bold; font-size:1.1em; }
          .notes { background:#fffbe6; border:1px solid #ffe066; padding:10px; margin-top:16px; border-radius:4px; }
          .footer { margin-top:40px; display:flex; justify-content:space-between; }
          .sign { text-align:center; width:160px; } .sign-line { border-top:1px solid #111; margin-top:60px; }
          @media print { body { padding: 20px; } }
        </style></head><body>
        <div class="header">
          <div class="company">${sanitize(companyName)}</div>
          <h2>WORK ORDER SERVIS ALAT BERAT</h2>
        </div>
        <p><strong>No. WO:</strong> ${sanitize(item.woNumber)} &nbsp;&nbsp; <strong>Tanggal Buka:</strong> ${item.openDate}</p>
        <table>
          <tr><th>Model Unit</th><td>${sanitize(item.unitModel)}</td></tr>
          <tr><th>Serial Number</th><td>${sanitize(item.serialNumber)}</td></tr>
          <tr><th>Hour Meter</th><td>${item.hourMeter} HM</td></tr>
          <tr><th>Pelanggan / Lokasi</th><td>${sanitize(item.customerOrProject)}</td></tr>
          <tr><th>Tipe Servis</th><td>${sanitize(SERVICE_TYPE_LABEL[item.serviceType] || item.serviceType)}</td></tr>
          <tr><th>Teknisi</th><td>${sanitize(item.mechanicName)}</td></tr>
          <tr><th>Estimasi Biaya</th><td class="total">Rp ${item.estimatedCost.toLocaleString('id-ID')}</td></tr>
          <tr><th>Status</th><td>${sanitize(item.status)}</td></tr>
        </table>
        ${item.complaintNotes ? '<div class="notes"><strong>Keluhan / Catatan Mekanik:</strong><br/>' + sanitize(item.complaintNotes) + '</div>' : ''}
        <div class="footer">
          <div class="sign"><div class="sign-line"></div><div>Mekanik</div></div>
          <div class="sign"><div class="sign-line"></div><div>Kepala Bengkel</div></div>
          <div class="sign"><div class="sign-line"></div><div>Pelanggan</div></div>
        </div>
      </body></html>
      `;
      printDocument(htmlContent, `WO ${item.woNumber}`);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Order & Servis Alat Berat</h1>
          <p className="page-subtitle">Pencatatan servis berkala, perbaikan breakdown, pemeliharaan preventif, dan monitoring mekanik</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Buka Work Order Servis
          </button>
        </div>
      </div>

      <div className="grid-3 mb-4">
        <div className="card stat-card">
          <div className="card-title">Pekerjaan Aktif Berjalan</div>
          <div className="card-value" style={{ color: 'var(--accent-blue)' }}>{activeJobs} Unit</div>
          <div className="card-sub">Dalam Penanganan Mekanik</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Menunggu Sparepart</div>
          <div className="card-value" style={{ color: 'var(--status-out)' }}>{waitingParts} Unit</div>
          <div className="card-sub">Unit Tertahan Part Indent</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Servis Selesai Bulan Ini</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{completedJobs} Unit</div>
          <div className="card-sub">Armada Siap Operasi Kembali</div>
        </div>
      </div>

      <div className="card mb-4" style={{ padding: '14px 20px', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status:</span>
          {['ALL', 'OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED'].map(st => (
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
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Cari WO, model unit, mekanik..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        
        <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
          <button 
            className={`btn btn-sm ${viewMode === 'kanban' ? 'btn-primary' : ''}`} 
            style={{ borderRadius: 0, border: 'none', background: viewMode === 'kanban' ? 'var(--primary)' : 'transparent' }}
            onClick={() => setViewMode('kanban')}
          >
            📋 Kanban
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

      {viewMode === 'kanban' ? (
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 16, minHeight: '60vh' }}>
          {[
            { id: 'OPEN', label: 'Menunggu Teknisi', color: '#9CA3AF' },
            { id: 'WAITING_PARTS', label: 'Menunggu Part', color: '#F59E0B' },
            { id: 'IN_PROGRESS', label: 'Sedang Dikerjakan', color: '#3B82F6' },
            { id: 'COMPLETED', label: 'Selesai', color: '#10B981' },
          ].map(col => (
            <div 
              key={col.id} 
              style={{ flex: '1 1 300px', minWidth: 280, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              <div style={{ padding: '12px 16px', borderBottom: '3px solid ' + col.color, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                <span>{col.label}</span>
                <span style={{ background: col.color, color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>
                  {filtered.filter(i => i.status === col.id).length}
                </span>
              </div>
              <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filtered.filter(i => i.status === col.id).map(item => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    onDragEnd={handleDragEnd}
                    style={{
                      background: 'var(--bg-card)', padding: 14, borderRadius: 8, border: '1px solid var(--border-default)',
                      boxShadow: 'var(--shadow-sm)', cursor: 'grab', opacity: draggedId === item.id ? 0.5 : 1
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{item.woNumber}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.openDate}</span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{item.unitModel}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>SN: {item.serialNumber} • {item.hourMeter} HM</div>
                    <div style={{ fontSize: 11, background: 'var(--bg-elevated)', padding: '6px 8px', borderRadius: 4, marginBottom: 12, color: 'var(--text-secondary)' }}>
                      👨‍🔧 {item.mechanicName}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="badge badge-info" style={{ fontSize: 10 }}>{SERVICE_TYPE_LABEL[item.serviceType]?.split(' ')[0] || item.serviceType}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {item.status === 'OPEN' && (
                          <button onClick={() => handleUpdateStatus(item.id, 'IN_PROGRESS')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }} title="Mulai Kerja">▶️</button>
                        )}
                        {(item.status === 'IN_PROGRESS' || item.status === 'WAITING_PARTS') && (
                          <button onClick={() => handleUpdateStatus(item.id, 'COMPLETED')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }} title="Selesai (catat part & biaya)">✅</button>
                        )}
                        <button onClick={() => handleEdit(item)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }} title="Edit">✏️</button>
                        <button onClick={() => handlePrint(item)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }} title="Print">🖨️</button>
                      </div>
                    </div>
                  </div>
                ))}
                {filtered.filter(i => i.status === col.id).length === 0 && (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12, border: '1px dashed var(--border-default)', borderRadius: 8 }}>
                    Tarik item ke sini
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>No. WO / Tanggal</th>
              <th>Unit & Jam Kerja (HM)</th>
              <th>Tipe Servis</th>
              <th>Pelanggan / Lokasi</th>
              <th>Mekanik Penanggung Jawab</th>
              <th style={{ textAlign: 'right' }}>Est. Biaya</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                  Tidak ada data work order yang sesuai.
                </td>
              </tr>
            ) : (
              filtered.map(item => (
                <tr key={item.id}>
                  <td>
                    <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{item.woNumber}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.openDate}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.unitModel}</div>
                    <div style={{ fontSize: 11, color: 'var(--accent-blue)', fontFamily: 'monospace' }}>
                      SN: {item.serialNumber} • {item.hourMeter} HM
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-info">{SERVICE_TYPE_LABEL[item.serviceType] || item.serviceType}</span>
                    {item.complaintNotes && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.complaintNotes}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ fontSize: 13 }}>{item.customerOrProject}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>👨‍🔧 {item.mechanicName}</div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.estimatedCost)}</td>
                  <td>
                    <span className={`badge ${STATUS_MAP[item.status]?.badge}`}>
                      {STATUS_MAP[item.status]?.label}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      {item.status === 'OPEN' && (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleUpdateStatus(item.id, 'IN_PROGRESS')}
                        >
                          Mulai Kerja
                        </button>
                      )}
                      {(item.status === 'IN_PROGRESS' || item.status === 'WAITING_PARTS') && (
                        <button
                          className="btn btn-sm"
                          style={{ background: 'var(--status-operating)', color: '#fff' }}
                          onClick={() => handleUpdateStatus(item.id, 'COMPLETED')}
                        >
                          Selesai
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-secondary"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => handleEdit(item)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-secondary"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => handlePrint(item)}
                      >
                        🖨 Cetak WO
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

      {/* Modal Buka WO */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">{editingId ? 'Edit Work Order' : 'Buka Work Order Servis Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Nomor Work Order</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.woNumber}
                      onChange={e => setForm({ ...form, woNumber: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipe Servis</label>
                    <select
                      className="form-select"
                      value={form.serviceType}
                      onChange={e => setForm({ ...form, serviceType: e.target.value as any })}
                    >
                      <option value="PERIODIC_250H">Servis Berkala 250 Jam (Oli & Filter)</option>
                      <option value="PERIODIC_500H">Servis Berkala 500 Jam (Filter Komplit)</option>
                      <option value="PERIODIC_1000H">Servis Berkala 1000 Jam (Major Check)</option>
                      <option value="BREAKDOWN">Breakdown Repair (Kerusakan Lapangan)</option>
                      <option value="OVERHAUL">Overhaul Komponen</option>
                      <option value="INSPECTION">Inspeksi Pra-Kirim (PDI)</option>
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Pilih Unit (AVAILABLE/ON_PROJECT)</label>
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
                      {units.map((u: any) => (
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

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Pelanggan (Pilih dari Master)</label>
                    <select
                      className="form-select"
                      required
                      value={form.customerOrProject}
                      onChange={e => setForm({ ...form, customerOrProject: e.target.value })}
                    >
                      <option value="">-- Pilih Pelanggan/Proyek --</option>
                      <option value="INTERNAL YARD">Internal Yard / Gudang Utama</option>
                      {customers.map((c: any) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Hour Meter (HM)</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0"
                      value={form.hourMeter || ''}
                      onChange={e => setForm({ ...form, hourMeter: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Teknisi / Mekanik</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Nama teknisi"
                      value={form.mechanicName}
                      onChange={e => setForm({ ...form, mechanicName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Estimasi Biaya (IDR)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.estimatedCost || ''}
                      onChange={e => setForm({ ...form, estimatedCost: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Keluhan / Catatan Pekerjaan Mekanik</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="Rincian kerusakan atau daftar part yang perlu diganti..."
                    value={form.complaintNotes}
                    onChange={e => setForm({ ...form, complaintNotes: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Simpan Perubahan' : 'Terbitkan Work Order'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Selesai Servis: part terpakai + biaya aktual */}
      {completing && (
        <div className="modal-backdrop" onClick={() => setCompleting(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <div className="modal-header">
              <span className="modal-title">Selesaikan Servis {completing.woNumber}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setCompleting(null)}>×</button>
            </div>
            <form onSubmit={handleCompleteConfirm}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {completing.unitModel} • SN {completing.serialNumber} • {completing.hourMeter} HM —
                  {SERVICE_TYPE_LABEL[completing.serviceType] || completing.serviceType}
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label className="form-label" style={{ margin: 0 }}>Suku Cadang Terpakai</label>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={addPartLine}>+ Tambah Part</button>
                  </div>

                  {partsDraft.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', border: '1px dashed var(--border-default)', borderRadius: 6, padding: '10px 12px' }}>
                      Tidak ada part yang diganti. Lanjutkan bila servis hanya jasa/tenaga kerja.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {partsDraft.map((line, index) => {
                        const part = spareParts.find(p => p.id === line.partId);
                        return (
                          <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <select
                              className="form-select"
                              style={{ flex: 3 }}
                              value={line.partId}
                              onChange={e => setPartLine(index, { partId: e.target.value })}
                              required
                            >
                              <option value="">-- Pilih Suku Cadang --</option>
                              {spareParts.map((p: any) => (
                                <option key={p.id} value={p.id} disabled={p.stock <= 0}>
                                  {p.name} ({p.sku}) — stok {p.stock} {p.unit}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              className="form-input"
                              style={{ flex: 1, minWidth: 70 }}
                              min={1}
                              max={part?.stock ?? undefined}
                              value={line.quantity}
                              onChange={e => setPartLine(index, { quantity: Number(e.target.value) })}
                              required
                            />
                            <span style={{ flex: 2, fontSize: 11, color: 'var(--text-muted)' }}>
                              {part ? fmt(part.price * line.quantity) : '—'}
                            </span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon"
                              onClick={() => removePartLine(index)}
                              title="Hapus baris"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {partsDraft.length > 0 && (
                    <div style={{ fontSize: 12, textAlign: 'right', color: 'var(--text-secondary)', marginTop: 4 }}>
                      Total harga part: <strong>{fmt(partsTotal)}</strong>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Biaya Aktual Tagihan (IDR)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={actualCostDraft || ''}
                    onChange={e => setActualCostDraft(Number(e.target.value))}
                    required
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Estimasi awal {fmt(Number(completing.estimatedCost) || 0)}. Nilai ini menjadi dasar Invoice SERVICE.
                  </div>
                  {partsTotal > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      style={{ marginTop: 6 }}
                      onClick={() => setActualCostDraft(partsTotal)}
                    >
                      Isi dengan total part
                    </button>
                  )}
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px' }}>
                  Menyimpan ini menutup WO, mengurangi stok part dan mencatat mutasi gudang,
                  menerbitkan Invoice SERVICE, mengembalikan unit ke status tersedia, dan membuka laporan pendapatan servis.
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setCompleting(null)}>Batal</button>
                <button type="submit" className="btn btn-primary">Tandai Selesai &amp; Terbitkan Invoice</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
