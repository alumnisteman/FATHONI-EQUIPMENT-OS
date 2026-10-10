// src/components/UnitPhoto.tsx
// Menampilkan foto unit dari berkas (Electron/IndexedDB), bukan base64 dari
// database. Thumbnail dipakai daftar, gambar penuh dipakai tampilan detail.

import { useEffect, useState, type CSSProperties } from 'react';
import { photoObjectUrl, thumbIdFor } from '../utils/photoStore';

const PLACEHOLDER_D = 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z';

type Props = {
  photoId?: string;
  /** Base64 lama yang belum termigrasi. */
  inlineSrc?: string;
  /** Foto default berdasarkan merek. */
  fallbackSrc?: string;
  alt: string;
  variant?: 'thumb' | 'full';
  style?: CSSProperties;
  placeholderSize?: number;
};

export default function UnitPhoto({
  photoId, inlineSrc, fallbackSrc, alt,
  variant = 'thumb', style, placeholderSize = 48,
}: Props) {
  const targetId = photoId ? (variant === 'thumb' ? thumbIdFor(photoId) : photoId) : undefined;
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!targetId) {
      setUrl(null);
      setMissing(false);
      return;
    }
    let active = true;
    setUrl(null);
    setMissing(false);
    photoObjectUrl(targetId)
      .then(resolved => {
        if (!active) return;
        if (resolved) setUrl(resolved);
        else setMissing(true);
      })
      .catch(() => { if (active) setMissing(true); });
    return () => { active = false; };
  }, [targetId]);

  // Berkas masih dibaca: jangan kedipkan foto default dulu.
  if (targetId && !url && !missing) return null;

  const src = url || (targetId ? undefined : inlineSrc) || fallbackSrc;

  if (!src) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--border-default)" strokeWidth={1}
        width={placeholderSize} height={placeholderSize}>
        <path d={PLACEHOLDER_D} />
      </svg>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      style={style}
      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  );
}
