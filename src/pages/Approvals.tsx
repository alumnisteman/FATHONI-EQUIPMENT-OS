// src/pages/Approvals.tsx - Modul Approval Workflow FATHONI EQUIPMENT OS

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { ApprovalRequest, ApprovalStatus, ApprovalType } from '../types';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';
import {
  validateField,
  validateName,
  validateAmount,
  validateDescription
} from '../utils/validation';

const STATUS_MAP: Record<ApprovalStatus, { label: string; badge: string }> = {
  PENDING: { label: 'Pending', badge: 'badge-warning' },
  APPROVED: { label: 'Disetujui', badge: 'badge-success' },
  REJECTED: { label: 'Ditolak', badge: 'badge-danger' },
  CANCELLED: { label: 'Dibatalkan', badge: 'badge-muted' },
};

const TYPE_MAP: Record<ApprovalType, { label: string; icon: string }> = {
  PURCHASE_REQUEST: { label: 'Purchase Request', icon: '🛒' },
  MAINTENANCE_REQUEST: { label: 'Maintenance Request', icon: '🔧' },
  RENTAL_CONTRACT: { label: 'Rental Contract', icon: '📋' },
  DISCOUNT: { label: 'Discount', icon: '💰' },
  PAYMENT: { label: 'Payment', icon: '💳' },
  EXPENSE: { label: 'Expense', icon: '📝' },
};

