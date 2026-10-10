// src/pages/Brands.tsx - Modul Merek & Model Alat Berat FATHONI EQUIPMENT OS

import { useState } from 'react';
import { matchesQuery } from '../utils/searchMatch';

interface Brand {
  id: string;
  name: string;
  country: string;
  category: string;
  modelCount: number;
  description: string;
}

interface UnitModel {
  id: string;
  brandName: string;
  modelCode: string;
  category: string;
  capacity: string;
  enginePower: string;
  operatingWeight: string;
}

const INITIAL_BRANDS: Brand[] = [
  { id: '1', name: 'SANY', country: 'Tiongkok', category: 'Excavator, Crane, Concrete Pump', modelCount: 18, description: 'Produsen alat berat terkemuka dunia dengan teknologi hidrolik canggih' },
  { id: '2', name: 'Komatsu', country: 'Jepang', category: 'Excavator, Bulldozer, Dump Truck', modelCount: 24, description: 'Merek alat berat Jepang berstandar tinggi untuk konstruksi dan pertambangan' },
  { id: '3', name: 'Caterpillar (CAT)', country: 'Amerika Serikat', category: 'Excavator, Wheel Loader, Dozer', modelCount: 30, description: 'Produsen mesin dan peralatan konstruksi/tambang terbesar di dunia' },
  { id: '4', name: 'Kobelco', country: 'Jepang', category: 'Excavator, Crane', modelCount: 12, description: 'Spesialis excavator hemat energi dan efisiensi tinggi' },
  { id: '5', name: 'Hitachi', country: 'Jepang', category: 'Excavator, Wheel Loader', modelCount: 15, description: 'Excavator pertambangan dan konstruksi berdaya tahan tinggi' },
  { id: '6', name: 'Volvo CE', country: 'Swedia', category: 'Articulated Hauler, Wheel Loader', modelCount: 10, description: 'Peralatan konstruksi terdepan dalam keselamatan dan ergonomi' },
];

const INITIAL_MODELS: UnitModel[] = [
  { id: 'm1', brandName: 'SANY', modelCode: 'SY215C', category: 'Excavator 20 Ton', capacity: '1.0 m³', enginePower: '128 kW / 2000 rpm', operatingWeight: '21.900 kg' },
  { id: 'm2', brandName: 'SANY', modelCode: 'SY365H', category: 'Excavator 36 Ton', capacity: '1.6 m³', enginePower: '205 kW / 1900 rpm', operatingWeight: '36.200 kg' },
  { id: 'm3', brandName: 'Komatsu', modelCode: 'PC200-8M0', category: 'Excavator 20 Ton', capacity: '0.93 m³', enginePower: '103 kW / 2000 rpm', operatingWeight: '20.500 kg' },
  { id: 'm4', brandName: 'Komatsu', modelCode: 'D85ESS-2', category: 'Bulldozer', capacity: '3.4 m³ Blade', enginePower: '161 kW / 1900 rpm', operatingWeight: '20.670 kg' },
  { id: 'm5', brandName: 'Caterpillar (CAT)', modelCode: '320 GX', category: 'Excavator 20 Ton', capacity: '1.0 m³', enginePower: '107 kW / 1800 rpm', operatingWeight: '20.500 kg' },
  { id: 'm6', brandName: 'Caterpillar (CAT)', modelCode: '777G', category: 'Off-Highway Dump Truck', capacity: '60 m³', enginePower: '765 kW / 1750 rpm', operatingWeight: '163.000 kg' },
];

