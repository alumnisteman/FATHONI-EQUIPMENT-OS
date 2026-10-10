// src/components/ErrorBoundary.tsx
// Error Boundary untuk menangani error React dan melakukan auto-recovery

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

class ErrorBoundary extends Component<Props, State> {
  private maxRetries = 3;
  private retryDelay = 2000; // 2 seconds

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    // Log error untuk monitoring
    this.logError(error, errorInfo);
    
    // Simpan state untuk auto-recovery
    this.setState({
      error,
      errorInfo,
    });

    // Trigger auto-recovery jika memungkinkan
    this.attemptAutoRecovery(error);
  }

  private logError(error: Error, errorInfo: ErrorInfo) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      componentStack: errorInfo.componentStack,
      retryCount: this.state.retryCount,
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    // Simpan ke localStorage untuk debugging
    try {
      const existingLogs = JSON.parse(localStorage.getItem('hems_error_logs') || '[]');
      existingLogs.push(errorLog);
      // Simpan maksimal 50 log terakhir
      const recentLogs = existingLogs.slice(-50);
      localStorage.setItem('hems_error_logs', JSON.stringify(recentLogs));
    } catch (e) {
      console.error('Failed to log error:', e);
    }

    // Kirim ke monitoring service (jika ada)
    this.sendToMonitoring(errorLog);
  }

  private sendToMonitoring(errorLog: any) {
    // Di production, ini bisa dikirim ke monitoring service seperti Sentry, LogRocket, dll
    console.log('Error logged for monitoring:', errorLog);
  }

  private attemptAutoRecovery(error: Error) {
    // Auto-recovery untuk error tertentu
    const recoverableErrors = [
      'TypeError',
      'ReferenceError',
      'ChunkLoadError',
      'NetworkError',
    ];

    if (recoverableErrors.includes(error.name) && this.state.retryCount < this.maxRetries) {
      console.log(`Attempting auto-recovery (attempt ${this.state.retryCount + 1}/${this.maxRetries})`);
      
      setTimeout(() => {
        this.setState({
          hasError: false,
          error: null,
          errorInfo: null,
          retryCount: this.state.retryCount + 1,
        });
      }, this.retryDelay);
    }
  }

  private handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    });
  };

  private handleResetApp = () => {
    if (confirm('Apakah Anda ingin mereset aplikasi ke keadaan awal? Data yang belum disimpan akan hilang.')) {
      // Clear localStorage kecuali error logs
      const errorLogs = localStorage.getItem('hems_error_logs');
      localStorage.clear();
      if (errorLogs) {
        localStorage.setItem('hems_error_logs', errorLogs);
      }
      window.location.reload();
    }
  };

  private handleExportError = () => {
    const errorData = {
      error: this.state.error,
      errorInfo: this.state.errorInfo,
      timestamp: new Date().toISOString(),
      retryCount: this.state.retryCount,
    };
    
    const blob = new Blob([JSON.stringify(errorData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FATHONI-Error-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            maxWidth: '600px',
            padding: '30px',
            background: 'var(--bg-elevated)',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          }}>
            <h1 style={{ color: 'var(--status-out)', marginBottom: '20px' }}>
              ⚠️ Terjadi Kesalahan
            </h1>
            
            <p style={{ marginBottom: '20px', color: 'var(--text-secondary)' }}>
              Maaf, terjadi kesalahan yang tidak terduga. Sistem sedang mencoba memperbaiki masalah ini secara otomatis.
            </p>

            {this.state.error && (
              <div style={{
                background: 'var(--bg-tertiary)',
                padding: '15px',
                borderRadius: '8px',
                marginBottom: '20px',
                textAlign: 'left',
                fontSize: '13px',
                fontFamily: 'monospace',
                overflow: 'auto',
                maxHeight: '200px',
              }}>
                <strong>Error:</strong> {this.state.error.message}
                {this.state.error.stack && (
                  <details style={{ marginTop: '10px' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--status-maintenance)' }}>
                      Stack Trace
                    </summary>
                    <pre style={{ marginTop: '10px', whiteSpace: 'pre-wrap' }}>
                      {this.state.error.stack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={this.handleRetry}
                style={{
                  padding: '10px 20px',
                  background: 'var(--primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                🔄 Coba Lagi
              </button>
              
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '10px 20px',
                  background: 'var(--status-maintenance)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                🔄 Refresh Halaman
              </button>

              <button
                onClick={this.handleExportError}
                style={{
                  padding: '10px 20px',
                  background: 'var(--status-out)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                📥 Export Error Log
              </button>

              <button
                onClick={this.handleResetApp}
                style={{
                  padding: '10px 20px',
                  background: 'var(--border-default)',
                  color: 'var(--text-primary)',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                🔄 Reset Aplikasi
              </button>
            </div>

            {this.state.retryCount > 0 && (
              <p style={{ marginTop: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>
                Auto-recovery attempt: {this.state.retryCount}/{this.maxRetries}
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
