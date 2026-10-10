// src/utils/photoStore.ts
// Foto unit disimpan sebagai berkas (folder data aplikasi di Electron, IndexedDB
// di mode browser), BUKAN base64 di localStorage.
//
// Alasannya: satu foto 200KB menjadi ±270.000 karakter saat disimpan base64, dan
// setiap perubahan foto memaksa seluruh database di-serialize + ditulis ulang ke
// storage. Foto juga dikompres di sisi klien lebih dulu (1400px + thumbnail 320px)
// supaya beban simpan dan beban tampil tidak tumbuh mengikuti kamera ponsel.

const DB_NAME = 'hems_photo_store';
const DB_VERSION = 1;
const STORE = 'photos';

const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const FULL_MAX_PX = 1400;
const FULL_QUALITY = 0.82;
const THUMB_MAX_PX = 320;
const THUMB_QUALITY = 0.72;

type ElectronApi = {
  savePhoto?: (id: string, data: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
  readPhoto?: (id: string) => Promise<{ success: boolean; data?: Uint8Array | ArrayBuffer | null; error?: string }>;
  deletePhoto?: (id: string) => Promise<{ success: boolean; error?: string }>;
};

const api = (): ElectronApi | undefined =>
  typeof window === 'undefined' ? undefined : (window as any).electronAPI;

const isDesktop = (): boolean => typeof api()?.savePhoto === 'function';

// ── Backend IndexedDB (mode browser / demo) ────────────────────────────
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB tidak tersedia'));
    });
  }
  return dbPromise;
}

function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Operasi foto gagal'));
  }));
}

// ── Akses foto seragam untuk kedua backend ─────────────────────────────
export async function savePhoto(id: string, blob: Blob): Promise<void> {
  if (isDesktop()) {
    const result = await api()!.savePhoto!(id, await blob.arrayBuffer());
    if (!result?.success) throw new Error(result?.error ?? 'Gagal menyimpan foto');
    return;
  }
  await idb('readwrite', store => store.put(blob, id));
}

export async function loadPhoto(id: string): Promise<Blob | null> {
  if (isDesktop()) {
    const result = await api()!.readPhoto!(id);
    if (!result?.success) throw new Error(result?.error ?? 'Gagal membaca foto');
    if (!result.data) return null;
    const bytes = result.data instanceof Uint8Array
      ? new Uint8Array(result.data)
      : new Uint8Array(result.data as ArrayBuffer);
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  return (await idb<Blob | undefined>('readonly', store => store.get(id))) ?? null;
}

export async function removePhoto(id: string): Promise<void> {
  if (isDesktop()) {
    const result = await api()!.deletePhoto!(id);
    if (!result?.success) throw new Error(result?.error ?? 'Gagal menghapus foto');
    return;
  }
  await idb('readwrite', store => store.delete(id));
}

// ── Nama & pembuatan id ────────────────────────────────────────────────
export function newPhotoId(prefix = 'unit'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function thumbIdFor(photoId: string): string {
  return photoId.replace(/\.[^.]+$/, '.thumb.jpg');
}

/** ID foto + thumbnail yang dipakai satu record unit (untuk backup manifest). */
export function photoIdsOf(unit: any): string[] {
  const id = unit?.photoId;
  if (typeof id !== 'string' || id === '') return [];
  return [id, thumbIdFor(id)];
}

export function collectPhotoIds(units: any[]): string[] {
  const ids = new Set<string>();
  units.forEach(u => photoIdsOf(u).forEach(id => ids.add(id)));
  return [...ids];
}

/** Hapus berkas foto unit beserta thumbnailnya. */
export async function deleteUnitPhotos(photoId?: string): Promise<void> {
  if (!photoId) return;
  await Promise.all([
    removePhoto(photoId).catch(e => console.warn('[photoStore] berkas lama tidak terhapus:', e)),
    removePhoto(thumbIdFor(photoId)).catch(() => undefined),
  ]);
}

// ── Kompresi di sisi klien ─────────────────────────────────────────────
type Size = { width: number; height: number };

function sourceSize(source: ImageBitmap | HTMLImageElement): Size {
  const bitmap = source as ImageBitmap;
  const image = source as HTMLImageElement;
  return { width: bitmap.width || image.naturalWidth, height: bitmap.height || image.naturalHeight };
}

function decodeImage(data: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(data).catch(() => decodeViaImageTag(data));
  }
  return decodeViaImageTag(data);
}

function decodeViaImageTag(data: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(data);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('File bukan gambar yang bisa dibaca')); };
    img.src = url;
  });
}

