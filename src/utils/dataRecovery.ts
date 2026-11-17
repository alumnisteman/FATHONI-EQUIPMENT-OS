// src/utils/dataRecovery.ts
// Jaring pengaman data: cadangan berkala, pemulihan, dan perbaikan.
//
// Fase 4: di aplikasi desktop cadangan adalah SNAPSHOT BERKAS SQLite yang dibuat
// main process (electron/backup.ts). Alasannya: database sudah pindah dari
// localStorage, sehingga hems_data_store_v1 di localStorage kini hanyalah arsip
// pra-migrasi — menyalinnya menghasilkan cadangan basi yang justru tidak berisi
// pekerjaan terbaru pengguna.
//
// Mode browser (vite dev tanpa Electron) tidak punya berkas untuk disalin, jadi
// jalur lama (snapshot JSON di localStorage) tetap dipakai di sana.
//
// Keputusan Fase 3 dipertahankan: arsip lama (HEMS_DATA_BACKUPS, HEMS_HEALTH_LOGS,
// key sumber pra-migrasi) beku — tidak ikut dicadangkan dan tidak pernah ditimpa,
// nilai yang tidak terbaca dikarantina, bukan dihapus.

import {
  dbIntegrity, dbSnapshotClear, dbSnapshotCreate, dbSnapshotList, dbSnapshotRestore,
  dbStats, snapshotAvailable, type SnapshotMeta,
} from '../services/dbClient';
import { STORAGE_KEY } from '../store/collections';

interface RecoveryConfig {
  autoBackup:     boolean;
  backupInterval: number; // dalam menit
  maxBackups:     number;
  enableAutoFix:  boolean;
}

interface Backup {
  timestamp: string;
  checksum:  string;
  version:   string;
  /** Hanya mode browser: isi localStorage yang dicadangkan. */
  data?:     Record<string, any>;
  /** Hanya desktop: nama folder snapshot di <userData>/snapshots. */
  file?:      string;
  bytes?:     number;
  totalRows?: number;
  reason?:    string;
}

// Bug fix: versi diambil dari Vite define (lihat vite.config.ts), bukan
// di-hardcode — supaya metadata backup mencatat versi yang sama dengan
// package.json dan app.getVersion() di main process.
declare const __APP_VERSION__: string;

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const BACKUP_BUDGET_CHARS = 2 * 1024 * 1024; // 2MB maksimum untuk seluruh cadangan otomatis

// Key kecil yang masih hidup di localStorage di desktop: belum pindah ke SQLite,
// jadi harus ikut snapshot supaya pemulihan tidak mengembalikan aplikasi setengah.
// Isi database (STORAGE_KEY) tidak pernah disebut di sini — itu tugas berkas
// SQLite, dan mengirimnya lewat localStorage akan membangkitkan arsip basi.
const SETTINGS_KEYS = ['hems_settings', 'hems_business_modes'];

/**
 * Key localStorage yang belum pindah ke SQLite dan karenanya harus ikut dalam
 * snapshot berkas. Daftar izin (bukan daftar larangan) supaya arsip lama, log,
 * dan sesi tidak pernah terselip tanpa sengaja.
 */
export function collectSnapshotSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  SETTINGS_KEYS.forEach(key => {
    const raw = localStorage.getItem(key);
    if (raw) out[key] = raw;
  });
  return out;
}

class DataRecovery {
  private config: RecoveryConfig = {
    autoBackup:     true,
    backupInterval: 30, // 30 menit — cadangan penuh itu mahal, bukan deteksi dini
    maxBackups:     5,  // 5 backup (lebih hemat dari 10)
    enableAutoFix:  true,
  };

  private backupIntervalId: ReturnType<typeof setInterval> | null = null;
  // BUG-007 FIX: Key backup terpisah dari data utama
  private backupKey = 'hems_auto_backups';
  private backingUp = false;

  constructor(config?: Partial<RecoveryConfig>) {
    if (config) this.config = { ...this.config, ...config };
    this.initialize();
  }

  private initialize() {
    // Pemindaian integritas membaca dan mem-parse seluruh isi storage.
    // Ditunda sampai browser idle agar tidak memperlambat startup.
    this.scheduleIdle(() => this.checkDataIntegrity(), 8000);

    if (this.config.autoBackup) {
      this.startAutoBackup();
    }
  }

