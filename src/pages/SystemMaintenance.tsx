// src/pages/SystemMaintenance.tsx
// Halaman maintenance untuk auto-fix dan health monitoring

import { useState, useEffect } from 'react';
import { getErrorHandler } from '../utils/errorHandler';
import { getDataRecovery } from '../utils/dataRecovery';
import { getHealthCheck } from '../utils/healthCheck';
import { formatBytes, useDataStore } from '../store/dataStore';
import { SEMUA_COLLECTION } from '../store/collectionNeeds';

function sumRecords(counts: Record<string, number>): number {
  return Object.values(counts || {}).reduce((a, n) => a + (Number(n) || 0), 0);
}

function hasEntries(counts: Record<string, number>): boolean {
  return sumRecords(counts) > 0;
}

function describeCounts(counts: Record<string, number>): string {
  return Object.entries(counts || {})
    .filter(([, n]) => Number(n) > 0)
    .map(([name, n]) => `${name}=${n}`)
    .join(', ');
}

/** Desktop menampilkan ukuran berkas; mode browser menampilkan jumlah key. */
function describeBackup(backup: any): string {
  if (backup?.file) {
    return `${backup.totalRows ?? 0} baris · ${formatBytes(backup.bytes ?? 0)} · ${backup.file}`;
  }
  return `${Object.keys(backup?.data || {}).length} keys`;
}

