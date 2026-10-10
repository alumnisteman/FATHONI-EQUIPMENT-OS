// src/pages/Invoices.tsx - Modul Invoice & Penagihan FATHONI EQUIPMENT OS

import { useEffect, useState } from 'react';
import type { PaymentStatus } from '../types';
import type { KategoriKas } from '../data/demoTransactions';
import { useDataStore } from '../store/dataStore';
import { usePagedCollection } from '../hooks/usePagedCollection';
import { useCollectionSum, useCollectionCount } from '../hooks/useCollectionTotals';
import Pager from '../components/Pager';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { validateAmount } from '../utils/validation';

interface InvoiceItem {
  id: string;
  invoiceNo: string;
  customerName: string;
  unitOrDesc: string;
  type: 'PENJUALAN' | 'RENTAL' | 'SERVICE' | 'SPAREPART';
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  status: PaymentStatus;
}

export const DEMO_INVOICES: InvoiceItem[] = [
  {
    id: '1',
    invoiceNo: 'INV-2026-001',
    customerName: 'PT Tambang Nusa Persada',
    unitOrDesc: 'Rental Komatsu PC200-8 (Bulan Jan 2026)',
    type: 'RENTAL',
    issueDate: '2026-01-05',
    dueDate: '2026-02-05',
    totalAmount: 95_000_000,
    paidAmount: 95_000_000,
    status: 'PAID',
  },
  {
    id: '2',
    invoiceNo: 'INV-2026-002',
    customerName: 'CV Maju Jaya Konstruksi',
    unitOrDesc: 'Penjualan SANY SY215C (Termin 1 - DP)',
    type: 'PENJUALAN',
    issueDate: '2026-01-18',
    dueDate: '2026-02-18',
    totalAmount: 500_000_000,
    paidAmount: 300_000_000,
    status: 'PARTIAL',
  },
  {
    id: '3',
    invoiceNo: 'INV-2026-003',
    customerName: 'PT Infrastruktur Mandiri',
    unitOrDesc: 'Overhaul Mesin & Servis Berkala CAT 320 GC',
    type: 'SERVICE',
    issueDate: '2026-02-01',
    dueDate: '2026-03-01',
    totalAmount: 48_500_000,
    paidAmount: 0,
    status: 'UNPAID',
  },
  {
    id: '4',
    invoiceNo: 'INV-2026-004',
    customerName: 'Dinas PU Kaltim',
    unitOrDesc: 'Paket Filter & Hydraulic Hose Kobelco SK200',
    type: 'SPAREPART',
    issueDate: '2025-12-10',
    dueDate: '2026-01-10',
    totalAmount: 24_200_000,
    paidAmount: 0,
    status: 'OVERDUE',
  },
  {
    id: '5',
    invoiceNo: 'INV-2026-005',
    customerName: 'PT Borneo Mineral Resources',
    unitOrDesc: 'Rental Dozer Komatsu D85ESS (Bulan Feb 2026)',
    type: 'RENTAL',
    issueDate: '2026-02-10',
    dueDate: '2026-03-10',
    totalAmount: 145_000_000,
    paidAmount: 145_000_000,
    status: 'PAID',
  },
];

const STATUS_CONFIG: Record<PaymentStatus, { label: string; badge: string }> = {
  PAID: { label: 'Lunas', badge: 'badge-success' },
  PARTIAL: { label: 'Sebagian (Cicil)', badge: 'badge-warning' },
  UNPAID: { label: 'Belum Bayar', badge: 'badge-info' },
  OVERDUE: { label: 'Jatuh Tempo', badge: 'badge-danger' },
};

const TYPE_BADGE: Record<string, string> = {
  PENJUALAN: 'var(--sany-red)',
  RENTAL: 'var(--accent-blue)',
  SERVICE: 'var(--status-maintenance)',
  SPAREPART: '#8b5cf6',
};

const PAGE_SIZE = 25;

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