  /** Jalankan kerja berat hanya saat idle, dengan batas waktu agar tetap berjalan. */
  private scheduleIdle(fn: () => void, timeout: number) {
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (typeof ric === 'function') ric(fn, { timeout });
    else setTimeout(fn, timeout);
  }

  private startAutoBackup() {
    const intervalMs = this.config.backupInterval * 60_000;
    this.backupIntervalId = setInterval(() => {
      // createBackup menyalin seluruh database. Jangan pernah mengerjakan ini di
      // tengah interaksi pengguna: di desktop main process yang bekerja, tapi
      // jawaban IPC-nya tetap kembali ke halaman.
      if (document.hidden) return;
      this.scheduleIdle(() => { void this.createBackup('auto'); }, 20_000);
    }, intervalMs);
  }

  private stopAutoBackup() {
    if (this.backupIntervalId !== null) {
      clearInterval(this.backupIntervalId);
      this.backupIntervalId = null;
    }
  }

  /** Buat snapshot keadaan sekarang. */
  public async createBackup(reason: 'auto' | 'manual' = 'manual'): Promise<Backup | null> {
    if (this.backingUp) return null;
    this.backingUp = true;
    try {
      if (snapshotAvailable()) {
        const result = await dbSnapshotCreate(reason, collectSnapshotSettings());
        if (!result.ok) {
          console.error('[DataRecovery] Snapshot gagal:', result.error);
          return null;
        }
        return this.fromSnapshot(result.snapshot);
      }
      return this.createLocalBackup();
    } catch (e) {
      console.error('[DataRecovery] Gagal membuat backup:', e);
      return null;
    } finally {
      this.backingUp = false;
    }
  }

  private fromSnapshot(s: SnapshotMeta): Backup {
    return {
      timestamp: s.createdAt,
      checksum:  s.checksum,
      version:   APP_VERSION,
      file:      s.name,
      bytes:     s.bytes,
      totalRows: s.totalRows,
      reason:    s.reason,
    };
  }

  /** Jalur mode browser: snapshot JSON di localStorage. */
  private createLocalBackup(): Backup | null {
    // BUG-007 FIX: Hanya backup data utama (hems_data_store_v1 & hems_business_modes)
    // Jangan backup log, backup lama, atau health data.
    // Sesi login juga sengaja tidak ikut: token sesi hanya berlaku di proses
    // yang membuatnya, memulihnya dari berkas lain justru membingungkan.
    const data: Record<string, any> = {};
    const keysToBackup = ['hems_business_modes', 'hems_settings'];

    keysToBackup.forEach(key => {
      const val = localStorage.getItem(key);
      if (val) {
        try {
          data[key] = JSON.parse(val);
        } catch {
          // Skip key yang rusak
        }
      }
    });

    const backup: Backup = {
      timestamp: new Date().toISOString(),
      data,
      checksum: this.calculateChecksum(data),
      version:  APP_VERSION,
    };

    return this.saveBackup(backup) ? backup : null;
  }

  private saveBackup(backup: Backup): boolean {
    const backups = this.getLocalBackups();
    const next = [...backups, backup].slice(-this.config.maxBackups);
    const str = JSON.stringify(next);

    // Backup lama adalah satu-satunya jaring pengaman pengguna. Bila tidak muat,
    // backup BARU yang dikorbankan — jangan pernah memangkas yang lama untuk
    // memberi ruang, itu mengubah kegagalan penyimpanan menjadi kehilangan data.
    if (str.length > BACKUP_BUDGET_CHARS) {
      console.warn('[DataRecovery] Backup dilewati: hasil melebihi anggaran storage. Backup lama dipertahankan.');
      return false;
    }

    try {
      localStorage.setItem(this.backupKey, str);
      return true;
    } catch (e: any) {
      console.error(
        '[DataRecovery] Backup gagal disimpan:',
        e?.name === 'QuotaExceededError' ? 'storage penuh — backup lama dipertahankan' : e
      );
      return false;
    }
  }

  public async getBackups(): Promise<Backup[]> {
    try {
      if (snapshotAvailable()) {
        const snapshots = await dbSnapshotList();
        return snapshots.map(s => this.fromSnapshot(s));
      }
      return this.getLocalBackups();
    } catch (e) {
      console.error('[DataRecovery] Gagal memuat backup:', e);
      return [];
    }
  }

