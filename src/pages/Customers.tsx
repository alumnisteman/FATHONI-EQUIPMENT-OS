// src/pages/Customers.tsx - Modul Manajemen Pelanggan
// PERBAIKAN: Migrasi dari useLocalStorage ke useDataStore (data terpusat)

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import type { Customer } from '../types';
import { matchesQuery } from '../utils/searchMatch';

export const DEMO_CUSTOMERS: Customer[] = [
  { id:'1', name:'PT Tambang Nusa Persada',  phone:'021-5550111', email:'procurement@tambang.co.id', address:'Jakarta Selatan', npwp:'12.345.678.9-001.000', pic:'Bapak Rahmat', createdAt:'2024-01-10', updatedAt:'2024-06-01' },
  { id:'2', name:'CV Maju Jaya Konstruksi',  phone:'0811-2345678', email:'cv.majujaya@gmail.com',    address:'Bandung',         npwp:'', pic:'Ibu Sari',    createdAt:'2024-02-14', updatedAt:'2024-05-20' },
  { id:'3', name:'PT Infrastruktur Mandiri', phone:'031-7890123', email:'infra.mandiri@corp.com',    address:'Surabaya',        npwp:'98.765.432.1-002.000', pic:'Bapak Doni', createdAt:'2024-03-01', updatedAt:'2024-06-10' },
  { id:'4', name:'Dinas PU Kaltim',         phone:'0541-123456', email:'pukaltim@pemerintah.go.id', address:'Samarinda',       npwp:'', pic:'Bu Kasi',      createdAt:'2024-04-05', updatedAt:'2024-06-05' },
];

export default function Customers() {
  const { customers: data, setCustomers: setData, removeRow } = useDataStore();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name:'', phone:'', email:'', address:'', npwp:'', pic:'' });

  const filtered = data.filter(c =>
    matchesQuery([c.name, c.phone, c.email], search)
  );

  const openAdd = () => { setEditing(null); setForm({ name:'',phone:'',email:'',address:'',npwp:'',pic:'' }); setShowForm(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm({ name:c.name, phone:c.phone||'', email:c.email||'', address:c.address||'', npwp:c.npwp||'', pic:c.pic||'' }); setShowForm(true); };

  const save = () => {
    if (!form.name.trim()) return;
    if (editing) {
      setData(d => d.map(c => c.id === editing.id ? { ...c, ...form, updatedAt: new Date().toISOString() } : c));
    } else {
      setData(d => [...d, { id: Date.now().toString(), ...form, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
    }
    setShowForm(false);
  };

  // Lewat removeRow, bukan filter array: pelanggan yang masih disebut SPK,
  // kontrak rental, invoice, atau surat jalan harus ditahan sebelum hapusnya,
  // dan salinan memori store ikut disesuaikan oleh store itu sendiri.
  const del = async (id: string) => {
    if (!confirm('Hapus pelanggan ini?')) return;
    const hasil = await removeRow('customers', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
      return;
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Pelanggan</h1>
          <p className="page-subtitle">Kelola data pelanggan dan riwayat transaksi</p>
        </div>
        <div className="page-header-actions">
          <div className="topbar-search" style={{ width:220 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input type="text" placeholder="Cari pelanggan..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button id="btn-add-customer" className="btn btn-primary" onClick={openAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}><path d="M12 5v14M5 12h14"/></svg>
            Tambah Pelanggan
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nama Pelanggan</th>
              <th>PIC</th>
              <th>Telepon</th>
              <th>Email</th>
              <th>Kota</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--text-muted)', padding:32 }}>Tidak ada data pelanggan</td></tr>
            )}
            {filtered.map(c => (
              <tr key={c.id}>
                <td><div style={{ fontWeight:600 }}>{c.name}</div>{c.npwp && <div style={{ fontSize:11, color:'var(--text-muted)' }}>NPWP: {c.npwp}</div>}</td>
                <td style={{ color:'var(--text-secondary)' }}>{c.pic || '—'}</td>
                <td style={{ fontFamily:'monospace', fontSize:12 }}>{c.phone || '—'}</td>
                <td style={{ fontSize:12, color:'var(--accent-blue)' }}>{c.email || '—'}</td>
                <td>{c.address || '—'}</td>
                <td>
                  <div style={{ display:'flex', gap:6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>Edit</button>
                    <button className="btn btn-sm" style={{ background:'rgba(239,68,68,0.1)', color:'var(--status-out)', border:'1px solid rgba(239,68,68,0.2)' }} onClick={() => del(c.id)}>Hapus</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editing ? 'Edit Pelanggan' : 'Tambah Pelanggan Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowForm(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label className="form-label">Nama Perusahaan *</label><input className="form-input" value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="PT. ..." /></div>
                <div className="form-group"><label className="form-label">PIC</label><input className="form-input" value={form.pic} onChange={e => setForm(f=>({...f,pic:e.target.value}))} placeholder="Nama kontak" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Telepon</label><input className="form-input" value={form.phone} onChange={e => setForm(f=>({...f,phone:e.target.value}))} placeholder="021-..." /></div>
                <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e => setForm(f=>({...f,email:e.target.value}))} placeholder="email@..." /></div>
              </div>
              <div className="form-group"><label className="form-label">Alamat</label><input className="form-input" value={form.address} onChange={e => setForm(f=>({...f,address:e.target.value}))} placeholder="Kota / Provinsi" /></div>
              <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={form.npwp} onChange={e => setForm(f=>({...f,npwp:e.target.value}))} placeholder="12.345.678.9-..." /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Batal</button>
              <button className="btn btn-primary" onClick={save}>Simpan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
