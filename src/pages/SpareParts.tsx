// src/pages/SpareParts.tsx - Modul Manajemen Suku Cadang & Komponen FATHONI EQUIPMENT OS

import { useEffect, useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { usePagedCollection } from '../hooks/usePagedCollection';
import Pager from '../components/Pager';

/** Bentuk record suku cadang seperti yang tersimpan di database. */
interface SparePartRow {
  id: string;
  name: string;
  sku: string;
  category?: string;
  compatibleBrands?: string;
  rackLocation?: string;
  stock: number;
  minStock: number;
  unit: string;
  price: number;
  sellingPrice?: number;
  [key: string]: any;
}

const EMPTY_FORM = {
  partNumber: '',
  name: '',
  category: '',
  compatibleBrands: '',
  stock: 0,
  minStock: 5,
  unit: 'Pcs',
  purchasePrice: 0,
  sellingPrice: 0,
  rackLocation: '',
};

/** Isian formulir menjadi record. Semua field ikut disimpan — kategori, merek
 *  yang cocok, rak, dan harga jual dulu hilang begitu saja saat disimpan. */
function toRow(base: SparePartRow | undefined, f: typeof EMPTY_FORM, id: string): SparePartRow {
  return {
    ...(base || ({} as SparePartRow)),
    id,
    name: f.name,
    sku: f.partNumber,
    category: f.category,
    compatibleBrands: f.compatibleBrands,
    rackLocation: f.rackLocation,
    stock: Number(f.stock) || 0,
    minStock: Number(f.minStock) || 0,
    unit: f.unit,
    price: Number(f.purchasePrice) || 0,
    sellingPrice: Number(f.sellingPrice) || 0,
  };
}

/** Record menjadi isian formulir. Data lama yang tidak punya kategori dibiarkan
 *  kosong, tidak dikarang 'FILTER' supaya tabel terlihat terisi. */
function toForm(row: SparePartRow): typeof EMPTY_FORM {
  return {
    partNumber: row.sku || '',
    name: row.name || '',
    category: row.category || '',
    compatibleBrands: row.compatibleBrands || '',
    stock: Number(row.stock) || 0,
    minStock: Number(row.minStock) || 0,
    unit: row.unit || 'Pcs',
    purchasePrice: Number(row.price) || 0,
    sellingPrice: Number(row.sellingPrice) || 0,
    rackLocation: row.rackLocation || '',
  };
}

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

const PAGE_SIZE = 25;

export default function SpareParts() {
  const { spareParts: data, saveRow, removeRow, savedTick } = useDataStore();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState(EMPTY_FORM);
  // Baris yang disunting dipegang utuh, bukan hanya id-nya: satu tulis hanya
  // perlu satu baris, dan field yang tidak ada di formulir ikut terbawa.
  const [editing, setEditing] = useState<SparePartRow | null>(null);

  const paged = usePagedCollection<SparePartRow>({
    collection: 'spareParts',
    search,
    where: catFilter === 'ALL' ? undefined : { category: catFilter },
    sort: 'sku',
    pageSize: PAGE_SIZE,
    page,
    localRows: data,
    localFields: item => [item.sku, item.name, item.compatibleBrands, item.rackLocation],
    revision: savedTick.spareParts,
  });

  useEffect(() => { setPage(0); }, [search, catFilter]);
  useEffect(() => {
    if (page > 0 && page >= paged.pages) setPage(paged.pages - 1);
  }, [page, paged.pages]);

  // Satu tulis = satu baris: tidak ada penggabungan array penuh lagi, jadi
  // halaman ini tidak bisa ikut menimpa baris yang tidak sedang dilihatnya.
  const commit = async (row: SparePartRow) => {
    await saveRow('spareParts', row);
    paged.refresh();
  };

  const drop = async (id: string) => {
    const hasil = await removeRow('spareParts', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
      return;
    }
    paged.refresh();
  };

  // Dua angka ini belum bisa dihitung SQLite: nilainya perkalian dua kolom dan
  // "stok di bawah minimum" membandingkan dua kolom, bukan kesamaan nilai.
  const totalInventoryValue = data.reduce((acc, i) => acc + (Number(i.stock) || 0) * (Number(i.price) || 0), 0);
  const lowStockItems = data.filter(i => (Number(i.stock) || 0) <= (Number(i.minStock) || 0)).length;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.partNumber || !form.name) {
      alert('Isi part number dan nama suku cadang');
      return;
    }

    if (editing) {
      commit(toRow(editing, form, editing.id));
    } else {
      commit(toRow(undefined, form, Date.now().toString()));
    }
    setShowModal(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleEdit = (item: SparePartRow) => {
    setEditing(item);
    setForm(toForm(item));
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Hapus data suku cadang ini?')) drop(id);
  };

  const handleAdjustStock = (item: SparePartRow, delta: number) => {
    commit({ ...item, stock: Math.max(0, (Number(item.stock) || 0) + delta) });
  };

  const openCreateModal = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Suku Cadang & Spare Parts</h1>
          <p className="page-subtitle">Katalog suku cadang alat berat multi-brand, stok opname, lokasi rak gudang, dan peringatan restock</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Tambah Spare Part
          </button>
        </div>
      </div>

      <div className="grid-3 mb-4">
        <div className="card stat-card">
          <div className="card-title">Total Nilai Persediaan</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{fmt(totalInventoryValue)}</div>
          <div className="card-sub">Modal Fisik Spare Parts di Gudang</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Stok Rendah (Restock Alert)</div>
          <div className="card-value" style={{ color: lowStockItems > 0 ? 'var(--status-out)' : 'var(--text-primary)' }}>
            {lowStockItems} Part
          </div>
          <div className="card-sub">Stok Kurang dari Batas Minimum</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Katalog Suku Cadang</div>
          <div className="card-value" style={{ color: 'var(--accent-blue)' }}>{data.length} SKU</div>
          <div className="card-sub">Item Terdaftar di Sistem</div>
        </div>
      </div>

      <div className="card mb-4" style={{ padding: '14px 20px', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Kategori:</span>
          {['ALL', 'FILTER', 'UNDERCARRIAGE', 'HYDRAULIC', 'ENGINE', 'ELECTRICAL'].map(c => (
            <button
              key={c}
              className={`btn btn-sm ${catFilter === c ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setCatFilter(c)}
            >
              {c === 'ALL' ? 'Semua' : c}
            </button>
          ))}
        </div>

        <div className="topbar-search" style={{ width: 280 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            id="spareparts-search"
            type="text"
            placeholder="Cari part number, nama part, rak..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrapper" id="spareparts-table">
        <table>
          <thead>
            <tr>
              <th>Part Number</th>
              <th>Nama Komponen / Kompatibilitas</th>
              <th>Kategori</th>
              <th>Lokasi Rak</th>
              <th style={{ textAlign: 'center' }}>Stok Gudang</th>
              <th style={{ textAlign: 'right' }}>Harga Beli</th>
              <th style={{ textAlign: 'right' }}>Harga Jual</th>
              <th style={{ textAlign: 'center' }}>Aksi / Sesuaikan</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                  {paged.loading ? 'Mengambil data...' : 'Tidak ada sparepart yang sesuai pencarian.'}
                </td>
              </tr>
            ) : (
              paged.rows.map(item => {
                const isLow = (Number(item.stock) || 0) <= (Number(item.minStock) || 0);
                return (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                        {item.sku || '—'}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Kompatibel: {item.compatibleBrands || 'belum diisi'}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-muted">{item.category || '—'}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, fontFamily: 'monospace', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                        🏷️ {item.rackLocation || '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: isLow ? 'var(--status-out)' : 'var(--text-primary)' }}>
                        {item.stock} {item.unit}
                      </div>
                      {isLow && (
                        <div style={{ fontSize: 10, color: 'var(--status-out)', fontWeight: 700 }}>
                          ⚠️ Min: {item.minStock}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(Number(item.price) || 0)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--status-operating)' }}>
                      {item.sellingPrice ? fmt(Number(item.sellingPrice)) : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button
                          className="btn btn-sm btn-secondary"
                          title="Tambah 1 Stok"
                          onClick={() => handleAdjustStock(item, 1)}
                        >
                          +1
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          title="Kurangi 1 Stok"
                          onClick={() => handleAdjustStock(item, -1)}
                        >
                          -1
                        </button>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(item)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(item.id)}>Hapus</button>
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

      {/* Modal Tambah Part */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Edit Data Suku Cadang' : 'Tambah Data Suku Cadang'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Part Number</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Contoh: 6736-51-5142"
                      value={form.partNumber}
                      onChange={e => setForm({ ...form, partNumber: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Kategori Komponen</label>
                    <select
                      className="form-select"
                      value={form.category}
                      onChange={e => setForm({ ...form, category: e.target.value })}
                    >
                      <option value="">Belum dikategorikan</option>
                      <option value="FILTER">Filter & Saringan</option>
                      <option value="UNDERCARRIAGE">Undercarriage (Track/Roller)</option>
                      <option value="HYDRAULIC">Hydraulic Component</option>
                      <option value="ENGINE">Engine & Transmission</option>
                      <option value="ELECTRICAL">Electrical & Starter</option>
                      <option value="ATTACHMENT">Bucket, Teeth & Breaker</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Nama Suku Cadang</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Fuel Filter Cartridge"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Model Kompatibel / Brand</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Komatsu PC200-8, SANY SY215C"
                    value={form.compatibleBrands}
                    onChange={e => setForm({ ...form, compatibleBrands: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Stok Awal</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.stock}
                      onChange={e => setForm({ ...form, stock: Number(e.target.value) })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Batas Min. Stok</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.minStock}
                      onChange={e => setForm({ ...form, minStock: Number(e.target.value) })}
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
                    <label className="form-label">Harga Beli Modal (IDR)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.purchasePrice || ''}
                      onChange={e => setForm({ ...form, purchasePrice: Number(e.target.value) })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Harga Jual (IDR)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={form.sellingPrice || ''}
                      onChange={e => setForm({ ...form, sellingPrice: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Lokasi Rak / Bin Gudang</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Contoh: A1-02-04"
                    value={form.rackLocation}
                    onChange={e => setForm({ ...form, rackLocation: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Simpan Perubahan' : 'Simpan Spare Part'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
