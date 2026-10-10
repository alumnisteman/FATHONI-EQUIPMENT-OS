// src/components/Pager.tsx
// Penanda halaman untuk daftar berpaginasi. Hanya satu halaman record yang
// diambil dari SQLite, jadi tanpa alat ini sisa datanya tak akan pernah terlihat.

import React from 'react';

interface Props {
  from: number;
  to: number;
  total: number;
  /** Nomor halaman berbasis nol. */
  page: number;
  pages: number;
  loading?: boolean;
  onPage: (page: number) => void;
}

const Pager: React.FC<Props> = ({ from, to, total, page, pages, loading, onPage }) => {
  const keDepan = page + 1 < pages;
  const keBelakang = page > 0;

  return (
    <div
      className="card"
      style={{ padding: '10px 16px', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
    >
      <span id="pager-info" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {total === 0 ? 'Tidak ada record' : `Menampilkan ${from}–${to} dari ${total} record`}
        {loading ? ' · memuat...' : ''}
      </span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn btn-sm btn-secondary" id="pager-first" onClick={() => onPage(0)} disabled={!keBelakang}>
          Awal
        </button>
        <button className="btn btn-sm btn-secondary" id="pager-prev" onClick={() => onPage(page - 1)} disabled={!keBelakang}>
          Sebelumnya
        </button>
        <span id="pager-position" style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '0 6px' }}>
          Halaman {page + 1} / {pages}
        </span>
        <button className="btn btn-sm btn-secondary" id="pager-next" onClick={() => onPage(page + 1)} disabled={!keDepan}>
          Berikutnya
        </button>
        <button className="btn btn-sm btn-secondary" id="pager-last" onClick={() => onPage(pages - 1)} disabled={!keDepan}>
          Terakhir
        </button>
      </div>
    </div>
  );
};

export default Pager;
