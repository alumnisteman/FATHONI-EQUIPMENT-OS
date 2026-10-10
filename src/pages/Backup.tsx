// src/pages/Backup.tsx
// 1. Backup mengambil data LIVE: di desktop sumbernya file SQLite, bukan
//    salinan localStorage yang sejak Fase 4 hanya berisi arsip pra-migrasi
// 2. Restore divalidasi penuh SEBELUM satu key pun ditimpa, dan bisa di-rollback
// 3. Snapshot berkas database: cadangan lokal + restore dengan quick_check
// 4. Menampilkan ukuran data & jumlah record

import { useState, useCallback, useEffect } from 'react';
import { formatBytes, markRestorePending, clearRestorePending } from '../store/dataStore';
import { STORAGE_KEY, COLLECTION_KEYS } from '../store/collections';
import { collectPhotoIds } from '../utils/photoStore';
import { SESSION_STORAGE_KEY } from '../services/authClient';
import { getDataRecovery, collectSnapshotSettings, type StorageUsage } from '../utils/dataRecovery';
import {
  dbAvailable, dbLoadStore, dbSaveStore, dbSnapshotCreate, dbSnapshotList,
  dbSnapshotRestore, snapshotAvailable, type SnapshotMeta,
} from '../services/dbClient';
import { isLegacyArchiveKey } from '../store/dataMigration';

/** Key sesi tidak boleh berpindah lewat berkas backup. */
const SESSION_KEYS = [SESSION_STORAGE_KEY, 'hems_session'];

function isSessionKey(key: string): boolean {
  return SESSION_KEYS.includes(key);
}

/** Arsip lama (HEMS_DATA_BACKUPS, HEMS_HEALTH_LOGS, key sumber pra-migrasi) dibekukan:
 *  tetap ada di profil, tetapi tidak ikut dibackup atau di-restore. */
function isFrozenArchive(key: string): boolean {
  return isLegacyArchiveKey(key);
}

/** Kumpulkan seluruh data aplikasi. Di desktop isi database diambil dari SQLite. */
async function collectAllData(): Promise<Record<string, any>> {
  const allData: Record<string, any> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (isSessionKey(key)) continue;
    if (isFrozenArchive(key)) continue;
    // Ambil semua key kecuali error/health logs (opsional, tidak kritikal)
    if (key.startsWith('hems_') || key.startsWith('HEMS_')) {
      try {
        const val = localStorage.getItem(key);
        if (val) allData[key] = JSON.parse(val);
      } catch {
        // Skip key yang tidak bisa diparse
      }
    }
  }

  if (dbAvailable()) {
    // hems_data_store_v1 di localStorage sudah menjadi arsip. Bila pembacaan
    // database gagal, arsip itu tidak boleh lolos menjadi isi backup: yang
    // terjadi adalah file cadangan berisi data lama tanpa peringatan.
    // Permintaan penuh SATU SATUNYA di aplikasi: cadangan harus berisi semuanya,
    // termasuk collection yang tidak pernah dibacakan ke layar yang sedang terbuka.
    // (Pencatat jalur baca di main process menunggu permintaan seperti ini.)
    const live = await dbLoadStore();
    if (!live) throw new Error('Database tidak bisa dibaca — backup dibatalkan agar tidak menyimpan data setengah.');
    allData[STORAGE_KEY] = live;
  }
  return allData;
}

// Semua collection harus ikut saat menulis ke SQLite: saveCollection menghapus
// baris yang tidak ada dalam kiriman, sehingga kiriman parsial berarti data hilang.
function normalizeStore(mainData: any): Record<string, any[]> {
  const store: Record<string, any[]> = {};
  COLLECTION_KEYS.forEach(name => {
    const rows = mainData?.[name];
    store[name] = Array.isArray(rows) ? rows : [];
  });
  return store;
}