export default function Approvals() {
  const { approvals, setApprovals, removeRow } = useDataStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState({
    requestNumber: `APR-${new Date().getFullYear()}-${String(approvals.length + 1).padStart(3, '0')}`,
    type: 'PURCHASE_REQUEST' as ApprovalType,
    title: '',
    description: '',
    requestedBy: '',
    amount: 0,
    approverLevel: 1,
    currentApprover: '',
    notes: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = approvals.filter(item => {
    const matchSearch = matchesQuery([item.requestNumber, item.title, item.requestedBy], search);
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
    const matchType = typeFilter === 'ALL' || item.type === typeFilter;
    return matchSearch && matchStatus && matchType;
  });

  const totalApprovals = approvals.length;
  const pendingApprovals = approvals.filter(a => a.status === 'PENDING').length;
  const approvedApprovals = approvals.filter(a => a.status === 'APPROVED').length;
  const rejectedApprovals = approvals.filter(a => a.status === 'REJECTED').length;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    // Validasi judul
    const titleError = validateField(form.title, { required: true, minLength: 5, maxLength: 100 }, 'Judul');
    if (titleError) {
      alert(titleError);
      return;
    }

    // Validasi deskripsi
    const descError = validateDescription(form.description, 10, 500);
    if (descError) {
      alert(descError);
      return;
    }

    // Validasi requester
    const requesterError = validateName(form.requestedBy, 3, 100);
    if (requesterError) {
      alert(requesterError);
      return;
    }

    // Validasi amount jika diisi
    if (form.amount > 0) {
      const amountError = validateAmount(form.amount, 0, 10000000000);
      if (amountError) {
        alert(amountError);
        return;
      }
    }

    // Validasi approver jika diisi
    if (form.currentApprover) {
      const approverError = validateName(form.currentApprover, 2, 100);
      if (approverError) {
        alert(approverError);
        return;
      }
    }

    if (editingId) {
      setApprovals(approvals.map(a => a.id === editingId ? {
        ...a,
        requestNumber: form.requestNumber,
        type: form.type,
        title: form.title,
        description: form.description,
        requestedBy: form.requestedBy,
        amount: form.amount,
        approverLevel: form.approverLevel,
        currentApprover: form.currentApprover,
        notes: form.notes,
      } : a));
    } else {
      const newItem: ApprovalRequest = {
        id: Date.now().toString(),
        requestNumber: form.requestNumber,
        type: form.type,
        title: form.title,
        description: form.description,
        requestedBy: form.requestedBy,
        requestedAt: new Date().toISOString(),
        amount: form.amount,
        status: 'PENDING',
        approverLevel: form.approverLevel,
        currentApprover: form.currentApprover,
        notes: form.notes,
      };
      setApprovals([newItem, ...approvals]);
    }
    setShowModal(false);
    setEditingId(null);
    setForm({
      requestNumber: `APR-${new Date().getFullYear()}-${String(approvals.length + 1).padStart(3, '0')}`,
      type: 'PURCHASE_REQUEST',
      title: '',
      description: '',
      requestedBy: '',
      amount: 0,
      approverLevel: 1,
      currentApprover: '',
      notes: '',
    });
  };

  const handleEdit = (item: ApprovalRequest) => {
    setEditingId(item.id);
    setForm({
      requestNumber: item.requestNumber,
      type: item.type,
      title: item.title,
      description: item.description,
      requestedBy: item.requestedBy,
      amount: item.amount || 0,
      approverLevel: item.approverLevel,
      currentApprover: item.currentApprover || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  // Lewat removeRow, bukan filter array: satu baris dikirim ke database dan
  // pemeriksaan rujukan di main process ikut berjalan.
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus request approval ini?')) return;
    const hasil = await removeRow('approvals', id);
    if (!hasil.ok) alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
  };

  const handleApprove = (id: string) => {
    const approval = approvals.find(a => a.id === id);
    if (approval && approval.status === 'PENDING') {
      const reason = prompt('Masukkan catatan approval (opsional):');
      setApprovals(approvals.map(a => a.id === id ? {
        ...a,
        status: 'APPROVED',
        approvedBy: 'Current User',
        approvedAt: new Date().toISOString(),
        notes: reason || a.notes,
      } : a));
    }
  };

  const handleReject = (id: string) => {
    const approval = approvals.find(a => a.id === id);
    if (approval && approval.status === 'PENDING') {
      const reason = prompt('Masukkan alasan penolakan (wajib):');
      if (reason && reason.trim()) {
        setApprovals(approvals.map(a => a.id === id ? {
          ...a,
          status: 'REJECTED',
          rejectionReason: reason.trim(),
          notes: reason,
        } : a));
      } else {
        alert('Alasan penolakan wajib diisi');
      }
    }
  };

  const handlePrint = (item: ApprovalRequest) => {
    if (confirm(`Cetak Approval Request ${item.requestNumber}?`)) {
      const companyName = getCompanyName();

      const htmlContent = `
        <html>
          <head>
            <title>Approval Request ${sanitize(item.requestNumber)}</title>
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
              .status-pending { background: #ffd; color: #b80; }
              .status-approved { background: #efe; color: #080; }
              .status-rejected { background: #fee; color: #c00; }
              .status-cancelled { background: #eee; color: #666; }
              .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>${sanitize(companyName)}</h1>
              <p>Approval Request</p>
            </div>

            <div class="status status-${(item.status ?? '').toLowerCase()}">
              Status: ${STATUS_MAP[item.status]?.label ?? item.status}
            </div>

            <div class="info">
              <div class="info-item">
                <label>Request Number:</label>
                <span>${sanitize(item.requestNumber)}</span>
              </div>
              <div class="info-item">
                <label>Type:</label>
                <span>${sanitize(TYPE_MAP[item.type]?.label ?? item.type)}</span>
              </div>
              <div class="info-item">
                <label>Title:</label>
                <span>${sanitize(item.title)}</span>
              </div>
              <div class="info-item">
                <label>Requested By:</label>
                <span>${sanitize(item.requestedBy)}</span>
              </div>
              <div class="info-item">
                <label>Requested At:</label>
                <span>${new Date(item.requestedAt).toLocaleString('id-ID')}</span>
              </div>
              <div class="info-item">
                <label>Amount:</label>
                <span>${item.amount ? 'Rp ' + new Intl.NumberFormat('id-ID').format(item.amount) : '-'}</span>
              </div>
            </div>

            <div class="section">
              <h3>Description</h3>
              <p>${sanitize(item.description)}</p>
            </div>

            <div class="section">
              <h3>Approval Details</h3>
              <p>Approver Level: ${item.approverLevel}</p>
              <p>Current Approver: ${item.currentApprover ? sanitize(item.currentApprover) : 'Not assigned'}</p>
              ${item.approvedBy ? `<p>Approved By: ${sanitize(item.approvedBy)}</p>` : ''}
              ${item.approvedAt ? `<p>Approved At: ${new Date(item.approvedAt).toLocaleString('id-ID')}</p>` : ''}
            </div>

            ${item.rejectionReason ? `
            <div class="section" style="background: #fee;">
              <h3>Rejection Reason</h3>
              <p>${sanitize(item.rejectionReason)}</p>
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
        <h1>✅ Approval Workflow</h1>
        <p>Manajemen persetujuan dan approval</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{totalApprovals}</div>
          <div className="stat-label">Total Request</div>
        </div>
        <div className="stat-card" style={{ background: '#ffd', border: '1px solid #fc0' }}>
          <div className="stat-value">{pendingApprovals}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card" style={{ background: '#efe', border: '1px solid #8f8' }}>
          <div className="stat-value">{approvedApprovals}</div>
          <div className="stat-label">Disetujui</div>
        </div>
        <div className="stat-card" style={{ background: '#fee', border: '1px solid #fcc' }}>
          <div className="stat-value">{rejectedApprovals}</div>
          <div className="stat-label">Ditolak</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Cari request..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="search-input"
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="filter-select"
        >
          <option value="ALL">Semua Tipe</option>
          <option value="PURCHASE_REQUEST">Purchase Request</option>
          <option value="MAINTENANCE_REQUEST">Maintenance Request</option>
          <option value="RENTAL_CONTRACT">Rental Contract</option>
          <option value="DISCOUNT">Discount</option>
          <option value="PAYMENT">Payment</option>
          <option value="EXPENSE">Expense</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="filter-select"
        >
          <option value="ALL">Semua Status</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Disetujui</option>
          <option value="REJECTED">Ditolak</option>
          <option value="CANCELLED">Dibatalkan</option>
        </select>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">
          + Buat Request
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>No. Request</th>
              <th>Tipe</th>
              <th>Judul</th>
              <th>Requester</th>
              <th>Amount</th>
              <th>Tanggal</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id}>
                <td>
                  <strong>{item.requestNumber}</strong>
                </td>
                <td>
                  <span>{TYPE_MAP[item.type]?.icon} {TYPE_MAP[item.type]?.label ?? item.type}</span>
                </td>
                <td>{item.title}</td>
                <td>{item.requestedBy}</td>
                <td>{item.amount ? 'Rp ' + new Intl.NumberFormat('id-ID').format(item.amount) : '-'}</td>
                <td>{new Date(item.requestedAt).toLocaleDateString('id-ID')}</td>
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
                    {item.status === 'PENDING' && (
                      <>
                        <button onClick={() => handleApprove(item.id)} className="btn btn-sm btn-success" title="Approve">
                          ✓
                        </button>
                        <button onClick={() => handleReject(item.id)} className="btn btn-sm btn-danger" title="Reject">
                          ✗
                        </button>
                      </>
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
          <div className="modal-content" style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Request' : 'Buat Request Baru'}</h2>
              <button onClick={() => setShowModal(false)} className="modal-close">×</button>
            </div>
            <form onSubmit={handleCreate} className="modal-body">
              <div className="form-group">
                <label>No. Request</label>
                <input
                  type="text"
                  value={form.requestNumber}
                  onChange={e => setForm({ ...form, requestNumber: e.target.value })}
                  disabled
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipe Request *</label>
                  <select
                    value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value as ApprovalType })}
                  >
                    <option value="PURCHASE_REQUEST">Purchase Request</option>
                    <option value="MAINTENANCE_REQUEST">Maintenance Request</option>
                    <option value="RENTAL_CONTRACT">Rental Contract</option>
                    <option value="DISCOUNT">Discount</option>
                    <option value="PAYMENT">Payment</option>
                    <option value="EXPENSE">Expense</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Judul *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="Judul request"
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Deskripsi *</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Jelaskan detail request..."
                  rows={4}
                  required
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Requested By *</label>
                  <input
                    type="text"
                    value={form.requestedBy}
                    onChange={e => setForm({ ...form, requestedBy: e.target.value })}
                    placeholder="Nama requester"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Amount</label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
                    placeholder="0"
                    min={0}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Approver Level</label>
                  <select
                    value={form.approverLevel}
                    onChange={e => setForm({ ...form, approverLevel: Number(e.target.value) })}
                  >
                    <option value={1}>Level 1</option>
                    <option value={2}>Level 2</option>
                    <option value={3}>Level 3</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Current Approver</label>
                  <input
                    type="text"
                    value={form.currentApprover}
                    onChange={e => setForm({ ...form, currentApprover: e.target.value })}
                    placeholder="Nama approver saat ini"
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
                  {editingId ? 'Simpan Perubahan' : 'Buat Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
