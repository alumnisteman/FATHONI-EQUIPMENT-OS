// src/pages/EquipmentPassport.tsx
// Satu unit, riwayatnya sepanjang database. Halaman ini dulu mencari unit di
// array store dan menyaring services/sales/rentals dengan .filter() — pada profil
// kerja besar, collection itu TIDAK dimuat seluruhnya ke renderer, jadi kartu
// riwayat bisa menampilkan angka nol untuk unit yang datanya justru lengkap di
// SQLite. Sekarang unit dan setiap angkanya datang lewat query berdasarkan nomor
// sasis, dan hanya beberapa catatan terakhir yang ikut dibawa ke DOM.

import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDataStore } from '../store/dataStore';
import { useCollectionCount, useCollectionQuery, useCollectionSum } from '../hooks/useCollectionTotals';
import UnitPhoto from '../components/UnitPhoto';

/** Riwayat yang ditampilkan; kartu jumlah tetap menghitung semuanya. */
const RIWAYAT_LIMIT = 30;

type TabPaspor = 'overview' | 'identity' | 'operation' | 'maintenance' | 'financial' | 'documents';

const rupiah = (n: unknown) => 'Rp' + new Intl.NumberFormat('id-ID').format(Number(n) || 0);

const EquipmentPassport: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { units, savedTick } = useDataStore();

  // Kolom 'id' dikenali lapisan query (lihat whereClauses di electron/db.ts),
  // jadi passport tetap terbuka walau collection units belum dimuat penuh.
  // Kunci kosong sengaja dipakai bila id hilang dari URL: tidak ada record yang
  // id-nya '', jadi hasilnya 'unit tidak ditemukan', bukan unit pertama.
  const unitHal = useCollectionQuery(
    { collection: 'units', where: { id: String(id ?? '') }, limit: 1 },
    units, savedTick.units
  );
  const unit = unitHal.rows[0];

  if (!unit) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2>Unit tidak ditemukan</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
          {unitHal.total === 0 && units.length > 0
            ? 'Tidak ada unit dengan id ini di database.'
            : 'Unit ini mungkin sudah dihapus.'}
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/units')} style={{ marginTop: 16 }}>
          Kembali ke Daftar Unit
        </button>
      </div>
    );
  }

  // Semua hook riwayat hidup di anak ini: tanpa unit, angkanya tidak ada artinya,
  // dan memanggil query dengan serialNumber kosong akan cocok dengan record yang
  // tidak punya nomor sasis sama sekali.
  return <PassportDetail unit={unit} serialNumber={String(unit.serialNumber ?? '')} />;
};

