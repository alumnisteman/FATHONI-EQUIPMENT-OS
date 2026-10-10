// src/utils/healthCheck.ts
// Health check system untuk monitoring kesehatan aplikasi
// BUG-002 FIX: Ganti require() dengan import statis (ESM compatible)
// BUG-014 FIX: Hapus window.gc yang bukan API resmi browser

import { getDataRecovery } from './dataRecovery';

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
    duration?: number;
  }[];
  timestamp: string;
}

class HealthCheck {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private defaultInterval = 600_000; // 10 menit — cek ringan saja
  private maxHealthLogs = 50; // Kurangi dari 100 → hemat storage

  constructor() {
    this.initialize();
  }

  private initialize() {
    // Cek mendalam pertama ditunda sampai browser idle, supaya tidak memperlambat startup.
    this.scheduleIdle(() => this.runHealthCheck({ deep: true }), 5000);
    this.startPeriodicChecks();
  }

  /** Jalankan kerja berat hanya saat idle, dan lewati bila jendela tidak terlihat. */
  private scheduleIdle(fn: () => void, timeout: number) {
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (typeof ric === 'function') ric(fn, { timeout });
    else setTimeout(fn, timeout);
  }

  private startPeriodicChecks() {
    this.checkInterval = setInterval(() => {
      if (document.hidden) return;
      this.scheduleIdle(() => this.runHealthCheck({ deep: false }), 10_000);
    }, this.defaultInterval);
  }

  private stopPeriodicChecks() {
    if (this.checkInterval !== null) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * @param opts.deep false = cek ringan yang aman dijalankan berkala;
   *                  true  = mem-parse seluruh database, hanya atas permintaan pengguna.
   */
  public async runHealthCheck(opts: { deep?: boolean } = {}): Promise<HealthCheckResult> {
    const deep = opts.deep !== false;
    const checks: HealthCheckResult['checks'] = [];

    // Check 1: localStorage availability (& quota saat deep)
    checks.push(await this.checkLocalStorage(deep));

    // Check 2: Data integrity
    checks.push(await this.checkDataIntegrity(deep));

    // Check 3: Memory usage (opsional, graceful fallback)
    checks.push(await this.checkMemoryUsage());

    // Check 4: Performance
    checks.push(await this.checkPerformance());

    // Determine overall status
    const failedChecks  = checks.filter(c => c.status === 'fail');
    const warningChecks = checks.filter(c => c.status === 'warn');

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (failedChecks.length > 0)      status = 'unhealthy';
    else if (warningChecks.length > 0) status = 'degraded';
    else                               status = 'healthy';

    const result: HealthCheckResult = {
      status,
      checks,
      timestamp: new Date().toISOString(),
    };

    // Log result (bukan ke console setiap menit)
    if (status !== 'healthy') {
      this.logHealthCheck(result);
      this.handleUnhealthyState(result);
    }

    return result;
  }

  private async checkLocalStorage(deep: boolean): Promise<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string }> {
    try {
      const testKey = '_hems_health_test_';
      localStorage.setItem(testKey, '1');
      const retrieved = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);

      if (retrieved !== '1') {
        return { name: 'localStorage', status: 'fail', message: 'localStorage read/write gagal' };
      }

      // Mengukur pemakaian butuh getItem atas setiap key — salinan string utuh
      // multi-megabyte. Hanya jalankan bila pengguna memintanya secara eksplisit.
      if (!deep) {
        return { name: 'localStorage', status: 'pass', message: 'localStorage dapat ditulis dan dibaca' };
      }

      // Cek penggunaan storage
      let used = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        used += (localStorage.getItem(key) || '').length;
      }
      const usedKB   = used / 1024;
      const limitKB  = 5 * 1024; // 5 MB
      const pct      = (usedKB / limitKB) * 100;

      if (pct > 85) {
        return { name: 'localStorage', status: 'warn', message: `Storage hampir penuh: ${usedKB.toFixed(0)}KB / ${limitKB}KB (${pct.toFixed(1)}%)` };
      }