export default function Brands() {
  const [activeTab, setActiveTab] = useState<'brands' | 'models'>('brands');
  const [search, setSearch] = useState('');
  const [brands, setBrands] = useState<Brand[]>(INITIAL_BRANDS);
  const [models, setModels] = useState<UnitModel[]>(INITIAL_MODELS);

  // Modal State
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [editingModel, setEditingModel] = useState<UnitModel | null>(null);

  // Form State Brand
  const [brandForm, setBrandForm] = useState({ name: '', country: '', category: '', description: '' });

  // Form State Model
  const [modelForm, setModelForm] = useState({ brandName: 'SANY', modelCode: '', category: '', capacity: '', enginePower: '', operatingWeight: '' });

  // Filter Data — setiap kata di kolom pencarian harus cocok
  const filteredBrands = brands.filter(b =>
    matchesQuery([b.name, b.country, b.category], search)
  );

  const filteredModels = models.filter(m =>
    matchesQuery([m.brandName, m.modelCode, m.category], search)
  );

  // Open Handlers
  const openAddBrand = () => {
    setEditingBrand(null);
    setBrandForm({ name: '', country: 'Jepang', category: 'Excavator, Heavy Machinery', description: '' });
    setShowBrandModal(true);
  };

  const openEditBrand = (b: Brand) => {
    setEditingBrand(b);
    setBrandForm({ name: b.name, country: b.country, category: b.category, description: b.description });
    setShowBrandModal(true);
  };

  const openAddModel = () => {
    setEditingModel(null);
    setModelForm({ brandName: brands[0]?.name || 'SANY', modelCode: '', category: 'Excavator 20 Ton', capacity: '1.0 m³', enginePower: '120 kW', operatingWeight: '20.000 kg' });
    setShowModelModal(true);
  };

  const openEditModel = (m: UnitModel) => {
    setEditingModel(m);
    setModelForm({ brandName: m.brandName, modelCode: m.modelCode, category: m.category, capacity: m.capacity, enginePower: m.enginePower, operatingWeight: m.operatingWeight });
    setShowModelModal(true);
  };

  // Save Handlers
  const saveBrand = () => {
    if (!brandForm.name.trim()) return;
    if (editingBrand) {
      setBrands(prev => prev.map(b => b.id === editingBrand.id ? { ...b, ...brandForm } : b));
    } else {
      setBrands(prev => [...prev, { id: Date.now().toString(), ...brandForm, modelCount: 0 }]);
    }
    setShowBrandModal(false);
  };

  const saveModel = () => {
    if (!modelForm.modelCode.trim()) return;
    if (editingModel) {
      setModels(prev => prev.map(m => m.id === editingModel.id ? { ...m, ...modelForm } : m));
    } else {
      setModels(prev => [...prev, { id: Date.now().toString(), ...modelForm }]);
    }
    setShowModelModal(false);
  };

  const deleteBrand = (id: string) => {
    if (confirm('Hapus merek ini dari katalog?')) {
      setBrands(prev => prev.filter(b => b.id !== id));
    }
  };

  const deleteModel = (id: string) => {
    if (confirm('Hapus model alat berat ini?')) {
      setModels(prev => prev.filter(m => m.id !== id));
    }
  };

  return (
    <div>
      {/* Header Halaman */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Merek & Model Alat Berat</h1>
          <p className="page-subtitle">Katalog merek manufaktur, kategori unit, dan spesifikasi teknis model</p>
        </div>
        <div className="page-header-actions">
          <div className="topbar-search" style={{ width: 220 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Cari merek/model..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={activeTab === 'brands' ? openAddBrand : openAddModel}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M12 5v14M5 12h14"/>
            </svg>
            {activeTab === 'brands' ? 'Tambah Merek' : 'Tambah Model Unit'}
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-default)' }}>
        <button
          onClick={() => setActiveTab('brands')}
          style={{
            padding: '10px 20px',
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'brands' ? '2px solid var(--sany-red)' : '2px solid transparent',
            color: activeTab === 'brands' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'brands' ? 700 : 500,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          🏷️ Daftar Merek ({brands.length})
        </button>
        <button
          onClick={() => setActiveTab('models')}
          style={{
            padding: '10px 20px',
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'models' ? '2px solid var(--sany-red)' : '2px solid transparent',
            color: activeTab === 'models' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'models' ? 700 : 500,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          🚜 Spesifikasi Model Unit ({models.length})
        </button>
      </div>

      {/* Tab 1: Daftar Merek */}
      {activeTab === 'brands' && (
        <div>
          {filteredBrands.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '60px 32px' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🏷️</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Belum Ada Merek Ditemukan</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                Tambahkan merek manufaktur alat berat baru seperti SANY, Komatsu, CAT, dll.
              </p>
              <button className="btn btn-primary" onClick={openAddBrand}>
                Mulai Tambah Merek Baru
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
              {filteredBrands.map(b => (
                <div key={b.id} className="card" style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{b.name}</span>
                      <span className="badge badge-blue">{b.country}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--sany-red)', fontWeight: 600, marginBottom: 8 }}>
                      {b.category}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 16 }}>
                      {b.description}
                    </p>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--border-default)' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      <strong>{b.modelCount}</strong> Model terdaftar
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEditBrand(b)}>Edit</button>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--status-out)', border: '1px solid rgba(239,68,68,0.2)' }}
                        onClick={() => deleteBrand(b.id)}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Model & Spesifikasi */}
      {activeTab === 'models' && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Kode Model</th>
                <th>Merek</th>
                <th>Kategori Unit</th>
                <th>Kapasitas Bucket / Blade</th>
                <th>Daya Mesin</th>
                <th>Operating Weight</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                    Tidak ada data model unit. Klik "Tambah Model Unit" di atas.
                  </td>
                </tr>
              )}
              {filteredModels.map(m => (
                <tr key={m.id}>
                  <td><strong style={{ color: 'var(--text-primary)' }}>{m.modelCode}</strong></td>
                  <td><span className="badge badge-red">{m.brandName}</span></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{m.category}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.capacity}</td>
                  <td style={{ fontSize: 12 }}>{m.enginePower}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{m.operatingWeight}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEditModel(m)}>Edit</button>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--status-out)', border: '1px solid rgba(239,68,68,0.2)' }}
                        onClick={() => deleteModel(m.id)}
                      >
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Tambah/Edit Merek */}
      {showBrandModal && (
        <div className="modal-backdrop" onClick={() => setShowBrandModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editingBrand ? 'Edit Merek' : 'Tambah Merek Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowBrandModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Nama Merek / Manufaktur *</label>
                <input
                  className="form-input"
                  placeholder="Contoh: SANY, Komatsu, Caterpillar"
                  value={brandForm.name}
                  onChange={e => setBrandForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Negara Asal</label>
                  <input
                    className="form-input"
                    placeholder="Contoh: Tiongkok, Jepang, AS"
                    value={brandForm.country}
                    onChange={e => setBrandForm(f => ({ ...f, country: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Kategori Peralatan Utama</label>
                  <input
                    className="form-input"
                    placeholder="Contoh: Excavator, Crane, Dump Truck"
                    value={brandForm.category}
                    onChange={e => setBrandForm(f => ({ ...f, category: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Deskripsi / Keterangan</label>
                <textarea
                  className="form-textarea"
                  placeholder="Keterangan singkat spesialisasi pabrikan..."
                  value={brandForm.description}
                  onChange={e => setBrandForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBrandModal(false)}>Batal</button>
              <button className="btn btn-primary" onClick={saveBrand}>Simpan Merek</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tambah/Edit Model */}
      {showModelModal && (
        <div className="modal-backdrop" onClick={() => setShowModelModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editingModel ? 'Edit Model Unit' : 'Tambah Model Unit Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModelModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Merek *</label>
                  <select
                    className="form-select"
                    value={modelForm.brandName}
                    onChange={e => setModelForm(f => ({ ...f, brandName: e.target.value }))}
                  >
                    {brands.map(b => (
                      <option key={b.id} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Kode / Nama Model *</label>
                  <input
                    className="form-input"
                    placeholder="Contoh: SY215C, PC200-8"
                    value={modelForm.modelCode}
                    onChange={e => setModelForm(f => ({ ...f, modelCode: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Kategori Unit</label>
                <input
                  className="form-input"
                  placeholder="Contoh: Excavator 20 Ton, Wheel Loader 3m³"
                  value={modelForm.category}
                  onChange={e => setModelForm(f => ({ ...f, category: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Kapasitas (Bucket/Blade/Payload)</label>
                  <input
                    className="form-input"
                    placeholder="Contoh: 1.0 m³"
                    value={modelForm.capacity}
                    onChange={e => setModelForm(f => ({ ...f, capacity: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Daya Mesin (Engine Power)</label>
                  <input
                    className="form-input"
                    placeholder="Contoh: 128 kW / 2000 rpm"
                    value={modelForm.enginePower}
                    onChange={e => setModelForm(f => ({ ...f, enginePower: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Berat Operasional (Operating Weight)</label>
                <input
                  className="form-input"
                  placeholder="Contoh: 21.900 kg"
                  value={modelForm.operatingWeight}
                  onChange={e => setModelForm(f => ({ ...f, operatingWeight: e.target.value }))}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModelModal(false)}>Batal</button>
              <button className="btn btn-primary" onClick={saveModel}>Simpan Model Unit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
