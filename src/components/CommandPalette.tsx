import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export interface PaletteItem {
  path: string;
  label: string;
  group: string;
  keywords?: string[];
}

// Daunnya tidak lagi di berkas ini: Layout meneruskan menu sidebar yang sudah
// melewati gerbang peran pengguna + profil bisnis (NAV_GROUPS). Dulu palette
// menyimpan COMMANDS sendiri, sehingga isinya cepat menyimpang dari layar —
// urutannya beda, dan sembilan menu (Operator, Teknisi, Persetujuan, Breakdown,
// Dokumen, Pengguna, Backup, Pemeliharaan, Audit Log) tidak bisa dicari lewat
// Ctrl+K padahal ada di sidebar. Satu sumber daftar = tidak ada lagi menu yang
// "hilang" dari salah satu jalan masuk.
export default function CommandPalette({ items }: { items: PaletteItem[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const q = query.trim().toLowerCase();
  const filteredCommands = q.length === 0
    ? items
    : items.filter((cmd) =>
      cmd.label.toLowerCase().includes(q)
      || cmd.group.toLowerCase().includes(q)
      || (cmd.keywords ?? []).some((k) => k.toLowerCase().includes(q))
    );
  const jumlah = filteredCommands.length;
  // Indeks boleh lebih besar dari hasil filter (misalnya peran/profil berubah
  // saat palette terbuka), jadi baris yang disorot dikunci ke daftar yang ada.
  const aktif = jumlah > 0 ? Math.min(selectedIndex, jumlah - 1) : 0;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleExecute = (path: string) => {
    navigate(path);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (jumlah === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (Math.min(prev, jumlah - 1) + 1) % jumlah);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (Math.min(prev, jumlah - 1) - 1 + jumlah) % jumlah);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleExecute(filteredCommands[aktif].path);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      backdropFilter: 'blur(4px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '10vh'
    }} onClick={() => setIsOpen(false)}>
      <div 
        style={{
          width: '100%', maxWidth: '600px',
          backgroundColor: 'var(--bg-card)',
          borderRadius: '12px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          overflow: 'hidden',
          border: '1px solid var(--border-default)',
          animation: 'slideDown 0.2s ease-out'
        }} 
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px', borderBottom: '1px solid var(--border-default)' }}>
          <span style={{ marginRight: 12, fontSize: 18, color: 'var(--text-muted)' }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ketik menu atau halaman yang dicari..."
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 16, color: 'var(--text-primary)', outline: 'none'
            }}
          />
          <span style={{ fontSize: 12, background: 'var(--bg-elevated)', padding: '4px 8px', borderRadius: 4, color: 'var(--text-muted)' }}>ESC</span>
        </div>
        <div style={{ maxHeight: '300px', overflowY: 'auto', padding: '8px' }}>
          {jumlah === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Tidak menemukan hasil untuk "{query}"
            </div>
          ) : (
            filteredCommands.map((cmd, index) => {
              const isSelected = index === aktif;
              return (
                <div
                  key={cmd.path}
                  data-palette-item={cmd.path}
                  onClick={() => handleExecute(cmd.path)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    padding: '12px 16px',
                    display: 'flex', alignItems: 'center', gap: 12,
                    cursor: 'pointer',
                    borderRadius: 8,
                    backgroundColor: isSelected ? 'var(--primary-light, rgba(239, 68, 68, 0.1))' : 'transparent',
                    color: isSelected ? 'var(--sany-red)' : 'var(--text-primary)',
                    transition: 'all 0.1s'
                  }}
                >
                  <span style={{ fontWeight: isSelected ? 600 : 400 }}>{cmd.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{cmd.group}</span>
                  {isSelected && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>ENTER</span>}
                </div>
              );
            })
          )}
        </div>
      </div>
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
