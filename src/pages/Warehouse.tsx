// src/pages/Warehouse.tsx - Modul Manajemen Gudang & Logistik FATHONI EQUIPMENT OS
// PERBAIKAN: Migrasi dari useLocalStorage ke useDataStore (data terpusat)
// Fase 4: daftar dibacanya berpaginasi lewat SQLite (pencarian + filter tipe di
// sisi SQL), dan simpanan satu mutasi dikirim sebagai patch baris, bukan seluruh
// tabel. Mutasi gudang bisa mencapai puluhan ribu baris — memuat semuanya ke
// halaman ini adalah salah satu sumber aplikasi terasa berat.

import { useEffect, useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { usePagedCollection } from '../hooks/usePagedCollection';
import { useCollectionCount } from '../hooks/useCollectionTotals';
import Pager from '../components/Pager';

interface WarehouseMutation {
  id: string;
  trxNo: string;
  type: 'INBOUND' | 'OUTBOUND' | 'TRANSFER';
  warehouseName: string;
  itemDescription: string;
  qty: number;
  unit: string;
  referenceDoc: string;
  date: string;
  pic: string;
  notes: string;
}


const WAREHOUSE_LOCATIONS = [
  { name: 'Yard Cikande Main Hub (Banten)', capacity: '60 Unit Heavy Equipment', pic: 'Rudi Hermawan' },
  { name: 'Gudang Pusat Spare Parts (Jakarta)', capacity: '3.500 SKU Suku Cadang', pic: 'Bambang Irawan' },
  { name: 'Pool & Workshop Balikpapan (Kaltim)', capacity: '25 Unit & Fast Moving Parts', pic: 'Danu Prasetyo' },
  { name: 'Depot Surabaya (Jawa Timur)', capacity: '15 Unit Logistik Armada', pic: 'Suhartono' },
];

const TYPE_CONFIG = {
  INBOUND: { label: 'Barang Masuk', badge: 'badge-success' },
  OUTBOUND: { label: 'Barang Keluar', badge: 'badge-danger' },
  TRANSFER: { label: 'Mutasi Antar Gudang', badge: 'badge-info' },
};

const PAGE_SIZE = 25;

export default function Warehouse() {
  const { warehouse: data, saveRow, removeRow, savedTick } = useDataStore();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  // Nomor transaksi mengikuti jumlah baris di FILE. `data.length` bukan dasar yang
  // benar lagi: rute gudang tidak memuat seluruh array ke memori (#38), jadi
  // length-nya 0 dan setiap mutasi baru ditawari nomor yang sudah dipakai.
  const jumlahMutasi = useCollectionCount('warehouse', undefined, data, savedTick.warehouse);

  const [form, setForm] = useState({
    trxNo: `TRX-${new Date().getFullYear()}-001`,
    type: 'INBOUND' as 'INBOUND' | 'OUTBOUND' | 'TRANSFER',
    warehouseName: 'Yard Cikande Main Hub',
    itemDescription: '',
    qty: 1,
    unit: 'Unit',
    referenceDoc: '',
    date: new Date().toISOString().split('T')[0],
    pic: 'Rudi Hermawan',
    notes: '',
  });
  // Baris yang disunting dipegang utuh supaya field di luar formulir tidak
  // hilang saat satu mutasi ditulis ulang.
  const [editing, setEditing] = useState<WarehouseMutation | null>(null);

  const paged = usePagedCollection<WarehouseMutation>({
    collection: 'warehouse',
    search,
    where: typeFilter === 'ALL' ? undefined : { type: typeFilter },
    sort: 'tanggal',
    desc: true,
    pageSize: PAGE_SIZE,
    page,
    localRows: data,
    localFields: item => [item.trxNo, item.itemDescription, item.warehouseName, item.referenceDoc],
    revision: savedTick.warehouse,
  });

  // Hasil menyempit (filter berubah, baris terakhir di halaman terakhir dihapus):
  // halaman tidak boleh tertinggal di luar rentang.
  useEffect(() => {
    if (page > 0 && page >= paged.pages) setPage(paged.pages - 1);
  }, [page, paged.pages]);

  useEffect(() => {
    setPage(0);
  }, [search, typeFilter]);

  // Setiap tulis dilakukan lewat sini: satu baris masuk ke store (halaman lain
  // dan dasbor membacanya dari memori) lalu langsung ke file, supaya halaman
  // yang sedang dilihat mengambil hasil yang sama dari SQLite.
  const commit = async (row: WarehouseMutation) => {
    await saveRow('warehouse', row);
    paged.refresh();
  };

  const drop = async (id: string) => {
    const hasil = await removeRow('warehouse', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
      return;
    }
    paged.refresh();
  };

  /** Bentuk record dari isian formulir; field di luar formulir ikut terbawa. */
  const toRow = (base: WarehouseMutation | null, id: string): WarehouseMutation => ({
    ...(base || ({} as WarehouseMutation)),
    id,
    trxNo: form.trxNo,
    type: form.type,
    warehouseName: form.warehouseName,
    itemDescription: form.itemDescription,
    qty: Number(form.qty),
    unit: form.unit,
    referenceDoc: form.referenceDoc || 'NON-REF',
    date: form.date,
    pic: form.pic,
    notes: form.notes,
  });

  /** Saran nomor transaksi berikutnya. Hanya label dan masih bisa diedit sebelum
   *  simpan, tapi dasarnya harus jumlah baris di file agar tidak menawar ulang
   *  nomor yang sudah dipakai mutasi lama. */
  const nomorTrx = (n: number) =>
    `TRX-${new Date().getFullYear()}-${String(Math.max(1, n)).padStart(3, '0')}`;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.itemDescription) {
      alert('Isi deskripsi barang/unit yang dimutasi');
      return;
    }

    await commit(editing ? toRow(editing, editing.id) : toRow(null, Date.now().toString()));
    setShowModal(false);
    setEditing(null);
    setForm({ trxNo: nomorTrx(jumlahMutasi + 2), type: 'INBOUND', warehouseName: 'Yard Cikande Main Hub', itemDescription: '', qty: 1, unit: 'Unit', referenceDoc: '', date: new Date().toISOString().split('T')[0], pic: 'Rudi Hermawan', notes: '' });
  };

  const handleEdit = (item: WarehouseMutation) => {
    setEditing(item);
    setForm({ trxNo: item.trxNo, type: item.type, warehouseName: item.warehouseName, itemDescription: item.itemDescription, qty: item.qty, unit: item.unit, referenceDoc: item.referenceDoc, date: item.date, pic: item.pic, notes: item.notes });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Hapus data mutasi gudang ini?')) await drop(id);
  };

  const openCreateModal = () => {
    setEditing(null);
    setForm({ trxNo: nomorTrx(jumlahMutasi + 1), type: 'INBOUND', warehouseName: 'Yard Cikande Main Hub', itemDescription: '', qty: 1, unit: 'Unit', referenceDoc: '', date: new Date().toISOString().split('T')[0], pic: 'Rudi Hermawan', notes: '' });
    setShowModal(true);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Gudang & Lokasi Armada (Yard)</h1>
          <p className="page-subtitle">Pencatatan mutasi barang masuk/keluar, transfer logistik, dan pengelolaan yard alat berat</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Catat Mutasi Stok
          </button>
        </div>
      </div>

      {/* Daftar Lokasi Gudang / Yard */}
      <div className="grid-4 mb-4">
        {WAREHOUSE_LOCATIONS.map((loc, idx) => (
          <div key={idx} className="card stat-card">
            <div style={{ fontSize: 24, marginBottom: 8 }}>🏢</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{loc.name}</div>
            <div style={{ fontSize: 12, color: 'var(--accent-blue)', marginBottom: 4 }}>{loc.capacity}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PIC: {loc.pic}</div>
          </div>
        ))}
      </div>

      {/* Filter Toolbar */}
      <div className="card mb-4" style={{ padding: '14px 20px', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Tipe:</span>
          {['ALL', 'INBOUND', 'OUTBOUND', 'TRANSFER'].map(t => (
            <button
              key={t}
              className={`btn btn-sm ${typeFilter === t ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTypeFilter(t)}
            >
              {t === 'ALL' ? 'Semua' : TYPE_CONFIG[t as keyof typeof TYPE_CONFIG]?.label ?? t}
            </button>
          ))}
        </div>

        <div className="topbar-search" style={{ width: 280 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            id="warehouse-search"
            type="text"
            placeholder="Cari transaksi, barang, gudang..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Tabel Mutasi */}
      <div className="table-wrapper" id="warehouse-table">
        <table>
          <thead>
            <tr>
              <th>No. Bukti / Tanggal</th>
              <th>Tipe Mutasi</th>
              <th>Lokasi Gudang / Yard</th>
              <th>Deskripsi Barang / Unit</th>
              <th>Jumlah</th>
              <th>Dokumen Referensi</th>
              <th>Petugas (PIC)</th>
              <th style={{ textAlign: 'center' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                  {paged.loading ? 'Mengambil data...' : 'Belum ada rekaman mutasi gudang.'}
                </td>
              </tr>
            ) : (
              paged.rows.map(item => (
                <tr key={item.id}>
                  <td>
                    <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{item.trxNo}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.date}</div>
                  </td>
                  <td>
                    <span className={`badge ${TYPE_CONFIG[item.type as keyof typeof TYPE_CONFIG]?.badge}`}>
                      {TYPE_CONFIG[item.type as keyof typeof TYPE_CONFIG]?.label}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.warehouseName}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.itemDescription}</div>
                    {item.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.notes}</div>}
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {item.type === 'OUTBOUND' ? `-${item.qty}` : `+${item.qty}`} {item.unit}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--accent-blue)' }}>
                      {item.referenceDoc}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{item.pic}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleEdit(item)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => alert(`Bukti Serah Terima Mutasi ${item.trxNo}`)}
                    >
                      Cetak Bukti
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(item.id)}
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Batas halaman: isi tabel bisa puluhan ribu mutasi, dan hanya satu
          halaman yang diambil dari database. */}
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

      {/* Modal Mutasi */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Edit Data Mutasi' : 'Catat Mutasi Masuk / Keluar Gudang'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">No. Bukti Mutasi</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.trxNo}
                      onChange={e => setForm({ ...form, trxNo: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Jenis Mutasi</label>
                    <select
                      className="form-select"
                      value={form.type}
                      onChange={e => setForm({ ...form, type: e.target.value as any })}
                    >
                      <option value="INBOUND">Barang Masuk (Inbound / Penerimaan)</option>
                      <option value="OUTBOUND">Barang Keluar (Outbound / Pemakaian)</option>
                      <option value="TRANSFER">Transfer Antar Yard / Gudang</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Lokasi Gudang / Yard</label>
                  <select
                    className="form-select"
                    value={form.warehouseName}
                    onChange={e => setForm({ ...form, warehouseName: e.target.value })}
                  >
                    {WAREHOUSE_LOCATIONS.map((loc, i) => (
                      <option key={i} value={loc.name}>{loc.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Nama Barang / Unit Alat Berat</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Contoh: 1 Unit Excavator SANY SY215C"
                    value={form.itemDescription}
                    onChange={e => setForm({ ...form, itemDescription: e.target.value })}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Kuantitas / Jumlah</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.qty}
                      onChange={e => setForm({ ...form, qty: Number(e.target.value) })}
                      required
                      min={1}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Satuan</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.unit}
                      onChange={e => setForm({ ...form, unit: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">No. Dokumen Referensi (PO/WO/SPK)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="PO-2026-001"
                      value={form.referenceDoc}
                      onChange={e => setForm({ ...form, referenceDoc: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nama Petugas (PIC)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.pic}
                      onChange={e => setForm({ ...form, pic: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Keterangan Tambahan</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Catatan kondisi fisik saat serah terima..."
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Simpan Perubahan' : 'Simpan Mutasi'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
