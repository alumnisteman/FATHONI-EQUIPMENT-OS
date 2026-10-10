// src/components/BankAccounts.tsx
// Komponen untuk manajemen rekening bank

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';

interface BankAccount {
  id: string;
  namaBank: string;
  nomorRekening: string;
  namaPemilik: string;
  cabang: string;
  mataUang: string;
  isActive: boolean;
  keterangan?: string;
}

export default function BankAccounts() {
  const { bankAccounts: accounts, setBankAccounts: setAccounts } = useDataStore();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    namaBank: 'BCA',
    nomorRekening: '',
    namaPemilik: '',
    cabang: '',
    mataUang: 'IDR',
    isActive: true,
    keterangan: '',
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nomorRekening || !form.namaPemilik) {
      alert('Isi nomor rekening dan nama pemilik');
      return;
    }

    if (editingId) {
      setAccounts(accounts.map(acc => acc.id === editingId ? { ...acc, ...form } : acc));
    } else {
      const newAccount: BankAccount = {
        id: Date.now().toString(),
        ...form,
      };
      setAccounts([newAccount, ...accounts]);
    }
    setShowModal(false);
    setEditingId(null);
    setForm({
      namaBank: 'BCA',
      nomorRekening: '',
      namaPemilik: '',
      cabang: '',
      mataUang: 'IDR',
      isActive: true,
      keterangan: '',
    });
  };

  const handleEdit = (account: BankAccount) => {
    setEditingId(account.id);
    setForm({
      namaBank: account.namaBank,
      nomorRekening: account.nomorRekening,
      namaPemilik: account.namaPemilik,
      cabang: account.cabang,
      mataUang: account.mataUang,
      isActive: account.isActive,
      keterangan: account.keterangan || '',
    });
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Hapus rekening bank ini?')) {
      setAccounts(accounts.filter(acc => acc.id !== id));
    }
  };

  const handleToggleActive = (id: string) => {
    setAccounts(accounts.map(acc => acc.id === id ? { ...acc, isActive: !acc.isActive } : acc));
  };

  return (
    <div>
      <div style={{ marginBottom: 20, fontWeight: 700, fontSize: 15 }}>Manajemen Rekening Bank</div>
      
      <div style={{ marginBottom: 20 }}>
        <button
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
        >
          + Tambah Rekening
        </button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nama Bank</th>
              <th>Nomor Rekening</th>
              <th>Nama Pemilik</th>
              <th>Cabang</th>
              <th>Mata Uang</th>
              <th>Status</th>
              <th>Keterangan</th>
              <th style={{ textAlign: 'right' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  Tidak ada rekening bank yang terdaftar
                </td>
              </tr>
            ) : (
              accounts.map(account => (
                <tr key={account.id}>
                  <td style={{ fontWeight: 600 }}>{account.namaBank}</td>
                  <td style={{ fontFamily: 'monospace' }}>{account.nomorRekening}</td>
                  <td>{account.namaPemilik}</td>
                  <td>{account.cabang}</td>
                  <td>{account.mataUang}</td>
                  <td>
                    <span className={`badge ${account.isActive ? 'badge-success' : 'badge-muted'}`}>
                      {account.isActive ? 'Aktif' : 'Non-Aktif'}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {account.keterangan || '-'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => handleToggleActive(account.id)}
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                      >
                        {account.isActive ? '⏸️ Non-Aktifkan' : '✅ Aktifkan'}
                      </button>
                      <button
                        onClick={() => handleEdit(account)}
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDelete(account.id)}
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: 12, background: 'var(--status-out)' }}
                      >
                        🗑️ Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <span className="modal-title">{editingId ? 'Edit Rekening Bank' : 'Tambah Rekening Bank'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Nama Bank</label>
                  <select
                    className="form-select"
                    value={form.namaBank}
                    onChange={e => setForm({ ...form, namaBank: e.target.value })}
                    required
                  >
                    <option value="BCA">BCA</option>
                    <option value="Mandiri">Mandiri</option>
                    <option value="BNI">BNI</option>
                    <option value="BRI">BRI</option>
                    <option value="CIMB Niaga">CIMB Niaga</option>
                    <option value="Danamon">Danamon</option>
                    <option value="Permata">Permata</option>
                    <option value="HSBC">HSBC</option>
                    <option value="Citibank">Citibank</option>
                    <option value="Jtrust">Jtrust</option>
                    <option value="Lainnya">Lainnya</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Nomor Rekening</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.nomorRekening}
                    onChange={e => setForm({ ...form, nomorRekening: e.target.value })}
                    placeholder="Contoh: 1234567890"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Nama Pemilik</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.namaPemilik}
                    onChange={e => setForm({ ...form, namaPemilik: e.target.value })}
                    placeholder="Nama perusahaan atau pemilik"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Cabang</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.cabang}
                    onChange={e => setForm({ ...form, cabang: e.target.value })}
                    placeholder="Contoh: Jakarta, Surabaya, dll"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Mata Uang</label>
                  <select
                    className="form-select"
                    value={form.mataUang}
                    onChange={e => setForm({ ...form, mataUang: e.target.value })}
                  >
                    <option value="IDR">IDR - Rupiah</option>
                    <option value="USD">USD - US Dollar</option>
                    <option value="SGD">SGD - Singapore Dollar</option>
                    <option value="EUR">EUR - Euro</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select
                    className="form-select"
                    value={form.isActive.toString()}
                    onChange={e => setForm({ ...form, isActive: e.target.value === 'true' })}
                  >
                    <option value="true">Aktif</option>
                    <option value="false">Non-Aktif</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Keterangan</label>
                  <textarea
                    className="form-input"
                    value={form.keterangan}
                    onChange={e => setForm({ ...form, keterangan: e.target.value })}
                    placeholder="Keterangan tambahan..."
                    rows={3}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Simpan Perubahan' : 'Tambah Rekening'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