function encodeJpeg(
  source: ImageBitmap | HTMLImageElement,
  maxPx: number,
  quality: number
): Promise<Blob> {
  const { width, height } = sourceSize(source);
  const scale = Math.min(1, maxPx / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas tidak tersedia'));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Kompresi foto gagal')),
      'image/jpeg',
      quality
    );
  });
}

function releaseSource(source: ImageBitmap | HTMLImageElement): void {
  const bitmap = source as ImageBitmap;
  if (typeof bitmap.close === 'function') bitmap.close();
}

/**
 * Simpan hasil pilih pengguna: didecode di luar main thread, lalu dikompres
 * menjadi satu gambar tampilan (±1400px) dan satu thumbnail (±320px).
 * Mengembalikan id berkas yang disimpan di record unit.
 */
export async function storeUnitPhoto(data: Blob, prefix = 'unit'): Promise<string> {
  return compressAndSave(data, `${newPhotoId(prefix)}.jpg`);
}

/** Id berbasis id unit — migrasi yang dijalankan dua kali tidak menghasilkan duplikat. */
function unitPhotoId(unitId: unknown): string | null {
  if (typeof unitId !== 'string' || unitId.trim() === '') return null;
  const safe = unitId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48);
  return `unit-${safe}.jpg`;
}

async function compressAndSave(data: Blob, photoId: string): Promise<string> {
  if (data.size > MAX_INPUT_BYTES) {
    throw new Error(`Foto terlalu besar (maks ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB sebelum dikompres).`);
  }
  const source = await decodeImage(data);
  try {
    const [full, thumb] = await Promise.all([
      encodeJpeg(source, FULL_MAX_PX, FULL_QUALITY),
      encodeJpeg(source, THUMB_MAX_PX, THUMB_QUALITY),
    ]);
    await savePhoto(photoId, full);
    await savePhoto(thumbIdFor(photoId), thumb);
    return photoId;
  } finally {
    releaseSource(source);
  }
}

// ── Object URL dengan cache terbatas ───────────────────────────────────
const urlCache = new Map<string, string>();
const URL_CACHE_MAX = 240;

export async function photoObjectUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) {
    urlCache.delete(id);
    urlCache.set(id, cached);
    return cached;
  }
  const blob = await loadPhoto(id);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  if (urlCache.size > URL_CACHE_MAX) {
    const oldest = urlCache.keys().next().value as string | undefined;
    if (oldest) {
      URL.revokeObjectURL(urlCache.get(oldest)!);
      urlCache.delete(oldest);
    }
  }
  return url;
}

// ── Migrasi base64 lama ────────────────────────────────────────────────
export function isDataUrl(value?: string): boolean {
  return typeof value === 'string' && value.startsWith('data:');
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(header)?.[1] ?? 'image/jpeg';
  const binary = atob(payload ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Pindahkan base64 yang masih menempel di record unit ke berkas foto.
 * Sekali jalan; mengembalikan null bila tidak ada yang berubah. Kegagalan pada
 * satu unit tidak menghapus fotonya — base64 tetap di tempat.
 */
let migrationInFlight: Promise<any[] | null> | null = null;

export function migrateInlinePhotos(units: any[]): Promise<any[] | null> {
  // Dua mount beruntun (React StrictMode) tidak boleh mengompres foto yang sama dua kali.
  if (migrationInFlight) return migrationInFlight;
  const run = runMigration(units);
  migrationInFlight = run;
  run.finally(() => { if (migrationInFlight === run) migrationInFlight = null; });
  return run;
}

async function runMigration(units: any[]): Promise<any[] | null> {
  if (!units.some(u => isDataUrl(u.photo))) return null;

  let changed = false;
  const migrated = await Promise.all(units.map(async (unit: any) => {
    if (!isDataUrl(unit.photo)) return unit;
    try {
      const photoId = await compressAndSave(
        dataUrlToBlob(unit.photo),
        unitPhotoId(unit.id) ?? newPhotoId('migrated')
      );
      const { photo, ...rest } = unit;
      changed = true;
      return { ...rest, photoId };
    } catch (e) {
      console.error('[photoStore] Migrasi foto unit gagal:', e);
      return unit;
    }
  }));

  return changed ? migrated : null;
}
