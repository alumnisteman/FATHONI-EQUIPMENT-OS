// src/pages/Breakdown.tsx - Modul Breakdown Management FATHONI EQUIPMENT OS

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import type { Breakdown, BreakdownSeverity, BreakdownStatus } from '../types';
import { UnitStatus } from '../types';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';
import { nomorBerikut, nomorSementara } from '../utils/nomorBerikut';
import {
  validateField,
  validateAmount,
  validateName,
  validateDescription
} from '../utils/validation';

const SEVERITY_MAP: Record<BreakdownSeverity, { label: string; badge: string }> = {
  CRITICAL: { label: 'Kritis', badge: 'badge-danger' },
  MAJOR: { label: 'Mayor', badge: 'badge-warning' },
  MINOR: { label: 'Minor', badge: 'badge-success' },
};

const STATUS_MAP: Record<BreakdownStatus, { label: string; badge: string }> = {
  REPORTED: { label: 'Dilaporkan', badge: 'badge-muted' },
  INSPECTING: { label: 'Inspeksi', badge: 'badge-info' },
  DIAGNOSING: { label: 'Diagnosis', badge: 'badge-info' },
  REPAIRING: { label: 'Perbaikan', badge: 'badge-warning' },
  TESTING: { label: 'Testing', badge: 'badge-info' },
  RESOLVED: { label: 'Selesai', badge: 'badge-success' },
  CANCELLED: { label: 'Dibatalkan', badge: 'badge-danger' },
};

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

