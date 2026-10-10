// src/pages/ControlTower.tsx
// Menara pantau: semuanya COUNT dan satu halaman kecil. Angka fleet tidak lagi
// dihitung dengan menelusuri seluruh units/services/spareParts/invoices di
// renderer — pada profil kerja yang datanya puluhan ribu baris, loop itu yang
// membuat jendela membeku begitu menu dibuka.

import React from 'react';
import { useDataStore } from '../store/dataStore';
import { isoDay } from '../domain/revenue';
import { useCollectionCount, useCollectionQuery } from '../hooks/useCollectionTotals';

/** Kartu FLEET OVERVIEW: satu COUNT per kelompok status. */
const WHERE_OPERATING = { status: { in: ['ON_PROJECT', 'RENTED'] } };
const WHERE_IDLE = { status: 'AVAILABLE' };
const WHERE_MAINTENANCE = { status: 'MAINTENANCE' };
const WHERE_BREAKDOWN = { status: 'BREAKDOWN' };
/** 'aktif' lewat nin, bukan daftar status lengkap: status baru dari menu lain
 *  tidak boleh diam-diam berhenti dihitung di sini. */
const WHERE_WO_ACTIVE = { status: { nin: ['COMPLETED'] } };
const WHERE_LOW_STOCK = { stockShortfall: { lte: 0 } };

/** Tile LIVE OPERATION hanya perlu beberapa unit pertama. */
const LIVE_LIMIT = 8;

