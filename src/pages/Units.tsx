// src/pages/Units.tsx - Modul Unit & Armada Alat Berat FATHONI EQUIPMENT OS

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UnitStatus } from '../types';
import { useDataStore } from '../store/dataStore';
import { diffRows } from '../store/writeGuard';
import { dbAvailable, dbQuery } from '../services/dbClient';
import UnitPhoto from '../components/UnitPhoto';
import { usePagedCollection } from '../hooks/usePagedCollection';
import Pager from '../components/Pager';
import {
  storeUnitPhoto, deleteUnitPhotos, migrateInlinePhotos, isDataUrl,
} from '../utils/photoStore';
import {
  validateField,
  validateUniqueSerialNumber,
  validateHourMeter,
  validateYear,
  validateAmount,
  validateUnitCategory,
  validateBrand,
  validateUnitStatus
} from '../utils/validation';

const STATUS_LABEL: Record<UnitStatus, string> = {
  AVAILABLE: 'Tersedia (Ready)',
  RESERVED: 'Dipesan (Booking)',
  SOLD: 'Terjual',
  RENTED: 'Dirental',
  ON_PROJECT: 'Di Proyek',
  IN_TRANSIT: 'Dalam Pengiriman',
  MAINTENANCE: 'Maintenance',
  BREAKDOWN: 'Breakdown / Rusak',
  INACTIVE: 'Tidak Aktif',
  DISPOSED: 'Afkir / Disposed',
};

const STATUS_CLASS: Record<UnitStatus, string> = {
  AVAILABLE: 'badge-success',
  RESERVED: 'badge-warning',
  SOLD: 'badge-muted',
  RENTED: 'badge-info',
  ON_PROJECT: 'badge-info',
  IN_TRANSIT: 'badge-info',
  MAINTENANCE: 'badge-warning',
  BREAKDOWN: 'badge-danger',
  INACTIVE: 'badge-muted',
  DISPOSED: 'badge-muted',
};

interface UnitRow {
  id: string;
  serialNumber: string;
  brand: string;
  category: string;
  model: string;
  status: UnitStatus;
  purchasePrice: number;
  currentValue: number;
  purchaseDate: string;
  hourMeter: number;
  location: string;
  year: string;
  photoId?: string; // berkas foto di folder data aplikasi
  photo?: string;   // base64 lama, dipindahkan oleh migrateInlinePhotos
}

// Foto default berdasarkan merek
function getDefaultPhoto(brand: string): string {
  const b = brand.toLowerCase();
  if (b.includes('komatsu')) return './units/komatsu.jpg';
  if (b.includes('caterpillar') || b.includes('cat')) return './units/caterpillar.jpg';
  if (b.includes('sany')) return './units/sany.jpg';
  return ''; // kosong = tampilkan placeholder SVG
}

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

/** Kartu unit per halaman; sisanya tetap ada di SQLite sampai halamannya dibuka. */
const PAGE_SIZE = 12;

/** Kandidat foto base64 per kueri migrasi (MAX_PAGE_LIMIT di main process). */
const BATAS_KANDIDAT = 500;

