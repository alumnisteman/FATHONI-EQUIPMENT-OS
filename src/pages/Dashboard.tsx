// src/pages/Dashboard.tsx - Dasbor Dinamis Berdasarkan Profil Bisnis FATHONI EQUIPMENT OS
//
// Semua ANGKA pada halaman ini dihitung SQLite (count/sum/group), bukan dengan
// menelusuri seluruh isi store di renderer: satu kartu hanya mengirim satu
// pertanyaan dan hanya menerima jawabannya. Daftar yang tampil di kartu (unit,
// SPK, WO, kontrak) adalah satu halaman kecil berisi 5–20 baris. Mode browser
// tanpa database tetap jalan lewat array store, dengan aturan penyaringan yang
// sama (lihat hooks/useCollectionTotals.ts).

import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/authStore';
import { useConfig, PROFILE_INFO, BusinessMode } from '../store/configStore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useDataStore } from '../store/dataStore';
import { isoDay, lastMonthKeys } from '../domain/revenue';
import { serviceDueInOf, SIKLUS_SERVIS_HM } from '../domain/derivedColumns';
import {
  useCollectionCount, useCollectionGroup, useCollectionQuery, useCollectionSum,
  type GroupRow,
} from '../hooks/useCollectionTotals';

const fmt = (n: number) => {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + ' M';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' Jt';
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(n);
};

/**
 * Kondisi yang dibaca kartu-kartu Dasbor, ditulis sekali di sini supaya angka
 * pada kartu dan isi daftar di bawahnya berasal dari penyaringan yang sama.
 * 'nin' (bukan salah satu) dipakai untuk "aktif" agar status baru yang ditambah
 * di halaman lain tidak diam-diam berhenti ikut dihitung di Dasbor.
 */
const WHERE_BREAKDOWN = { status: 'BREAKDOWN' };
const WHERE_SERVICE_DUE = { serviceDueIn: { gte: 1, lte: 50 } };
const WHERE_LOW_STOCK = { stockShortfall: { lte: 0 } };
const WHERE_UNIT_AVAILABLE = { status: 'AVAILABLE' };
const WHERE_WO_ACTIVE = { status: { nin: ['COMPLETED'] } };
const WHERE_WO_COMPLETED = { status: 'COMPLETED' };
const WHERE_SPK_ACTIVE = { status: { nin: ['COMPLETED', 'CANCELLED'] } };
const WHERE_SPK_COMPLETED = { status: 'COMPLETED' };
const WHERE_RENTAL_ACTIVE = { status: 'ACTIVE' };
const WHERE_RENTAL_AR = { type: 'RENTAL', status: { in: ['UNPAID', 'PARTIAL'] } };

// revenueByMonth() hanya menghitung ketiga jenis ini; invoice SPAREPART tidak
// pernah ikut, jadi kartunya tetap sama seperti sebelum pindah ke SQLite.
const REVENUE_INVOICE_TYPES = ['RENTAL', 'PENJUALAN', 'SERVICE'];

/** Kunci tanggal 'YYYY-MM-DD' lokal ada di src/domain/revenue (isoDay), dipakai
 *  juga oleh Laporan supaya 'jatuh tempo hari ini' berarti sama di dua menu. */