const ControlTower: React.FC = () => {
  const { units, services, spareParts, invoices, savedTick } = useDataStore();

  // Piutang lewat tempo: `gt: ''` mengeluarkan invoice tanpa tanggal jatuh tempo,
  // sama seperti `new Date('') < today` yang selalu false di hitungan lama.
  const whereOverdue = { status: { nin: ['PAID'] }, dueDate: { gt: '', lt: isoDay(0) } };

  const totalFleet = useCollectionCount('units', undefined, units, savedTick.units);
  const fleetOperating = useCollectionCount('units', WHERE_OPERATING, units, savedTick.units);
  const fleetIdle = useCollectionCount('units', WHERE_IDLE, units, savedTick.units);
  const fleetMaintenance = useCollectionCount('units', WHERE_MAINTENANCE, units, savedTick.units);
  const fleetBreakdown = useCollectionCount('units', WHERE_BREAKDOWN, units, savedTick.units);
  const serviceDueAlerts = useCollectionCount('services', WHERE_WO_ACTIVE, services, savedTick.services);
  const lowStockAlerts = useCollectionCount('spareParts', WHERE_LOW_STOCK, spareParts, savedTick.spareParts);
  const overdueInvoices = useCollectionCount('invoices', whereOverdue, invoices, savedTick.invoices);
  const liveUnits = useCollectionQuery({ collection: 'units', limit: LIVE_LIMIT }, units, savedTick.units);

  // Kartu alert breakdown memakai COUNT yang sama dengan tile BREAKDOWN di atas;
  // dua kueri identik hanya membuat menu ini dua kali lebih lambat.
  const breakdownAlerts = fleetBreakdown;

  // Calculate health score for each unit
  const calculateHealthScore = (unit: any) => {
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

  const getUnitStatusColor = (status: string) => {
    switch (status) {
      case 'ON_PROJECT':
      case 'RENTED':
        return '#10B981'; // Green
      case 'AVAILABLE':
        return '#3B82F6'; // Blue
      case 'MAINTENANCE':
        return '#F59E0B'; // Orange
      case 'BREAKDOWN':
        return '#EF4444'; // Red
      default:
        return '#6B7280'; // Gray
    }
  };

  const getUnitStatusIcon = (status: string) => {
    switch (status) {
      case 'ON_PROJECT':
      case 'RENTED':
        return '🟢';
      case 'AVAILABLE':
        return '🔵';
      case 'MAINTENANCE':
        return '🟠';
      case 'BREAKDOWN':
        return '🔴';
      default:
        return '⚪';
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">🏰 FATHONI Control Tower</h1>
          <p className="page-subtitle">Dashboard operasional real-time untuk monitoring fleet dan alert</p>
        </div>
      </div>

      {/* Fleet Overview */}
      <div className="card mb-4" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>FLEET OVERVIEW</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          <div style={{ textAlign: 'center', padding: 20, background: 'var(--bg-elevated)', borderRadius: 12 }}>
            <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--text-primary)' }}>{totalFleet}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase' }}>FLEET</div>
          </div>
          <div style={{ textAlign: 'center', padding: 20, background: 'rgba(16, 185, 129, 0.1)', borderRadius: 12, border: '2px solid #10B981' }}>
            <div style={{ fontSize: 48, fontWeight: 800, color: '#10B981' }}>{fleetOperating}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase' }}>OPERATING</div>
          </div>
          <div style={{ textAlign: 'center', padding: 20, background: 'rgba(59, 130, 246, 0.1)', borderRadius: 12, border: '2px solid #3B82F6' }}>
            <div style={{ fontSize: 48, fontWeight: 800, color: '#3B82F6' }}>{fleetIdle}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase' }}>IDLE</div>
          </div>
          <div style={{ textAlign: 'center', padding: 20, background: 'rgba(245, 158, 11, 0.1)', borderRadius: 12, border: '2px solid #F59E0B' }}>
            <div style={{ fontSize: 48, fontWeight: 800, color: '#F59E0B' }}>{fleetMaintenance}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase' }}>MAINTENANCE</div>
          </div>
          <div style={{ textAlign: 'center', padding: 20, background: 'rgba(239, 68, 68, 0.1)', borderRadius: 12, border: '2px solid #EF4444' }}>
            <div style={{ fontSize: 48, fontWeight: 800, color: '#EF4444' }}>{fleetBreakdown}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase' }}>BREAKDOWN</div>
          </div>
        </div>
      </div>

      {/* Live Operation */}
      <div className="card mb-4" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>LIVE OPERATION</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          {liveUnits.rows.map((unit, idx) => (
            <div
              key={unit.id ?? idx}
              style={{
                padding: 16, 
                background: 'var(--bg-elevated)', 
                borderRadius: 8, 
                border: `2px solid ${getUnitStatusColor(unit.status)}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>{getUnitStatusIcon(unit.status)}</span>
                  <div style={{ fontWeight: 700 }}>{unit.brand} {unit.model}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {unit.location} &bull; {new Intl.NumberFormat('id-ID').format(unit.hourMeter || 0)} HM
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: getUnitStatusColor(unit.status) }}>
                {unit.status === 'BREAKDOWN' ? 'BREAKDOWN' : `${calculateHealthScore(unit)}%`}
              </div>
            </div>
          ))}
          {liveUnits.total === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
              Belum ada unit
            </div>
          )}
        </div>
      </div>

      {/* Alerts */}
      <div className="card mb-4" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>ALERTS</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
          <div style={{ padding: 20, background: 'rgba(239, 68, 68, 0.1)', borderRadius: 12, border: '2px solid #EF4444' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>🔴</span>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#EF4444' }}>{breakdownAlerts}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Breakdown</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Unit yang rusak perlu perhatian</div>
          </div>
          
          <div style={{ padding: 20, background: 'rgba(245, 158, 11, 0.1)', borderRadius: 12, border: '2px solid #F59E0B' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>🟠</span>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#F59E0B' }}>{serviceDueAlerts}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Service Due</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Unit yang perlu service</div>
          </div>
          
          <div style={{ padding: 20, background: 'rgba(245, 158, 11, 0.1)', borderRadius: 12, border: '2px solid #F59E0B' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>🟡</span>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#F59E0B' }}>{lowStockAlerts}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Sparepart Low</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Stok sparepart menipis</div>
          </div>
          
          <div style={{ padding: 20, background: 'rgba(59, 130, 246, 0.1)', borderRadius: 12, border: '2px solid #3B82F6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>🔵</span>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#3B82F6' }}>{overdueInvoices}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Invoice Overdue</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Invoice yang jatuh tempo</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>QUICK ACTIONS</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <button className="btn btn-primary" style={{ textAlign: 'left', justifyContent: 'flex-start' }}>
            🚜 View All Units
          </button>
          <button className="btn btn-secondary" style={{ textAlign: 'left', justifyContent: 'flex-start' }}>
            🔧 View All Services
          </button>
          <button className="btn btn-secondary" style={{ textAlign: 'left', justifyContent: 'flex-start' }}>
            📦 View All Spareparts
          </button>
          <button className="btn btn-secondary" style={{ textAlign: 'left', justifyContent: 'flex-start' }}>
            💰 View All Invoices
          </button>
        </div>
      </div>
    </div>
  );
};

export default ControlTower;
