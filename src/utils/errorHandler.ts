// src/utils/errorHandler.ts
// Global error handler untuk menangani error runtime
// Perbaikan: Hapus alert() yang mengganggu UX, gunakan console-based logging

interface ErrorLog {
  timestamp:  string;
  type:       'runtime' | 'network' | 'async' | 'storage' | 'validation';
  message:    string;
  stack?:     string;
  context?:   any;
  url:        string;
}

const STORAGE_KEY = 'hems_error_logs'; // BUG-006: lowercase konsisten
const MAX_LOGS    = 50;

class ErrorHandler {
  private errorLogs: ErrorLog[] = [];
  private initialized = false;

  constructor() {
    this.initialize();
  }

  private initialize() {
    if (this.initialized) return; // Hindari double-init
    this.initialized = true;

    // Muat log yang ada
    this.loadLogs();

    // Global error handlers
    window.addEventListener('error',            this.handleGlobalError,       { passive: true });
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection, { passive: true });
    window.addEventListener('offline',          this.handleOffline,           { passive: true });
    window.addEventListener('online',           this.handleOnline,            { passive: true });
  }

  private handleGlobalError = (event: ErrorEvent) => {
    // Abaikan error dari ekstensi browser
    if (event.filename && (event.filename.includes('extension') || event.filename.includes('chrome-extension'))) {
      return;
    }

    // Abaikan error chunk load → sudah ditangani oleh ChunkLoadError handler
    if (event.message?.includes('Loading chunk')) {
      console.warn('[ErrorHandler] Chunk load error detected, skipping global handler');
      return;
    }

    const log: ErrorLog = {
      timestamp: new Date().toISOString(),
      type:      'runtime',
      message:   event.message,
      stack:     event.error?.stack,
      context:   { filename: event.filename, lineno: event.lineno, colno: event.colno },
      url:       window.location.href,
    };

    this.logError(log);
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const msg = event.reason?.message || String(event.reason || 'Unknown rejection');

    // Abaikan promise rejection yang tidak kritis
    if (msg.includes('ResizeObserver') || msg.includes('Non-Error rejection')) return;

    const log: ErrorLog = {
      timestamp: new Date().toISOString(),
      type:      'async',
      message:   msg,
      stack:     event.reason?.stack,
      url:       window.location.href,
    };

    this.logError(log);
  };

  private handleOffline = () => {
    const log: ErrorLog = {
      timestamp: new Date().toISOString(),
      type:      'network',
      message:   'Koneksi jaringan terputus',
      url:       window.location.href,
    };
    this.logError(log);
  };

  private handleOnline = () => {
    console.log('[ErrorHandler] Koneksi jaringan pulih');
  };

  private logError(log: ErrorLog) {
    this.errorLogs.push(log);

    // Trim jika melebihi batas
    if (this.errorLogs.length > MAX_LOGS) {
      this.errorLogs = this.errorLogs.slice(-MAX_LOGS);
    }

    this.saveLogs();

    // Log ke console (hanya di development)
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorHandler]', log.type, log.message);
    }
  }

  private saveLogs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.errorLogs));
    } catch {
      // Storage penuh — hapus log lama, simpan yang baru
      try {
        const trimmed = this.errorLogs.slice(-10);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // Silent fail
      }
    }
  }

  private loadLogs() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) this.errorLogs = JSON.parse(saved);
    } catch {
      this.errorLogs = [];
    }
  }

  public getLogs(): ErrorLog[] {
    return [...this.errorLogs];
  }

  public clearLogs() {
    this.errorLogs = [];
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  public exportLogs(): string {
    return JSON.stringify(this.errorLogs, null, 2);
  }

  public logCustomError(type: ErrorLog['type'], message: string, context?: any) {
    const log: ErrorLog = {
      timestamp: new Date().toISOString(),
      type,
      message,
      context,
      url: window.location.href,
    };
    this.logError(log);
  }

  public destroy() {
    window.removeEventListener('error',             this.handleGlobalError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.removeEventListener('offline',           this.handleOffline);
    window.removeEventListener('online',            this.handleOnline);
    this.initialized = false;
  }
}

// Singleton instance
let errorHandlerInstance: ErrorHandler | null = null;

export const getErrorHandler = (): ErrorHandler => {
  if (!errorHandlerInstance) {
    errorHandlerInstance = new ErrorHandler();
  }
  return errorHandlerInstance;
};

export default ErrorHandler;