export default function Units() {
  const navigate = useNavigate();
  const { units: data, saveRow, saveRows, removeRow, savedTick } = useDataStore();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedUnit, setSelectedUnit] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState('RINGKASAN');

  // Modal Tambah Unit
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitRow | null>(null);
  const [tempPhotoId, setTempPhotoId] = useState<string | undefined>(undefined);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Modal Foto Unit. Yang dipegang adalah BARISNYA, bukan hanya id: array units
  // di memori tidak lagi berisi seluruh fleet, jadi mencari baris atas id di sana
  // tidak lagi menemukan apa-apa (#38).
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [photoTarget, setPhotoTarget] = useState<UnitRow | null>(null);

  // Pindahkan base64 lama ke berkas foto sekali jalan saat halaman dibuka.
  // Kandidatnya dicari lewat kueri pada kolom turunan `inlinePhoto`, bukan dengan
  // memindai array units di memori: sejak boot tidak lagi memuat seluruh collection
  // (#38), array itu bisa kosong atau sebagian saja, dan memindainya membuat
  // migrasi ini tidak pernah berjalan sementara foto base64 masih menempel di file.
  // Satu halaman kandidat per pembukaan layar: baris yang sudah berpindah tidak lagi
  // menjadi kandidat, jadi sisa yang lebih dari BATAS_KANDIDAT ikut pada kunjungan
  // berikutnya — tidak ada yang hilang, hanya bertahap.
  useEffect(() => {
    let active = true;
    (async () => {
      const kandidat = dbAvailable()
        ? (await dbQuery({ collection: 'units', where: { inlinePhoto: 1 }, limit: BATAS_KANDIDAT }))?.rows
        : data.filter(u => isDataUrl(u.photo));
      if (!active || !kandidat || kandidat.length === 0) return;
      const migrated = await migrateInlinePhotos(kandidat);
      if (!active || !migrated) return;
      // Hanya baris yang fotonya benar-benar pindah yang ditulis; hasil migrasi
      // mengembalikan objek lama untuk sisanya.
      const berubah = diffRows(kandidat, migrated)?.upsert ?? migrated;
      if (berubah.length > 0) await commitRows(berubah as UnitRow[]);
    })().catch(e => console.error('[Units] migrasi foto gagal:', e));
    return () => { active = false; };
    // sengaja hanya saat mount — kandidat datang dari kueri, bukan dari array units,
    // jadi efek ini tidak berulang kali memindai seluruh unit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Foto dikompres di sisi klien (±1400px + thumbnail ±320px) sebelum disimpan
   * sebagai berkas. Database hanya memegang nama berkasnya.
   */
  const processPhotoFile = async (file: File): Promise<string> => {
    setUploadingPhoto(true);
    try {
      return await storeUnitPhoto(file);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = photoTarget;
    if (!file || !target) return;

    try {
      const photoId = await processPhotoFile(file);
      const berikutnya = { ...target, photoId, photo: undefined };
      commit(berikutnya);
      setPhotoTarget(berikutnya);
      setSelectedUnit((prev: any) => prev?.id === target.id ? berikutnya : prev);
      if (target.photoId && target.photoId !== photoId) await deleteUnitPhotos(target.photoId);
      setShowPhotoModal(false);
    } catch (err: any) {
      alert(`Foto gagal disimpan: ${err?.message ?? err}`);
    }
  };

  const handleFormPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const photoId = await processPhotoFile(file);
      // Berkas dari pilihan sebelumnya menjadi yatim bila diganti.
      if (tempPhotoId && tempPhotoId !== editingUnit?.photoId) await deleteUnitPhotos(tempPhotoId);
      setTempPhotoId(photoId);
    } catch (err: any) {
      alert(`Foto gagal disimpan: ${err?.message ?? err}`);
    }
  };

  const handleDeletePhoto = async () => {
    if (!confirm('Hapus foto unit ini?')) return;
    const target = photoTarget;
    if (!target) return;
    const previous = target.photoId;
    const berikutnya = { ...target, photoId: undefined, photo: undefined };
    commit(berikutnya);
    setPhotoTarget(berikutnya);
    setSelectedUnit((prev: any) => prev?.id === target.id ? berikutnya : prev);
    setShowPhotoModal(false);
    if (previous) await deleteUnitPhotos(previous);
  };

  const openPhotoModal = (unit: UnitRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setPhotoTarget(unit);
    setShowPhotoModal(true);
  };

  const [form, setForm] = useState({
    serialNumber: '',
    brand: 'SANY',
    model: '',
    category: 'Excavator',
    status: 'AVAILABLE' as UnitStatus,
    hourMeter: 0,
    year: '2024',
    location: 'Gudang Utama',
    purchasePrice: 1500000000,
  });

  // Daftar fleet dibaca per halaman dari SQLite: dengan puluhan ribu unit,
  // pencarian dan halaman yang tampil tidak lagi menelusuri seluruh array.
  const paged = usePagedCollection<UnitRow>({
    collection: 'units',
    search,
    sort: 'purchaseDate',
    desc: true,
    pageSize: PAGE_SIZE,
    page,
    localRows: data,
    localFields: u => [u.serialNumber, u.brand, u.model, u.category, u.location, u.year],
    revision: savedTick.units,
  });

  useEffect(() => { setPage(0); }, [search]);
  useEffect(() => {
    if (page > 0 && page >= paged.pages) setPage(paged.pages - 1);
  }, [page, paged.pages]);

  // Setiap tulis unit langsung masuk file: halaman membaca ulang dari SQLite,
  // jadi tanpa simpanan langsung perubahan baru tampak setelah debounce.
  // Yang ditulis hanya baris yang berubah — tidak lagi menggabungkan array penuh
  // untuk menyatakan satu perubahan pada satu unit.
  const commit = async (row: UnitRow) => {
    await saveRow('units', row);
    paged.refresh();
  };

  const commitRows = async (rows: UnitRow[]) => {
    await saveRows('units', rows);
    paged.refresh();
  };

  const openAdd = () => {
    setEditingUnit(null);
    setTempPhotoId(undefined);
    setForm({
      serialNumber: '',
      brand: 'SANY',
      model: 'SY215C',
      category: 'Excavator',
      status: 'AVAILABLE',
      hourMeter: 0,
      year: '2024',
      location: 'Gudang Utama',
      purchasePrice: 1750000000,
    });
    setShowAddModal(true);
  };

  const openEdit = (u: UnitRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingUnit(u);
    setTempPhotoId(u.photoId);
    setForm({
      serialNumber: u.serialNumber,
      brand: u.brand,
      model: u.model,
      category: u.category,
      status: u.status,
      hourMeter: u.hourMeter,
      year: u.year,
      location: u.location,
      purchasePrice: u.purchasePrice,
    });
    setShowAddModal(true);
  };

  /** Tutup form tanpa menyimpan — berkas foto yang baru diupload ikut dihapus. */
  const closeAddModal = async () => {
    if (tempPhotoId && tempPhotoId !== editingUnit?.photoId) {
      await deleteUnitPhotos(tempPhotoId);
    }
    setTempPhotoId(undefined);
    setShowAddModal(false);
  };

  /**
   * Duplikat serial dicek terhadap isi file, bukan terhadap array units di memori:
   * sejak boot hanya membawa satu halaman (#38), array itu bisa kosong sehingga
   * setiap nomor rangka baru terasa "unik". Kueri memakai blob pencarian SQL hanya
   * untuk mempersempit kandidat; yang memutuskan adalah validateUniqueSerialNumber,
   * jadi aturannya (trim + tidak peka huruf) tidak ditulis dua kali.
   */
  const cekSerialGanda = async (serial: string, kecualiId?: string): Promise<string | null> => {
    if (!dbAvailable()) return validateUniqueSerialNumber(serial, data, kecualiId);
    const hasil = await dbQuery<UnitRow>({ collection: 'units', search: serial, limit: BATAS_KANDIDAT });
    return validateUniqueSerialNumber(serial, hasil?.rows ?? data, kecualiId);
  };

  const saveUnit = async () => {
    // Validasi Serial Number
    const serialError = validateField(form.serialNumber, { required: true, minLength: 3, maxLength: 50 }, 'Serial Number');
    if (serialError) {
      alert(serialError);
      return;
    }

    // Validasi duplikat Serial Number
    const duplicateError = await cekSerialGanda(form.serialNumber, editingUnit?.id);
    if (duplicateError) {
      alert(duplicateError);
      return;
    }

    // Validasi Brand
    const brandError = validateBrand(form.brand);
    if (brandError) {
      alert(brandError);
      return;
    }

    // Validasi Model
    const modelError = validateField(form.model, { required: true, minLength: 2, maxLength: 50 }, 'Model');
    if (modelError) {
      alert(modelError);
      return;
    }

    // Validasi Kategori
    const categoryError = validateUnitCategory(form.category);
    if (categoryError) {
      alert(categoryError);
      return;
    }

    // Validasi Status
    const statusError = validateUnitStatus(form.status);
    if (statusError) {
      alert(statusError);
      return;
    }

    // Validasi Hour Meter
    const hmError = validateHourMeter(form.hourMeter);
    if (hmError) {
      alert(hmError);
      return;
    }

    // Validasi Tahun
    const yearError = validateYear(form.year);
    if (yearError) {
      alert(yearError);
      return;
    }

    // Validasi Lokasi
    const locationError = validateField(form.location, { required: true, minLength: 3, maxLength: 100 }, 'Lokasi');
    if (locationError) {
      alert(locationError);
      return;
    }

    // Validasi Harga Purchase
    const priceError = validateAmount(form.purchasePrice, 1000000, 10000000000);
    if (priceError) {
      alert(priceError);
      return;
    }

    // Semua validasi lolos, simpan data
    const previousPhotoId = editingUnit?.photoId;
    if (editingUnit) {
      commit({
        ...editingUnit,
        ...form,
        currentValue: form.purchasePrice,
        photoId: tempPhotoId,
        photo: undefined,
      });
    } else {
      commit({
        id: Date.now().toString(),
        ...form,
        currentValue: form.purchasePrice,
        purchaseDate: new Date().toISOString().split('T')[0],
        photoId: tempPhotoId,
      } as UnitRow);
    }
    setShowAddModal(false);
    setTempPhotoId(undefined);

    if (previousPhotoId && previousPhotoId !== tempPhotoId) {
      await deleteUnitPhotos(previousPhotoId);
    }
  };

  const deleteUnit = async (u: UnitRow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Hapus unit alat berat ini dari sistem?')) return;
    const hasil = await removeRow('units', u.id);
    if (!hasil.ok) {
      // Unit yang masih punya pesanan, WO, atau surat jalan tidak dihapus — dan
      // fotonya ikut dibiarkan, karena foto hanya boleh dibuang setelah unitnya
      // benar-benar hilang.
      alert(hasil.alasan ?? 'Penghapusan dibatalkan.');
      return;
    }
    paged.refresh();
    if (selectedUnit?.id === u.id) setSelectedUnit(null);
    if (photoTarget?.id === u.id) setShowPhotoModal(false);
    if (u.photoId) await deleteUnitPhotos(u.photoId);
  };

  if (selectedUnit) {
    const u = selectedUnit;
    return (
      <div className="unit-detail-view">
        <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={() => setSelectedUnit(null)}>
          &larr; Kembali ke Daftar Fleet
        </button>

        {/* Unit Header Card */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap' }}>
            <div style={{ width: 240, height: 180, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
              <UnitPhoto
                photoId={u.photoId}
                inlineSrc={u.photo}
                fallbackSrc={getDefaultPhoto(u.brand)}
                alt={`${u.brand} ${u.model}`}
                variant="full"
                placeholderSize={80}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {/* Overlay tombol edit foto */}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', transition: 'background 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.5)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0)')}>
                <button
                  onClick={() => openPhotoModal(u)}
                  style={{ marginBottom: 10, padding: '5px 14px', borderRadius: 6, border: 'none', background: 'rgba(255,255,255,0.9)', color: '#111', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: 0, transition: 'opacity 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                >
                  📷 Kelola Foto
                </button>
              </div>
            </div>

            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <h2 style={{ fontSize: 24, fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>
                    {u.brand} {u.model}
                  </h2>
                  <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 14 }}>
                    Serial: {u.serialNumber}
                  </div>
                </div>
                <span className={`badge ${STATUS_CLASS[u.status as UnitStatus]}`}>
                  <span className="status-dot" /> {STATUS_LABEL[u.status as UnitStatus]}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 40, marginTop: 24 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{new Intl.NumberFormat('id-ID').format(u.hourMeter)} HM</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Hour Meter</div>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 }}>{u.location} &bull; {u.year}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Lokasi / Tahun</div>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', background: 'var(--bg-base)', borderBottom: '1px solid var(--border-default)', overflowX: 'auto' }}>
            {['RINGKASAN', 'PERAWATAN', 'SUKU CADANG', 'GARANSI', 'SEWA', 'DOKUMEN', 'PASSPORT DIGITAL'].map(tab => (
              <button
                key={tab}
                onClick={() => {
                  if (tab === 'PASSPORT DIGITAL') {
                    navigate(`/equipment-passport/${u.id}`);
                  } else {
                    setActiveTab(tab);
                  }
                }}
                style={{
                  padding: '12px 24px', background: 'transparent', border: 'none',
                  color: tab === 'PASSPORT DIGITAL' ? 'var(--sany-red)' : (activeTab === tab ? 'var(--sany-red)' : 'var(--text-muted)'),
                  borderBottom: tab === 'PASSPORT DIGITAL' ? '2px solid var(--sany-red)' : (activeTab === tab ? '2px solid var(--sany-red)' : '2px solid transparent'),
                  fontWeight: 600, fontSize: 12, letterSpacing: '0.05em', cursor: 'pointer', whiteSpace: 'nowrap'
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div style={{ padding: 24 }}>
            {activeTab === 'RINGKASAN' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 24 }}>
                  <div className="card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', padding: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Nilai Perolehan / Beli</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(u.purchasePrice)}</div>
                  </div>
                  <div className="card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', padding: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Nilai Buku Saat Ini (Est)</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--status-maintenance)' }}>{fmt(u.currentValue)}</div>
                  </div>
                  <div className="card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', padding: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Service Periodik Selanjutnya</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6' }}>{u.hourMeter + 250} HM</div>
                  </div>
                  <div className="card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', padding: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Status Garansi</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981' }}>Aktif (s.d Jan 2026)</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div className="card" style={{ border: '1px solid var(--border-default)' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Spesifikasi Teknis Unit</h3>
                    <table className="table" style={{ fontSize: 13 }}>
                      <tbody>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Kategori Unit</td><td style={{ fontWeight: 600 }}>{u.category}</td></tr>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Merek & Model</td><td style={{ fontWeight: 600 }}>{u.brand} {u.model}</td></tr>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Tahun Pembuatan</td><td style={{ fontWeight: 600 }}>{u.year}</td></tr>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Kapasitas Bucket / Load</td><td style={{ fontWeight: 600 }}>1.0 m³ Standard</td></tr>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Daya Mesin (Engine)</td><td style={{ fontWeight: 600 }}>110 kW / 2000 rpm</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="card" style={{ border: '1px solid var(--border-default)' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Lokasi & Operator</h3>
                    <table className="table" style={{ fontSize: 13 }}>
                      <tbody>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Lokasi Operasional</td><td style={{ fontWeight: 600 }}>{u.location}</td></tr>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Operator Utama</td><td style={{ fontWeight: 600 }}>Bambang Supriyanto</td></tr>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Penanggung Jawab Jobsite</td><td style={{ fontWeight: 600 }}>Ir. Handoko</td></tr>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Status GPS Tracking</td><td style={{ fontWeight: 600, color: '#10b981' }}>● Online (Signal Strong)</td></tr>
                        <tr><td style={{ color: 'var(--text-muted)' }}>Konsumsi BBM Rata-rata</td><td style={{ fontWeight: 600 }}>16.5 Liter / Jam</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'PERAWATAN' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700 }}>Riwayat Perawatan & SPK Work Order</h3>
                  <button className="btn btn-primary btn-sm" onClick={() => alert('Fitur Tambah SPK Perawatan Unit terhubung ke Modul Service.')}>
                    + Catat Service Baru
                  </button>
                </div>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>No SPK</th>
                      <th>Jenis Perawatan</th>
                      <th>Hour Meter (HM)</th>
                      <th>Tanggal</th>
                      <th>Teknisi / Mekanik</th>
                      <th>Status</th>
                      <th>Biaya</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>SPK-2025-012</td>
                      <td>Service Periodik 4.500 HM</td>
                      <td>4.500 HM</td>
                      <td>12 Jan 2025</td>
                      <td>Budi Santoso</td>
                      <td><span className="badge badge-success">Selesai</span></td>
                      <td>Rp 14.500.000</td>
                    </tr>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>SPK-2024-089</td>
                      <td>Penggantian Hydraulic Filter & Oil</td>
                      <td>3.800 HM</td>
                      <td>15 Nov 2024</td>
                      <td>Ahmad Jaya</td>
                      <td><span className="badge badge-success">Selesai</span></td>
                      <td>Rp 8.200.000</td>
                    </tr>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>SPK-2024-042</td>
                      <td>Preventive Maintenance 3.000 HM</td>
                      <td>3.000 HM</td>
                      <td>02 Jul 2024</td>
                      <td>Budi Santoso</td>
                      <td><span className="badge badge-success">Selesai</span></td>
                      <td>Rp 21.300.000</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'SUKU CADANG' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700 }}>Penggunaan Suku Cadang pada Unit Ini</h3>
                  <button className="btn btn-secondary btn-sm" onClick={() => alert('Terhubung dengan Stok Spare Parts')}>
                    + Pasang Spare Part
                  </button>
                </div>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Kode Part</th>
                      <th>Nama Suku Cadang</th>
                      <th>Jumlah (Qty)</th>
                      <th>Tanggal Pasang</th>
                      <th>Mekanik Penanggung Jawab</th>
                      <th>Total Biaya Part</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>P-1002</td>
                      <td>Filter Oli Engine High Performance</td>
                      <td>2 Pcs</td>
                      <td>12 Jan 2025</td>
                      <td>Budi Santoso</td>
                      <td>Rp 1.500.000</td>
                    </tr>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>P-2004</td>
                      <td>Hydraulic Main Filter Element</td>
                      <td>1 Pcs</td>
                      <td>15 Nov 2024</td>
                      <td>Ahmad Jaya</td>
                      <td>Rp 4.200.000</td>
                    </tr>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>P-3001</td>
                      <td>Track Shoe Bolt Set (Set of 20)</td>
                      <td>1 Set</td>
                      <td>02 Jul 2024</td>
                      <td>Budi Santoso</td>
                      <td>Rp 3.800.000</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'GARANSI' && (
              <div>
                <div className="card" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', marginBottom: 20, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Garansi Resmi Pabrikan</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#10b981', marginTop: 4 }}>GARANSI AKTIF (24 Bulan / 4.000 HM)</div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                        Distributor Resmi: <strong>PT SANY Indonesia Machinery</strong> &bull; Masa berlaku hingga: <strong>15 Januari 2026</strong>
                      </div>
                    </div>
                    <span className="badge badge-success" style={{ fontSize: 13, padding: '6px 12px' }}>VERIFIED</span>
                  </div>
                </div>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Riwayat Klaim Garansi</h3>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>No Klaim</th>
                      <th>Deskripsi Masalah / Komponen</th>
                      <th>Tanggal Klaim</th>
                      <th>Status Klaim</th>
                      <th>Biaya Tercover</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>CLM-2024-008</td>
                      <td>Penggantian O-Ring Seal Boom Cylinder Unit</td>
                      <td>14 Ags 2024</td>
                      <td><span className="badge badge-success">Disetujui (Covered)</span></td>
                      <td>Rp 0 (100% Garansi)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'SEWA' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700 }}>Riwayat Sewa & Kontrak Proyek</h3>
                  <button className="btn btn-primary btn-sm" onClick={() => alert('Terhubung ke Modul Rental & Pengadaan Proyek')}>
                    + Alokasikan Kontrak Baru
                  </button>
                </div>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>No Kontrak</th>
                      <th>Penyewa / Nama Proyek</th>
                      <th>Lokasi Jobsite</th>
                      <th>Periode Kontrak</th>
                      <th>Tarif Sewa / Jam</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>KNT-2025-001</td>
                      <td>PT Nusantara Mining Contractor</td>
                      <td>Jobsite Morowali, Sulteng</td>
                      <td>01 Jan 2025 - 31 Des 2025</td>
                      <td>Rp 250.000 / HM</td>
                      <td><span className="badge badge-info">Berjalan (Aktif)</span></td>
                    </tr>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>KNT-2024-044</td>
                      <td>PT Tambang Jaya Bersama</td>
                      <td>Jobsite Halmahera, Malut</td>
                      <td>15 Feb 2024 - 15 Des 2024</td>
                      <td>Rp 240.000 / HM</td>
                      <td><span className="badge badge-muted">Selesai</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'DOKUMEN' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700 }}>Dokumen Kelayakan & Legalitas Unit</h3>
                  <button className="btn btn-secondary btn-sm" onClick={() => alert('Upload dokumen baru')}>
                    + Upload Dokumen
                  </button>
                </div>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Jenis Dokumen</th>
                      <th>Nomor Dokumen</th>
                      <th>Masa Berlaku (Expiry)</th>
                      <th>Status Legalitas</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 600 }}>SIA (Surat Izin Alat)</td>
                      <td style={{ fontFamily: 'monospace' }}>SIA-2024-8891-JKT</td>
                      <td>15 Jan 2026</td>
                      <td><span className="badge badge-success">Aktif</span></td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => alert('Mengunduh SIA-2024-8891-JKT.pdf')}>Unduh PDF</button></td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>SILO (Surat Izin Layak Operasi)</td>
                      <td style={{ fontFamily: 'monospace' }}>SILO-SANY-215C-09</td>
                      <td>20 Des 2025</td>
                      <td><span className="badge badge-success">Aktif</span></td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => alert('Mengunduh SILO-SANY-215C-09.pdf')}>Unduh PDF</button></td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Faktur Pembelian & Sertifikat Merek</td>
                      <td style={{ fontFamily: 'monospace' }}>INV-SANY-2023-001</td>
                      <td>Permanen</td>
                      <td><span className="badge badge-success">Valid</span></td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => alert('Mengunduh Faktur.pdf')}>Unduh PDF</button></td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Polis Asuransi All Risk Equipment</td>
                      <td style={{ fontFamily: 'monospace' }}>INS-ALLIANZ-771290</td>
                      <td>10 Jan 2026</td>
                      <td><span className="badge badge-success">Aktif</span></td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => alert('Mengunduh Polis_Asuransi.pdf')}>Unduh PDF</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Manajemen Armada & Unit Alat Berat</h1>
          <p className="page-subtitle">Kelola daftar unit, jam kerja (HM), dan status operasional armada</p>
        </div>
        <div className="page-header-actions">
          <div className="topbar-search" style={{ width: 220 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input id="units-search" type="text" placeholder="Cari merek, model, serial, lokasi..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={openAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}><path d="M12 5v14M5 12h14"/></svg>
            Tambah Unit
          </button>
        </div>
      </div>

      {paged.rows.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🚜</div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
            {search ? 'Tidak Ada Unit Yang Cocok' : 'Belum Ada Unit Alat Berat'}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
            {paged.loading
              ? 'Mengambil data unit dari database...'
              : search
                ? `Tidak ada unit yang cocok dengan pencarian "${search}".`
                : 'Tambahkan unit alat berat baru untuk memulai pelacakan armada.'}
          </p>
          {!search && !paged.loading && (
            <button className="btn btn-primary" onClick={openAdd}>
              Mulai Tambah Unit Baru
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }} id="units-grid">
          {paged.rows.map(u => (
            <div key={u.id} className="card" style={{ cursor: 'pointer', transition: 'var(--transition)' }} onClick={() => setSelectedUnit(u)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{u.brand} {u.model}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{u.serialNumber}</div>
                </div>
                <span className={`badge ${STATUS_CLASS[u.status as UnitStatus]}`} style={{ padding: '2px 6px', fontSize: 10 }}>
                  {STATUS_LABEL[u.status as UnitStatus]}
                </span>
              </div>

              <div style={{ height: 120, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', marginBottom: 16, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UnitPhoto
                  photoId={u.photoId}
                  inlineSrc={u.photo}
                  fallbackSrc={getDefaultPhoto(u.brand)}
                  alt={`${u.brand} ${u.model}`}
                  placeholderSize={48}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <button
                  title="Kelola Foto"
                  onClick={(e) => openPhotoModal(u, e)}
                  style={{ position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}
                >
                  📷
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-default)', paddingTop: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{new Intl.NumberFormat('id-ID').format(u.hourMeter)} HM</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.location}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button 
                    className="btn btn-sm" 
                    style={{ background: 'var(--accent-blue)', color: 'white', border: 'none' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/equipment-passport/${u.id}`);
                    }}
                  >
                    📱 Passport
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={(e) => openEdit(u, e)}>Edit</button>
                  <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--status-out)', border: '1px solid rgba(239,68,68,0.2)' }} onClick={(e) => deleteUnit(u, e)}>Hapus</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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

      {/* Modal Tambah/Edit Unit */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={closeAddModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editingUnit ? 'Edit Unit Alat Berat' : 'Tambah Unit Alat Berat Baru'}</span>
              <button className="btn btn-ghost btn-icon" onClick={closeAddModal}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Nomor Seri / PIN *</label>
                  <input className="form-input" placeholder="Contoh: SY-SY215C-099" value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Merek *</label>
                  <select className="form-select" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}>
                    <option value="SANY">SANY</option>
                    <option value="Komatsu">Komatsu</option>
                    <option value="Caterpillar">Caterpillar</option>
                    <option value="Kobelco">Kobelco</option>
                    <option value="Hitachi">Hitachi</option>
                    <option value="Volvo">Volvo</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Kode Model *</label>
                  <input className="form-input" placeholder="Contoh: SY215C, PC200-8" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Kategori Unit</label>
                  <input className="form-input" placeholder="Contoh: Excavator, Dozer, Crane" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Status Operasional</label>
                  <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as UnitStatus }))}>
                    {Object.entries(STATUS_LABEL).map(([val, lbl]) => (
                      <option key={val} value={val}>{lbl}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Hour Meter awal (HM)</label>
                  <input className="form-input" type="number" value={form.hourMeter} onChange={e => setForm(f => ({ ...f, hourMeter: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Lokasi Saat Ini</label>
                  <input className="form-input" placeholder="Contoh: Jobsite Morowali, Gudang" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tahun Pembuatan</label>
                  <input className="form-input" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
                </div>
              </div>

              {/* Upload Foto Unit */}
              <div className="form-group">
                <label className="form-label">Foto Unit</label>
                <div style={{ marginTop: 8 }}>
                  <div style={{ 
                    width: '100%', 
                    height: 150, 
                    background: 'var(--bg-elevated)', 
                    borderRadius: 8, 
                    border: '2px dashed var(--border-default)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative'
                  }}>
                    {tempPhotoId ? (
                      <UnitPhoto
                        photoId={tempPhotoId}
                        alt="Preview foto unit"
                        placeholderSize={48}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: 32, marginBottom: 4 }}>📷</div>
                        <div style={{ fontSize: 12 }}>{uploadingPhoto ? 'Mengompres foto...' : 'Klik untuk upload foto'}</div>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={uploadingPhoto}
                      onChange={handleFormPhotoUpload}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        opacity: 0,
                        cursor: 'pointer'
                      }}
                    />
                  </div>
                  {tempPhotoId && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (tempPhotoId !== editingUnit?.photoId) await deleteUnitPhotos(tempPhotoId);
                        setTempPhotoId(undefined);
                      }}
                      style={{
                        marginTop: 8,
                        padding: '4px 12px',
                        fontSize: 12,
                        borderRadius: 4,
                        border: '1px solid var(--border-default)',
                        background: 'var(--bg-elevated)',
                        cursor: 'pointer'
                      }}
                    >
                      Hapus Foto
                    </button>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Foto dikompres otomatis (maks. sisi terpanjang 1400px) dan disimpan sebagai berkas di folder data, bukan di dalam database.
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeAddModal} disabled={uploadingPhoto}>Batal</button>
              <button className="btn btn-primary" onClick={saveUnit} disabled={uploadingPhoto}>
                {uploadingPhoto ? 'Menyiapkan foto...' : 'Simpan Unit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Kelola Foto Unit ── */}
      {showPhotoModal && photoTarget && (() => {
        const targetUnit = photoTarget;
        const fallbackPhoto = getDefaultPhoto(targetUnit?.brand || '');
        const hasStoredPhoto = !!targetUnit?.photoId || isDataUrl(targetUnit?.photo);
        return (
          <div className="modal-backdrop" onClick={() => setShowPhotoModal(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
              <div className="modal-header">
                <span className="modal-title">📷 Kelola Foto Unit</span>
                <button className="btn btn-ghost btn-icon" onClick={() => setShowPhotoModal(false)}>×</button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Preview foto saat ini */}
                <div style={{ width: '100%', height: 200, background: 'var(--bg-base)', borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-default)' }}>
                  {hasStoredPhoto || fallbackPhoto ? (
                    <UnitPhoto
                      photoId={targetUnit?.photoId}
                      inlineSrc={targetUnit?.photo}
                      fallbackSrc={fallbackPhoto}
                      alt="Foto unit"
                      variant="full"
                      placeholderSize={80}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
                      <div style={{ fontSize: 13 }}>Belum ada foto</div>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {targetUnit?.brand} {targetUnit?.model} — {targetUnit?.serialNumber}
                </div>

                {/* Tombol aksi */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ cursor: uploadingPhoto ? 'wait' : 'pointer', opacity: uploadingPhoto ? 0.6 : 1 }}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      disabled={uploadingPhoto}
                      onChange={handlePhotoUpload}
                    />
                    <div className="btn btn-primary" style={{ width: '100%', textAlign: 'center', display: 'block', padding: '10px 0' }}>
                      {uploadingPhoto ? 'Mengompres foto...' : '⬆️ Upload Foto Baru (JPG/PNG/WEBP)'}
                    </div>
                  </label>

                  {hasStoredPhoto && (
                    <button
                      className="btn btn-secondary"
                      style={{ borderColor: 'rgba(239,68,68,0.4)', color: 'var(--status-out)' }}
                      onClick={handleDeletePhoto}
                    >
                      🗑️ Hapus Foto (Kembali ke Default)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
