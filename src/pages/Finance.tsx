// src/pages/Finance.tsx - Modul Kas & Bank FATHONI EQUIPMENT OS

import { useEffect, useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { usePagedCollection } from '../hooks/usePagedCollection';
import { useCollectionSum } from '../hooks/useCollectionTotals';
import Pager from '../components/Pager';
import { type TransaksiKas, type TipeTransaksi, type KategoriKas } from '../data/demoTransactions';

const PAGE_SIZE = 25;

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

const BADGE_KATEGORI: Record<KategoriKas, string> = {
  PENJUALAN: 'badge-success',
  RENTAL: 'badge-info',
  SERVICE: 'badge-warning',
  PEMBELIAN: 'badge-danger',
  OPERASIONAL: 'badge-muted',
  GAJI: 'badge-muted',
  LAINNYA: 'badge-muted',
};

export default function Finance() {
  const { kas: data, bankAccounts, saveRow, removeRow, savedTick } = useDataStore();
  const [search, setSearch] = useState('');
  const [tipeFilter, setTipeFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(0);
  
  // Generate rekening list from bank accounts
  const REKENING_LIST = bankAccounts && bankAccounts.length > 0 
    ? bankAccounts.filter((acc: any) => acc.isActive).map((acc: any) => `${acc.namaBank} - ${acc.nomorRekening}`)
    : ['BCA - 1234567890', 'Mandiri - 0987654321', 'BNI - 1122334455', 'Kas Tunai'];
  
  const [form, setForm] = useState({
    tanggal: new Date().toISOString().split('T')[0],
    keterangan: '',
    kategori: 'LAINNYA' as KategoriKas,
    tipe: 'MASUK' as TipeTransaksi,
    jumlah: 0,
    rekening: REKENING_LIST[0],
    referensi: '',
  });
  const [editing, setEditing] = useState<TransaksiKas | null>(null);

  const paged = usePagedCollection<TransaksiKas>({
    collection: 'kas',
    search,
    where: tipeFilter === 'ALL' ? undefined : { tipe: tipeFilter },
    sort: 'tanggal',
    desc: true,
    pageSize: PAGE_SIZE,
    page,
    localRows: data,
    localFields: item => [item.keterangan, item.referensi, item.rekening],
    revision: savedTick.kas,
  });

  useEffect(() => { setPage(0); }, [search, tipeFilter]);
  useEffect(() => {
    if (page > 0 && page >= paged.pages) setPage(paged.pages - 1);
  }, [page, paged.pages]);

  // Saldo dihitung oleh SQLite, bukan dengan menjumlah seluruh transaksi di
  // renderer — kartu KPI tetap ringan walau arus kas bertambah terus.
  const totalMasuk = useCollectionSum('kas', 'jumlah', { tipe: 'MASUK' }, data, savedTick.kas);
  const totalKeluar = useCollectionSum('kas', 'jumlah', { tipe: 'KELUAR' }, data, savedTick.kas);
  const saldo = totalMasuk - totalKeluar;

  // Tulis lalu ambil halaman itu lagi dari file: tanpa simpanan langsung, hasil
  // edit baru terlihat setelah debounce dan halaman pertama justru menampilkan
  // data lama. Satu tulis = satu baris arus kas.
  const commit = async (row: TransaksiKas) => {
    await saveRow('kas', row);
    paged.refresh();
  };

  const drop = async (id: string) => {
    const hasil = await removeRow('kas', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
      return;
    }
    paged.refresh();
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.keterangan || form.jumlah <= 0) {
      alert('Isi keterangan transaksi dan jumlah dengan benar');
      return;
    }
    
    if (editing) {
      commit({ ...editing, ...form, jumlah: Number(form.jumlah) });
    } else {
      commit({
        id: Date.now().toString(),
        ...form,
        jumlah: Number(form.jumlah),
      });
    }
    setShowModal(false);
    setEditing(null);
    setForm({ tanggal: new Date().toISOString().split('T')[0], keterangan: '', kategori: 'LAINNYA', tipe: 'MASUK', jumlah: 0, rekening: REKENING_LIST[0], referensi: '' });
  };

  const handleEdit = (item: TransaksiKas) => {
    setEditing(item);
    setForm({ tanggal: item.tanggal, keterangan: item.keterangan, kategori: item.kategori, tipe: item.tipe, jumlah: item.jumlah, rekening: item.rekening, referensi: item.referensi });
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Hapus transaksi ini? Data saldo akan otomatis disesuaikan.')) {
      drop(id);
    }
  };

  const openCreateModal = () => {
    setEditing(null);
    const currentRekeningList = bankAccounts && bankAccounts.length > 0 
      ? bankAccounts.filter((acc: any) => acc.isActive).map((acc: any) => `${acc.namaBank} - ${acc.nomorRekening}`)
      : ['BCA - 1234567890', 'Mandiri - 0987654321', 'BNI - 1122334455', 'Kas Tunai'];
    setForm({ tanggal: new Date().toISOString().split('T')[0], keterangan: '', kategori: 'LAINNYA', tipe: 'MASUK', jumlah: 0, rekening: currentRekeningList[0], referensi: '' });
    setShowModal(true);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Kas & Bank</h1>
          <p className="page-subtitle">Pencatatan arus kas masuk/keluar, mutasi rekening, dan saldo keuangan perusahaan</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openCreateModal}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Catat Transaksi
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid-3 mb-4">
        <div className="card stat-card">
          <div className="card-title">Total Kas Masuk</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{fmt(totalMasuk)}</div>
          <div className="card-sub">Penerimaan Bulan Ini</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Total Kas Keluar</div>
          <div className="card-value" style={{ color: 'var(--status-out)' }}>{fmt(totalKeluar)}</div>
          <div className="card-sub">Pengeluaran Bulan Ini</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Saldo Bersih</div>
          <div className="card-value" style={{ color: saldo >= 0 ? 'var(--accent-blue)' : 'var(--status-out)' }}>{fmt(saldo)}</div>
          <div className="card-sub">Selisih Masuk vs Keluar</div>
        </div>
      </div>

      {/* Filter */}
      <div className="card mb-4" style={{ padding: '14px 20px', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Tipe:</span>
          {[
            { key: 'ALL', label: 'Semua' },
            { key: 'MASUK', label: '⬆ Kas Masuk' },
            { key: 'KELUAR', label: '⬇ Kas Keluar' },
          ].map(t => (
            <button key={t.key} className={`btn btn-sm ${tipeFilter === t.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTipeFilter(t.key)}>{t.label}</button>
          ))}
        </div>
        <div className="topbar-search" style={{ width: 280 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input id="finance-search" type="text" placeholder="Cari keterangan, referensi, rekening..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Tabel */}
      <div className="table-wrapper" id="finance-table">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Keterangan</th>
              <th>Kategori</th>
              <th>Rekening</th>
              <th>Referensi</th>
              <th style={{ textAlign: 'right' }}>Kas Masuk</th>
              <th style={{ textAlign: 'right' }}>Kas Keluar</th>
              <th style={{ textAlign: 'center', width: 120 }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>{paged.loading ? 'Mengambil data...' : 'Tidak ada transaksi yang sesuai.'}</td></tr>
            ) : paged.rows.map(item => (
              <tr key={item.id}>
                <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{item.tanggal}</td>
                <td>
                  <div style={{ fontWeight: 600, maxWidth: 300 }}>{item.keterangan}</div>
                </td>
                <td>
                  <span className={`badge ${BADGE_KATEGORI[item.kategori as KategoriKas]}`}>{item.kategori}</span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.rekening}</td>
                <td><span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--accent-blue)' }}>{item.referensi}</span></td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--status-operating)' }}>
                  {item.tipe === 'MASUK' ? fmt(item.jumlah) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--status-out)' }}>
                  {item.tipe === 'KELUAR' ? fmt(item.jumlah) : '—'}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(item)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(item.id)}>Hapus</button>
                  </div>
                </td>
              </tr>
            ))}
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

      {/* Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Edit Transaksi Kas' : 'Catat Transaksi Kas'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Tipe Transaksi</label>
                    <select className="form-select" value={form.tipe} onChange={e => setForm({ ...form, tipe: e.target.value as TipeTransaksi })}>
                      <option value="MASUK">⬆ Kas Masuk (Penerimaan)</option>
                      <option value="KELUAR">⬇ Kas Keluar (Pengeluaran)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tanggal Transaksi</label>
                    <input type="date" className="form-input" value={form.tanggal} onChange={e => setForm({ ...form, tanggal: e.target.value })} required />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Keterangan</label>
                  <input type="text" className="form-input" placeholder="Contoh: Penerimaan rental PC200 bulan Maret" value={form.keterangan} onChange={e => setForm({ ...form, keterangan: e.target.value })} required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Kategori</label>
                    <select className="form-select" value={form.kategori} onChange={e => setForm({ ...form, kategori: e.target.value as KategoriKas })}>
                      <option value="PENJUALAN">Penjualan Unit</option>
                      <option value="RENTAL">Rental Alat</option>
                      <option value="SERVICE">Jasa Service</option>
                      <option value="PEMBELIAN">Pembelian / PO</option>
                      <option value="OPERASIONAL">Biaya Operasional</option>
                      <option value="GAJI">Gaji & Tunjangan</option>
                      <option value="LAINNYA">Lainnya</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rekening / Kas</label>
                    <select className="form-select" value={form.rekening} onChange={e => setForm({ ...form, rekening: e.target.value })}>
                      {bankAccounts && bankAccounts.length > 0 
                        ? bankAccounts.filter((acc: any) => acc.isActive).map((acc: any) => (
                          <option key={acc.id} value={`${acc.namaBank} - ${acc.nomorRekening}`}>
                            {acc.namaBank} - {acc.nomorRekening}
                          </option>
                        ))
                        : REKENING_LIST.map(r => <option key={r} value={r}>{r}</option>)
                      }
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Jumlah (IDR)</label>
                    <input type="number" className="form-input" placeholder="0" value={form.jumlah || ''} onChange={e => setForm({ ...form, jumlah: Number(e.target.value) })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nomor Referensi (SPK/PO/INV)</label>
                    <input type="text" className="form-input" placeholder="INV-2026-XXX" value={form.referensi} onChange={e => setForm({ ...form, referensi: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Simpan Perubahan' : 'Simpan Transaksi'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
