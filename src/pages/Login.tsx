// src/pages/Login.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/authStore';
import { demoAccounts } from '../services/authClient';

// Hanya untuk halaman demo browser; akun desktop tidak pernah dikirim ke renderer.
const DEMO_USERNAMES = demoAccounts().map(u => u.username);

export default function Login() {
  const { login, isAuthenticated, isLoading, demoMode } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  const [companyName, setCompanyName] = useState('CV. MUGHNY NAMASKARABUMI KURNIA');

  // Redirect jika sudah login
  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated]);

  // Ambil versi dari Electron
  useEffect(() => {
    (async () => {
      try {
        const info = await (window as any).electronAPI?.getSystemInfo?.();
        if (info?.version) setAppVersion(info.version);
      } catch {}
    })();
  }, []);

  // Load company name from settings
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('hems_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (parsed.name) {
          setCompanyName(parsed.name);
        }
      }
    } catch (e) {
      console.error('Gagal memuat settings:', e);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('Username dan password wajib diisi');
      return;
    }
    const result = await login(username.trim(), password);
    if (!result.success) {
      setError(result.error || 'Login gagal');
    }
  };

  return (
    <div className="login-page">
      {/* Background animasi */}
      <div className="login-bg">
        <div className="login-bg-grid" />
        <div className="login-bg-blob blob-1" />
        <div className="login-bg-blob blob-2" />
        <div className="login-bg-blob blob-3" />
      </div>

      {/* Card login */}
      <div className="login-card">
        {/* Header */}
        <div className="login-header">
          <div className="login-logo">
            <span>F</span>
          </div>
          <h1 className="login-title">FATHONI EQUIPMENT OS</h1>
          <p className="login-subtitle">Sistem Operasional Alat Berat Terintegrasi</p>
          <span className="login-badge">v{appVersion}</span>
        </div>

        {/* Garis pemisah */}
        <div className="login-divider" />

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="login-username">
              Username
            </label>
            <div className="input-icon-wrap">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <input
                id="login-username"
                type="text"
                className="form-input with-icon"
                placeholder="Masukkan username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">
              Password
            </label>
            <div className="input-icon-wrap">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              <input
                id="login-password"
                type={showPass ? 'text' : 'password'}
                className="form-input with-icon"
                placeholder="Masukkan password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="input-toggle"
                onClick={() => setShowPass(v => !v)}
                tabIndex={-1}
              >
                {showPass ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            id="btn-login"
            className="btn btn-primary btn-lg w-full login-btn"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 12a9 9 0 11-6.219-8.56"/>
                </svg>
                Sedang Masuk...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
                  <polyline points="10,17 15,12 10,7"/>
                  <line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
                Masuk ke FATHONI EQUIPMENT OS
              </>
            )}
          </button>
        </form>

        {/* Petunjuk sesuai lingkungan aplikasi */}
        <div className="login-demo">
          {demoMode ? (
            <>
              <p><strong>Mode demo browser.</strong> Database terpisah dari aplikasi desktop dan tidak tersimpan permanen.</p>
              <p>Akun demo tersedia: {DEMO_USERNAMES.join(', ')} — password apa pun diterima, tidak ada kredensial asli di halaman ini.</p>
            </>
          ) : (
            <p>Akun dibuat dan dikelola oleh Super Admin. Lima kali password salah mengunci akun selama lima menit; lupa password dimintakan reset ke Super Admin.</p>
          )}
        </div>

        {/* Footer */}
        <p className="login-footer">
          © 2024 {companyName}. Semua hak dilindungi.
        </p>
      </div>

      <style>{`
        .login-page {
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          background: #0E1015;
        }

        .login-bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .login-bg-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 40px 40px;
        }

        .login-bg-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.15;
          animation: blobFloat 8s ease-in-out infinite;
        }

        .blob-1 {
          width: 400px; height: 400px;
          background: radial-gradient(circle, #E60012, transparent);
          top: -100px; left: -100px;
        }

        .blob-2 {
          width: 300px; height: 300px;
          background: radial-gradient(circle, #3B82F6, transparent);
          bottom: -50px; right: 100px;
          animation-delay: -3s;
        }

        .blob-3 {
          width: 200px; height: 200px;
          background: radial-gradient(circle, #8B5CF6, transparent);
          top: 50%; right: -50px;
          animation-delay: -5s;
        }

        @keyframes blobFloat {
          0%, 100% { transform: translate(0,0) scale(1); }
          33%  { transform: translate(20px,-20px) scale(1.05); }
          66%  { transform: translate(-10px,15px) scale(0.95); }
        }

        .login-card {
          position: relative;
          z-index: 10;
          width: 400px;
          background: rgba(22,24,32,0.8);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          padding: 36px;
          backdrop-filter: blur(20px);
          box-shadow: 0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
          animation: cardIn 0.5s cubic-bezier(0.34,1.56,0.64,1);
        }

        @keyframes cardIn {
          from { opacity:0; transform: translateY(30px) scale(0.95); }
          to   { opacity:1; transform: translateY(0) scale(1); }
        }

        .login-header {
          text-align: center;
          margin-bottom: 8px;
        }

        .login-logo {
          width: 60px;
          height: 60px;
          background: linear-gradient(135deg, #E60012, #FF4455);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          font-weight: 900;
          color: white;
          margin: 0 auto 12px;
          box-shadow: 0 8px 24px rgba(230,0,18,0.4);
        }

        .login-title {
          font-size: 22px;
          font-weight: 900;
          color: #F0F2F8;
          letter-spacing: 0;
          margin: 0;
        }

        .login-subtitle {
          font-size: 12px;
          color: #9299B0;
          margin: 4px 0 8px;
        }

        .login-badge {
          display: inline-block;
          background: rgba(230,0,18,0.12);
          color: #FF4455;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 10px;
          border: 1px solid rgba(230,0,18,0.2);
        }

        .login-divider {
          height: 1px;
          background: rgba(255,255,255,0.07);
          margin: 20px 0;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        .input-icon-wrap {
          position: relative;
        }

        .input-icon {
          position: absolute;
          left: 11px;
          top: 50%;
          transform: translateY(-50%);
          width: 15px;
          height: 15px;
          color: #5C6280;
          pointer-events: none;
        }

        .form-input.with-icon {
          padding-left: 36px;
        }

        .input-toggle {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: transparent;
          border: none;
          color: #5C6280;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
        }

        .input-toggle svg {
          width: 15px;
          height: 15px;
        }

        .input-toggle:hover { color: #9299B0; }

        .login-error {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 12px;
          color: #EF4444;
          margin-bottom: 14px;
          animation: slideUp 0.2s ease-out;
        }

        .login-btn {
          margin-top: 8px;
          background: linear-gradient(135deg, #E60012, #FF2233);
          border: none;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          padding: 12px;
          box-shadow: 0 4px 16px rgba(230,0,18,0.4);
          transition: all 0.2s;
        }

        .login-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #FF2233, #FF4455);
          box-shadow: 0 6px 20px rgba(230,0,18,0.5);
          transform: translateY(-1px);
        }

        .login-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .login-demo {
          margin-top: 16px;
          padding: 10px 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px;
          font-size: 11px;
          color: #5C6280;
          text-align: center;
        }

        .login-demo strong { color: #9299B0; }

        .login-footer {
          text-align: center;
          font-size: 10px;
          color: #3A3F55;
          margin-top: 16px;
        }
      `}</style>
    </div>
  );
}