  private getLocalBackups(): Backup[] {
    try {
      const saved = localStorage.getItem(this.backupKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('[DataRecovery] Gagal memuat backup:', e);
    }
    return [];
  }

  public async restoreBackup(timestamp: string): Promise<boolean> {
    try {
      if (snapshotAvailable()) return await this.restoreSnapshot(timestamp);

      const backups = this.getLocalBackups();
      const backup  = backups.find(b => b.timestamp === timestamp);

      if (!backup || !backup.data) {
        console.error('[DataRecovery] Backup tidak ditemukan:', timestamp);
        return false;
      }

      // Verifikasi checksum
      const checksum = this.calculateChecksum(backup.data);
      if (checksum !== backup.checksum) {
        console.warn('[DataRecovery] Checksum tidak cocok — data mungkin rusak');
        // Tetap coba restore (jangan blokir user)
      }

      // Restore data
      Object.entries(backup.data).forEach(([key, value]) => {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          console.error('[DataRecovery] Gagal restore key:', key);
        }
      });

      return true;
    } catch (e) {
      console.error('[DataRecovery] Gagal restore backup:', e);
      return false;
    }
  }

  /**
   * Pulihkan dari berkas snapshot. Keadaan saat ini sudah dicadangkan lebih dulu
   * oleh main process, dan database hanya diganti bila quick_check lulus.
   */
  private async restoreSnapshot(timestamp: string): Promise<boolean> {
    const snapshots = await dbSnapshotList();
    const snap = snapshots.find(s => s.createdAt === timestamp);
    if (!snap) {
      console.error('[DataRecovery] Snapshot tidak ditemukan:', timestamp);
      return false;
    }

    const result = await dbSnapshotRestore(snap.name, collectSnapshotSettings());
    if (!result.ok) {
      console.error('[DataRecovery] Restore snapshot gagal:', result.error,
        result.rolledBack ? '(keadaan sebelum restore sudah dikembalikan)' : '(database TIDAK diubah)');
      return false;
    }

    // Settings ikut snapshot; kunci yang tidak dikenali sudah disaring main
    // process, jadi di sini cukup ditulis apa adanya.
    Object.entries(result.settings).forEach(([key, value]) => {
      try { localStorage.setItem(key, value); }
      catch { console.error('[DataRecovery] Gagal restore key:', key); }
    });

    console.info(`[DataRecovery] Dipulihkan dari snapshot ${snap.name} (${result.snapshot.totalRows} baris).`);
    return true;
  }

  private calculateChecksum(data: any): string {
    const str  = JSON.stringify(data);
    let   hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private checkDataIntegrity(): string[] {
    // BUG-006 FIX: Cek semua key dengan prefix hems_ (lowercase)
    const corruptedKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (key.startsWith('hems_') &&
          !key.includes('backup') && !key.includes('error') && !key.includes('health') &&
          !key.includes('_corrupt_')) {
        try {
          const val = localStorage.getItem(key);
          if (val) JSON.parse(val);
        } catch {
          corruptedKeys.push(key);
        }
      }
    }

    if (corruptedKeys.length > 0) this.quarantineCorruptedData(corruptedKeys);
    return corruptedKeys;
  }

  /**
   * Nilai yang tidak terbaca dipindahkan, tidak pernah dihapus dan tidak pernah
   * diam-diam ditimpa oleh snapshot lama. Menghapusnya mengubah satu entri rusak
   * menjadi kehilangan seluruh tabel; memulihkan tanpa persetujuan pengguna
   * menghilangkan pekerjaan yang belum tercadangkan.
   */
  private quarantineCorruptedData(corruptedKeys: string[]) {
    corruptedKeys.forEach(key => {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      try {
        localStorage.setItem(`${key}_corrupt_${Date.now()}`, raw);
        localStorage.removeItem(key);
        console.error(
          `[DataRecovery] Key "${key}" tidak terbaca dan sudah dikarantina. ` +
          `Pulihkan dari cadangan lewat menu Pemeliharaan Sistem.`
        );
      } catch {
        console.error(`[DataRecovery] Key "${key}" rusak tetapi tidak muat dikarantina. Key dibiarkan apa adanya.`);
      }
    });
  }