const PassportDetail: React.FC<{ unit: any; serialNumber: string }> = ({ unit, serialNumber }) => {
  const navigate = useNavigate();
  const { services, sales, rentals, savedTick } = useDataStore();
  const [activeTab, setActiveTab] = useState<TabPaspor>('overview');

  const whereUnit = { serialNumber };
  const jumlahService = useCollectionCount('services', whereUnit, services, savedTick.services);
  const jumlahRental = useCollectionCount('rentals', whereUnit, rentals, savedTick.rentals);
  const jumlahSales = useCollectionCount('sales', whereUnit, sales, savedTick.sales);
  const biayaService = useCollectionSum('services', 'estimatedCost', whereUnit, services, savedTick.services);
  const nilaiSales = useCollectionSum('sales', 'totalPrice', whereUnit, sales, savedTick.sales);
  const nilaiRental = useCollectionSum('rentals', 'monthlyRate', whereUnit, rentals, savedTick.rentals);
  const riwayatHal = useCollectionQuery(
    { collection: 'services', where: whereUnit, sort: 'openDate', desc: true, limit: RIWAYAT_LIMIT },
    services, savedTick.services
  );
  const riwayat = riwayatHal.rows;

  const calculateHealthScore = () => {
    let score = 100;
    const age = new Date().getFullYear() - (unit.year || 2020);
    score -= age * 2;
    const hm = unit.hourMeter || 0;
    if (hm > 10000) score -= 10;
    else if (hm > 5000) score -= 5;
    if (unit.status === 'BREAKDOWN') score -= 30;
    else if (unit.status === 'MAINTENANCE') score -= 15;
    return Math.max(0, Math.min(100, score));
  };

  const healthScore = calculateHealthScore();
  const healthColor = healthScore >= 80 ? '#10B981' : healthScore >= 60 ? '#F59E0B' : '#EF4444';

  return (
    <div>
      <div className="page-header">
        <div>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/units')}
            style={{ marginBottom: 8, padding: '4px 8px', fontSize: 12 }}
          >
            ← Kembali ke Unit
          </button>
          <h1 className="page-title">📱 Digital Equipment Passport</h1>
          <p className="page-subtitle">Paspor digital lengkap untuk unit {unit.brand} {unit.model}</p>
        </div>
      </div>

      {/* Header Passport */}
      <div className="card mb-4" style={{ padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24 }}>
          <div style={{
            width: '100%',
            height: 200,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
            <UnitPhoto
              photoId={unit.photoId}
              alt={`${unit.brand} ${unit.model}`}
              variant="full"
              placeholderSize={56}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>

          {/* Unit Info */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{unit.brand} {unit.model}</h2>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>
                  Asset ID: {unit.serialNumber}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: healthColor }}>{healthScore}%</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Health Score</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
              <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Status</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                  <span className={`badge ${unit.status === 'AVAILABLE' ? 'badge-success' : unit.status === 'RENTED' || unit.status === 'ON_PROJECT' ? 'badge-info' : 'badge-warning'}`}>
                    {unit.status}
                  </span>
                </div>
              </div>
              <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Hour Meter</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{new Intl.NumberFormat('id-ID').format(unit.hourMeter || 0)} HM</div>
              </div>
              <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tahun</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{unit.year || 'N/A'}</div>
              </div>
              <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lokasi</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{unit.location || 'Gudang'}</div>
              </div>
            </div>

            {/* Health Score Bar */}
            <div style={{ width: '100%', height: 12, background: '#E5E7EB', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: `${healthScore}%`, height: '100%', background: healthColor, borderRadius: 6, transition: 'width 0.3s ease' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border-default)', paddingBottom: 12 }}>
        {([
          { key: 'overview', label: '📊 Overview' },
          { key: 'identity', label: '🆔 Identity' },
          { key: 'operation', label: '⚙️ Operation' },
          { key: 'maintenance', label: '🔧 Maintenance' },
          { key: 'financial', label: '💰 Financial' },
          { key: 'documents', label: '📄 Documents' },
        ] as { key: TabPaspor; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: activeTab === tab.key ? 'var(--accent-blue)' : 'transparent',
              color: activeTab === tab.key ? 'white' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.key ? 600 : 400,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card" style={{ padding: 24 }}>
        {activeTab === 'overview' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Ringkasan Unit</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              <div style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Total Service</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{jumlahService} kali</div>
              </div>
              <div style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Total Rental</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{jumlahRental} kali</div>
              </div>
              <div style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Total Sales</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{jumlahSales} kali</div>
              </div>
              <div style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Estimasi Utilization</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>-</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Belum ada sumber datanya</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'identity' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Identitas Unit</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Serial Number</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{unit.serialNumber}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Engine Number</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>-</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Chassis Number</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>-</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Tahun Pembuatan</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{unit.year || 'N/A'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Lokasi Saat Ini</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{unit.location || 'Gudang'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Pemilik</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{unit.owner || '-'}</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'operation' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Data Operasional</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Total Hour Meter</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{new Intl.NumberFormat('id-ID').format(unit.hourMeter || 0)} HM</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Utilization</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>-</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Fuel Consumption</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{unit.fuelConsumption ? `${unit.fuelConsumption} L/HM` : '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Operator</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{unit.operator || '-'}</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Riwayat Maintenance</h3>
            {riwayat.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                Belum ada riwayat maintenance
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {riwayat.map((service, idx) => (
                  <div key={service.id ?? idx} style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontWeight: 600 }}>{service.woNumber}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{service.openDate}</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Tipe: {service.serviceType || '-'} &bull; Teknisi: {service.mechanicName || '-'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Estimasi Biaya: {rupiah(service.estimatedCost)}
                    </div>
                  </div>
                ))}
                {jumlahService > riwayat.length && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Menampilkan {riwayat.length} dari {jumlahService} catatan, yang terbaru lebih dulu.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'financial' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Data Finansial</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Purchase Price</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{unit.purchasePrice ? rupiah(unit.purchasePrice) : '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Depreciation</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>-</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Total Maintenance Cost</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{rupiah(biayaService)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Total Revenue</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{rupiah(nilaiSales + nilaiRental)}</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Dokumen Unit</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              <div style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8, opacity: 0.6 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Invoice</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Belum ada dokumen</div>
              </div>
              <div style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8, opacity: 0.6 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Warranty</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Belum ada dokumen</div>
              </div>
              <div style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8, opacity: 0.6 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Manual</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Belum ada dokumen</div>
              </div>
              <div style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8, opacity: 0.6 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Certificate</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Belum ada dokumen</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EquipmentPassport;
