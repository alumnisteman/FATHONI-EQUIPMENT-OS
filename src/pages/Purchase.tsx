// src/pages/Purchase.tsx - Modul Pembelian Alat Berat & Spareparts
// PERBAIKAN: Migrasi dari useLocalStorage ke useDataStore (data terpusat)

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
  validatePurchaseCategory,
  PURCHASE_CATEGORY_LABELS,
  PURCHASE_CATEGORY_LEGACY_LABELS
} from '../utils/validation';

interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierName: string;
  itemName: string;
  category: string;
  orderDate: string;
  deliveryExpectedDate: string;
  totalAmount: number;
  status: 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';
  notes: string;
}

const DEMO_PURCHASES: PurchaseOrder[] = [
  {
    id: '1',
    poNumber: 'PO-2026-001',
    supplierName: 'PT Sany Heavy Machinery Indonesia',
    itemName: '2 Unit SANY SY215C Hydraulic Excavator',
    category: 'UNIT',
    orderDate: '2026-01-05',
    deliveryExpectedDate: '2026-02-15',
    totalAmount: 3_200_000_000,
    status: 'RECEIVED',
    notes: 'Franco Gudang Cikande Banten',
  },
  {
    id: '2',
    poNumber: 'PO-2026-002',
    supplierName: 'United Tractors Parts Center',
    itemName: 'Paket Undercarriage Track Link & Roller PC200',
    category: 'SPAREPART',
    orderDate: '2026-01-20',
    deliveryExpectedDate: '2026-02-10',
    totalAmount: 185_000_000,
    status: 'RECEIVED',
    notes: 'Kebutuhan overhaul armada rental',
  },
  {
    id: '3',
    poNumber: 'PO-2026-003',
    supplierName: 'Trakindo Utama Caterpillar',
    itemName: 'Main Hydraulic Pump CAT 320 GC',
    category: 'SPAREPART',
    orderDate: '2026-02-01',
    deliveryExpectedDate: '2026-02-28',
    totalAmount: 320_000_000,
    status: 'ORDERED',
    notes: 'Indent 4 minggu dari Singapura',
  },
  {
    id: '4',
    poNumber: 'PO-2026-004',
    supplierName: 'PT Pertamina Lubricants',
    itemName: '10 Drum Meditran SX4 15W-40 Oli Mesin',
    category: 'CONSUMABLE',
    orderDate: '2026-02-12',
    deliveryExpectedDate: '2026-02-20',
    totalAmount: 64_000_000,
    status: 'ORDERED',
    notes: 'Untuk stok workshop workshop pusat',
  },
];

const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  DRAFT: { label: 'Draft PO', badge: 'badge-muted' },
  ORDERED: { label: 'Dipesan ke Supplier', badge: 'badge-warning' },
  RECEIVED: { label: 'Diterima di Gudang', badge: 'badge-success' },
  CANCELLED: { label: 'Dibatalkan', badge: 'badge-danger' },
};

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