export default function Breakdown() {
  const {
    breakdowns,
    setBreakdowns,
    units,
    updateUnitStatus,
    removeRow,
  } = useDataStore();

  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);

  const nomorBD = (urutan: number) =>
    `BD-${new Date().getFullYear()}-${String(urutan).padStart(3, '0')}`;

  const formKosong = {
    breakdownNumber: nomorSementara(breakdowns, 'breakdownNumber', nomorBD),
    unitSerialNumber: '',
    unitModel: '',
    location: '',
    reportedBy: '',
    severity: 'MAJOR' as BreakdownSeverity,
    status: 'REPORTED' as BreakdownStatus,
    description: '',
    diagnosis: '',
    assignedTechnician: '',
    estimatedRepairCost: 0,
    actualRepairCost: 0,
    startTime: '',
    endTime: '',
    resolutionNotes: '',
  };
  const [form, setForm] = useState(formKosong);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openCreateModal = async () => {
    setEditingId(null);
    const breakdownNumber = await nomorBerikut('breakdowns', 'breakdownNumber', breakdowns, nomorBD);
    setForm({ ...formKosong, breakdownNumber });
    setShowModal(true);
  };

  const filtered = breakdowns.filter(item => {
    const matchSearch = matchesQuery([item.breakdownNumber, item.unitSerialNumber, item.unitModel, item.reportedBy], search);
    const matchSeverity = severityFilter === 'ALL' || item.severity === severityFilter;
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchSearch && matchSeverity && matchStatus;
  });

  const totalBreakdowns = breakdowns.length;
  const criticalBreakdowns = breakdowns.filter(b => b.severity === 'CRITICAL' && b.status !== 'RESOLVED').length;
  const inProgress = breakdowns.filter(b => b.status === 'REPAIRING' || b.status === 'DIAGNOSING').length;
  const resolved = breakdowns.filter(b => b.status === 'RESOLVED').length;

  // Calculate average downtime
  const resolvedBreakdowns = breakdowns.filter(b => b.status === 'RESOLVED' && b.downtimeHours);
  const avgDowntime = resolvedBreakdowns.length > 0
    ? resolvedBreakdowns.reduce((acc, b) => acc + (b.downtimeHours || 0), 0) / resolvedBreakdowns.length
    : 0;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    // Validasi serial number unit
    const serialError = validateField(form.unitSerialNumber, { required: true, minLength: 3, maxLength: 50 }, 'Serial Number Unit');
    if (serialError) {
      alert(serialError);
      return;
    }

    // Validasi model unit
    const modelError = validateField(form.unitModel, { required: true, minLength: 2, maxLength: 100 }, 'Model Unit');
    if (modelError) {
      alert(modelError);
      return;
    }

    // Validasi lokasi
    const locationError = validateField(form.location, { required: true, minLength: 3, maxLength: 100 }, 'Lokasi');
    if (locationError) {
      alert(locationError);
      return;
    }

    // Validasi pelapor
    const reporterError = validateName(form.reportedBy, 3, 100);
    if (reporterError) {
      alert(reporterError);
      return;
    }

    // Validasi deskripsi
    const descError = validateDescription(form.description, 10, 500);
    if (descError) {
      alert(descError);
      return;
    }

    // Validasi diagnosis jika diisi
    if (form.diagnosis) {
      const diagError = validateDescription(form.diagnosis, 5, 500);
      if (diagError) {
        alert(diagError);
        return;
      }
    }

    // Validasi teknisi jika diisi
    if (form.assignedTechnician) {
      const techError = validateName(form.assignedTechnician, 2, 100);
      if (techError) {
        alert(techError);
        return;
      }
    }

    // Validasi estimasi biaya jika diisi
    if (form.estimatedRepairCost > 0) {
      const costError = validateAmount(form.estimatedRepairCost, 0, 1000000000);
      if (costError) {
        alert(costError);
        return;
      }
    }

    // Validasi biaya aktual jika diisi
    if (form.actualRepairCost > 0) {
      const actualCostError = validateAmount(form.actualRepairCost, 0, 1000000000);
      if (actualCostError) {
        alert(actualCostError);
        return;
      }
    }

    // Validasi tanggal selesai jika diisi
    if (form.endTime && form.startTime) {
      const startDate = new Date(form.startTime);
      const endDate = new Date(form.endTime);
      if (endDate < startDate) {
        alert('Tanggal selesai tidak boleh sebelum tanggal mulai');
        return;
      }
    }

    const now = new Date().toISOString();

    if (editingId) {
      const breakdown = breakdowns.find(b => b.id === editingId);
      if (breakdown) {
        // Calculate downtime if both start and end time are set
        let downtimeHours = breakdown.downtimeHours;
        if (form.startTime && form.endTime) {
          const start = new Date(form.startTime);
          const end = new Date(form.endTime);
          downtimeHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        }

        setBreakdowns(breakdowns.map(b => b.id === editingId ? {
          ...b,
          breakdownNumber: form.breakdownNumber,
          unitSerialNumber: form.unitSerialNumber,
          unitModel: form.unitModel,
          location: form.location,
          reportedBy: form.reportedBy,
          severity: form.severity,
          status: form.status,
          description: form.description,
          diagnosis: form.diagnosis,
          assignedTechnician: form.assignedTechnician,
          estimatedRepairCost: form.estimatedRepairCost,
          actualRepairCost: form.actualRepairCost,
          startTime: form.startTime || b.startTime,
          endTime: form.endTime || b.endTime,
          downtimeHours,
          resolutionNotes: form.resolutionNotes,
        } : b));

        // Update unit status based on breakdown status
        if (form.status === 'RESOLVED' || form.status === 'CANCELLED') {
          const unit = units.find((u: any) => u.serialNumber === form.unitSerialNumber);
          if (unit && unit.status === 'BREAKDOWN') {
            updateUnitStatus(unit.id, 'AVAILABLE');
          }
        } else if (form.status !== 'REPORTED' && form.status !== 'INSPECTING') {
          const unit = units.find((u: any) => u.serialNumber === form.unitSerialNumber);
          if (unit && unit.status !== 'BREAKDOWN') {
            updateUnitStatus(unit.id, 'BREAKDOWN');
          }
        }
      }
    } else {
      const newItem: Breakdown = {
        id: Date.now().toString(),
        breakdownNumber: form.breakdownNumber,
        unitSerialNumber: form.unitSerialNumber,
        unitModel: form.unitModel,
        location: form.location,
        reportedBy: form.reportedBy,
        reportedAt: now,
        severity: form.severity,
        status: form.status,
        description: form.description,
        diagnosis: form.diagnosis,
        assignedTechnician: form.assignedTechnician,
        estimatedRepairCost: form.estimatedRepairCost,
        actualRepairCost: form.actualRepairCost,
        startTime: form.startTime,
        endTime: form.endTime,
        downtimeHours: form.startTime && form.endTime
          ? (new Date(form.endTime).getTime() - new Date(form.startTime).getTime()) / (1000 * 60 * 60)
          : undefined,
        resolutionNotes: form.resolutionNotes,
        partsUsed: [],
      };
      setBreakdowns([newItem, ...breakdowns]);

      // Update unit status to BREAKDOWN
      const unit = units.find((u: any) => u.serialNumber === form.unitSerialNumber);
      if (unit) {
        updateUnitStatus(unit.id, 'BREAKDOWN');
      }
    }
    setShowModal(false);
    setEditingId(null);
    setForm(formKosong);
  };

  const handleEdit = (item: Breakdown) => {
    setEditingId(item.id);
    setForm({
      breakdownNumber: item.breakdownNumber,
      unitSerialNumber: item.unitSerialNumber,
      unitModel: item.unitModel,
      location: item.location,
      reportedBy: item.reportedBy,
      severity: item.severity,
      status: item.status,
      description: item.description,
      diagnosis: item.diagnosis || '',
      assignedTechnician: item.assignedTechnician || '',
      estimatedRepairCost: item.estimatedRepairCost || 0,
      actualRepairCost: item.actualRepairCost || 0,
      startTime: item.startTime || '',
      endTime: item.endTime || '',
      resolutionNotes: item.resolutionNotes || '',
    });
    setShowModal(true);
  };

  // Hapus lewat removeRow, lalu baru kembalikan status unit. Urutan ini penting:
  // kalau penghapusan ditahan (mis. tersimpan tidak tercapai), unit tidak boleh
  // berpindah status padahal laporan breakdown-nya masih ada.
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus data breakdown ini?')) return;
    const hasil = await removeRow('breakdowns', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
      return;
    }
    const breakdown = breakdowns.find(b => b.id === id);
    if (breakdown) {
      // Restore unit status if it was BREAKDOWN
      const unit = units.find((u: any) => u.serialNumber === breakdown.unitSerialNumber);
      if (unit && unit.status === 'BREAKDOWN') {
        updateUnitStatus(unit.id, 'AVAILABLE');
      }
    }
  };

  const handleUpdateStatus = (id: string, newStatus: BreakdownStatus) => {
    const breakdown = breakdowns.find(b => b.id === id);
    if (breakdown) {
      const now = new Date().toISOString();
      let updatedBreakdown = { ...breakdown, status: newStatus };

      // Set start time when moving to REPAIRING
      if (newStatus === 'REPAIRING' && !breakdown.startTime) {
        updatedBreakdown.startTime = now;
      }

      // Set end time and calculate downtime when RESOLVED
      if (newStatus === 'RESOLVED' && breakdown.startTime && !breakdown.endTime) {
        updatedBreakdown.endTime = now;
        const start = new Date(breakdown.startTime);
        const end = new Date(now);
        updatedBreakdown.downtimeHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      }

      setBreakdowns(breakdowns.map(b => b.id === id ? updatedBreakdown : b));

      // Update unit status
      const unit = units.find((u: any) => u.serialNumber === breakdown.unitSerialNumber);
      if (unit) {
        if (newStatus === 'RESOLVED' || newStatus === 'CANCELLED') {
          updateUnitStatus(unit.id, 'AVAILABLE');
        } else if (newStatus === 'REPAIRING' || newStatus === 'DIAGNOSING') {
          updateUnitStatus(unit.id, 'BREAKDOWN');
        }
      }
    }
  };

  const handlePrint = (item: Breakdown) => {
    if (confirm(`Cetak Breakdown Report ${item.breakdownNumber}?`)) {
      const companyName = getCompanyName();

      const htmlContent = `
        <html>
          <head>
            <title>Breakdown Report ${sanitize(item.breakdownNumber)}</title>
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
              .status-critical { background: #fee; color: #c00; }
              .status-major { background: #ffd; color: #b80; }
              .status-minor { background: #efe; color: #080; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background: #f0f0f0; }
              .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>${sanitize(companyName)}</h1>
              <p>Breakdown Management Report</p>
            </div>

            <div class="status status-${(item.severity ?? '').toLowerCase()}">
              Severity: ${SEVERITY_MAP[item.severity]?.label ?? item.severity} | Status: ${STATUS_MAP[item.status]?.label ?? item.status}
            </div>

            <div class="info">
              <div class="info-item">
                <label>Breakdown Number:</label>
                <span>${sanitize(item.breakdownNumber)}</span>
              </div>
              <div class="info-item">
                <label>Reported At:</label>
                <span>${new Date(item.reportedAt).toLocaleString('id-ID')}</span>
              </div>
              <div class="info-item">
                <label>Unit Serial Number:</label>
                <span>${sanitize(item.unitSerialNumber)}</span>
              </div>
              <div class="info-item">
                <label>Unit Model:</label>
                <span>${sanitize(item.unitModel)}</span>
              </div>
              <div class="info-item">
                <label>Location:</label>
                <span>${sanitize(item.location)}</span>
              </div>
              <div class="info-item">
                <label>Reported By:</label>
                <span>${sanitize(item.reportedBy)}</span>
              </div>
            </div>

            <div class="section">
              <h3>Description</h3>
              <p>${sanitize(item.description)}</p>
            </div>

            ${item.diagnosis ? `
            <div class="section">
              <h3>Diagnosis</h3>
              <p>${sanitize(item.diagnosis)}</p>
            </div>
            ` : ''}

            ${item.assignedTechnician ? `
            <div class="section">
              <h3>Technician Assignment</h3>
              <p>Assigned Technician: ${sanitize(item.assignedTechnician)}</p>
            </div>
            ` : ''}

            ${item.estimatedRepairCost ? `
            <div class="section">
              <h3>Cost Information</h3>
              <p>Estimated Repair Cost: ${fmt(item.estimatedRepairCost)}</p>
              ${item.actualRepairCost ? `<p>Actual Repair Cost: ${fmt(item.actualRepairCost)}</p>` : ''}
            </div>
            ` : ''}

            ${item.startTime ? `
            <div class="section">
              <h3>Timeline</h3>
              <p>Start Time: ${new Date(item.startTime).toLocaleString('id-ID')}</p>
              ${item.endTime ? `<p>End Time: ${new Date(item.endTime).toLocaleString('id-ID')}</p>` : ''}
              ${item.downtimeHours ? `<p>Downtime: ${item.downtimeHours.toFixed(2)} hours</p>` : ''}
            </div>
            ` : ''}

            ${item.resolutionNotes ? `
            <div class="section">
              <h3>Resolution Notes</h3>
              <p>${sanitize(item.resolutionNotes)}</p>
            </div>
            ` : ''}

            ${item.partsUsed && item.partsUsed.length > 0 ? `
            <div class="section">
              <h3>Parts Used</h3>
              <table>
                <thead>
                  <tr>
                    <th>Part Name</th>
                    <th>Quantity</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  ${item.partsUsed.map(part => `
                    <tr>
                      <td>${sanitize(part.partName)}</td>
                      <td>${part.quantity}</td>
                      <td>${fmt(part.cost)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
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
        <h1>🔧 Breakdown Management</h1>
        <p>Pencatatan dan tracking breakdown unit alat berat</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{totalBreakdowns}</div>
          <div className="stat-label">Total Breakdown</div>
        </div>
        <div className="stat-card" style={{ background: '#fee', border: '1px solid #fcc' }}>
          <div className="stat-value">{criticalBreakdowns}</div>
          <div className="stat-label">Critical (Active)</div>
        </div>
        <div className="stat-card" style={{ background: '#ffd', border: '1px solid #fc0' }}>
          <div className="stat-value">{inProgress}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-card" style={{ background: '#efe', border: '1px solid #8f8' }}>
          <div className="stat-value">{resolved}</div>
          <div className="stat-label">Resolved</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{avgDowntime.toFixed(1)}h</div>
          <div className="stat-label">Avg Downtime</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Cari breakdown..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="search-input"
        />
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          className="filter-select"
        >
          <option value="ALL">Semua Severity</option>
          <option value="CRITICAL">Critical</option>
          <option value="MAJOR">Major</option>
          <option value="MINOR">Minor</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="filter-select"
        >
          <option value="ALL">Semua Status</option>
          <option value="REPORTED">Dilaporkan</option>
          <option value="INSPECTING">Inspeksi</option>
          <option value="DIAGNOSING">Diagnosis</option>
          <option value="REPAIRING">Perbaikan</option>
          <option value="TESTING">Testing</option>
          <option value="RESOLVED">Selesai</option>
          <option value="CANCELLED">Dibatalkan</option>
        </select>
        <button onClick={openCreateModal} className="btn btn-primary">
          + Lapor Breakdown
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>No. Breakdown</th>
              <th>Unit</th>
              <th>Lokasi</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Tanggal</th>
              <th>Downtime</th>
              <th>Biaya</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id}>
                <td>
                  <strong>{item.breakdownNumber}</strong>
                  <div style={{ fontSize: 11, color: '#666' }}>{item.reportedBy}</div>
                </td>
                <td>
                  <div>{item.unitModel}</div>
                  <div style={{ fontSize: 11, color: '#666' }}>{item.unitSerialNumber}</div>
                </td>
                <td>{item.location}</td>
                <td>
                  <span className={`badge ${SEVERITY_MAP[item.severity]?.badge ?? 'badge-muted'}`}>
                    {SEVERITY_MAP[item.severity]?.label ?? item.severity}
                  </span>
                </td>
                <td>
                  <span className={`badge ${STATUS_MAP[item.status]?.badge ?? 'badge-muted'}`}>
                    {STATUS_MAP[item.status]?.label ?? item.status}
                  </span>
                </td>
                <td>{new Date(item.reportedAt).toLocaleDateString('id-ID')}</td>
                <td>{item.downtimeHours ? `${item.downtimeHours.toFixed(1)}h` : '-'}</td>
                <td>{item.actualRepairCost ? fmt(item.actualRepairCost) : (item.estimatedRepairCost ? fmt(item.estimatedRepairCost) : '-')}</td>
                <td>
                  <div className="action-buttons">
                    <button onClick={() => handleEdit(item)} className="btn btn-sm" title="Edit">
                      ✏️
                    </button>
                    <button onClick={() => handlePrint(item)} className="btn btn-sm" title="Print">
                      🖨️
                    </button>
                    {item.status === 'REPORTED' && (
                      <button onClick={() => handleUpdateStatus(item.id, 'INSPECTING')} className="btn btn-sm btn-success" title="Start Inspection">
                        🔍
                      </button>
                    )}
                    {item.status === 'INSPECTING' && (
                      <button onClick={() => handleUpdateStatus(item.id, 'DIAGNOSING')} className="btn btn-sm btn-warning" title="Start Diagnosis">
                        🔬
                      </button>
                    )}
                    {item.status === 'DIAGNOSING' && (
                      <button onClick={() => handleUpdateStatus(item.id, 'REPAIRING')} className="btn btn-sm btn-warning" title="Start Repair">
                        🔧
                      </button>
                    )}
                    {item.status === 'REPAIRING' && (
                      <button onClick={() => handleUpdateStatus(item.id, 'TESTING')} className="btn btn-sm btn-info" title="Start Testing">
                        ✅
                      </button>
                    )}
                    {item.status === 'TESTING' && (
                      <button onClick={() => handleUpdateStatus(item.id, 'RESOLVED')} className="btn btn-sm btn-success" title="Mark Resolved">
                        ✓
                      </button>
                    )}
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
          <div className="modal-content" style={{ maxWidth: 800 }}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Breakdown' : 'Lapor Breakdown Baru'}</h2>
              <button onClick={() => setShowModal(false)} className="modal-close">×</button>
            </div>
            <form onSubmit={handleCreate} className="modal-body">
              <div className="form-group">
                <label>No. Breakdown</label>
                <input
                  type="text"
                  value={form.breakdownNumber}
                  onChange={e => setForm({ ...form, breakdownNumber: e.target.value })}
                  disabled
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Serial Number Unit *</label>
                  <input
                    type="text"
                    value={form.unitSerialNumber}
                    onChange={e => setForm({ ...form, unitSerialNumber: e.target.value })}
                    placeholder="Contoh: KMT-PC200-001"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Model Unit *</label>
                  <input
                    type="text"
                    value={form.unitModel}
                    onChange={e => setForm({ ...form, unitModel: e.target.value })}
                    placeholder="Contoh: Komatsu PC200-8"
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Lokasi *</label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={e => setForm({ ...form, location: e.target.value })}
                    placeholder="Contoh: Jobsite Morowali"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Dilaporkan Oleh *</label>
                  <input
                    type="text"
                    value={form.reportedBy}
                    onChange={e => setForm({ ...form, reportedBy: e.target.value })}
                    placeholder="Nama pelapor"
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Severity *</label>
                  <select
                    value={form.severity}
                    onChange={e => setForm({ ...form, severity: e.target.value as BreakdownSeverity })}
                  >
                    <option value="CRITICAL">Critical - Unit tidak bisa bergerak sama sekali</option>
                    <option value="MAJOR">Major - Fungsi utama terganggu</option>
                    <option value="MINOR">Minor - Masalah kecil, masih bisa operasi</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Status *</label>
                  <select
                    value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value as BreakdownStatus })}
                  >
                    <option value="REPORTED">Dilaporkan</option>
                    <option value="INSPECTING">Inspeksi</option>
                    <option value="DIAGNOSING">Diagnosis</option>
                    <option value="REPAIRING">Perbaikan</option>
                    <option value="TESTING">Testing</option>
                    <option value="RESOLVED">Selesai</option>
                    <option value="CANCELLED">Dibatalkan</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Deskripsi Masalah *</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Jelaskan masalah yang terjadi secara detail..."
                  rows={4}
                  required
                />
              </div>
              <div className="form-group">
                <label>Diagnosis</label>
                <textarea
                  value={form.diagnosis}
                  onChange={e => setForm({ ...form, diagnosis: e.target.value })}
                  placeholder="Hasil diagnosis teknisi..."
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>Teknisi yang Ditugaskan</label>
                <input
                  type="text"
                  value={form.assignedTechnician}
                  onChange={e => setForm({ ...form, assignedTechnician: e.target.value })}
                  placeholder="Nama teknisi"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Estimasi Biaya Perbaikan</label>
                  <input
                    type="number"
                    value={form.estimatedRepairCost}
                    onChange={e => setForm({ ...form, estimatedRepairCost: Number(e.target.value) })}
                    placeholder="0"
                    min={0}
                  />
                </div>
                <div className="form-group">
                  <label>Biaya Aktual</label>
                  <input
                    type="number"
                    value={form.actualRepairCost}
                    onChange={e => setForm({ ...form, actualRepairCost: Number(e.target.value) })}
                    placeholder="0"
                    min={0}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Waktu Mulai</label>
                  <input
                    type="datetime-local"
                    value={form.startTime}
                    onChange={e => setForm({ ...form, startTime: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Waktu Selesai</label>
                  <input
                    type="datetime-local"
                    value={form.endTime}
                    onChange={e => setForm({ ...form, endTime: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Catatan Penyelesaian</label>
                <textarea
                  value={form.resolutionNotes}
                  onChange={e => setForm({ ...form, resolutionNotes: e.target.value })}
                  placeholder="Catatan setelah perbaikan selesai..."
                  rows={3}
                />
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Batal
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingId ? 'Simpan Perubahan' : 'Lapor Breakdown'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
