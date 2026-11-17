// src/pages/Sales.tsx - Modul Penjualan Alat Berat FATHONI EQUIPMENT OS

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import type { OrderStatus } from '../types';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { matchesQuery } from '../utils/searchMatch';
import { nomorBerikut, nomorSementara } from '../utils/nomorBerikut';
import {
  validateField,
  validateAmount,
  validateDateRange,
  validateName,
} from '../utils/validation';

import { type SalesOrder } from '../data/demoTransactions';


const STATUS_CONFIG: Record<OrderStatus, { label: string; badge: string }> = {
  DRAFT: { label: 'Draft / Penawaran', badge: 'badge-muted' },
  CONFIRMED: { label: 'SPK Dikonfirmasi', badge: 'badge-info' },
  IN_PROGRESS: { label: 'Proses Unit / Leasing', badge: 'badge-warning' },
  COMPLETED: { label: 'Unit Terkirim / Selesai', badge: 'badge-success' },
  CANCELLED: { label: 'Dibatalkan', badge: 'badge-danger' },
};

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

export default function Sales() {
  const { sales: data, setSales: setData, units, customers, addSale, updateUnitStatus, saveRow, removeRow } = useDataStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Bentuk nomor SPK satu tempat: lebar angka ikut tumbuh (001, 002, ... 1000)
  // dan sumber angkanya dari file, bukan dari panjang array halaman.
  const nomorSPK = (urutan: number) =>
    `SO-${new Date().getFullYear()}-${String(urutan).padStart(3, '0')}`;

  const emptyForm = {
    orderNo: nomorSementara(data, 'orderNo', nomorSPK),
    customerName: '',
    unitModel: 'SANY SY215C Excavator',
    serialNumber: '',
    orderDate: new Date().toISOString().split('T')[0],
    totalPrice: 0,
    downPayment: 0,
    paymentScheme: 'CASH' as 'CASH' | 'LEASING' | 'INSTALLMENT',
    salesPerson: 'Budi Santoso',
  };
  const [form, setForm] = useState(emptyForm);

  const filtered = data.filter(item => {
    const matchSearch = matchesQuery([item.orderNo, item.customerName, item.unitModel], search);
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalSalesVolume = data.reduce((acc, i) => acc + i.totalPrice, 0);
  const activeOrders = data.filter(i => i.status !== 'COMPLETED' && i.status !== 'CANCELLED').length;
  const completedOrders = data.filter(i => i.status === 'COMPLETED').length;

  const handleCreate = async (e: React.FormEvent) => {
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

    // Validasi harga total
    const priceError = validateAmount(form.totalPrice, 1000000, 10000000000);
    if (priceError) {
      alert(priceError);
      return;
    }

    // Validasi down payment
    const dpError = validateAmount(form.downPayment, 0, form.totalPrice);
    if (dpError) {
      alert(dpError);
      return;
    }

    // Validasi down payment tidak boleh lebih dari harga total
    if (form.downPayment > form.totalPrice) {
      alert('Uang muka tidak boleh lebih dari harga unit');
      return;
    }

    // Validasi skema pembayaran
    const schemeError = validateField(form.paymentScheme, { required: true, minLength: 2, maxLength: 50 }, 'Skema Pembayaran');
    if (schemeError) {
      alert(schemeError);
      return;
    }

    // Validasi sales person
    const salesError = validateName(form.salesPerson, 2, 50);
    if (salesError) {
      alert(salesError);
      return;
    }

    // Validasi tanggal order
    const dateError = validateField(form.orderDate, { required: true }, 'Tanggal Order');
    if (dateError) {
      alert(dateError);
      return;
    }

    if (editingId) {
      const existing = data.find(i => i.id === editingId);
      if (!existing) return;
      await saveRow('sales', {
        ...existing,
        orderNo: form.orderNo,
        customerName: form.customerName,
        unitModel: form.unitModel,
        serialNumber: form.serialNumber || existing.serialNumber,
        orderDate: form.orderDate,
        totalPrice: Number(form.totalPrice),
        downPayment: Number(form.downPayment),
        paymentScheme: form.paymentScheme,
        salesPerson: form.salesPerson,
      });
    } else {
      const newItem: SalesOrder = {
        id: Date.now().toString(),
        orderNo: form.orderNo,
        customerName: form.customerName,
        unitModel: form.unitModel,
        serialNumber: form.serialNumber || `SN-${Date.now().toString().slice(-6)}`,
        orderDate: form.orderDate,
        totalPrice: Number(form.totalPrice),
        downPayment: Number(form.downPayment),
        paymentScheme: form.paymentScheme,
        status: 'CONFIRMED',
        salesPerson: form.salesPerson,
      };
      // Satu aksi store menyelesaikan seluruh handoff: unit SOLD, invoice,
      // DP masuk kas, dan dokumen pengiriman yang menunggu jadwal.
      addSale(newItem);
    }    setShowModal(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleEdit = (item: SalesOrder) => {
    setEditingId(item.id);
    setForm({
      orderNo: item.orderNo,
      customerName: item.customerName,
      unitModel: item.unitModel,
      serialNumber: item.serialNumber,
      orderDate: item.orderDate,
      totalPrice: item.totalPrice,
      downPayment: item.downPayment,
      paymentScheme: item.paymentScheme,
      salesPerson: item.salesPerson,
    });
    setShowModal(true);
  };

  // SPK yang sudah melahirkan surat jalan atau invoice tidak bisa dihapus diam-
  // diam; dokumen turunannya akan kehilangan rujukan ke pesanan induk.
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus data SPK ini? Data yang dihapus tidak dapat dikembalikan.')) return;
    const hasil = await removeRow('sales', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: OrderStatus) => {
    const item = data.find(i => i.id === id);
    if (!item) return;
    await saveRow('sales', { ...item, status: newStatus });
    if (newStatus === 'COMPLETED' && item.serialNumber) {
      const unit = units.find((u: any) => u.serialNumber === item.serialNumber);
      if (unit) updateUnitStatus(unit.id, 'SOLD');
    }
  };

  const openCreateModal = async () => {
    setEditingId(null);
    const orderNo = await nomorBerikut('sales', 'orderNo', data, nomorSPK);
    setForm({ ...emptyForm, orderNo });
    setShowModal(true);
  };

  const handlePrint = (item: SalesOrder) => {
    if (confirm(`Cetak SPK ${item.orderNo}?`)) {
      const sisa = item.totalPrice - item.downPayment;
      const companyName = getCompanyName();
      
      const htmlContent = `
        <html><head><title>SPK ${sanitize(item.orderNo)}</title><style>
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
          <h2>SURAT PESANAN KENDARAAN (SPK)</h2>
        </div>
        <p><strong>No. SPK:</strong> ${sanitize(item.orderNo)} &nbsp;&nbsp; <strong>Tanggal:</strong> ${item.orderDate}</p>
        <table>
          <tr><th>Pembeli</th><td>${sanitize(item.customerName)}</td></tr>
          <tr><th>Unit Alat Berat</th><td>${sanitize(item.unitModel)}</td></tr>
          <tr><th>Serial Number</th><td>${sanitize(item.serialNumber)}</td></tr>
          <tr><th>Skema Pembayaran</th><td>${sanitize(item.paymentScheme)}</td></tr>
          <tr><th>Sales</th><td>${sanitize(item.salesPerson)}</td></tr>
          <tr><th>Harga Unit</th><td class="total">Rp ${(item.totalPrice ?? 0).toLocaleString('id-ID')}</td></tr>
          <tr><th>Uang Muka (DP)</th><td>Rp ${(item.downPayment ?? 0).toLocaleString('id-ID')}</td></tr>
          <tr><th>Sisa Pembayaran</th><td class="total">Rp ${sisa.toLocaleString('id-ID')}</td></tr>
          <tr><th>Status</th><td>${sanitize(item.status)}</td></tr>
        </table>
        <div class="footer">
          <div class="sign"><div class="sign-line"></div><div>Pembeli</div></div>
          <div class="sign"><div class="sign-line"></div><div>Sales</div></div>
          <div class="sign"><div class="sign-line"></div><div>Direktur</div></div>
        </div>
      </body></html>
      `;
      printDocument(htmlContent, `SPK ${item.orderNo}`);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Penjualan & SPK</h1>
          <p className="page-subtitle">Pencatatan Surat Pesanan Kendaraan (SPK), penjualan unit, dan proses serah terima</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Buat SPK Baru
          </button>
        </div>
      </div>

      <div className="grid-3 mb-4">
        <div className="card stat-card">
          <div className="card-title">Total Nilai Penjualan</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{fmt(totalSalesVolume)}</div>
          <div className="card-sub">Akumulasi Penjualan Alat Berat</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Order Aktif / Diproses</div>
          <div className="card-value" style={{ color: 'var(--accent-blue)' }}>{activeOrders} Unit</div>
          <div className="card-sub">Menunggu Pengiriman / Leasing</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Penjualan Selesai</div>
          <div className="card-value" style={{ color: 'var(--text-primary)' }}>{completedOrders} Unit</div>
          <div className="card-sub">Unit Sudah Diserahterimakan</div>
        </div>
      </div>

      <div className="card mb-4" style={{ padding: '14px 20px', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status:</span>
          {['ALL', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(st => (
            <button
              key={st}
              className={`btn btn-sm ${statusFilter === st ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusFilter(st)}
            >
              {st === 'ALL' ? 'Semua' : STATUS_CONFIG[st as OrderStatus]?.label.split('/')[0] ?? st}
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
            placeholder="Cari SPK, pelanggan, unit..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>No. SPK / Tanggal</th>
              <th>Pelanggan</th>
              <th>Unit & Serial Number</th>
              <th>Skema Bayar</th>
              <th style={{ textAlign: 'right' }}>Harga Unit</th>
              <th>Sales</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                  Belum ada data penjualan yang cocok.
                </td>
              </tr>
            ) : (
              filtered.map(item => (
                <tr key={item.id}>
                  <td>
                    <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{item.orderNo}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.orderDate}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.customerName}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.unitModel}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>SN: {item.serialNumber}</div>
                  </td>
                  <td>
                    <span className="badge badge-muted">{item.paymentScheme}</span>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>DP: {fmt(item.downPayment)}</div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {fmt(item.totalPrice)}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.salesPerson}</td>
                  <td>
                    <span className={`badge ${STATUS_CONFIG[item.status as OrderStatus]?.badge ?? 'badge-muted'}`}>
                      {STATUS_CONFIG[item.status as OrderStatus]?.label ?? item.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      {item.status === 'CONFIRMED' && (
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => handleUpdateStatus(item.id, 'IN_PROGRESS')}
                        >
                          Proses
                        </button>
                      )}
                      {item.status === 'IN_PROGRESS' && (
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ fontSize: 11, padding: '4px 8px' }}
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
                        🖨 Cetak SPK
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

      {/* Modal Tambah SPK */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">{editingId ? 'Edit Data SPK' : 'Buat SPK Penjualan Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Nomor SPK</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.orderNo}
                      onChange={e => setForm({ ...form, orderNo: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tanggal Order</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.orderDate}
                      onChange={e => setForm({ ...form, orderDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Nama Pembeli (Pilih dari Data Pelanggan)</label>
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
                        <option key={u.id} value={u.serialNumber}>{u.brand} {u.model} - {u.serialNumber}</option>
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
                    <label className="form-label">Total Harga Unit (IDR)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.totalPrice || ''}
                      onChange={e => setForm({ ...form, totalPrice: Number(e.target.value) })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Uang Muka / DP (IDR)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.downPayment || ''}
                      onChange={e => setForm({ ...form, downPayment: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Skema Pembayaran</label>
                    <select
                      className="form-select"
                      value={form.paymentScheme}
                      onChange={e => setForm({ ...form, paymentScheme: e.target.value as any })}
                    >
                      <option value="CASH">Hard Cash (Tunai)</option>
                      <option value="LEASING">Leasing Financing</option>
                      <option value="INSTALLMENT">Cicilan Internal (Bertahap)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Sales Representative</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.salesPerson}
                      onChange={e => setForm({ ...form, salesPerson: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Simpan Perubahan' : 'Simpan SPK'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