      return { name: 'localStorage', status: 'pass', message: `Storage OK: ${usedKB.toFixed(0)}KB dipakai (${pct.toFixed(1)}%)` };
    } catch (e) {
      return { name: 'localStorage', status: 'fail', message: `localStorage error: ${e}` };
    }
  }

  private async checkDataIntegrity(deep: boolean): Promise<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string }> {
    try {
      // BUG-006 FIX: Periksa kedua prefix (lowercase dan uppercase)
      const hemsKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        if ((key.startsWith('hems_') || key.startsWith('HEMS_')) &&
            !key.includes('backup') && !key.includes('BACKUP') &&
            !key.includes('error') && !key.includes('ERROR') &&
            !key.includes('health') && !key.includes('HEALTH')) {
          hemsKeys.push(key);
        }
      }

      const closerFor = (ch: string) => (ch === '{' ? '}' : ch === '[' ? ']' : null);
      let corruptedCount = 0;

      for (const key of hemsKeys) {
        const value = localStorage.getItem(key);
        if (!value) continue;

        if (deep) {
          try { JSON.parse(value); } catch { corruptedCount++; }
          continue;
        }

        // Mode ringan: deteksi pemotongan akibat tulis yang gagal di tengah jalan,
        // tanpa menyalin dan mem-parse seluruh database.
        const closer = closerFor(value[0]);
        if (!closer || value[value.length - 1] !== closer) corruptedCount++;
      }

      const label = deep ? 'valid' : 'berstruktur utuh';

      if (corruptedCount === 0) {
        return { name: 'dataIntegrity', status: 'pass', message: `Semua data ${label} (${hemsKeys.length} keys)` };
      } else if (corruptedCount < 3) {
        return { name: 'dataIntegrity', status: 'warn', message: `${corruptedCount} data tidak ${label}` };
      } else {
        return { name: 'dataIntegrity', status: 'fail', message: `${corruptedCount} data rusak - jalankan pemeriksaan mendalam` };
      }
    } catch (e) {
      return { name: 'dataIntegrity', status: 'warn', message: `Cek integritas gagal: ${e}` };
    }
  }

  private async checkMemoryUsage(): Promise<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string }> {
    try {
      // BUG-014 FIX: Hanya gunakan API resmi, tidak ada window.gc
      const perf = performance as any;
      if (perf && perf.memory) {
        const memory = perf.memory;
        const usedMB  = memory.usedJSHeapSize  / 1_048_576;
        const limitMB = memory.jsHeapSizeLimit  / 1_048_576;
        const pct     = (usedMB / limitMB) * 100;

        if (pct < 70) return { name: 'memory', status: 'pass',  message: `Memory OK: ${usedMB.toFixed(0)}MB / ${limitMB.toFixed(0)}MB (${pct.toFixed(1)}%)` };
        if (pct < 90) return { name: 'memory', status: 'warn',  message: `Memory tinggi: ${usedMB.toFixed(0)}MB (${pct.toFixed(1)}%)` };
        return               { name: 'memory', status: 'fail',  message: `Memory kritis: ${usedMB.toFixed(0)}MB (${pct.toFixed(1)}%)` };
      }
      return { name: 'memory', status: 'pass', message: 'Memory API tidak tersedia (normal)' };
    } catch {
      return { name: 'memory', status: 'pass', message: 'Memory check dilewati' };
    }
  }

  private async checkPerformance(): Promise<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string; duration: number }> {
    const t0 = performance.now();
    // Simulasi sederhana — tidak blocking
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    arr.reduce((a, b) => a + b, 0);
    const dur = performance.now() - t0;

    if (dur < 5)  return { name: 'performance', status: 'pass', message: 'Performa baik',      duration: dur };
    if (dur < 20) return { name: 'performance', status: 'warn', message: 'Performa menurun',   duration: dur };
    return              { name: 'performance', status: 'fail', message: 'Performa sangat lambat', duration: dur };
  }

  private logHealthCheck(result: HealthCheckResult) {
    try {
      const key      = 'hems_health_logs';
      const existing = JSON.parse(localStorage.getItem(key) || '[]') as HealthCheckResult[];
      existing.push(result);
      // BUG-005 FIX: Batasi log agar tidak membengkak
      const trimmed  = existing.slice(-this.maxHealthLogs);
      localStorage.setItem(key, JSON.stringify(trimmed));
    } catch {
      // Silent fail - log tidak kritis
    }
  }

  private handleUnhealthyState(result: HealthCheckResult) {
    const failedChecks = result.checks.filter(c => c.status === 'fail');

    failedChecks.forEach(check => {
      switch (check.name) {
        case 'localStorage':
          this.fixLocalStorage();
          break;
        case 'dataIntegrity':
          this.fixDataIntegrity();
          break;
      }
    });
  }

  private fixLocalStorage() {
    try {
      // Bersihkan log lama saja, JANGAN hapus data penting
      ['hems_error_logs', 'hems_health_logs', 'hems_data_backups'].forEach(key => {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '[]');
          if (Array.isArray(data) && data.length > 20) {
            // Simpan hanya 10 terbaru
            localStorage.setItem(key, JSON.stringify(data.slice(-10)));
          }
        } catch {
          localStorage.removeItem(key);
        }
      });
    } catch (e) {
      console.error('[HealthCheck] Gagal bersihkan localStorage:', e);
    }
  }

  private fixDataIntegrity() {
    // BUG-002 FIX: Gunakan import statis yang sudah diimport di atas
    // repairData membuat snapshot lebih dulu dan tidak pernah menghapus data,
    // jadi hasilnya cukup dicatat bila ada bagian yang tidak beres.
    getDataRecovery().repairData().then(result => {
      if (!result.success) console.error('[HealthCheck] Perbaikan data tidak tuntas:', result.message);
    }).catch(e => console.error('[HealthCheck] Gagal perbaiki integritas data:', e));
  }

  public getHealthLogs(): HealthCheckResult[] {
    try {
      return JSON.parse(localStorage.getItem('hems_health_logs') || '[]');
    } catch {
      return [];
    }
  }

  public clearHealthLogs() {
    localStorage.removeItem('hems_health_logs');
  }

  public destroy() {
    this.stopPeriodicChecks();
  }
}

// Singleton instance
let healthCheckInstance: HealthCheck | null = null;

export const getHealthCheck = (): HealthCheck => {
  if (!healthCheckInstance) {
    healthCheckInstance = new HealthCheck();
  }
  return healthCheckInstance;
};

export default HealthCheck;
