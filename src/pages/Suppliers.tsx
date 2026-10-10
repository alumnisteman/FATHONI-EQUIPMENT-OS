// src/pages/Suppliers.tsx - Modul Manajemen Pemasok
// PERBAIKAN: Migrasi dari useLocalStorage ke useDataStore (data terpusat)

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import type { Supplier } from '../types';
import { matchesQuery } from '../utils/searchMatch';

const DEMO: Supplier[] = [
  { id:'1', name:'PT Komatsu Indonesia',      contact:'Pak Hendra',  phone:'021-8887777', email:'sales@komatsu.co.id',    address:'Jakarta Timur', npwp:'11.222.333.4-001', bankName:'BCA',     bankAccount:'1234567890', createdAt:'2024-01-10', updatedAt:'2024-06-01' },
  { id:'2', name:'Trakindo Utama',            contact:'Bu Dewi',     phone:'021-9998888', email:'dewi@trakindo.co.id',    address:'Jakarta Selatan',npwp:'55.666.777.8-002', bankName:'Mandiri', bankAccount:'0987654321', createdAt:'2024-02-14', updatedAt:'2024-05-20' },
  { id:'3', name:'PT SANY Indonesia',         contact:'Pak Zhang Li', phone:'021-6665555',email:'zhang@sany.co.id',       address:'BSD City',      npwp:'99.000.111.2-003', bankName:'BNI',     bankAccount:'1122334455', createdAt:'2024-03-01', updatedAt:'2024-06-10' },
  { id:'4', name:'Hitachi Construction Indo', contact:'Pak Rudi',    phone:'0811-9876543',email:'rudi@hitachi.co.id',    address:'Bekasi',        npwp:'', bankName:'', bankAccount:'', createdAt:'2024-04-05', updatedAt:'2024-06-05' },
];

export default function Suppliers() {
  const { suppliers: data, setSuppliers: setData, removeRow } = useDataStore();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name:'', contact:'', phone:'', email:'', address:'', npwp:'', bankName:'', bankAccount:'' });

  const filtered = data.filter(s =>
    matchesQuery([s.name, s.contact], search)
  );

  const openAdd = () => { setEditing(null); setForm({ name:'',contact:'',phone:'',email:'',address:'',npwp:'',bankName:'',bankAccount:'' }); setShowForm(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setForm({ name:s.name, contact:s.contact||'', phone:s.phone||'', email:s.email||'', address:s.address||'', npwp:s.npwp||'', bankName:s.bankName||'', bankAccount:s.bankAccount||'' }); setShowForm(true); };

  const save = () => {
    if (!form.name.trim()) return;
    if (editing) {
      setData(d => d.map(s => s.id === editing.id ? { ...s, ...form, updatedAt: new Date().toISOString() } : s));
    } else {
      setData(d => [...d, { id: Date.now().toString(), ...form, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
    }
    setShowForm(false);
  };

  // Pemasok yang masih punya Purchase Order tidak boleh hilang: PO-nya akan
  // menyebut nama yang sudah tidak ada di katalog.
  const del = async (id: string) => {
    if (!confirm('Hapus pemasok ini?')) return;
    const hasil = await removeRow('suppliers', id);
    if (!hasil.ok) {
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
      return;
    }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Pemasok</h1><p className="page-subtitle">Kelola data pemasok dan informasi rekening</p></div>
        <div className="page-header-actions">
          <div className="topbar-search" style={{ width:220 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input type="text" placeholder="Cari pemasok..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={openAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}><path d="M12 5v14M5 12h14"/></svg>
            Tambah Pemasok
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr><th>Nama Pemasok</th><th>Kontak</th><th>Telepon / Email</th><th>Rekening Bank</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={5} style={{ textAlign:'center', color:'var(--text-muted)', padding:32 }}>Tidak ada data</td></tr>}
            {filtered.map(s => (
              <tr key={s.id}>
                <td><div style={{ fontWeight:600 }}>{s.name}</div>{s.npwp && <div style={{ fontSize:11, color:'var(--text-muted)' }}>NPWP: {s.npwp}</div>}</td>
                <td>{s.contact || '—'}</td>
                <td>
                  <div style={{ fontSize:12 }}>{s.phone || '—'}</div>
                  <div style={{ fontSize:11, color:'var(--accent-blue)' }}>{s.email || '—'}</div>
                </td>
                <td>
                  {s.bankName ? (
                    <div>
                      <div style={{ fontSize:12, fontWeight:600 }}>{s.bankName}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'monospace' }}>{s.bankAccount}</div>
                    </div>
                  ) : '—'}
                </td>
                <td>
                  <div style={{ display:'flex', gap:6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>Edit</button>
                    <button className="btn btn-sm" style={{ background:'rgba(239,68,68,0.1)', color:'var(--status-out)', border:'1px solid rgba(239,68,68,0.2)' }} onClick={() => del(s.id)}>Hapus</button>
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
              <span className="modal-title">{editing ? 'Edit Pemasok' : 'Tambah Pemasok'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowForm(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label className="form-label">Nama Perusahaan *</label><input className="form-input" value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} /></div>
                <div className="form-group"><label className="form-label">Kontak / PIC</label><input className="form-input" value={form.contact} onChange={e => setForm(f=>({...f,contact:e.target.value}))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Telepon</label><input className="form-input" value={form.phone} onChange={e => setForm(f=>({...f,phone:e.target.value}))} /></div>
                <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e => setForm(f=>({...f,email:e.target.value}))} /></div>
              </div>
              <div className="form-group"><label className="form-label">Alamat</label><input className="form-input" value={form.address} onChange={e => setForm(f=>({...f,address:e.target.value}))} /></div>
              <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={form.npwp} onChange={e => setForm(f=>({...f,npwp:e.target.value}))} /></div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Nama Bank</label><input className="form-input" value={form.bankName} onChange={e => setForm(f=>({...f,bankName:e.target.value}))} placeholder="BCA, Mandiri, ..." /></div>
                <div className="form-group"><label className="form-label">No. Rekening</label><input className="form-input" value={form.bankAccount} onChange={e => setForm(f=>({...f,bankAccount:e.target.value}))} /></div>
              </div>
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