export default function Purchase() {
  const { purchases: data, setPurchases: setData, suppliers, receivePurchase, saveRow, removeRow } = useDataStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);

  const nomorPO = (urutan: number) =>
    `PO-${new Date().getFullYear()}-${String(urutan).padStart(3, '0')}`;

  const formKosong = {
    poNumber: nomorSementara(data, 'poNumber', nomorPO),
    supplierName: '',
    itemName: '',
    category: 'SPAREPART',
    orderDate: new Date().toISOString().split('T')[0],
    deliveryExpectedDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    totalAmount: 0,
    notes: '',
  };
  const [form, setForm] = useState(formKosong);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = data.filter(item => {
    const matchSearch = matchesQuery([item.poNumber, item.supplierName, item.itemName], search);
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalSpent = data.filter(i => i.status === 'RECEIVED').reduce((acc, i) => acc + i.totalAmount, 0);
  const totalOutstanding = data.filter(i => i.status === 'ORDERED').reduce((acc, i) => acc + i.totalAmount, 0);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validasi nama supplier
    const supplierError = validateName(form.supplierName, 3, 100);
    if (supplierError) {
      alert(supplierError);
      return;
    }

    // Validasi nama barang/deskripsi
    const itemError = validateField(form.itemName, { required: true, minLength: 3, maxLength: 200 }, 'Barang/Deskripsi');
    if (itemError) {
      alert(itemError);
      return;
    }

    // Validasi kategori
    const categoryError = validatePurchaseCategory(form.category);
    if (categoryError) {
      alert(categoryError);
      return;
    }

    // Validasi tanggal order
    const orderDateError = validateField(form.orderDate, { required: true }, 'Tanggal Order');
    if (orderDateError) {
      alert(orderDateError);
      return;
    }

    // Validasi tanggal estimasi tiba
    const deliveryDateError = validateField(form.deliveryExpectedDate, { required: true }, 'Estimasi Tiba');
    if (deliveryDateError) {
      alert(deliveryDateError);
      return;
    }

    // Validasi range tanggal
    const dateRangeError = validateDateRange(form.orderDate, form.deliveryExpectedDate, 'Tanggal Order', 'Estimasi Tiba');
    if (dateRangeError) {
      alert(dateRangeError);
      return;
    }

    // Validasi total amount
    const amountError = validateAmount(form.totalAmount, 100000, 10000000000);
    if (amountError) {
      alert(amountError);
      return;
    }

    if (editingId) {
      const row = { ...(data.find(i => i.id === editingId) ?? { id: editingId } as any), ...form, totalAmount: Number(form.totalAmount) };
      const ok = await saveRow('purchases', row);
      if (!ok) return;
    } else {
      const newItem: PurchaseOrder = {
        id: Date.now().toString(),
        poNumber: form.poNumber,
        supplierName: form.supplierName,
        itemName: form.itemName,
        category: form.category,
        orderDate: form.orderDate,
        deliveryExpectedDate: form.deliveryExpectedDate,
        totalAmount: Number(form.totalAmount),
        status: 'ORDERED',
        notes: form.notes,
      };
      await saveRow('purchases', newItem);
    }
    setShowModal(false);
    setEditingId(null);
    setForm(formKosong);
  };

  const handleEdit = (item: PurchaseOrder) => {
    setEditingId(item.id);
    setForm({ poNumber: item.poNumber, supplierName: item.supplierName, itemName: item.itemName, category: item.category, orderDate: item.orderDate, deliveryExpectedDate: item.deliveryExpectedDate, totalAmount: item.totalAmount, notes: item.notes });
    setShowModal(true);
  };

  // PO yang sudah diterima ke gudang punya mutasi GR- atas nomor pesanannya.
  // Menghapus PO tanpa menghapus mutasinya meninggalkan stok yang tidak bisa
  // ditelusuri asal-usulnya.
  const handleDelete = async (id: string) => {
    if (!confirm('Hapus data PO ini?')) return;
    const hasil = await removeRow('purchases', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
    }
  };

  const handleReceive = (id: string) => {
    if (confirm('Konfirmasi penerimaan barang/unit ini ke gudang?')) {
      receivePurchase(id);
    }
  };

  const handlePrint = (item: PurchaseOrder) => {
    if (confirm(`Cetak Purchase Order ${item.poNumber}?`)) {
      const companyName = getCompanyName();
      
      const htmlContent = `
        <html>
          <head>
            <title>PO ${sanitize(item.poNumber)}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; color: #111; }
              .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #C00; padding-bottom: 20px; }
              .company { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
              .title { font-size: 24px; font-weight: bold; margin-bottom: 5px; color: #C00; }
              .subtitle { font-size: 14px; color: #666; }
              .section { margin-bottom: 20px; }
              .section-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
              .row { display: flex; margin-bottom: 8px; }
              .label { width: 200px; font-weight: 600; color: #333; }
              .value { flex: 1; }
              .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              .table th, .table td { border: 1px solid #ddd; padding: 10px; text-align: left; }
              .table th { background: #f5f5f5; font-weight: 600; }
              .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; text-align: center; font-size: 12px; color: #666; }
              @media print { body { padding: 20px; } }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="company">${sanitize(companyName)}</div>
              <div class="title">PURCHASE ORDER</div>
              <div class="subtitle">No: ${sanitize(item.poNumber)}</div>
            </div>

            <div class="section">
              <div class="row">
                <div class="label">Tanggal PO:</div>
                <div class="value">${new Date(item.orderDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              </div>
              <div class="row">
                <div class="label">Pemasok:</div>
                <div class="value">${sanitize(item.supplierName)}</div>
              </div>
              <div class="row">
                <div class="label">Status:</div>
                <div class="value">${sanitize(item.status)}</div>
              </div>
            </div>

            <div class="section-title">Detail Barang / Jasa</div>
            <div class="section">
              <div class="row">
                <div class="label">Kategori:</div>
                <div class="value">${sanitize(item.category)}</div>
              </div>
              <div class="row">
                <div class="label">Barang / Deskripsi:</div>
                <div class="value">${sanitize(item.itemName)}</div>
              </div>
              <div class="row">
                <div class="label">Estimasi Tiba:</div>
                <div class="value">${new Date(item.deliveryExpectedDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              </div>
              <div class="row">
                <div class="label">Total Nilai PO:</div>
                <div class="value" style="font-weight: bold; font-size: 16px;">${fmt(item.totalAmount)}</div>
              </div>
              <div class="row">
                <div class="label">Catatan:</div>
                <div class="value">${sanitize(item.notes || '-')}</div>
              </div>
            </div>

            <div class="footer">
              <p>Dokumen ini dibuat secara otomatis oleh FATHONI EQUIPMENT OS - Sistem Operasional Alat Berat Terintegrasi</p>
              <p>${new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </body>
        </html>
      `;
      printDocument(htmlContent, `PO ${item.poNumber}`);
    }
  };

  const openCreateModal = async () => {
    setEditingId(null);
    const poNumber = await nomorBerikut('purchases', 'poNumber', data, nomorPO);
    setForm({ ...formKosong, poNumber });
    setShowModal(true);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pembelian & Pengadaan (PO)</h1>
          <p className="page-subtitle">Penerbitan Purchase Order (PO) alat berat, spare parts, dan perlengkapan operasional</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Buat PO Baru
          </button>
        </div>
      </div>

      <div className="grid-3 mb-4">
        <div className="card stat-card">
          <div className="card-title">Total Belanja Diterima</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{fmt(totalSpent)}</div>
          <div className="card-sub">Barang/Unit Sudah Masuk Gudang</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">PO Dalam Pengiriman</div>
          <div className="card-value" style={{ color: 'var(--status-maintenance)' }}>{fmt(totalOutstanding)}</div>
          <div className="card-sub">Menunggu Kedatangan Barang</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Total PO Diterbitkan</div>
          <div className="card-value" style={{ color: 'var(--text-primary)' }}>{data.length} Pesanan</div>
          <div className="card-sub">Keseluruhan Transaksi Pembelian</div>
        </div>
      </div>

      <div className="card mb-4" style={{ padding: '14px 20px', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status:</span>
          {['ALL', 'ORDERED', 'RECEIVED', 'CANCELLED'].map(st => (
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
            placeholder="Cari PO, supplier, barang..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>No. PO / Tanggal</th>
              <th>Pemasok (Supplier)</th>
              <th>Barang / Deskripsi</th>
              <th>Kategori</th>
              <th>Estimasi Tiba</th>
              <th style={{ textAlign: 'right' }}>Nilai PO</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                  Tidak ada data pembelian yang ditemukan.
                </td>
              </tr>
            ) : (
              filtered.map(item => (
                <tr key={item.id}>
                  <td>
                    <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{item.poNumber}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.orderDate}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.supplierName}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.itemName}</div>
                    {item.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.notes}</div>}
                  </td>
                  <td>
                    <span className="badge badge-muted">{item.category}</span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.deliveryExpectedDate}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {fmt(item.totalAmount)}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_MAP[item.status]?.badge}`}>
                      {STATUS_MAP[item.status]?.label}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      {item.status === 'ORDERED' && (
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => handleReceive(item.id)}
                        >
                          Terima Barang
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
                        🖨 Cetak PO
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

      {/* Modal Tambah PO */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">{editingId ? 'Edit Purchase Order' : 'Buat Purchase Order (PO) Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Nomor PO</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.poNumber}
                      onChange={e => setForm({ ...form, poNumber: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Kategori Pembelian</label>
                    <select
                      className="form-select"
                      value={form.category}
                      onChange={e => setForm({ ...form, category: e.target.value })}
                    >
                      {Object.entries(PURCHASE_CATEGORY_LABELS).map(([nilai, label]) => (
                        <option key={nilai} value={nilai}>{label}</option>
                      ))}
                      {/* Baris lama boleh menyimpan kategori yang sudah tidak
                          ditawarkan. Tanpa opsi ini, nilainya tidak ada di daftar,
                          browser menampilkan opsi pertama, dan Simpan mengganti
                          kategori record tanpa pernah diminta. */}
                      {PURCHASE_CATEGORY_LEGACY_LABELS[form.category] && (
                        <option value={form.category}>{PURCHASE_CATEGORY_LEGACY_LABELS[form.category]}</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Nama Pemasok / Supplier</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Contoh: PT United Tractors Tbk"
                    value={form.supplierName}
                    onChange={e => setForm({ ...form, supplierName: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Nama Barang / Spesifikasi Pesanan</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Contoh: 1 Set Final Drive Komatsu PC200"
                    value={form.itemName}
                    onChange={e => setForm({ ...form, itemName: e.target.value })}
                    required
                  />
                </div>

                <div className="form-row">
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
                  <div className="form-group">
                    <label className="form-label">Estimasi Tanggal Pengiriman</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.deliveryExpectedDate}
                      onChange={e => setForm({ ...form, deliveryExpectedDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Total Nilai Pembelian (IDR)</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0"
                    value={form.totalAmount || ''}
                    onChange={e => setForm({ ...form, totalAmount: Number(e.target.value) })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Catatan / Syarat Pengiriman</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="Contoh: Franco workshop, garansi resmi 12 bulan"
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Simpan Perubahan' : 'Terbitkan PO'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