export default function SystemMaintenance() {
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [errorLogs, setErrorLogs] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [storageUsage, setStorageUsage] = useState<any>(null);

  const errorHandler = getErrorHandler();
  const dataRecovery = getDataRecovery();
  const healthCheck = getHealthCheck();
  const { loadSampleData, migrationReport, ensureLoaded } = useDataStore();

  // Data contoh ditulis sebagai array penuh di semua collection, jadi collection
  // diminta di sini — bukan di gerbang rute. Membuka menu ini sekarang tidak
  // memindahkan apa pun dari file ke renderer; yang memindahkannya hanya tombol
  // ini, dan pemakai melihat indikator berjalan selama hidrasi.
  const handleLoadSampleData = async () => {
    if (!confirm('Muat data contoh ke database? Record yang id-nya sudah dipakai tidak ditimpa.')) return;
    setIsRunning(true);
    try {
      await ensureLoaded(SEMUA_COLLECTION);
      const added = loadSampleData();
      alert(added > 0 ? `${added} record contoh ditambahkan.` : 'Data contoh sudah ada semua di database.');
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    loadSystemInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSystemInfo = async () => {
    setIsRunning(true);
    try {
      // Load health status
      const health = await healthCheck.runHealthCheck();
      setHealthStatus(health);

      // Load error logs
      const logs = errorHandler.getLogs();
      setErrorLogs(logs);

      // Load backups
      const bkps = await dataRecovery.getBackups();
      setBackups(bkps);

      // Load storage usage
      const usage = await dataRecovery.getStorageUsage();
      setStorageUsage(usage);
    } catch (e) {
      console.error('Failed to load system info:', e);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunHealthCheck = async () => {
    setIsRunning(true);
    try {
      const health = await healthCheck.runHealthCheck();
      setHealthStatus(health);
    } catch (e) {
      console.error('Health check failed:', e);
    } finally {
      setIsRunning(false);
    }
  };

  const handleCreateBackup = async () => {
    const backup = await dataRecovery.createBackup('manual');
    if (backup) {
      setBackups([...backups, backup]);
      alert(backup.file
        ? `Snapshot database dibuat: ${backup.file}`
        : 'Backup berhasil dibuat');
    } else {
      alert('Backup gagal dibuat — periksa konsol untuk sebabnya.');
    }
  };

  const handleRestoreBackup = async (timestamp: string) => {
    if (!confirm('Pulihkan cadangan ini? Data saat ini digantikan, tetapi keadaan sebelum restore dicadangkan lebih dulu sebagai snapshot pengaman.')) return;
    const success = await dataRecovery.restoreBackup(timestamp);
    if (success) {
      alert('Backup berhasil direstore. Halaman akan direload.');
      window.location.reload();
    } else {
      alert('Gagal merestore backup — database saat ini tidak diubah.');
    }
  };

  const handleRepairData = async () => {
    if (confirm('Apakah Anda yakin ingin memperbaiki data? Ini akan membuat backup terlebih dahulu.')) {
      const result = await dataRecovery.repairData();
      alert(result.message);
      if (result.success) loadSystemInfo();
    }
  };

  const handleClearErrorLogs = () => {
    if (confirm('Apakah Anda yakin ingin menghapus semua error logs?')) {
      errorHandler.clearLogs();
      setErrorLogs([]);
    }
  };

  const handleClearBackups = async () => {
    if (!confirm('Hapus SEMUA snapshot cadangan?\n\nSetelah ini tidak ada jaring pengaman bila file database rusak. Buat backup file lewat menu Backup & Restore terlebih dahulu.')) return;
    const removed = await dataRecovery.clearBackups();
    setBackups([]);
    alert(removed > 0 ? `${removed} snapshot dihapus.` : 'Daftar backup dibersihkan.');
  };

  const handleExportErrorLogs = () => {
    const data = errorHandler.exportLogs();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FATHONI-ErrorLogs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportHealthReport = () => {
    const data = JSON.stringify(healthStatus, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FATHONI-HealthReport-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'pass':
        return 'var(--status-operating)';
      case 'degraded':
      case 'warn':
        return 'var(--status-maintenance)';
      case 'unhealthy':
      case 'fail':
        return 'var(--status-out)';
      default:
        return 'var(--text-muted)';
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>
          🔧 System Maintenance
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Monitoring kesehatan sistem dan perbaikan otomatis
        </p>
      </div>

      {/* Health Status */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Health Status</h2>
          <button
            onClick={handleRunHealthCheck}
            disabled={isRunning}
            className="btn btn-primary"
            style={{ padding: '8px 16px' }}
          >
            {isRunning ? 'Checking...' : '🔄 Run Health Check'}
          </button>
        </div>

        {healthStatus && (
          <div>
            <div style={{
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '16px',
              background: healthStatus.status === 'healthy' ? 'var(--status-operating)' : 
                         healthStatus.status === 'degraded' ? 'var(--status-maintenance)' : 
                         'var(--status-out)',
              color: 'white',
              textAlign: 'center',
              fontWeight: 600,
            }}>
              Status: {healthStatus.status.toUpperCase()}
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              {healthStatus.checks.map((check: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px',
                    background: 'var(--bg-elevated)',
                    borderRadius: '6px',
                    borderLeft: `4px solid ${getStatusColor(check.status)}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{check.name}</strong>
                    <span style={{ color: getStatusColor(check.status), fontWeight: 600 }}>
                      {check.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {check.message}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Storage Usage */}
      {storageUsage && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
            Storage Usage
          </h2>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Terpakai: {(storageUsage.usedKB / 1024).toFixed(2)} MB</span>
              <span>
                {storageUsage.limitKB > 0
                  ? `Batas: ${(storageUsage.limitKB / 1024).toFixed(1)} MB`
                  : 'Batas: hanya disk (file SQLite)'}
              </span>
            </div>
            {storageUsage.limitKB > 0 && (
              <div style={{
                height: '8px',
                background: 'var(--bg-tertiary)',
                borderRadius: '4px',
                overflow: 'hidden',
              }}>
                <div
                  style={{
                    height: '100%',
                    width: `${storageUsage.percentage}%`,
                    background: storageUsage.percentage > 80 ? 'var(--status-out)' :
                               storageUsage.percentage > 50 ? 'var(--status-maintenance)' :
                               'var(--status-operating)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            )}
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {storageUsage.source === 'sqlite'
                ? `Database: ${storageUsage.detail}`
                : `${storageUsage.percentage.toFixed(1)}% kuota localStorage terpakai`}
            </div>
          </div>
        </div>
      )}

      {/* Data & Migrasi */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
          Data &amp; Migrasi
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Database mulai kosong dan hanya berisi data yang Anda input. Data contoh tidak
          dimuat otomatis; gunakan tombol di bawah bila membutuhkan contoh untuk uji coba.
        </p>
        <button onClick={handleLoadSampleData} className="btn btn-secondary" disabled={isRunning}>
          {isRunning ? '⏳ Memuat collection dari database...' : '📦 Muat Data Contoh'}
        </button>

        {migrationReport && (
          <div style={{ marginTop: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <div style={{ fontWeight: 600, marginBottom: '6px' }}>
              Hasil migrasi data otomatis ({migrationReport.at})
            </div>
            <div>Record lama yang diimpor: {migrationReport.legacyRowsSeen} baris dibaca, {sumRecords(migrationReport.imported)} record masuk.</div>
            <div>Record contoh yang dibuang (tidak pernah diubah): {sumRecords(migrationReport.removedSamples)} record.</div>
            <div>Invoice yang dilengkapi untuk transaksi lama: {migrationReport.backfilledInvoices} invoice.</div>
            {hasEntries(migrationReport.imported) && (
              <div style={{ marginTop: '6px', fontFamily: 'monospace', fontSize: '12px' }}>
                Diimpor: {describeCounts(migrationReport.imported)}
              </div>
            )}
            {hasEntries(migrationReport.removedSamples) && (
              <div style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                Contoh dibuang: {describeCounts(migrationReport.removedSamples)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Data Recovery */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
          Data Recovery
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Cadangan otomatis berupa salinan file database di folder data aplikasi
          (subfolder <code>snapshots</code>), bukan salinan localStorage yang sejak
          Fase 4 hanya berisi arsip lama. Cadangan terbaru selalu dipertahankan; yang
          paling tua dipangkas otomatis.
        </p>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <button onClick={handleCreateBackup} className="btn btn-primary">
            💾 Create Backup
          </button>
          <button onClick={handleRepairData} className="btn btn-secondary">
            🔧 Repair Data
          </button>
          <button onClick={handleClearBackups} className="btn btn-secondary" style={{ background: 'var(--status-out)' }}>
            🗑️ Clear Backups
          </button>
        </div>

        <div style={{ maxHeight: '300px', overflow: 'auto' }}>
          {backups.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Tidak ada backup tersedia
            </div>
          ) : (
            backups.map((backup, idx) => (
              <div
                key={idx}
                style={{
                  padding: '12px',
                  background: 'var(--bg-elevated)',
                  borderRadius: '6px',
                  marginBottom: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {new Date(backup.timestamp).toLocaleString('id-ID')}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {describeBackup(backup)}
                  </div>
                </div>
                <button
                  onClick={() => handleRestoreBackup(backup.timestamp)}
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '13px' }}
                >
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Error Logs */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>
            Error Logs ({errorLogs.length})
          </h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleExportErrorLogs} className="btn btn-secondary">
              📥 Export
            </button>
            <button onClick={handleClearErrorLogs} className="btn btn-secondary" style={{ background: 'var(--status-out)' }}>
              🗑️ Clear
            </button>
          </div>
        </div>

        <div style={{ maxHeight: '400px', overflow: 'auto' }}>
          {errorLogs.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Tidak ada error log
            </div>
          ) : (
            errorLogs.slice(-10).reverse().map((log, idx) => (
              <div
                key={idx}
                style={{
                  padding: '12px',
                  background: 'var(--bg-elevated)',
                  borderRadius: '6px',
                  marginBottom: '8px',
                  borderLeft: `4px solid ${log.type === 'runtime' ? 'var(--status-out)' : 'var(--status-maintenance)'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px' }}>
                    {log.type.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {new Date(log.timestamp).toLocaleString('id-ID')}
                  </span>
                </div>
                <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                  {log.message}
                </div>
                {log.stack && (
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--status-maintenance)' }}>
                      Stack Trace
                    </summary>
                    <pre style={{ marginTop: '8px', fontSize: '11px', whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>
                      {log.stack}
                    </pre>
                  </details>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Health Report Export */}
      <div className="card">
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
          Export Reports
        </h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={handleExportHealthReport} className="btn btn-primary">
            📊 Export Health Report
          </button>
        </div>
      </div>
    </div>
  );
}
