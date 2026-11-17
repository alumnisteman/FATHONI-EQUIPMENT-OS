// src/pages/Brands.tsx - Modul Merek & Model Alat Berat FATHONI EQUIPMENT OS
//
// Katalog ini adalah collection store seperti master data lain (brands + models),
// bukan state lokal halaman. Dua hal yang mengikuti dari situ:
//   1. Perubahan masuk ke fathoni.db lewat autosave, jadi tidak hilang saat
//      halaman ditutup atau aplikasi direstart;
//   2. Penghapusan lewat removeRow, sehingga pemeriksaan rujukan di main process
//      (electron/referential.ts) ikut berjalan: merek yang masih dipakai sebuah
//      model atau sebuah unit tidak bisa dihapus begitu saja.
// Katalog awal TIDAK dimuat otomatis — hanya lewat tombol "Muat Katalog Awal".

import { useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { dbAvailable, dbQuery } from '../services/dbClient';
import { matchesQuery } from '../utils/searchMatch';
import { validateField } from '../utils/validation';
import { KATALOG_MEREK, KATALOG_MODEL } from '../data/katalogAwal';

interface Merek {
  id: string;
  name: string;
  country: string;
  category: string;
  description: string;
}

interface ModelUnit {
  id: string;
  brandName: string;
  modelCode: string;
  category: string;
  capacity: string;
  enginePower: string;
  operatingWeight: string;
}

// Baris bisa datang dari payload lama, impor, atau pemulihan; field yang hilang
// harus dibaca sebagai string kosong, bukan undefined yang tampil di layar.
const teks = (nilai: any): string => (nilai === null || nilai === undefined ? '' : String(nilai));
const kecil = (nilai: any): string => teks(nilai).trim().toLowerCase();

export default function Brands() {
  const { brands, setBrands, models, setModels, saveRow, saveRows, removeRow } = useDataStore();

  const merekList = brands as Merek[];
  const modelList = models as ModelUnit[];

  const [activeTab, setActiveTab] = useState<'brands' | 'models'>('brands');
  const [search, setSearch] = useState('');

  // Modal State
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Merek | null>(null);
  const [editingModel, setEditingModel] = useState<ModelUnit | null>(null);
  const [busy, setBusy] = useState(false);

  // Form State Brand
  const [brandForm, setBrandForm] = useState({ name: '', country: '', category: '', description: '' });

  // Form State Model
  const [modelForm, setModelForm] = useState({ brandName: '', modelCode: '', category: '', capacity: '', enginePower: '', operatingWeight: '' });

  // Filter Data — setiap kata di kolom pencarian harus cocok
  const filteredBrands = merekList.filter(b =>
    matchesQuery([b.name, b.country, b.category], search)
  );

  const filteredModels = modelList.filter(m =>
    matchesQuery([m.brandName, m.modelCode, m.category], search)
  );

  const jumlahModel = (namaMerek: string) =>
    modelList.filter(m => kecil(m.brandName) === kecil(namaMerek)).length;

  // Open Handlers
  const openAddBrand = () => {
    setEditingBrand(null);
    setBrandForm({ name: '', country: '', category: '', description: '' });
    setShowBrandModal(true);
  };

  const openEditBrand = (b: Merek) => {
    setEditingBrand(b);
    setBrandForm({ name: teks(b.name), country: teks(b.country), category: teks(b.category), description: teks(b.description) });
    setShowBrandModal(true);
  };

  const openAddModel = () => {
    if (merekList.length === 0) {
      alert('Belum ada merek di katalog. Tambahkan mereknya lebih dulu, lalu buat model di bawah merek tersebut.');
      return;
    }
    setEditingModel(null);
    setModelForm({ brandName: teks(merekList[0].name), modelCode: '', category: '', capacity: '', enginePower: '', operatingWeight: '' });
    setShowModelModal(true);
  };

  const openEditModel = (m: ModelUnit) => {
    setEditingModel(m);
    setModelForm({
      brandName: teks(m.brandName), modelCode: teks(m.modelCode), category: teks(m.category),
      capacity: teks(m.capacity), enginePower: teks(m.enginePower), operatingWeight: teks(m.operatingWeight),
    });
    setShowModelModal(true);
  };

  const idBaru = (awalan: string, urut: number) => `${awalan}-${Date.now()}-${urut}`;

  // Save Handlers
  const saveBrand = async () => {
    const name = brandForm.name.trim();
    const namaError = validateField(name, { required: true, minLength: 2, maxLength: 60 }, 'Nama Merek');
    if (namaError) {
      alert(namaError);
      return;
    }
    // Nama merek adalah kunci rujukan unit dan model, jadi tidak boleh rangkap —
    // dua entri 'SANY' dan 'sany ' membuat unit menunjuk ke merek yang tidak
    // jelas dan membuat pencarian katalog menemukan dua kartu untuk satu pabrikan.
    if (merekList.some(b => kecil(b.name) === kecil(name) && String(b.id) !== String(editingBrand?.id))) {
      alert(`Merek "${name}" sudah ada di katalog. Gunakan nama yang berbeda atau perbarui entri yang sudah ada.`);
      return;
    }
    const ketError = validateField(brandForm.description, { maxLength: 300 }, 'Deskripsi');
    if (ketError) {
      alert(ketError);
      return;
    }

    if (editingBrand) {
      const lama = teks(editingBrand.name);
      if (lama !== name) {
        const dipakai = await unitPakaiMerek(lama);
        if (dipakai !== null && dipakai > 0) {
          alert(`Nama merek tidak bisa diubah: masih ada ${dipakai} unit yang tercatat dengan merek "${lama}". Perbarui unitnya lebih dulu lewat menu Unit / Armada.`);
          return;
        }
        // Model dengan brandName lama ikut diperbarui sekaligus
        const modelBerubah = modelList
          .filter(m => kecil(m.brandName) === kecil(lama))
          .map(m => ({ ...m, brandName: name }));
        if (modelBerubah.length > 0) await saveRows('models', modelBerubah);
      }
      await saveRow('brands', { ...editingBrand, ...brandForm, name });
    } else {
      await saveRow('brands', { id: idBaru('brand', merekList.length), ...brandForm, name });
    }
    setShowBrandModal(false);
  };

  const saveModel = async () => {
    const modelCode = modelForm.modelCode.trim();
    const kodeError = validateField(modelCode, { required: true, minLength: 2, maxLength: 40 }, 'Kode Model');
    if (kodeError) {
      alert(kodeError);
      return;
    }
    // Model tanpa merek tidak bisa dirujuk oleh unit mana pun — mereklah yang
    // membuat sebuah kode model berarti.
    if (!merekList.some(b => kecil(b.name) === kecil(modelForm.brandName))) {
      alert('Pilih merek yang sudah ada di katalog. Model hanya bisa dibuat di bawah sebuah merek.');
      return;
    }
    if (modelList.some(m => kecil(m.modelCode) === kecil(modelCode) && String(m.id) !== String(editingModel?.id))) {
      alert(`Kode model "${modelCode}" sudah ada di katalog. Gunakan kode yang berbeda atau perbarui entri yang sudah ada.`);
      return;
    }

    const brandName = teks(merekList.find(b => kecil(b.name) === kecil(modelForm.brandName))?.name);
    if (editingModel) {
      await saveRow('models', { ...editingModel, ...modelForm, brandName, modelCode });
    } else {
      await saveRow('models', { id: idBaru('model', modelList.length), brandName, modelCode, category: modelForm.category, capacity: modelForm.capacity, enginePower: modelForm.enginePower, operatingWeight: modelForm.operatingWeight });
    }
    setShowModelModal(false);
  };

  /**
   * Berapa unit yang masih mencatat merek ini. Angka diambil dari SQLite, bukan
   * dari array: halaman ini tidak memuat collection units, dan menebak dari array
   * kosong akan selalu menjawab "0" — penolakan yang tidak pernah terjadi.
   * null = mode browser tanpa database; di situ seluruh store memang ada di
   * memori layar ini dan tidak ada file yang bisa ditinggalkan setengah jalan.
   */
  const unitPakaiMerek = async (nama: string): Promise<number | null> => {
    if (!dbAvailable() || !nama) return null;
    const hasil = await dbQuery({ collection: 'units', where: { brand: nama }, limit: 1 });
    return hasil ? hasil.total : null;
  };

  // Satu-satunya jalan masuk data katalog awal: tombol eksplisit. Halaman ini
  // dulunya mengisi dirinya sendiri saat dibuka, sehingga yang tampil bukan
  // katalog perusahaan tapi daftar bawaan komponen.
  const muatKatalogAwal = () => {
    if (merekList.length > 0 || modelList.length > 0) {
      alert('Katalog sudah berisi data. Tambahkan atau perbarui entri satu per satu supaya tidak menimpa katalog yang sedang dipakai.');
      return;
    }
    if (!confirm('Muat katalog awal (merek pabrikan dan beberapa model umum)? Isinya bisa diedit atau dihapus setelahnya.')) return;
    setBrands(KATALOG_MEREK.map((b, i) => ({ id: idBaru('brand', i), ...b })));
    setModels(KATALOG_MODEL.map((m, i) => ({ id: idBaru('model', i), ...m })));
  };

  const deleteBrand = async (id: string) => {
    if (!confirm('Hapus merek ini dari katalog?')) return;
    setBusy(true);
    const hasil = await removeRow('brands', id);
    setBusy(false);
    if (!hasil.ok) alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
  };

  const deleteModel = async (id: string) => {
    if (!confirm('Hapus model alat berat ini?')) return;
    setBusy(true);
    const hasil = await removeRow('models', id);
    setBusy(false);
    if (!hasil.ok) alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
  };

  const katalogKosong = merekList.length === 0 && modelList.length === 0;

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
          🏷️ Daftar Merek ({merekList.length})
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
          🚜 Spesifikasi Model Unit ({modelList.length})
        </button>
      </div>

      {/* Tab 1: Daftar Merek */}
      {activeTab === 'brands' && (
        <div>
          {filteredBrands.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '60px 32px' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🏷️</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                {merekList.length === 0 ? 'Katalog Masih Kosong' : 'Tidak Ada Merek yang Cocok'}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                {merekList.length === 0
                  ? 'Merek yang ditambahkan di sini menjadi pilihan pada form Unit / Armada, dan tersimpan permanen di database.'
                  : `Coba kata kunci lain — ${merekList.length} merek tersimpan di katalog.`}
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={openAddBrand}>
                  Tambah Merek Baru
                </button>
                {katalogKosong && (
                  <button className="btn btn-secondary" onClick={muatKatalogAwal}>
                    Muat Katalog Awal
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
              {filteredBrands.map(b => (
                <div key={b.id} className="card" style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{teks(b.name)}</span>
                      {b.country && <span className="badge badge-blue">{teks(b.country)}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--sany-red)', fontWeight: 600, marginBottom: 8 }}>
                      {teks(b.category)}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 16 }}>
                      {teks(b.description)}
                    </p>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--border-default)' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      <strong>{jumlahModel(teks(b.name))}</strong> Model terdaftar
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEditBrand(b)}>Edit</button>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--status-out)', border: '1px solid rgba(239,68,68,0.2)' }}
                        disabled={busy}
                        onClick={() => deleteBrand(String(b.id))}
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
                    {modelList.length === 0
                      ? 'Belum ada model di katalog. Klik "Tambah Model Unit" di atas — model hanya bisa dibuat di bawah merek yang sudah ada.'
                      : 'Tidak ada model yang cocok dengan kata kunci pencarian.'}
                  </td>
                </tr>
              )}
              {filteredModels.map(m => (
                <tr key={m.id}>
                  <td><strong style={{ color: 'var(--text-primary)' }}>{teks(m.modelCode)}</strong></td>
                  <td><span className="badge badge-red">{teks(m.brandName)}</span></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{teks(m.category)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{teks(m.capacity)}</td>
                  <td style={{ fontSize: 12 }}>{teks(m.enginePower)}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{teks(m.operatingWeight)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEditModel(m)}>Edit</button>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--status-out)', border: '1px solid rgba(239,68,68,0.2)' }}
                        disabled={busy}
                        onClick={() => deleteModel(String(m.id))}
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

      {/* Katalog awal: hanya ditawarkan ketika katalog benar-benar masih kosong */}
      {katalogKosong && activeTab === 'models' && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button className="btn btn-secondary" onClick={muatKatalogAwal}>Muat Katalog Awal</button>
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
              {editingBrand && jumlahModel(teks(editingBrand.name)) > 0 && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                  Merek ini dipakai {jumlahModel(teks(editingBrand.name))} model di katalog. Mengubah namanya akan
                  memindahkan model-model itu ke nama baru; selama masih ada unit yang memakai nama lamanya,
                  perubahan nama ditahan.
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBrandModal(false)}>Batal</button>
              <button className="btn btn-primary" disabled={busy} onClick={saveBrand}>Simpan Merek</button>
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
                    {merekList.map(b => (
                      <option key={b.id} value={teks(b.name)}>{teks(b.name)}</option>
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