// Sapaan + tanggal. Jam diisolasi di sini supaya tick per menit tidak membuat
// seluruh Dasbor (termasuk grafik recharts) render ulang.
// Tampilan ini hanya berubah mengikuti hari dan jam, jadi jeda 60 detik cukup.
function GreetingHeader({ userName, description }: { userName: string; description: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const hour = now.getHours();
  const greeting = hour < 11 ? 'SELAMAT PAGI' : hour < 15 ? 'SELAMAT SIANG' : hour < 18 ? 'SELAMAT SORE' : 'SELAMAT MALAM';
  const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
        {greeting}, {userName}
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>
        {description} &bull; <span style={{ color: 'var(--text-muted)' }}>{dateStr}</span>
      </p>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { modes, resetSetup } = useConfig();
  const navigate = useNavigate();

  // Tab profil aktif jika pengguna memilih lebih dari 1 profil bisnis
  const [activeProfileTab, setActiveProfileTab] = useState<BusinessMode>(modes[0] || 'PERSONAL');

  // BUG-004 FIX: Tambahkan activeProfileTab ke dependency array (hilangkan stale closure)
  useEffect(() => {
    if (modes.length > 0 && !modes.includes(activeProfileTab)) {
      setActiveProfileTab(modes[0]);
    }
  }, [modes, activeProfileTab]);

  const currentProfileInfo = PROFILE_INFO[activeProfileTab] || PROFILE_INFO['PERSONAL'];

  const { units, sales, rentals, services, invoices, spareParts, savedTick } = useDataStore();

  // ========================================
  // ALERT CENTER — empat pertanyaan, bukan empat tabel penuh
  // ========================================
  // `total` laporan jumlah sebenarnya (untuk badge di judul), `rows` hanya beberapa
  // baris pertama yang memang ditampilkan di kartu.
  const breakdownAlerts = useCollectionQuery({ collection: 'units', where: WHERE_BREAKDOWN, limit: 20 }, units, savedTick.units);
  const serviceDueAlerts = useCollectionQuery({ collection: 'units', where: WHERE_SERVICE_DUE, limit: 20 }, units, savedTick.units);
  const lowStockAlerts = useCollectionQuery({ collection: 'spareParts', where: WHERE_LOW_STOCK, limit: 20 }, spareParts, savedTick.spareParts);
  // Kontrak yang berakhir dalam 7 hari ke depan. Batas bawah ketat supaya kontrak
  // yang jatuh tempo hari ini tidak menulis "Expires in 0 days".
  const contractAlerts = useCollectionQuery(
    { collection: 'rentals', where: { endDate: { gt: isoDay(0), lte: isoDay(7) } }, limit: 20 },
    rentals, savedTick.rentals
  );

  const { alerts, alertTotal, alertCounts } = useMemo(() => {
    const list = [
      ...breakdownAlerts.rows.map((u: any) => ({
        type: 'critical' as const,
        title: `${u.brand} ${u.model}`,
        message: 'Unit breakdown - need immediate attention',
        unitId: u.id,
      })),
      ...serviceDueAlerts.rows.map((u: any) => ({
        type: 'warning' as const,
        title: `${u.brand} ${u.model}`,
        message: `Service due in ${serviceDueInOf(u.hourMeter) ?? '-'} HM`,
        unitId: u.id,
      })),
      ...lowStockAlerts.rows.map((sp: any) => ({
        type: 'warning' as const,
        title: sp.name,
        message: `Stock low: ${sp.stock} pcs (min: ${sp.minStock})`,
        itemId: sp.id,
      })),
      ...contractAlerts.rows.map((r: any) => ({
        type: 'info' as const,
        title: `Rental Contract #${r.contractNo || r.id}`,
        message: `Expires in ${Math.ceil((new Date(r.endDate).getTime() - Date.now()) / 86_400_000)} days`,
        contractId: r.id,
      })),
    ];

    return {
      alerts: list,
      alertTotal: breakdownAlerts.total + serviceDueAlerts.total + lowStockAlerts.total + contractAlerts.total,
      alertCounts: {
        critical: breakdownAlerts.total,
        warning:  serviceDueAlerts.total + lowStockAlerts.total,
        info:     contractAlerts.total,
      },
    };
  }, [breakdownAlerts, serviceDueAlerts, lowStockAlerts, contractAlerts]);

  // ========================================
  // EQUIPMENT HEALTH SCORE CALCULATION
  // ========================================
  const calculateHealthScore = (unit: any) => {
    let score = 100;
    
    // Factor 1: Age penalty (older units have lower health)
    const age = new Date().getFullYear() - (unit.year || 2020);
    score -= age * 2;
    
    // Factor 2: Hour meter usage
    const hm = unit.hourMeter || 0;
    if (hm > 10000) score -= 10;
    else if (hm > 5000) score -= 5;
    
    // Factor 3: Status penalty
    if (unit.status === 'BREAKDOWN') score -= 30;
    else if (unit.status === 'MAINTENANCE') score -= 15;
    
    // Factor 4: Jarak sejak servis terakhir. `lastServiceHM` ditulis oleh
    // completeService (menu Servis). Dulu kartu ini memakai `hm - 500` saat field
    // itu belum ada, yang berarti "belum pernah diservis" selalu terbaca seperti
    // "baru saja diservis" dan skor kesehatan alat baru terlihat sempurna.
    // Tanpa catatan servis, faktor ini tidak menghukum apa pun.
    const lastServiceHM = Number(unit.lastServiceHM);
    if (Number.isFinite(lastServiceHM) && lastServiceHM >= 0) {
      const hmSinceService = hm - lastServiceHM;
      if (hmSinceService > SIKLUS_SERVIS_HM) score -= 10;
      else if (hmSinceService > SIKLUS_SERVIS_HM / 2) score -= 5;
    }
    
    return Math.max(0, Math.min(100, score));
  };

  // ========================================
  // BIAYA & PENDAPATAN PER JAM — dari transaksi, bukan konstanta
  // ========================================
  // Penyusutan adalah-satu-satunya komponen biaya per alat yang bisa dihitung dari
  // data yang ada (harga perolehan unit), dan itupun butuh satu asumsi umur ekonomis
  // yang dinyatakan di layar. BBM, sparepart dan operator TIDAK punya tautan ke
  // unit: Purchase Order hanya menyimpan nama barang, kas hanya kategori, dan
  // pemakaian sparepart tercatat per Work Order tanpa jam alat. Ketiganya dulu
  // ditulis sebagai Rp85.000 / Rp18.000 / Rp25.000 per HM — angka yang sama untuk
  // excavator 12.000 HM maupun unit baru 40 HM, dan tidak pernah berubah seberapa
  // banyak pun data masuk. Sekarang ketiganya ditandai belum tercatat.
  const NILAI_SISA_EKONOMIS = 0.1;
  const UMUR_EKONOMIS_HM = 12_000;

  const kelompokSerial = (groups: GroupRow[], serial: unknown, kolom = 0): GroupRow[] => {
    const kunci = String(serial || '').trim().toLowerCase();
    if (!kunci) return [];
    return groups.filter(g => String(g.keys[kolom] || '').trim().toLowerCase() === kunci);
  };

  interface AngkaPerUnit {
    hm: number;
    penyusutanPerJam: number;
    punyaHarga: boolean;
    kontrakAktif: number;
    sewaPerBulan: number;
    sewaPerJam: number | null;
    woSelesai: number;
    tagihanServis: number;
    biayaPerJam: number;
  }

  const angkaPerUnit = (unit: any): AngkaPerUnit => {
    const hm = Math.max(0, Math.trunc(Number(unit?.hourMeter) || 0));
    const harga = Math.max(0, Number(unit?.purchasePrice) || 0);
    const sewa = kelompokSerial(sewaPerSerial, unit?.serialNumber);
    const servis = kelompokSerial(biayaServisPerSerial, unit?.serialNumber);
    const tagihanServis = servis.reduce((acc, g) => acc + g.sum, 0);
    const woSelesai = servis.reduce((acc, g) => acc + g.count, 0);
    const sewaPerBulan = sewa.reduce((acc, g) => acc + g.sum, 0);
    // Tarif per jam hanya ada bila SEMUA kontrak aktif untuk serial ini menyimpan
    // jam minimum. Bila salah satu kosong, hasilnya nol atau null, bukan
    // Rp350.000/HM karangan lama.
    const tarifKontrak = sewa.map(g => {
      const jam = Math.max(0, Math.trunc(Number(g.keys[1]) || 0));
      return jam > 0 ? g.sum / jam : null;
    });
    const sewaPerJam = tarifKontrak.length > 0 && tarifKontrak.every(v => v !== null)
      ? tarifKontrak.reduce<number>((acc, v) => acc + (v as number), 0)
      : null;
    const penyusutanPerJam = harga > 0
      ? (harga * (1 - NILAI_SISA_EKONOMIS)) / UMUR_EKONOMIS_HM
      : 0;

    return {
      hm,
      penyusutanPerJam,
      punyaHarga: harga > 0,
      kontrakAktif: sewa.reduce((acc, g) => acc + g.count, 0),
      sewaPerBulan,
      sewaPerJam,
      woSelesai,
      tagihanServis,
      // Yang boleh dinamai "biaya tercatat" hanya penyusutan; WO servis adalah
      // tagihan ke pelanggan/proyek (pendapatan), bukan biaya yang ditanggung armada.
      biayaPerJam: penyusutanPerJam,
    };
  };
  // ========================================
  // ARMADA + GRAFIK — agregat dihitung di SQLite
  // ========================================
  // Satu kueri GROUP BY status mengganti lima hitungan manual; jumlah seluruh
  // status = seluruh armada, termasuk status yang tidak ditampilkan di pie chart.
  const unitStatusGroups = useCollectionGroup({ collection: 'units', by: ['status'] }, units, savedTick.units);
  const serviceStatusGroups = useCollectionGroup({ collection: 'services', by: ['status'] }, services, savedTick.services);

  const totalUnits = useMemo(
    () => unitStatusGroups.reduce((acc, g) => acc + g.count, 0),
    [unitStatusGroups]
  );
  const unitCountOf = useMemo(() => {
    const byStatus = new Map(unitStatusGroups.map(g => [g.keys[0], g.count]));
    return (...statuses: string[]) => statuses.reduce((acc, s) => acc + (byStatus.get(s) || 0), 0);
  }, [unitStatusGroups]);

  const fleetOperating = unitCountOf('ON_PROJECT', 'RENTED');
  const fleetRented = unitCountOf('RENTED');
  const fleetAvailable = unitCountOf('AVAILABLE');
  const fleetMaintenance = unitCountOf('MAINTENANCE');
  const fleetBreakdown = unitCountOf('BREAKDOWN');
  const totalHM = useCollectionSum('units', 'hourMeter', undefined, units, savedTick.units);

  const fleetStatusData = useMemo(() => ([
    { name: 'Operating / Rented', value: fleetOperating, color: '#10B981' },
    { name: 'Tersedia',           value: fleetAvailable, color: '#3B82F6' },
    { name: 'Maintenance',        value: fleetMaintenance, color: '#F59E0B' },
    { name: 'Breakdown',          value: fleetBreakdown, color: '#EF4444' },
  ].filter(d => d.value > 0)), [fleetOperating, fleetAvailable, fleetMaintenance, fleetBreakdown]);

  // Tren pendapatan 6 bulan: SQLite yang mengelompokkan invoice per bulan,
  // hanya 6 angka yang keluar ke renderer.
  const chartMonths = useMemo(() => lastMonthKeys(6), []);
  const revenueGroups = useCollectionGroup({
    collection: 'invoices',
    by: ['month'],
    sum: 'totalAmount',
    where: {
      month: { between: [chartMonths[0].key, chartMonths[chartMonths.length - 1].key] },
      type: { in: REVENUE_INVOICE_TYPES },
    },
  }, invoices, savedTick.invoices);

  const revenueData = useMemo(() => {
    const sumOfMonth = new Map(revenueGroups.map(g => [g.key, g.sum]));
    return chartMonths.map(m => ({ name: m.label, revenue: sumOfMonth.get(m.key) || 0 }));
  }, [revenueGroups, chartMonths]);

  // ── Daftar yang tampil di kartu: satu halaman kecil per daftar ──
  // Tanpa `sort`, urutannya mengikuti urutan baku collection, sama seperti
  // isi store sebelum halaman ini pindah ke kueri.
  const unitSorotan = useCollectionQuery({ collection: 'units', limit: 5 }, units, savedTick.units);
  const unitTersedia = useCollectionQuery({ collection: 'units', where: WHERE_UNIT_AVAILABLE, limit: 5 }, units, savedTick.units);
  const spkAktif = useCollectionQuery({ collection: 'sales', where: WHERE_SPK_ACTIVE, limit: 5 }, sales, savedTick.sales);
  const woAktif = useCollectionQuery({ collection: 'services', where: WHERE_WO_ACTIVE, limit: 5 }, services, savedTick.services);
  const kontrakAktif = useCollectionQuery({ collection: 'rentals', where: WHERE_RENTAL_ACTIVE, limit: 5 }, rentals, savedTick.rentals);

  // ── Angka uang dan jumlah lain yang dibutuhkan beberapa profil ──
  const omsetPenjualan = useCollectionSum('sales', 'totalPrice', undefined, sales, savedTick.sales);
  const pendapatanJasaSelesai = useCollectionSum('services', 'estimatedCost', WHERE_WO_COMPLETED, services, savedTick.services);
  const tagihanSewaBulanan = useCollectionSum('rentals', 'monthlyRate', WHERE_RENTAL_ACTIVE, rentals, savedTick.rentals);
  const piutangPokok = useCollectionSum('invoices', 'totalAmount', WHERE_RENTAL_AR, invoices, savedTick.invoices);
  const piutangTerbayar = useCollectionSum('invoices', 'paidAmount', WHERE_RENTAL_AR, invoices, savedTick.invoices);
  const penjualanSelesai = useCollectionCount('sales', WHERE_SPK_COMPLETED, sales, savedTick.sales);
  const piutangJumlah = useCollectionCount('invoices', WHERE_RENTAL_AR, invoices, savedTick.invoices);
  const totalKontrak = useCollectionCount('rentals', undefined, rentals, savedTick.rentals);
  const totalSukuCadang = useCollectionCount('spareParts', undefined, spareParts, savedTick.spareParts);
  const serviceCountOf = useMemo(() => {
    const byStatus = new Map(serviceStatusGroups.map(g => [g.keys[0], g.count]));
    return (...statuses: string[]) => statuses.reduce((acc, s) => acc + (byStatus.get(s) || 0), 0);
  }, [serviceStatusGroups]);

  // ── Biaya & pendapatan PER ALAT, diambil dari transaksi ──
  // Dua kartu di bawah dulu berisi konstanta: Fuel Rp85.000/HM, Maintenance
  // Rp32.000/HM, Sparepart Rp18.000/HM, Operator Rp25.000/HM dan revenue
  // Rp350.000/HM — angka yang sama untuk excavator 12.000 HM dan untuk unit baru
  // 40 HM, dan tidak pernah berubah seberapa banyak pun data masuk. Sekarang yang
  // punya tautan dihitung (Work Order COMPLETED per serial, sewa AKTIF per serial),
  // dan yang tidak punya tautan dinyatakan belum ada, bukan dikarang.
  const biayaServisPerSerial = useCollectionGroup(
    { collection: 'services', by: ['serialNumber'], sum: 'estimatedCost', where: WHERE_WO_COMPLETED },
    services, savedTick.services);
  // Jam minimum ikut menjadi kunci kelompok: tarif per jam hanya bisa dihitung
  // dari Rp/bulan bila kontrak itu sendiri yang menyatakan dasar jamnya.
  const sewaPerSerial = useCollectionGroup(
    { collection: 'rentals', by: ['serialNumber', 'minimumHours'], sum: 'monthlyRate', where: WHERE_RENTAL_ACTIVE },
    rentals, savedTick.rentals);

  return (
    <div>
      {/* ── Banner Utama Header Profil Bisnis ── */}
      <div className="stagger-1" style={{
        background: `linear-gradient(135deg, ${currentProfileInfo.color}15, var(--bg-card))`,
        border: `1px solid ${currentProfileInfo.color}40`,
        borderRadius: 'var(--radius-lg)',
        padding: '24px 28px',
        marginBottom: 20,
        position: 'relative',
        boxShadow: 'var(--shadow-md)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 28 }}>{currentProfileInfo.icon}</span>
              <span style={{
                background: currentProfileInfo.color,
                color: 'white',
                fontSize: 11,
                fontWeight: 800,
                padding: '3px 10px',
                borderRadius: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                MODAL PROFIL: {currentProfileInfo.title}
              </span>
            </div>

            <GreetingHeader
              userName={user?.name?.split(' ')[0] ?? 'PENGGUNA'}
              description={currentProfileInfo.desc}
            />
          </div>

          {/* Tombol Ganti Profil Bisnis & Aksi Cepat */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => { resetSetup(); navigate('/setup'); }}
              style={{ fontSize: 12, padding: '8px 16px' }}
            >
              🔄 Ganti Mode Profil
            </button>

            {/* Quick Action Berdasarkan Mode */}
            {activeProfileTab === 'PERSONAL' && (
              <button className="btn btn-primary" onClick={() => navigate('/units')}>🚜 + Tambah Alat Saya</button>
            )}
            {activeProfileTab === 'DEALER' && (
              <button className="btn btn-primary" onClick={() => navigate('/sales')}>💰 + Buat Order SPK</button>
            )}
            {activeProfileTab === 'CONTRACTOR' && (
              <button className="btn btn-primary" onClick={() => navigate('/units')}>🏗️ + Alokasi Fleet</button>
            )}
            {activeProfileTab === 'RENTAL' && (
              <button className="btn btn-primary" onClick={() => navigate('/rental')}>📄 + Kontrak Sewa</button>
            )}
            {activeProfileTab === 'WORKSHOP' && (
              <button className="btn btn-primary" onClick={() => navigate('/service')}>🔧 + Terbitkan WO</button>
            )}
            {activeProfileTab === 'TRADER' && (
              <button className="btn btn-primary" onClick={() => navigate('/purchase')}>💰 + Beli Unit Second</button>
            )}
          </div>
        </div>

        {/* ── ALERT CENTER ── */}
        {alertTotal > 0 && (
          <div style={{
            marginTop: 20,
            paddingTop: 20,
            borderTop: '1px solid var(--border-default)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>🔔</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>ALERT CENTER</span>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444' }}></span>
                  <span style={{ color: 'var(--text-muted)' }}>{alertCounts.critical} Critical</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B' }}></span>
                  <span style={{ color: 'var(--text-muted)' }}>{alertCounts.warning} Due</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B82F6' }}></span>
                  <span style={{ color: 'var(--text-muted)' }}>{alertCounts.info} Info</span>
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {alerts.slice(0, 5).map((alert, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: '1 1 200px',
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: alert.type === 'critical' ? '#FEF2F2' : alert.type === 'warning' ? '#FFFBEB' : '#EFF6FF',
                    border: `1px solid ${alert.type === 'critical' ? '#FECACA' : alert.type === 'warning' ? '#FDE68A' : '#BFDBFE'}`,
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span>{alert.type === 'critical' ? '🔴' : alert.type === 'warning' ? '🟠' : '🔵'}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{alert.title}</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{alert.message}</div>
                </div>
              ))}
              {alertTotal > 5 && (
                <div
                  style={{
                    flex: '1 1 200px',
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                  }}
                >
                  +{alertTotal - 5} more alerts
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab Pemilih Profil Bisnis (jika pengguna memilih > 1 profil) */}
        {modes.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-default)', overflowX: 'auto' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center', marginRight: 4, fontWeight: 600 }}>
              Pilih Tampilan Profil:
            </span>
            {modes.map(modeKey => {
              const info = PROFILE_INFO[modeKey];
              const isActive = activeProfileTab === modeKey;
              return (
                <button
                  key={modeKey}
                  onClick={() => setActiveProfileTab(modeKey)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 20,
                    background: isActive ? info.color : 'var(--bg-elevated)',
                    color: isActive ? 'white' : 'var(--text-secondary)',
                    border: `1.5px solid ${isActive ? info.color : 'var(--border-default)'}`,
                    fontWeight: isActive ? 700 : 500,
                    fontSize: 12,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{info.icon}</span>
                  <span>{info.shortTitle}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── KONTEN DASBOR KHUSUS PER PROFIL ── */}

      {/* 1. KONTEN PEMILIK ALAT (PERSONAL) */}
      {activeProfileTab === 'PERSONAL' && (
        <div>
          <div className="grid-4 mb-4 stagger-2">
            <div className="card stat-card" style={{ borderLeft: '3px solid #10B981' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Armada Alat Berat Saya</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{totalUnits} Unit</div>
              <div style={{ fontSize: 11, color: '#10B981', marginTop: 4 }}>🟢 {fleetOperating} Operating &bull; {fleetMaintenance} Maintenance</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #3B82F6' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Jam Kerja (HM)</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{new Intl.NumberFormat('id-ID').format(totalHM)} HM</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Total seluruh armada aktif</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #F59E0B' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Jadwal Servis Mendatang</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#F59E0B' }}>{woAktif.total} Unit</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Sedang dalam WO Servis</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #8B5CF6' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pendapatan Bulan Ini</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: 'var(--status-operating)' }}>{fmt(omsetPenjualan)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Hasil Penjualan & Sewa</div>
            </div>
          </div>

          {/* Equipment Health Score Card */}
          <div className="card mb-4 stagger-3">
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>❤️ Equipment Health Score</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {unitSorotan.rows.slice(0, 4).map((u, i) => {
                const healthScore = calculateHealthScore(u);
                const healthColor = healthScore >= 80 ? '#10B981' : healthScore >= 60 ? '#F59E0B' : '#EF4444';
                const healthPercent = Math.max(0, Math.min(100, healthScore));
                
                return (
                  <div key={u.id || u.serialNumber} style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-default)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ fontWeight: 700 }}>{u.brand} {u.model}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: healthColor }}>{healthPercent}%</div>
                    </div>
                    <div style={{ width: '100%', height: 8, background: '#E5E7EB', borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
                      <div style={{ width: `${healthPercent}%`, height: '100%', background: healthColor, borderRadius: 4, transition: 'width 0.3s ease' }}></div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                      <span>{u.serialNumber}</span>
                      <span>{new Intl.NumberFormat('id-ID').format(u.hourMeter || 0)} HM</span>
                    </div>
                  </div>
                );
              })}
              {totalUnits === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>Belum ada armada</div>}
            </div>
          </div>

          {/* Biaya & pendapatan per jam: angka transaksi + satu asumsi bernama */}
          <div className="card mb-4 stagger-4">
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>💰 Cost per Hour Analysis</h3>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 16px', maxWidth: 820 }}>
              Hanya biaya yang punya tautan ke unit yang ikut dihitung. Penyusutan memakai asumsi umur ekonomis{' '}
              {new Intl.NumberFormat('id-ID').format(UMUR_EKONOMIS_HM)} HM dengan nilai sisa{' '}
              {Math.round(NILAI_SISA_EKONOMIS * 100)}% dari harga perolehan. BBM, sparepart dan operator belum bisa
              dinyatakan per jam alat karena pembelian tidak menautkan barisnya ke satu unit dan belum ada catatan
              jam operasi per hari.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {unitSorotan.rows.slice(0, 3).map((u, i) => {
                const a = angkaPerUnit(u);
                const rp = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
                const baris = (label: string, nilai: string, warna?: string) => (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>{label}</span>
                    <span style={warna ? { color: warna } : undefined}>{nilai}</span>
                  </div>
                );
                const margin = a.sewaPerJam === null ? null : a.sewaPerJam - a.biayaPerJam;
                const marginPersen = a.sewaPerJam ? (Number(margin) / a.sewaPerJam) * 100 : 0;

                return (
                  <div key={u.id || u.serialNumber} style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-default)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>{u.brand} {u.model} ({u.serialNumber})</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                      {new Intl.NumberFormat('id-ID').format(a.hm)} HM tercatat
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      {baris('Penyusutan (asumsi)', a.punyaHarga ? `${rp(a.penyusutanPerJam)}/HM` : 'harga perolehan belum diisi')}
                      {baris('BBM', 'belum tercatat per unit', 'var(--text-muted)')}
                      {baris('Sparepart', 'belum tercatat per unit', 'var(--text-muted)')}
                      {baris('Operator', 'belum tercatat per unit', 'var(--text-muted)')}
                      <div style={{ height: '1px', background: 'var(--border-default)', margin: '8px 0' }}></div>
                      {baris('BIAYA TERCATAT', `${rp(a.biayaPerJam)}/HM`, '#EF4444')}
                      {baris('Sewa aktif', a.kontrakAktif > 0
                        ? `${a.kontrakAktif} kontrak • ${rp(a.sewaPerBulan)}/bulan`
                        : 'tidak ada kontrak aktif')}
                      {baris('PENDAPATAN', a.sewaPerJam !== null ? `${rp(a.sewaPerJam)}/HM` : 'tarif/jam belum ada', '#10B981')}
                      {baris('Tagihan WO selesai', a.woSelesai > 0
                        ? `${a.woSelesai} WO • ${rp(a.tagihanServis)}`
                        : 'belum ada WO selesai')}
                      <div style={{ height: '1px', background: 'var(--border-default)', margin: '8px 0' }}></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12 }}>
                        <span>GROSS MARGIN</span>
                        <span style={{ color: margin === null ? 'var(--text-muted)' : marginPersen >= 30 ? '#10B981' : '#F59E0B' }}>
                          {margin === null
                            ? 'belum dapat dihitung'
                            : `${rp(margin)}/HM (${marginPersen.toFixed(1)}%)`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {totalUnits === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>Belum ada armada</div>}
            </div>
          </div>

          {/* Grafik Analitik */}
          <div className="stagger-5" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>📈 Tren Pendapatan 6 Bulan Terakhir</h3>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} tickFormatter={(val) => `Rp${val/1000000}M`} />
                    <Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: 'var(--shadow-md)', background: 'var(--bg-card)' }} formatter={(val: number) => [fmt(val), 'Pendapatan']} />
                    <Bar dataKey="revenue" fill="var(--sany-red)" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>📊 Status Armada Unit</h3>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={fleetStatusData} cx="50%" cy="45%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value">
                      {fleetStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: 'var(--shadow-md)', background: 'var(--bg-card)' }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🚜 Ringkasan Unit Alat Saya</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {unitSorotan.rows.slice(0, 3).map((u, i) => {
                  const healthScore = calculateHealthScore(u);
                  const a = angkaPerUnit(u);
                  const healthColor = healthScore >= 80 ? '#10B981' : healthScore >= 60 ? '#F59E0B' : '#EF4444';
                  
                  return (
                    <div key={u.id || u.serialNumber} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700 }}>{u.brand} {u.model} ({u.serialNumber})</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          Lokasi: {u.location || 'Gudang'} &bull; {new Intl.NumberFormat('id-ID').format(u.hourMeter || 0)} HM
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 10 }}>❤️</span>
                            <span style={{ fontWeight: 600, color: healthColor }}>{healthScore}%</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 10 }}>💰</span>
                            <span>
                              {a.kontrakAktif > 0
                                ? `Sewa ${fmt(a.sewaPerBulan)}/bulan`
                                : a.woSelesai > 0
                                  ? `${a.woSelesai} WO selesai • ${fmt(a.tagihanServis)}`
                                  : 'belum ada transaksi alat ini'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className={`badge ${u.status === 'AVAILABLE' ? 'badge-success' : u.status === 'RENTED' || u.status === 'ON_PROJECT' ? 'badge-info' : 'badge-warning'}`}>
                        {u.status}
                      </span>
                    </div>
                  );
                })}
                {totalUnits === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada armada</div>}
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>⚡ Akses Cepat Pemilik</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => navigate('/units')} style={{ textAlign: 'left', justifyContent: 'flex-start' }}>🚜 Lihat Semua Alat Saya</button>
                <button className="btn btn-secondary" onClick={() => navigate('/service')} style={{ textAlign: 'left', justifyContent: 'flex-start' }}>🔧 Catat Biaya Perawatan</button>
                <button className="btn btn-secondary" onClick={() => navigate('/finance')} style={{ textAlign: 'left', justifyContent: 'flex-start' }}>💰 Catat Uang Masuk / Kas</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. KONTEN DEALER / DISTRIBUTOR */}
      {activeProfileTab === 'DEALER' && (
        <div>
          <div className="grid-4 mb-4 stagger-2">
            <div className="card stat-card" style={{ borderLeft: '3px solid #3B82F6' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Stok Unit Tersedia</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{unitTersedia.total} Unit</div>
              <div style={{ fontSize: 11, color: '#3B82F6', marginTop: 4 }}>Total: {totalUnits} Unit</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #10B981' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Penjualan Selesai</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: 'var(--status-operating)' }}>{penjualanSelesai} Unit</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Total Omset: {fmt(omsetPenjualan)}</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #F59E0B' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>SPK Aktif</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#F59E0B' }}>{spkAktif.total} SPK</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Menunggu Pelunasan / Leasing</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #8B5CF6' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Estimasi Komisi Sales</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{fmt(omsetPenjualan * 0.02)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Bonus Kinerja (2%)</div>
            </div>
          </div>

          <div className="stagger-3" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🏬 Pipeline Penjualan Unit Baru</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {spkAktif.rows.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.customerName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.unitModel} &bull; {fmt(item.totalPrice)}</div>
                    </div>
                    <span className="badge badge-blue">{item.status}</span>
                  </div>
                ))}
                {spkAktif.total === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Tidak ada SPK aktif</div>
                )}
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>⚡ Fitur Dealer</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => navigate('/sales')}>🏢 Modul Sales Order (SPK)</button>
                <button className="btn btn-secondary" onClick={() => navigate('/brands')}>🏷️ Katalog Merek & Model</button>
                <button className="btn btn-secondary" onClick={() => navigate('/delivery')}>🚚 Surat Jalan & DO Unit</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. KONTEN KONTRAKTOR PROJECT */}
      {activeProfileTab === 'CONTRACTOR' && (
        <div>
          <div className="grid-4 mb-4 stagger-2">
            <div className="card stat-card" style={{ borderLeft: '3px solid #F59E0B' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Armada Proyek Aktif</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{fleetOperating} Unit</div>
              <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 4 }}>Total: {totalUnits} Unit</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #10B981' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tingkat Utilisasi Armada</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: 'var(--status-operating)' }}>
                {totalUnits > 0 ? ((fleetOperating / totalUnits) * 100).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Target: 85%</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #EC4899' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Unit Breakdown / Servis</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#EC4899' }}>{fleetMaintenance + fleetBreakdown} Unit</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {fleetBreakdown} Breakdown &bull; {fleetMaintenance} Maintenance
              </div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #3B82F6' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Jam Kerja (HM)</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{new Intl.NumberFormat('id-ID').format(totalHM)} HM</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Akumulasi seluruh armada</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🏗️ Status Armada per Unit</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {unitSorotan.rows.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.brand} {item.model}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>SN: {item.serialNumber} &bull; {new Intl.NumberFormat('id-ID').format(item.hourMeter || 0)} HM</div>
                    </div>
                    <span className={`badge ${item.status === 'ON_PROJECT' || item.status === 'RENTED' ? 'badge-success' : item.status === 'MAINTENANCE' || item.status === 'BREAKDOWN' ? 'badge-warning' : 'badge-muted'}`}>
                      {item.status}
                    </span>
                  </div>
                ))}
                {totalUnits === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada unit terdaftar</div>
                )}
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>⚡ Operasional Kontraktor</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => navigate('/units')}>🚜 Alokasi & Plotting Fleet</button>
                <button className="btn btn-secondary" onClick={() => navigate('/warehouse')}>📦 Gudang Sparepart Proyek</button>
                <button className="btn btn-secondary" onClick={() => navigate('/purchase')}>🛍️ Pembelian Sparepart / BBM</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. KONTEN PERUSAHAAN SEWA (RENTAL) */}
      {activeProfileTab === 'RENTAL' && (
        <div>
          <div className="grid-4 mb-4 stagger-2">
            <div className="card stat-card" style={{ borderLeft: '3px solid #8B5CF6' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Kontrak Sewa Aktif</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{kontrakAktif.total} Kontrak</div>
              <div style={{ fontSize: 11, color: '#8B5CF6', marginTop: 4 }}>Total: {totalKontrak} Kontrak</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #10B981' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pendapatan Rental MTD</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: 'var(--status-operating)' }}>{fmt(tagihanSewaBulanan)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Tagihan Sewa Bulanan</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #EF4444' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Piutang Sewa (AR)</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#EF4444' }}>{fmt(piutangPokok - piutangTerbayar)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{piutangJumlah} Invoice Belum Lunas</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #3B82F6' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Unit Disewa</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{fleetRented} Unit</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Sedang Beroperasi di Jobsite</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🚚 Kontrak Rental Aktif</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {kontrakAktif.rows.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.customerName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.contractNo} &bull; {item.unitModel}</div>
                    </div>
                    <span className="badge badge-purple">{fmt(item.monthlyRate)}/bln</span>
                  </div>
                ))}
                {kontrakAktif.total === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Tidak ada kontrak aktif</div>
                )}
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>⚡ Operasional Rental</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => navigate('/rental')}>📄 Kelola Kontrak Sewa</button>
                <button className="btn btn-secondary" onClick={() => navigate('/invoices')}>🧾 Terbitkan Invoice Rental</button>
                <button className="btn btn-secondary" onClick={() => navigate('/delivery')}>🚚 Surat Jalan Mobilisasi</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. KONTEN BENGKEL / WORKSHOP */}
      {activeProfileTab === 'WORKSHOP' && (
        <div>
          <div className="grid-4 mb-4 stagger-2">
            <div className="card stat-card" style={{ borderLeft: '3px solid #EC4899' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Work Order (WO) Aktif</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{woAktif.total} WO</div>
              <div style={{ fontSize: 11, color: '#EC4899', marginTop: 4 }}>{serviceCountOf('IN_PROGRESS')} Sedang Dikerjakan &bull; {serviceCountOf('WAITING_PARTS')} Menunggu Part</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #10B981' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>WO Selesai Bulan Ini</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: 'var(--status-operating)' }}>{serviceCountOf('COMPLETED')} WO</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Pendapatan Jasa: {fmt(pendapatanJasaSelesai)}</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #3B82F6' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Spare Parts</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{totalSukuCadang} Item</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{lowStockAlerts.total} Stok Kritis</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #F59E0B' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Stok Sparepart Kritis</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#F59E0B' }}>{lowStockAlerts.total} Part</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Filter Solar & Seal Kit</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🔧 Antrean Work Order Bengkel</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {woAktif.rows.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.woNumber} &bull; {item.unitModel}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.complaintNotes || item.serviceType} &bull; Mekanik: {item.mechanicName}</div>
                    </div>
                    <span className={`badge ${item.status === 'IN_PROGRESS' ? 'badge-warning' : item.status === 'WAITING_PARTS' ? 'badge-danger' : 'badge-muted'}`}>
                      {item.status}
                    </span>
                  </div>
                ))}
                {woAktif.total === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Tidak ada WO aktif</div>
                )}
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>⚡ Modul Bengkel</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => navigate('/service')}>🔧 Kelola Work Order (WO)</button>
                <button className="btn btn-secondary" onClick={() => navigate('/spareparts')}>⚙️ Katalog Suku Cadang</button>
                <button className="btn btn-secondary" onClick={() => navigate('/warehouse')}>📦 Ambil Barang dari Gudang</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. KONTEN PEDAGANG ALAT BEKAS (TRADER) */}
      {activeProfileTab === 'TRADER' && (
        <div>
          <div className="grid-4 mb-4">
            <div className="card stat-card" style={{ borderLeft: '3px solid #06B6D4' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Stok Alat Tersedia</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{unitTersedia.total} Unit</div>
              <div style={{ fontSize: 11, color: '#06B6D4', marginTop: 4 }}>Total: {totalUnits} Unit</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #10B981' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Penjualan Selesai</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: 'var(--status-operating)' }}>{penjualanSelesai} Unit</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Total: {fmt(omsetPenjualan)}</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #F59E0B' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Prospect Aktif</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: '#F59E0B' }}>{spkAktif.total} Lead</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Menunggu Konfirmasi</div>
            </div>
            <div className="card stat-card" style={{ borderLeft: '3px solid #8B5CF6' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Jam Kerja</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{new Intl.NumberFormat('id-ID').format(totalHM)} HM</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Akumulasi seluruh unit</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>💰 Stok Alat Tersedia</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {unitTersedia.rows.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.brand} {item.model}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>SN: {item.serialNumber} &bull; {new Intl.NumberFormat('id-ID').format(item.hourMeter || 0)} HM</div>
                    </div>
                    <span className="badge badge-cyan">{item.status}</span>
                  </div>
                ))}
                {unitTersedia.total === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Tidak ada unit tersedia</div>
                )}
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>⚡ Modul Trader</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => navigate('/sales')}>💰 Form Penjualan Unit Second</button>
                <button className="btn btn-secondary" onClick={() => navigate('/purchase')}>📥 Pembelian Unit Bekas</button>
                <button className="btn btn-secondary" onClick={() => navigate('/units')}>🔍 Inspeksi Kondisi Unit</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
