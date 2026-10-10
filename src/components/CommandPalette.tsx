import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const COMMANDS = [
  { name: 'Dashboard', path: '/dashboard', icon: '📊' },
  { name: 'Control Tower', path: '/control-tower', icon: '🗼' },
  { name: 'Customers (Pelanggan)', path: '/customers', icon: '👥' },
  { name: 'Suppliers (Pemasok)', path: '/suppliers', icon: '🏭' },
  { name: 'Units (Alat Berat)', path: '/units', icon: '🚜' },
  { name: 'Brands (Merek)', path: '/brands', icon: '🏷️' },
  { name: 'Sales (Penjualan/SPK)', path: '/sales', icon: '💰' },
  { name: 'Purchase (Pembelian)', path: '/purchase', icon: '🛍️' },
  { name: 'Rental (Sewa)', path: '/rental', icon: '📄' },
  { name: 'Invoices (Tagihan)', path: '/invoices', icon: '🧾' },
  { name: 'Warehouse (Gudang)', path: '/warehouse', icon: '📦' },
  { name: 'Spare Parts (Suku Cadang)', path: '/spareparts', icon: '⚙️' },
  { name: 'Service (Bengkel)', path: '/service', icon: '🔧' },
  { name: 'Delivery (Surat Jalan)', path: '/delivery', icon: '🚚' },
  { name: 'Finance (Keuangan)', path: '/finance', icon: '💵' },
  { name: 'Reports (Laporan)', path: '/reports', icon: '📈' },
  { name: 'Settings (Pengaturan)', path: '/settings', icon: '⚙️' },
];

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const filteredCommands = COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleExecute = (path: string) => {
    navigate(path);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
    } else if (e.key === 'Enter' && filteredCommands.length > 0) {
      e.preventDefault();
      handleExecute(filteredCommands[selectedIndex].path);
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
          {filteredCommands.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Tidak menemukan hasil untuk "{query}"
            </div>
          ) : (
            filteredCommands.map((cmd, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={cmd.path}
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
                  <span style={{ fontSize: 18 }}>{cmd.icon}</span>
                  <span style={{ fontWeight: isSelected ? 600 : 400 }}>{cmd.name}</span>
                  {isSelected && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>ENTER</span>}
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