  public async repairData(): Promise<{ success: boolean; message: string }> {
    try {
      await this.createBackup('manual');
      const corrupted = this.checkDataIntegrity();

      if (snapshotAvailable()) {
        // Baris ganda di SQLite tidak pernah dihapus otomatis: pk unik membuat dua
        // baris ber-id sama tetap baris berbeda, dan yang mana yang dibuang adalah
        // keputusan pengguna.
        const report = await dbIntegrity();
        const dupCount = report?.duplicates?.length ?? 0;
        if (!report) {
          return { success: false, message: `Perbaikan hanya sebagian: ${corrupted.length} key dikarantina, integritas database tidak bisa diperiksa` };
        }
        return {
          success: report.ok,
          message: report.ok
            ? `Perbaikan data selesai: ${corrupted.length} key dikarantina, quick_check sehat, ${dupCount} nilai ganda dilaporkan tanpa diubah`
            : `quick_check database TIDAK sehat (${report.quickCheck.join('; ')}) — buat backup file dan hubungi pemulihan`,
        };
      }

      this.removeDuplicates();
      return { success: true, message: `Perbaikan data selesai: ${corrupted.length} key dikarantina` };
    } catch (e) {
      return { success: false, message: `Perbaikan gagal: ${e}` };
    }
  }

  private removeDuplicates() {
    const val = localStorage.getItem(STORAGE_KEY);
    if (!val) return;

    try {
      const data = JSON.parse(val);
      let changed = false;

      // Deduplikasi array berdasarkan ID
      const arrayKeys = ['units', 'customers', 'spareParts', 'invoices', 'sales',
                         'rentals', 'services', 'deliveries', 'breakdowns', 'operators',
                         'technicians', 'approvals', 'kas', 'documents', 'bankAccounts'];

      arrayKeys.forEach(k => {
        if (Array.isArray(data[k])) {
          const seen = new Set<string>();
          const deduped = data[k].filter((item: any) => {
            const id = item?.id;
            if (id && seen.has(id)) return false;
            if (id) seen.add(id);
            return true;
          });
          if (deduped.length !== data[k].length) {
            data[k] = deduped;
            changed = true;
          }
        }
      });

      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    } catch (e) {
      console.error('[DataRecovery] Gagal deduplikasi:', e);
    }
  }

  /**
   * Desktop: ukuran file database nyata, tanpa batas keras seperti kuota
   * localStorage (limitKB = 0 berarti "tidak ada batas tetap").
   * Browser: memakai anggaran kuota 5 MB seperti sebelumnya.
   */
  public async getStorageUsage(): Promise<StorageUsage> {
    if (snapshotAvailable()) {
      const s = await dbStats();
      if (s) {
        const usedKB = Math.round(s.sizeBytes / 1024);
        return { usedKB, limitKB: 0, percentage: 0, source: 'sqlite', detail: `${s.totalRows} baris di ${s.file}` };
      }
    }

    let used = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      used += (localStorage.getItem(key) || '').length;
    }
    const usedKB   = Math.round(used / 1024);
    const limitKB  = 5 * 1024; // 5MB estimasi
    const percentage = Math.round((usedKB / limitKB) * 100);
    return { usedKB, limitKB, percentage, source: 'localstorage', detail: 'localStorage' };
  }

  public async clearBackups(): Promise<number> {
    if (snapshotAvailable()) return await dbSnapshotClear();
    localStorage.removeItem(this.backupKey);
    return 0;
  }

  public destroy() {
    this.stopAutoBackup();
  }
}

export interface StorageUsage {
  usedKB:     number;
  /** 0 = tidak ada batas tetap (file SQLite hanya dibatasi disk). */
  limitKB:    number;
  percentage: number;
  source:     'sqlite' | 'localstorage';
  detail:     string;
}

// Singleton instance
let dataRecoveryInstance: DataRecovery | null = null;

export const getDataRecovery = (config?: Partial<RecoveryConfig>): DataRecovery => {
  if (!dataRecoveryInstance) {
    dataRecoveryInstance = new DataRecovery(config);
  }
  return dataRecoveryInstance;
};

export default DataRecovery;