// Invoice SPAREPART dicatat sebagai pendapatan PENJUALAN supaya kategori Kas tidak
// keluar dari daftar yang dikenali halaman Finance.
const KATEGORI_KAS: Record<string, KategoriKas> = {
  PENJUALAN: 'PENJUALAN',
  RENTAL: 'RENTAL',
  SERVICE: 'SERVICE',
  SPAREPART: 'PENJUALAN',
};

export default function Invoices() {
  const { invoices: data, bankAccounts, addKasEntry, saveRow, removeRow, savedTick } = useDataStore();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState<InvoiceItem | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payRekening, setPayRekening] = useState<string>('');

  // Rekening tujuan pembayaran mengikuti master Bank, bukan angka hardcode.
  const rekeningAktif = (bankAccounts || [])
    .filter((acc: any) => acc.isActive)
    .map((acc: any) => `${acc.namaBank} - ${acc.nomorRekening}`);
  const rekeningList = rekeningAktif.length > 0 ? rekeningAktif : ['Kas Tunai'];

  // Form tambah
  const [form, setForm] = useState({
    invoiceNo: `INV-2026-00${data.length + 1}`,
    customerName: '',
    unitOrDesc: '',
    type: 'RENTAL' as 'PENJUALAN' | 'RENTAL' | 'SERVICE' | 'SPAREPART',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    totalAmount: 0,
  });

  const paged = usePagedCollection<InvoiceItem>({
    collection: 'invoices',
    search,
    where: filterStatus === 'ALL' ? undefined : { status: filterStatus },
    sort: 'issueDate',
    desc: true,
    pageSize: PAGE_SIZE,
    page,
    localRows: data,
    localFields: item => [item.invoiceNo, item.customerName, item.unitOrDesc],
    revision: savedTick.invoices,
  });

  useEffect(() => { setPage(0); }, [search, filterStatus]);
  useEffect(() => {
    if (page > 0 && page >= paged.pages) setPage(paged.pages - 1);
  }, [page, paged.pages]);

  // KPI Calculations — agregasi dikerjakan SQLite, bukan dengan menelusuri
  // seluruh invoice di renderer.
  const totalBilled = useCollectionSum('invoices', 'totalAmount', undefined, data, savedTick.invoices);
  const totalPaid = useCollectionSum('invoices', 'paidAmount', undefined, data, savedTick.invoices);
  const overdueCount = useCollectionCount('invoices', { status: 'OVERDUE' }, data, savedTick.invoices);
  const totalUnpaid = totalBilled - totalPaid;

  // Simpan ke file sebelum halaman mengambil datanya lagi, supaya hasil tulis
  // langsung terlihat di halaman yang sedang dibuka. Satu tulis = satu baris.
  const commit = async (row: InvoiceItem) => {
    await saveRow('invoices', row);
    paged.refresh();
  };

  const drop = async (id: string) => {
    const hasil = await removeRow('invoices', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
      return;
    }
    paged.refresh();
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName || form.totalAmount <= 0) {
      alert('Mohon isi nama pelanggan dan nominal tagihan dengan benar');
      return;
    }

    const newItem: InvoiceItem = {
      id: Date.now().toString(),
      invoiceNo: form.invoiceNo,
      customerName: form.customerName,
      unitOrDesc: form.unitOrDesc,
      type: form.type,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      totalAmount: Number(form.totalAmount),
      paidAmount: 0,
      status: 'UNPAID',
    };

    commit(newItem);
    setShowModal(false);
    setForm({
      invoiceNo: `INV-2026-00${data.length + 2}`,
      customerName: '',
      unitOrDesc: '',
      type: 'RENTAL',
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      totalAmount: 0,
    });
  };

  const handleRecordPayment = () => {
    if (!showPayModal) return;

    const inv = showPayModal;
    const sisa = inv.totalAmount - inv.paidAmount;
    const jumlah = Number(payAmount);

    const error = validateAmount(jumlah, 1, Math.max(sisa, 1));
    if (error) {
      alert(error);
      return;
    }
    if (jumlah > sisa) {
      alert(`Pembayaran melebihi sisa tagihan ${fmt(sisa)}.`);
      return;
    }

    const newPaid = inv.paidAmount + jumlah;
    const updatedStatus: PaymentStatus = newPaid >= inv.totalAmount ? 'PAID' : 'PARTIAL';

    commit({
      ...inv,
      paidAmount: Math.min(newPaid, inv.totalAmount),
      status: updatedStatus,
    });

    // Referensi menyertakan akumulasi bayar: cicil dengan nominal berbeda masuk
    // sebagai dua entri kas, klik ganda dengan nominal sama tetap terdedup.
    addKasEntry({
      tanggal: new Date().toISOString().split('T')[0],
      keterangan: `Penerimaan Pembayaran ${inv.type} (${inv.invoiceNo}) - ${inv.customerName}`,
      kategori: KATEGORI_KAS[inv.type] || 'LAINNYA',
      tipe: 'MASUK',
      jumlah,
      rekening: payRekening || rekeningList[0],
      referensi: `${inv.invoiceNo} · Bayar ${newPaid}`,
    });

    setShowPayModal(null);
    setPayAmount(0);
  };

  const handleDelete = (id: string) => {
    if (confirm('Hapus data invoice ini?')) {
      drop(id);
    }
  };

  const handlePrintInvoice = (item: InvoiceItem) => {
    if (confirm(`Cetak Invoice ${item.invoiceNo}?`)) {
      const balance = item.totalAmount - item.paidAmount;
      const statusLabel = STATUS_CONFIG[item.status]?.label || item.status;
      const companyName = getCompanyName();
      
      const htmlContent = `
        <html><head><title>Invoice ${sanitize(item.invoiceNo)}</title><style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #111; }
          h2 { color: #C00; margin-bottom:4px; } .sub { color:#666; font-size:13px; margin-bottom:20px; }
          .header { margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #C00; }
          .company { font-size: 18px; font-weight: bold; margin-bottom: 5px; }
          table { width:100%; border-collapse:collapse; margin-top:16px; }
          th,td { border:1px solid #ccc; padding:8px 12px; text-align:left; }
          th { background:#f0f0f0; } .right { text-align:right; }
          .total-row { font-weight:bold; font-size:1.1em; background:#fff3cd; }
          .paid-row { color: green; } .bal-row { color: red; font-weight:bold; }
          .footer { margin-top:40px; display:flex; justify-content:space-between; }
          .sign { text-align:center; width:160px; } .sign-line { border-top:1px solid #111; margin-top:60px; }
          .stamp { border:3px solid #c00; color:#c00; padding:6px 14px; display:inline-block; transform:rotate(-10deg); font-weight:900; font-size:18px; margin-top:10px; }
          @media print { body { padding: 20px; } }
        </style></head><body>
        <div class="header">
          <div class="company">${sanitize(companyName)}</div>
          <h2>INVOICE / TAGIHAN</h2>
        </div>
        <div class="sub">No: <strong>${sanitize(item.invoiceNo)}</strong> &nbsp;|&nbsp; Tgl Terbit: ${item.issueDate} &nbsp;|&nbsp; Jatuh Tempo: ${item.dueDate}</div>
        <table>
          <tr><th>Pelanggan</th><td>${sanitize(item.customerName)}</td></tr>
          <tr><th>Keterangan</th><td>${sanitize(item.unitOrDesc)}</td></tr>
          <tr><th>Kategori</th><td>${sanitize(item.type)}</td></tr>
          <tr><th class="right">Total Tagihan</th><td class="right total-row">Rp ${item.totalAmount.toLocaleString('id-ID')}</td></tr>
          <tr><th class="right">Sudah Dibayar</th><td class="right paid-row">Rp ${item.paidAmount.toLocaleString('id-ID')}</td></tr>
          <tr><th class="right">Sisa Tagihan</th><td class="right bal-row">Rp ${balance.toLocaleString('id-ID')}</td></tr>
          <tr><th>Status</th><td>${sanitize(statusLabel)} ${item.status === 'PAID' ? '<span class="stamp">LUNAS</span>' : ''}</td></tr>
        </table>
        <div class="footer">
          <div class="sign"><div class="sign-line"></div><div>Pelanggan</div></div>
          <div class="sign"><div class="sign-line"></div><div>Finance/Kasir</div></div>
          <div class="sign"><div class="sign-line"></div><div>Direktur</div></div>
        </div>
      </body></html>
      `;
      printDocument(htmlContent, `Invoice ${item.invoiceNo}`);
    }
  };

  const exportCSVInvoices = () => {
    let csv = "data:text/csv;charset=utf-8,No Invoice,Tanggal,Pelanggan,Kategori,Nominal Total,Terbayar,Jatuh Tempo,Status\n";
    data.forEach(inv => {
      csv += `"${inv.invoiceNo}","${inv.issueDate}","${inv.customerName}","${inv.type}",${inv.totalAmount},${inv.paidAmount},"${inv.dueDate}","${inv.status}"\n`;
    });
    const encodedUri = encodeURI(csv);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Daftar_Invoice_FATHONI_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoice & Tagihan</h1>
          <p className="page-subtitle">Penerbitan tagihan pelanggan, pemantauan pembayaran, dan status piutang</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={exportCSVInvoices}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Ekspor CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Buat Invoice Baru
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid-4 mb-4">
        <div className="card stat-card">
          <div className="card-title">Total Ditagihkan</div>
          <div className="card-value" style={{ color: 'var(--text-primary)' }}>{fmt(totalBilled)}</div>
          <div className="card-sub">{data.length} Transaksi Terbit</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Sudah Dibayar</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{fmt(totalPaid)}</div>
          <div className="card-sub">Penerimaan Kas Masuk</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Sisa Piutang (AR)</div>
          <div className="card-value" style={{ color: 'var(--accent-blue)' }}>{fmt(totalUnpaid)}</div>
          <div className="card-sub">Menunggu Pelunasan</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Jatuh Tempo</div>
          <div className="card-value" style={{ color: 'var(--status-out)' }}>{overdueCount} Invoice</div>
          <div className="card-sub">Perlu Follow-up Tagihan</div>
        </div>
      </div>

      {/* Filter & Toolbar */}
      <div className="card mb-4" style={{ padding: '14px 20px', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status:</span>
          {['ALL', 'UNPAID', 'PARTIAL', 'PAID', 'OVERDUE'].map(st => (
            <button
              key={st}
              className={`btn btn-sm ${filterStatus === st ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterStatus(st)}
            >
              {st === 'ALL' ? 'Semua' : STATUS_CONFIG[st as PaymentStatus]?.label ?? st}
            </button>
          ))}
        </div>

        <div className="topbar-search" style={{ width: 280 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            id="invoice-search"
            type="text"
            placeholder="Cari no. invoice, pelanggan..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Tabel Data */}
      <div className="table-wrapper" id="invoice-table">
        <table>
          <thead>
            <tr>
              <th>No. Invoice</th>
              <th>Pelanggan & Keterangan</th>
              <th>Tipe</th>
              <th>Jatuh Tempo</th>
              <th style={{ textAlign: 'right' }}>Total Tagihan</th>
              <th style={{ textAlign: 'right' }}>Sisa Tagihan</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                  {paged.loading ? 'Mengambil data...' : 'Tidak ada invoice yang sesuai kriteria pencarian.'}
                </td>
              </tr>
            ) : (
              paged.rows.map(item => {
                const balance = item.totalAmount - item.paidAmount;
                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                        {item.invoiceNo}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tgl: {item.issueDate}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.customerName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.unitOrDesc}</div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '3px 7px',
                          borderRadius: 4,
                          color: '#fff',
                          background: TYPE_BADGE[item.type] || 'var(--border-default)',
                        }}
                      >
                        {item.type}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: item.status === 'OVERDUE' ? 'var(--status-out)' : 'var(--text-secondary)' }}>
                      {item.dueDate}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.totalAmount)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: balance > 0 ? 'var(--status-out)' : 'var(--status-operating)' }}>
                      {fmt(balance)}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_CONFIG[item.status as PaymentStatus].badge}`}>
                        {STATUS_CONFIG[item.status as PaymentStatus].label}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        {item.status !== 'PAID' && (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              setShowPayModal(item);
                              setPayAmount(balance);
                            }}
                          >
                            Bayar
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handlePrintInvoice(item)}
                        >
                          🖨 Cetak
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <Pager
          from={paged.from}
          to={paged.to}
          total={paged.total}
          page={page}
          pages={paged.pages}
          loading={paged.loading}
          onPage={setPage}
        />
      </div>

      {/* Modal Tambah Invoice */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">Terbitkan Invoice Baru</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Nomor Invoice</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.invoiceNo}
                      onChange={e => setForm({ ...form, invoiceNo: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipe Transaksi</label>
                    <select
                      className="form-select"
                      value={form.type}
                      onChange={e => setForm({ ...form, type: e.target.value as any })}
                    >
                      <option value="RENTAL">Rental Alat Berat</option>
                      <option value="PENJUALAN">Penjualan Unit</option>
                      <option value="SERVICE">Jasa Service & Perbaikan</option>
                      <option value="SPAREPART">Spare Parts & Komponen</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Nama Pelanggan / Perusahaan</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Contoh: PT Sumber Alam Mandiri"
                    value={form.customerName}
                    onChange={e => setForm({ ...form, customerName: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Deskripsi Pekerjaan / Unit Terkait</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Sewa Excavator Komatsu PC200 Jobsite Morowali"
                    value={form.unitOrDesc}
                    onChange={e => setForm({ ...form, unitOrDesc: e.target.value })}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Tanggal Terbit</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.issueDate}
                      onChange={e => setForm({ ...form, issueDate: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Jatuh Tempo</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.dueDate}
                      onChange={e => setForm({ ...form, dueDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Total Nominal Tagihan (IDR)</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0"
                    value={form.totalAmount || ''}
                    onChange={e => setForm({ ...form, totalAmount: Number(e.target.value) })}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">Terbitkan Invoice</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Catat Pembayaran */}
      {showPayModal && (
        <div className="modal-backdrop" onClick={() => setShowPayModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <span className="modal-title">Catat Penerimaan Pembayaran</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowPayModal(null)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nomor Invoice:</div>
                <div style={{ fontWeight: 700 }}>{showPayModal.invoiceNo} — {showPayModal.customerName}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 13 }}>
                  <span>Total Tagihan:</span>
                  <strong>{fmt(showPayModal.totalAmount)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>Sisa Belum Bayar:</span>
                  <strong style={{ color: 'var(--status-out)' }}>{fmt(showPayModal.totalAmount - showPayModal.paidAmount)}</strong>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Jumlah Pembayaran Diterima (IDR)</label>
                <input
                  type="number"
                  className="form-input"
                  value={payAmount || ''}
                  onChange={e => setPayAmount(Number(e.target.value))}
                  max={showPayModal.totalAmount - showPayModal.paidAmount}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Diterima di Rekening</label>
                <select
                  className="form-select"
                  value={payRekening || rekeningList[0]}
                  onChange={e => setPayRekening(e.target.value)}
                >
                  {rekeningList.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowPayModal(null)}>Batal</button>
              <button type="button" className="btn btn-primary" onClick={handleRecordPayment}>Simpan Pembayaran</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