/** Hitung ringkasan data */
function getDataSummary(data: Record<string, any>): string[] {
  const summary: string[] = [];
  const mainData = data[STORAGE_KEY];
  if (mainData) {
    COLLECTION_KEYS.forEach(k => {
      if (Array.isArray(mainData[k]) && mainData[k].length > 0) {
        summary.push(`${k}: ${mainData[k].length} record`);
      }
    });
  }
  return summary;
}

// ── Validasi file backup ──────────────────────────────────────

type RestoreCheck =
  | { ok: true; meta: any; entries: [string, any][]; skipped: string[]; photoIds: string[] }
  | { ok: false; errors: string[] };

const PHOTO_FILE_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.(jpg|jpeg|png|webp)$/i;

// Versi SKEMA file backup, bukan versi aplikasi. Restore menolak file yang
// skemanya tidak dinyatakan.
const BACKUP_SCHEMA_VERSION = '1.0.0';

/** Hanya key data aplikasi yang boleh ditulis ulang oleh proses restore. */
function keyIsRestorable(key: string): boolean {
  if (!key.startsWith('hems_') && !key.startsWith('HEMS_')) return false;
  if (isSessionKey(key)) return false;           // sesi login bukan data bisnis
  if (isFrozenArchive(key)) return false;        // arsip lama tidak ditimpa kembali
  if (key.includes('_corrupt_')) return false;   // karantina tidak dipasang kembali
  if (key === 'hems_error_logs') return false;   // log diagnostik, bukan data
  if (key === 'hems_health_logs') return false;
  return true;
}

function inspectPayload(raw: string): RestoreCheck {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['File bukan JSON yang valid (kemungkinan rusak di tengah).'] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['Struktur file tidak dikenali.'] };
  }

  const meta = parsed._meta;
  if (!meta || typeof meta.version !== 'string' || meta.version.trim() === '') {
    return {
      ok: false,
      errors: ['File tidak punya _meta.version. Restore menolak backup tanpa versi karena skenanya tidak bisa dipastikan.'],
    };
  }

  const data = parsed.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['Field "data" tidak ditemukan atau bukan object — hanya format { _meta, data } yang diterima.'] };
  }

  const errors: string[] = [];
  const entries: [string, any][] = [];
  const skipped: string[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (!keyIsRestorable(key)) {
      skipped.push(key);
      return;
    }
    if (value === null || value === undefined) {
      errors.push(`${key}: isinya kosong.`);
      return;
    }
    if (key === STORAGE_KEY) {
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${key}: bukan object database.`);
        return;
      }
      const store = value as Record<string, unknown>;
      COLLECTION_KEYS.forEach(collection => {
        const arr = store[collection];
        if (arr === undefined || arr === null) return; // collection kosong diizinkan
        if (!Array.isArray(arr)) {
          errors.push(`${key}.${collection}: seharusnya array, ditemukan ${typeof arr}.`);
          return;
        }
        if (arr.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
          errors.push(`${key}.${collection}: berisi item yang bukan record.`);
        }
      });
    }
    entries.push([key, value]);
  });

  if (errors.length > 0) return { ok: false, errors };
  if (!entries.some(([key]) => key === STORAGE_KEY)) {
    return { ok: false, errors: ['File tidak berisi database utama (hems_data_store_v1) — ini bukan backup data FATHONI.'] };
  }
  if (entries.length === 0) {
    return { ok: false, errors: ['Tidak ada key yang bisa dipulihkan.'] };
  }

  const photoIds: string[] = Array.isArray(meta.photoIds)
    ? meta.photoIds.filter((id: unknown) => typeof id === 'string' && PHOTO_FILE_RE.test(id))
    : [];

  return { ok: true, meta, entries, skipped, photoIds };
}

/**
 * Tulis seluruh key hasil validasi. Semua nilai lama diambil lebih dulu supaya
 * kegagalan di tengah jalan (mis. kuota storage habis) bisa dikembalikan utuh.
 */
function applyRestore(entries: [string, any][], log: (msg: string) => void): { ok: boolean; error?: string } {
  const snapshot = new Map<string, string | null>();
  entries.forEach(([key]) => snapshot.set(key, localStorage.getItem(key)));

  // Setelah ini autosave/flush store lama di memori tidak boleh menulis.
  markRestorePending();

  try {
    entries.forEach(([key, value]) => {
      localStorage.setItem(key, JSON.stringify(value));
    });
    return { ok: true };
  } catch (err: any) {
    snapshot.forEach((prev, key) => {
      try {
        if (prev === null) localStorage.removeItem(key);
        else localStorage.setItem(key, prev);
      } catch {
        log(`🚨 Gagal mengembalikan key ${key} — data key ini mungkin perlu dipulihkan manual dari file backup.`);
      }
    });
    clearRestorePending(); // store lama masih utuh, autosave boleh lanjut
    return {
      ok: false,
      error: err?.name === 'QuotaExceededError'
        ? 'Storage habis saat menulis backup. Data lama dikembalikan seperti semula.'
        : `Penulisan gagal (${err?.name ?? 'Error'}). Data lama dikembalikan seperti semula.`,
    };
  }
}

export default function Backup() {
  const [status, setStatus]        = useState<'idle'|'backing-up'|'restoring'|'done'>('idle');
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [log, setLog]              = useState<string[]>([]);
  const [dataSummary, setDataSummary] = useState<string[]>([]);
  const [snapshots, setSnapshots]  = useState<SnapshotMeta[]>([]);
  const [storage, setStorage]      = useState<StorageUsage | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog(l => [...l, `[${new Date().toLocaleTimeString('id-ID')}] ${msg}`]);
  }, []);

  const refreshSnapshots = useCallback(async () => {
    if (!snapshotAvailable()) return;
    setSnapshots(await dbSnapshotList());
  }, []);

  useEffect(() => {
    void refreshSnapshots();
    void getDataRecovery().getStorageUsage().then(setStorage);
  }, [refreshSnapshots]);

  // ── SNAPSHOT BERKAS DATABASE ────────────────────────────
  const doSnapshot = async () => {
    setStatus('backing-up');
    addLog('Membuat snapshot file database...');
    const result = await dbSnapshotCreate('manual', collectSnapshotSettings());
    if (result.ok) {
      const s = result.snapshot;
      setLastBackup(s.name);
      addLog(`✅ Snapshot ${s.name}: ${s.totalRows} baris, ${formatBytes(s.bytes)}, checksum ${s.checksum.slice(0, 10)}`);
      await refreshSnapshots();
    } else {
      addLog(`❌ Snapshot gagal: ${result.error}`);
    }
    setStatus('done');
    setTimeout(() => setStatus('idle'), 2000);
  };

  const doSnapshotRestore = async (snap: SnapshotMeta) => {
    if (!confirm(
      `Pulihkan snapshot ${new Date(snap.createdAt).toLocaleString('id-ID')} (${snap.totalRows} baris)?\n\n` +
      'Seluruh data saat ini digantikan oleh isi snapshot tersebut. Keadaan sebelum restore dicadangkan lebih dulu, ' +
      'dan file database hanya diganti bila periksa integritas (quick_check) lulus.\n\nLanjutkan?'
    )) return;

    setStatus('restoring');
    addLog(`Memulihkan dari snapshot ${snap.name}...`);
    const result = await dbSnapshotRestore(snap.name, collectSnapshotSettings());
    if (!result.ok) {
      addLog(`❌ ${result.error}${result.rolledBack ? ' — keadaan sebelum restore sudah dipakai kembali.' : ' — database belum diubah.'}`);
      setStatus('idle');
      return;
    }

    Object.entries(result.settings).forEach(([key, value]) => {
      try { localStorage.setItem(key, value); }
      catch { addLog(`🚨 Settings "${key}" tidak bisa ditulis kembali.`); }
    });
    addLog('ℹ️ Berkas foto unit tidak ikut snapshot — foto hidup di folder photos dan harus disalin lewat Backup file.');
    addLog(`✅ Snapshot dipulihkan: ${result.snapshot.totalRows} baris, quick_check ${result.quickCheck.join(' / ')}`);
    await refreshSnapshots();
    addLog('🔄 Memuat ulang aplikasi dalam 2 detik...');
    setTimeout(() => window.location.reload(), 2000);
  };

  // ── BACKUP ──────────────────────────────────────────────
  const doBackup = async () => {
    setStatus('backing-up');
    addLog('Memulai proses backup database...');

    try {
      // Kumpulkan SEMUA data aktual (di desktop: dari file SQLite)
      const allData = await collectAllData();
      const summary = getDataSummary(allData);
      setDataSummary(summary);

      // Foto unit tidak disimpan di database, jadi daftar berkasnya ikut
      // dicatat di _meta supaya proses restore bisa meminta foldernya.
      const photoIds = collectPhotoIds(allData[STORAGE_KEY]?.units ?? []);

      let appVersion = 'tidak diketahui';
      try {
        const info = await (window as any).electronAPI?.getSystemInfo?.();
        if (info?.version) appVersion = info.version;
      } catch { /* mode browser — versi aplikasi tidak tersedia */ }

      const exportPayload = JSON.stringify({
        _meta: {
          appName: 'FATHONI EQUIPMENT OS',
          version: BACKUP_SCHEMA_VERSION,
          appVersion,
          // Dari mana hems_data_store_v1 di file ini berasal. Dicatat supaya
          // restore bisa menjelaskan apa yang sebenarnya dipulihkan.
          source: dbAvailable() ? 'sqlite' : 'localstorage',
          timestamp: new Date().toISOString(),
          keyCount: Object.keys(allData).length,
          collections: summary.length,
          photoIds,
        },
        data: allData,
      }, null, 2);

      const sizeKB = Math.round(exportPayload.length / 1024);
      addLog(`Data terkumpul: ${summary.length} tabel, ~${sizeKB} KB`);
      summary.forEach(s => addLog(`  📦 ${s}`));

      const api = (window as any).electronAPI;
      if (api?.exportBackup) {
        addLog('Membuka dialog simpan file...');
        const result = await api.exportBackup(exportPayload);
        if (result.success) {
          setLastBackup(result.filePath);
          addLog(`✅ Backup berhasil disimpan: ${result.filePath}`);
          if (photoIds.length > 0) {
            addLog(`🖼️ ${photoIds.length} berkas foto tersimpan terpisah dari file .sanybak.`);
            if (confirm(`Sertakan ${photoIds.length} berkas foto ke backup?\n\nPilih folder untuk menyalinnya (subfolder "photos" dibuat otomatis).`)) {
              const copied = await api.copyPhotosTo(photoIds);
              if (copied.success) {
                addLog(`✅ ${copied.copied} berkas foto disalin ke ${copied.dir}${copied.missing ? ` (${copied.missing} tidak ditemukan)` : ''}`);
              } else if (!copied.canceled) {
                addLog(`❌ Foto gagal disertakan: ${copied.error}`);
              }
            }
          }
        } else if (result.canceled) {
          addLog('⚠️ Backup dibatalkan oleh pengguna.');
        } else {
          addLog(`❌ Backup gagal: ${result.error}`);
        }
      } else {
        // Demo mode: download sebagai file
        addLog('Mode demo — mengunduh file backup...');
        if (photoIds.length > 0) {
          addLog('⚠️ Mode browser: berkas foto di IndexedDB TIDAK ikut file .sanybak ini.');
        }
        const blob = new Blob([exportPayload], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `FATHONI_Backup_${new Date().toISOString().slice(0, 10)}.sanybak`;
        a.click();
        URL.revokeObjectURL(url);
        setLastBackup(a.download);
        addLog(`✅ Backup berhasil diunduh: ${a.download}`);
      }
    } catch (e: any) {
      addLog(`❌ Error: ${e.message}`);
    }

    setStatus('done');
    setTimeout(() => setStatus('idle'), 2000);
  };

  // ── RESTORE ─────────────────────────────────────────────
  const doRestore = async () => {
    if (!confirm(
      'PERINGATAN: Restore akan MENGGANTIKAN seluruh data saat ini dengan data dari file backup.\n\n' +
      'Pastikan Anda sudah melakukan backup terbaru sebelum melanjutkan.\n\nLanjutkan?'
    )) return;

    setStatus('restoring');
    addLog('Memulai proses restore...');

    try {
      const api = (window as any).electronAPI;

      let rawContent: string | null = null;

      if (api?.restoreBackup) {
        addLog('Membuka dialog pilih file backup...');
        const result = await api.restoreBackup();
        if (result.success) {
          rawContent = result.data;
          addLog(`📂 File dimuat: ${result.filePath}`);
        } else if (result.canceled) {
          addLog('⚠️ Restore dibatalkan.');
          setStatus('idle');
          return;
        } else {
          addLog(`❌ Restore gagal: ${result.error}`);
          setStatus('idle');
          return;
        }
      } else {
        // Demo mode: buka file picker browser
        addLog('Mode demo — membuka file picker...');
        rawContent = await new Promise<string | null>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.sanybak,.json';
          input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
          };
          input.click();
        });

        if (!rawContent) {
          addLog('⚠️ Restore dibatalkan atau file gagal dibaca.');
          setStatus('idle');
          return;
        }
      }

      // Validasi penuh sebelum satu key pun disentuh
      if (!rawContent) {
        addLog('⚠️ Tidak ada isi file yang terbaca.');
        setStatus('idle');
        return;
      }

      const check = inspectPayload(rawContent);
      if (!check.ok) {
        addLog('❌ Restore DIBATALKAN — data saat ini tidak diubah sama sekali:');
        check.errors.forEach(e => addLog(`   • ${e}`));
        setStatus('idle');
        return;
      }

      addLog(`📋 Backup dari: ${check.meta.timestamp || 'tidak diketahui'}`);
      addLog(`📋 Versi skema: ${check.meta.version} (dibuat aplikasi ${check.meta.appVersion ?? 'versi lama'}, sumber ${check.meta.source ?? 'localstorage'})`);
      if (check.skipped.length > 0) {
        addLog(`ℹ️ Dilewati (bukan data yang boleh ditimpa): ${check.skipped.join(', ')}`);
      }

      // Snapshot pengaman lebih dulu: restore JSON menggantikan seluruh isi
      // database, dan bila file backupnya ternyata bukan yang dimaksud, keadaan
      // sebelum restore harus masih bisa diambil kembali.
      if (snapshotAvailable()) {
        const guard = await dbSnapshotCreate('pra-restore', collectSnapshotSettings());
        if (!guard.ok) {
          addLog(`🚨 Snapshot pengaman gagal dibuat (${guard.error}) — restore dibatalkan, data belum diubah sama sekali.`);
          setStatus('idle');
          return;
        }
        addLog(`🛡️ Snapshot pengaman ${guard.snapshot.name} dibuat sebelum restore.`);
      }

      // Di desktop hems_data_store_v1 di localStorage adalah arsip pra-migrasi:
      // tidak boleh ditimpa, isinya masuk ke SQLite saja.
      const desktop = dbAvailable();
      const entries = desktop ? check.entries.filter(([key]) => key !== STORAGE_KEY) : check.entries;
      if (desktop && check.entries.length !== entries.length) {
        addLog('ℹ️ Arsip localStorage tidak disentuh; isi database ditulis ke file SQLite.');
      }

      const result = applyRestore(entries, addLog);
      if (!result.ok) {
        addLog(`❌ ${result.error}`);
        setStatus('idle');
        return;
      }

      addLog(`✅ ${entries.length} key data dipulihkan: ${entries.map(([k]) => k).join(', ')}`);

      // Aplikasi desktop membaca data dari file SQLite, jadi isi backup harus
      // masuk ke sana juga — menulis localStorage saja tidak akan terlihat
      // setelah muat ulang.
      let dbWritten = true;
      if (desktop) {
        const mainStore = check.entries.find(([key]) => key === STORAGE_KEY)?.[1];
        const written = await dbSaveStore(normalizeStore(mainStore));
        dbWritten = written !== null;
        addLog(written
          ? '✅ Database SQLite sudah berisi data hasil restore.'
          : '🚨 Gagal menulis database SQLite. Yang tampil masih data lama — aplikasi TIDAK dimuat ulang, ulangi restore.');
      }

      if (check.photoIds.length > 0) {
        if (api?.restorePhotosFrom) {
          addLog(`🖼️ Backup ini mencatat ${check.photoIds.length} berkas foto.`);
          if (confirm(`Pulihkan berkas foto dari folder cadangan?\n\nPilih folder yang berisi subfolder "photos" hasil backup.`)) {
            const restored = await api.restorePhotosFrom(check.photoIds);
            if (restored.success) {
              addLog(`✅ ${restored.restored} berkas foto dikembalikan ke folder data aplikasi.`);
            } else if (!restored.canceled) {
              addLog(`❌ Foto tidak dipulihkan: ${restored.error}`);
            }
          }
        } else {
          addLog('⚠️ Mode browser: berkas foto tidak ikut dipulihkan dari file ini.');
        }
      }

      if (!dbWritten) {
        setStatus('idle');
        return;
      }

      addLog('🔄 Memuat ulang aplikasi dalam 2 detik...');

      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (e: any) {
      addLog(`❌ Error: ${e.message}`);
    }

    setStatus('done');
    setTimeout(() => setStatus('idle'), 3000);
  };

  // ── Storage Info ────────────────────────────────────────
  // Angka diambil dari dataRecovery: file SQLite di desktop, kuota localStorage
  // di mode browser. Menampilkan kuota 5 MB untuk database yang sudah pindah ke
  // berkas hanya akan menakut-nakuti.
  const storageInfo = storage;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Backup & Restore</h1>
          <p className="page-subtitle">Cadangkan dan pulihkan seluruh data database FATHONI EQUIPMENT OS</p>
        </div>
      </div>

      {/* Storage Usage */}
      <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>📊 Penggunaan Storage</span>
          <span style={{ fontSize: 12, color: storageInfo && storageInfo.limitKB > 0 && storageInfo.percentage > 80 ? 'var(--status-out)' : 'var(--text-muted)' }}>
            {!storageInfo ? 'menghitung...' : storageInfo.limitKB > 0
              ? `${storageInfo.usedKB} KB / ${storageInfo.limitKB} KB (${storageInfo.percentage}%)`
              : `${formatBytes(storageInfo.usedKB * 1024)} file database — tanpa batas tetap`}
          </span>
        </div>
        {storageInfo && storageInfo.limitKB > 0 && (
          <>
            <div style={{ height: 8, background: 'var(--bg-base)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4, transition: 'width 0.3s',
                width: `${Math.min(storageInfo.percentage, 100)}%`,
                background: storageInfo.percentage > 85 ? '#ef4444' : storageInfo.percentage > 60 ? '#f59e0b' : '#22c55e',
              }} />
            </div>
            {storageInfo.percentage > 80 && (
              <p style={{ fontSize: 11, color: 'var(--status-out)', marginTop: 6 }}>
                ⚠️ Storage hampir penuh! Segera lakukan backup dan bersihkan data lama.
              </p>
            )}
          </>
        )}
        {storageInfo && storageInfo.limitKB === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            {storageInfo.detail} — batasnya hanya kapasitas disk, bukan kuota browser.
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Backup */}
        <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ width: 64, height: 64, background: 'rgba(59,130,246,0.12)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth={1.5} width={32} height={32}>
              <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"/>
            </svg>
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Backup Database</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
            Simpan seluruh data ke file <code style={{ fontFamily: 'monospace', background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>.sanybak</code> yang dapat dipulihkan kapan saja.
            Isinya data yang sedang dipakai — di desktop dibaca langsung dari file database, bukan dari arsip lama.
          </p>
          {lastBackup && (
            <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 11, color: 'var(--status-operating)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              Terakhir: {lastBackup}
            </div>
          )}
          <button id="btn-backup" className="btn btn-primary" style={{ background: 'var(--accent-blue)' }} onClick={doBackup} disabled={status !== 'idle'}>
            {status === 'backing-up' ? (
              <><svg className="animate-spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Mencadangkan...</>
            ) : 'Backup Sekarang'}
          </button>
        </div>

        {/* Restore */}
        <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ width: 64, height: 64, background: 'rgba(245,158,11,0.12)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--status-maintenance)" strokeWidth={1.5} width={32} height={32}>
              <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
            </svg>
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Restore Database</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
            Pulihkan data dari file backup. <strong style={{ color: 'var(--status-out)' }}>Data saat ini akan digantikan!</strong> Pastikan sudah backup terlebih dahulu.
          </p>
          <button id="btn-restore" className="btn btn-secondary" onClick={doRestore} disabled={status !== 'idle'} style={{ borderColor: 'var(--status-maintenance)', color: 'var(--status-maintenance)' }}>
            {status === 'restoring' ? (
              <><svg className="animate-spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Memulihkan...</>
            ) : 'Pilih File Backup...'}
          </button>
        </div>
      </div>

      {/* Snapshot berkas database */}
      {snapshotAvailable() && (
        <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }} id="snapshot-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div className="card-title">🗄️ Snapshot Database Lokal</div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Salinan file database di folder data aplikasi (subfolder <code>snapshots</code>), dibuat lewat SQLite
                online backup sehingga tidak ada transaksi yang tertinggal. Cadangan otomatis memakai mekanisme yang sama.
              </p>
            </div>
            <button id="btn-snapshot" className="btn btn-secondary" onClick={doSnapshot} disabled={status !== 'idle'}>
              Buat Snapshot
            </button>
          </div>
          <div id="snapshot-list" style={{ marginTop: 10 }}>
            {snapshots.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Belum ada snapshot di profil ini.</div>
            ) : snapshots.map(s => (
              <div key={s.name} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '8px 10px', background: 'var(--bg-base)', borderRadius: 6, marginBottom: 6,
              }}>
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontFamily: 'monospace' }}>{new Date(s.createdAt).toLocaleString('id-ID')} · {s.reason}</div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    {s.totalRows} baris · {formatBytes(s.bytes)} · sha1 {s.checksum.slice(0, 10)}
                    {s.settingsKeys.length > 0 ? ` · settings: ${s.settingsKeys.join(', ')}` : ''}
                  </div>
                </div>
                <button
                  id="btn-snapshot-restore"
                  data-snapshot={s.name}
                  className="btn btn-ghost btn-sm"
                  onClick={() => doSnapshotRestore(s)}
                  disabled={status !== 'idle'}
                >
                  Pulihkan
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Summary */}
      {dataSummary.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '14px 20px' }}>
          <div className="card-title" style={{ marginBottom: 8 }}>📋 Ringkasan Data Terakhir</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {dataSummary.map((s, i) => (
              <span key={i} className="badge badge-info" style={{ fontSize: 11 }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Log */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="card-title">Log Aktivitas</div>
          <button className="btn btn-ghost btn-sm" onClick={() => setLog([])}>Bersihkan</button>
        </div>
        <div id="backup-log" style={{ background: 'var(--bg-base)', borderRadius: 8, padding: 12, minHeight: 120, maxHeight: 300, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12 }}>
          {log.length === 0
            ? <span style={{ color: 'var(--text-muted)' }}>Belum ada aktivitas backup/restore...</span>
            : log.map((l, i) => (
                <div key={i} style={{
                  color: l.includes('✅') ? 'var(--status-operating)' :
                         l.includes('❌') ? 'var(--status-out)' :
                         l.includes('⚠️') ? 'var(--status-maintenance)' :
                         l.includes('📦') ? 'var(--accent-blue)' :
                         'var(--text-secondary)',
                  marginBottom: 4,
                }}>{l}</div>
              ))
          }
        </div>
      </div>
    </div>
  );
}
