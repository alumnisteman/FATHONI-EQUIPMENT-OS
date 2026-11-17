// src/store/dataStore.tsx
// BUG-003 FIX: Perbaiki dependency array save effect
// BUG-005 FIX: Tambahkan debounce, storage quota warning, dan kapasitas monitoring
// BUG-006 FIX: Konsistenkan storage key ke lowercase (hems_)
// BUG-009 FIX: Perbaiki field mismatch di createInvoiceFromSale

import React, {
  createContext, useContext, useState, useEffect, useRef, useMemo, ReactNode, useCallback
} from 'react';
import {
  Customer, Supplier, SparePart, ServiceRecord, Delivery,
  CashBank, DashboardStats, UnitStatus, Breakdown, Operator,
  Technician, ApprovalRequest
} from '../types';

import { buildSampleStore } from '../data/sampleData';
import type { TransaksiKas } from '../data/demoTransactions';
import {
  invoiceFromSale, invoiceFromRental, invoiceFromService,
} from '../domain/invoiceFactory';
import {
  migrateStore, readMigrationMarker, writeMigrationMarker, hasMigrationWork, type MigrationReport,
} from './dataMigration';
import {
  dbInfo, dbLoadStore, dbSaveStore, dbPatchStore, dbMarkImported, dbOnFlushRequest, dbFlushDone,
  tulisDitolak,
  dbReferences, type RowPatch, type ReferenceReport,
} from '../services/dbClient';
import { COLLECTION_KEYS, STORAGE_KEY } from './collections';
import { rencanakanTulis, rowKey } from './writeGuard';
import { validateKasKembar } from '../utils/validation';

// ── Penolakan tulis dari main process ─────────────────────────
// Main process bisa menolak dengan sengaja: jendela tidak punya sesi, peran tidak
// berwenang atas collection itu, atau nilainya bukan angka. Ketiganya berarti
// "muatan ini tidak akan pernah masuk", jadi renderer tidak boleh jatuh ke jalur
// simpanan penuh — yang hanya mengulang penolakan yang sama sambil membuat layar
// mengira perubahannya sudah aman.
function pesanDitolak(): string | null {
  const t = tulisDitolak();
  return t && t.dilarang ? t.error : null;
}

// ── Status restore ────────────────────────────────────────────
// Saat proses restore sedang berlangsung, setiap penulisan store dari
// memori lama harus dihentikan — kalau tidak, autosave atau flush
// beforeunload menimpa data yang baru saja dipulihkan.
let restorePending = false;
export function markRestorePending(): void {
  restorePending = true;
}
export function clearRestorePending(): void {
  restorePending = false;
}

// ── Hasil tindakan hapus ───────────────────────────────────────
// Hapus DITOLAK bila record masih disebut dokumen lain. Alasannya dibawa sebagai
// teks, karena yang harus dibaca pengguna bukan "gagal" tapi dokumen mana yang
// menahan — dan itu berbeda-beda per menu (lihat electron/referential.ts).
export interface HasilHapus {
  ok: boolean;
  alasan?: string;
}

function alasanRujukan(refs: ReferenceReport): string {
  if (refs.error) {
    return `Penghapusan dibatalkan: daftar dokumen yang merujuk record ini tidak bisa dibaca (${refs.error}). ` +
      'Coba lagi setelah aplikasi stabil — menghapus tanpa daftar itu berisiko meninggalkan dokumen yatim.';
  }
  const daftar = refs.hits
    .map(h => `${h.label}: ${h.jumlah} dokumen (${h.contoh.join(', ')})`)
    .join('; ');
  return `Record ini masih dipakai dokumen lain, jadi belum bisa dihapus. Hapus atau pindahkan dokumennya lebih dulu — ${daftar}.`;
}

// ── Storage Utility ──────────────────────────────────────────
// Chromium membatasi localStorage ±5MB per origin. Aplikasi menganggarkan
// 4MB untuk store ini; sisanya untuk sesi, pengaturan, dan log.
const STORE_BUDGET_CHARS = 4 * 1024 * 1024;

export function formatBytes(chars: number): string {
  return `${(chars / 1024 / 1024).toFixed(2)} MB`;
}

// ── Baca database lama di localStorage ─────────────────────────────────────
// Jalan ini tetap dibutuhkan untuk dua hal: mode browser tanpa Electron, dan
// sekali saja saat memindahkan profil desktop ke SQLite.
function readLocalStore(): { store: Record<string, any[]>; corrupted: boolean; quarantined: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: Record<string, any[]> = {};
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const key of COLLECTION_KEYS) {
        if (Array.isArray(parsed[key])) store[key] = parsed[key];
      }
    }
    return { store, corrupted: false, quarantined: false };
  } catch (e) {
    // Key yang rusak JANGAN pernah dihapus — string mentahnya adalah satu-satunya
    // salinan data pengguna. Karantina supaya bisa dipulihkan manual.
    console.error('[DataStore] Gagal memuat data dari localStorage:', e);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        localStorage.setItem(`${STORAGE_KEY}_corrupt_${Date.now()}`, raw);
        return { store: emptyStore(), corrupted: true, quarantined: true };
      }
    } catch { /* tidak ada tempat lain untuk memisahkan */ }
    return { store: emptyStore(), corrupted: true, quarantined: false };
  }
}

// Store dengan semua collection berbentuk array. Perbandingan identitas saat
// simpan bergantung pada ini: tanpa normalisasi, collection yang hilang akan
// dianggap berubah terus.
function emptyStore(): Record<string, any[]> {
  const store: Record<string, any[]> = {};
  for (const key of COLLECTION_KEYS) store[key] = [];
  return store;
}

function toStore(source: Record<string, any> | null | undefined): Record<string, any[]> {
  const store = emptyStore();
  if (!source) return store;
  for (const key of COLLECTION_KEYS) {
    const rows = source[key];
    if (Array.isArray(rows)) store[key] = rows;
  }
  return store;
}

function countRows(store: Record<string, any[]>): number {
  return Object.values(store).reduce((total, rows) => total + rows.length, 0);
}

// Nilai awal ref store; selalu digantikan sebelum efek autosave boleh menulis.
const EMPTY_STORE: Record<string, any[]> = emptyStore();

// ── Context Type ──────────────────────────────────────────────
interface DataContextType {
  units: any[];
  brands: any[];
  models: any[];
  customers: Customer[];
  suppliers: Supplier[];
  spareParts: SparePart[];
  invoices: any[];
  sales: any[];
  rentals: any[];
  services: any[];
  kas: any[];
  deliveries: any[];
  warehouse: any[];
  purchases: any[];
  documents: any[];
  bankAccounts: any[];
  breakdowns: Breakdown[];
  operators: Operator[];
  technicians: Technician[];
  approvals: ApprovalRequest[];
  storageWarning: string | null;
  loadError: string | null;
  hasUnsavedChanges: boolean;
  migrationReport: MigrationReport | null;

  // Actions
  updateUnitStatus: (unitId: string, status: UnitStatus) => void;
  createInvoiceFromSale: (sale: any) => void;
  createInvoiceFromRental: (rental: any) => void;
  consumeSparePart: (partId: string, quantity: number) => void;
  restockSparePart: (partId: string, quantity: number) => void;
  addKasEntry: (entry: Omit<TransaksiKas, 'id'> & { id?: string }) => void;
  addWarehouseMovement: (movement: {
    type: 'INBOUND' | 'OUTBOUND';
    referenceDoc: string;
    itemDescription: string;
    qty: number;
    unit: string;
    warehouseName?: string;
    pic?: string;
    notes?: string;
  }) => void;
  ensureSupplier: (name: string) => void;
  addSale: (sale: any) => void;
  addRental: (rental: any) => void;
  addDelivery: (delivery: any) => void;
  completeService: (serviceId: string, sparePartsUsed?: { partId: string; quantity: number }[], actualCost?: number) => void;
  receivePurchase: (purchaseId: string, receivedBy?: string) => void;
  loadSampleData: () => number;
  /**
   * Tulis SATU baris (tambah atau ubah) ke file. Halaman berpaginasi memakai
   * ini, bukan saveNow: menggabungkan array penuh untuk menyatakan satu
   * perubahan berarti membuat salinan puluhan ribu objek tiap klik, dan begitu
   * halaman hanya memegang sebagian baris, gabungan itu juga menghapus baris
   * yang tidak pernah dimuat.
   */
  saveRow: (name: string, row: any) => Promise<boolean>;
  /** Tulis beberapa baris yang berubah sekaligus; tetap patch, bukan collection penuh. */
  saveRows: (name: string, rows: any[]) => Promise<boolean>;
  /** Hapus SATU baris lewat id; hanya id yang melintasi IPC. */
  removeRow: (name: string, id: string) => Promise<HasilHapus>;
  /**
   * Gerbang hidrasi: muat penuh collection yang diminta sebelum halamannya
   * menampilkan atau menulis array store. Dipanggil ProtectedRoute lewat daftar
   * kebutuhan di src/store/collectionNeeds.ts.
   */
  ensureLoaded: (names: string[]) => Promise<void>;
  /** Berapa kali tiap collection sudah masuk file; isyarat untuk ambil ulang. */
  savedTick: Record<string, number>;

  setUnits: React.Dispatch<React.SetStateAction<any[]>>;
  setBrands: React.Dispatch<React.SetStateAction<any[]>>;
  setModels: React.Dispatch<React.SetStateAction<any[]>>;
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  setSuppliers: React.Dispatch<React.SetStateAction<Supplier[]>>;
  setSpareParts: React.Dispatch<React.SetStateAction<SparePart[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<any[]>>;
  setSales: React.Dispatch<React.SetStateAction<any[]>>;
  setRentals: React.Dispatch<React.SetStateAction<any[]>>;
  setServices: React.Dispatch<React.SetStateAction<any[]>>;
  setKas: React.Dispatch<React.SetStateAction<any[]>>;
  setDeliveries: React.Dispatch<React.SetStateAction<any[]>>;
  setWarehouse: React.Dispatch<React.SetStateAction<any[]>>;
  setPurchases: React.Dispatch<React.SetStateAction<any[]>>;
  setDocuments: React.Dispatch<React.SetStateAction<any[]>>;
  setBankAccounts: React.Dispatch<React.SetStateAction<any[]>>;
  setBreakdowns: React.Dispatch<React.SetStateAction<Breakdown[]>>;
  setOperators: React.Dispatch<React.SetStateAction<Operator[]>>;
  setTechnicians: React.Dispatch<React.SetStateAction<Technician[]>>;
  setApprovals: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Database selalu mulai kosong. Data contoh hanya masuk lewat loadSampleData(),
  // dan data warisan masuk lewat migrasi sekali jalan di bawah.
  const [units, setUnits]           = useState<any[]>([]);
  const [brands, setBrands]         = useState<any[]>([]);
  const [models, setModels]         = useState<any[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [suppliers, setSuppliers]   = useState<Supplier[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [invoices, setInvoices]     = useState<any[]>([]);
  const [sales, setSales]           = useState<any[]>([]);
  const [rentals, setRentals]       = useState<any[]>([]);
  const [services, setServices]     = useState<any[]>([]);
  const [kas, setKas]               = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [warehouse, setWarehouse]   = useState<any[]>([]);
  const [purchases, setPurchases]   = useState<any[]>([]);
  const [breakdowns, setBreakdowns] = useState<Breakdown[]>([]);
  const [operators, setOperators]   = useState<Operator[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [approvals, setApprovals]   = useState<ApprovalRequest[]>([]);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const [documents, setDocuments] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [migrationReport, setMigrationReport] = useState<MigrationReport | null>(null);

  // BUG-003 FIX: isLoaded dipisahkan dari data state
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // true bila data hidup di file SQLite (desktop); false = localStorage (browser)
  const [useDb, setUseDb] = useState(false);

  // BUG-005 FIX: Debounce timer ref untuk menghindari save berlebihan
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Salinan terbaru dari seluruh data, dipakai oleh flush saat beforeunload.
  const dataRef = useRef<Record<string, any[]>>(EMPTY_STORE);
  // Referensi array yang sudah ada di database. Autosave hanya mengirim
  // collection yang referensinya berbeda, jadi simpanan besar tidak diulang.
  const lastSavedRef = useRef<Record<string, any[]>>(EMPTY_STORE);

  // Penanda versi simpanan per collection. Halaman yang membaca SQLite baris per
  // halaman memakainya sebagai isyarat ambil ulang: hasil tulis baru boleh dibaca
  // lagi SETELAH perubahan benar-benar ada di file, tidak saat array state baru
  // saja berubah. Tanpa isyarat ini, tulis dari menu lain tidak pernah tampak.
  const [savedTick, setSavedTick] = useState<Record<string, number>>({});
  const bumpSaved = useCallback((names: string[]) => {
    if (names.length === 0) return;
    setSavedTick(prev => {
      const next = { ...prev };
      for (const name of names) next[name] = (next[name] || 0) + 1;
      return next;
    });
  }, []);

  // ── Peta nama collection → setter state ──────────────────────
  const collectionSetters = useMemo<Record<string, React.Dispatch<React.SetStateAction<any[]>>>>(() => ({
    units: setUnits, customers: setCustomers, suppliers: setSuppliers,
    brands: setBrands, models: setModels,
    spareParts: setSpareParts, invoices: setInvoices, sales: setSales,
    rentals: setRentals, services: setServices, kas: setKas,
    deliveries: setDeliveries, warehouse: setWarehouse, purchases: setPurchases,
    documents: setDocuments, bankAccounts: setBankAccounts, breakdowns: setBreakdowns,
    operators: setOperators, technicians: setTechnicians, approvals: setApprovals,
  }), []);

  // ── Pasang satu paket data sekaligus ke state ─────────────────
  const applyDataset = useCallback((data: Record<string, any[]>) => {
    for (const [name, setter] of Object.entries(collectionSetters)) {
      setter(Array.isArray(data[name]) ? data[name] : []);
    }
  }, [collectionSetters]);

  // ── Hidrasi tertunda per collection ──────────────────────────
  // Boot desktop tidak lagi memindahkan seluruh isi file ke renderer. Collection
  // dibaca ketika menu yang memakainya dibuka, jadi biaya boot berhenti tumbuh
  // mengikuti jumlah record. Konsekuensinya harus dijaga keras: selama sebuah
  // collection BELUM pernah dibacakan penuh, array di memorinya bukan gambaran
  // isi file, sehingga simpanan collection penuh akan menghapus baris yang tidak
  // ikut terbaca. loadedRef adalah sumber kebenaran status itu dan penjaga tulis
  // ada di persist() serta patchRows().
  const loadedRef = useRef<Record<string, boolean>>({});
  const hydratingRef = useRef<Record<string, Promise<any[] | null>>>({});
  // Hasil baca yang sudah diminta tapi belum mendarat di state. Identitas arraynya
  // dicatat supaya autosave tidak menganggapnya perubahan pengguna.
  const hydratedRef = useRef<Record<string, any[]>>({});

  const hydrateOne = useCallback((name: string): Promise<any[] | null> => {
    const permintaan = dbLoadStore([name]).then(data => {
      const rows = Array.isArray(data?.[name]) ? (data as Record<string, any[]>)[name] : null;
      if (!rows) {
        setStorageWarning(`🚨 Data "${name}" belum bisa dibaca dari database. ` +
          'Perubahan di layar ini tetap tersimpan di memori tapi collection-nya ' +
          'belum boleh ditimpa; periksa Pemeliharaan Sistem lalu buka ulang menunya.');
        return null;
      }
      // Pengguna sudah mengubah collection ini lebih dulu (IPC lambat, pengguna
      // cepat): jangan timpa perubahannya. Collection tetap berstatus belum
      // termuat, dan penjaga tulis membatasi cara penulisannya.
      if (dataRef.current[name] !== lastSavedRef.current[name]) return rows;
      hydratedRef.current[name] = rows;
      (collectionSetters[name] as React.Dispatch<React.SetStateAction<any[]>>)(rows);
      return rows;
    }).catch(err => {
      console.error(`[DataStore] Gagal memuat collection ${name}:`, err);
      setStorageWarning(`🚨 Data "${name}" gagal dibaca dari database: ${String(err?.message ?? err)}`);
      return null;
    }).finally(() => {
      delete hydratingRef.current[name];
    });
    hydratingRef.current[name] = permintaan;
    return permintaan;
  }, [collectionSetters]);

  /**
   * Muat collection yang diminta bila belum pernah dimuat penuh. Dipanggil oleh
   * gerbang rute (ProtectedRoute) dengan daftar dari src/store/collectionNeeds.ts;
   * dua permintaan atas collection yang sama memakai satu pembacaan, dan mode
   * browser tanpa database sudah memegang semuanya sejak boot.
   */
  const ensureLoaded = useCallback(async (names: string[]): Promise<void> => {
    if (!useDb) return;
    if (restorePending) return;
    const diminta = (names || []).filter(n => COLLECTION_KEYS.includes(n) && collectionSetters[n]);
    const belum = diminta.filter(n => !loadedRef.current[n] && !hydratingRef.current[n]);
    const berjalan = diminta.map(n => hydratingRef.current[n]).filter(Boolean) as Promise<any>[];
    await Promise.all([...belum.map(hydrateOne), ...berjalan]);
  }, [useDb, collectionSetters, hydrateOne]);

  /**
   * Tandai semua collection sudah utuh di memori. Hanya dipakai untuk satu
   * keadaan: data hasil migrasi dari penyimpanan lama yang memang kita pegang
   * seluruhnya, termasuk saat penulisannya ke file masih harus dicoba lagi.
   */
  const markSemuaTermuat = useCallback(() => {
    for (const name of COLLECTION_KEYS) {
      loadedRef.current[name] = true;
      delete hydratedRef.current[name];
    }
  }, []);

  // ── Load database saat mount ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const publish = (data: Record<string, any[]>, retrySave = false) => {
      if (cancelled) return;
      applyDataset(data);
      // Snapshot pertama masuk ke dataRef sebelum efek autosave sempat menjadwalkan
      // tulisannya sendiri; tanpa ini state yang masih kosong bisa tersimpan
      // menimpa database.
      dataRef.current = data;
      // retrySave = isi data belum tentu ada di file, jadi biarkan simpanan
      // berikutnya mengirim semua collection lagi.
      lastSavedRef.current = retrySave ? EMPTY_STORE : data;
      setIsLoaded(true);
    };

    const showReport = (report: MigrationReport | null) => {
      // Laporan ditampilkan walau migrasi terjadi pada sesi sebelumnya, supaya
      // halaman Pemeliharaan Sistem selalu bisa menjelaskan isi database.
      if (hasMigrationWork(report)) {
        setMigrationReport(report);
        console.info('[DataStore] Laporan migrasi data:', JSON.stringify(report));
      }
    };

    const boot = async () => {
      const info = await dbInfo();
      if (cancelled) return;

      if (info) {
        // Desktop: file SQLite adalah sumber kebenaran. Boot hanya perlu tahu
        // apakah masih ada warisan localStorage yang harus dipindahkan, dan itu
        // dijawab oleh jumlah baris — bukan oleh pembacaan seluruh isi file.
        setUseDb(true);
        const adaIsi = (Number(info.totalRows) || 0) > 0;

        if (adaIsi) {
          showReport(readMigrationMarker());
          // Collection dimuat saat menunya dibuka. Array kosong di sini bukan
          // berarti "collection itu kosong", dan penjaga tulis tidak akan
          // pernah memakainya sebagai gambaran isi file.
          publish(emptyStore());
          return;
        }

        if (info.importedFromLocalStorage) {
          // Profil baru, atau database yang baru dipulihkan dari file kosong.
          // Isi file memang nol baris, jadi array kosong di memori sah.
          showReport(readMigrationMarker());
          publish(emptyStore());
          markSemuaTermuat();
          return;
        }

        const local = readLocalStore();
        if (local.corrupted) {
          setLoadError(local.quarantined
            ? 'Database tersimpan tidak bisa dibaca dan sudah dikarantina. ' +
              'Buka menu Backup & Restore untuk memulihkan dari file cadangan.'
            : 'Database tersimpan rusak dan tidak bisa dikarantina. Jangan tutup aplikasi ini sebelum menghubungi administrator.');
          publish(emptyStore());
          return;
        }

        if (countRows(local.store) === 0) {
          // Tidak ada warisan apa pun: tandai supaya boot berikutnya tidak
          // membaca localStorage lagi.
          await dbMarkImported();
          showReport(readMigrationMarker());
          publish(emptyStore());
          markSemuaTermuat();
          return;
        }

        const migrated = migrateStore(local.store);
        const saved = await dbSaveStore(migrated.store);
        if (cancelled) return;
        if (saved) {
          await dbMarkImported();
          writeMigrationMarker(migrated.report);
          showReport(migrated.report);
          // Barisnya sudah pindah ke file; biarkan tiap menu memuatnya sendiri.
          publish(emptyStore());
        } else {
          // Marker impor tidak dipasang, jadi boot berikutnya mencoba lagi.
          // Data hasil migrasi tetap dipakai di memori dan simpanan berikutnya
          // mengirim ulang semuanya — array ini memang seluruh isi store lama,
          // jadi boleh ditulis sebagai collection penuh.
          setStorageWarning('🚨 Data dari penyimpanan lama BELUM masuk ke database. ' +
            'Jangan tutup aplikasi ini; ulangi beberapa saat atau ekspor backup dari menu Backup & Restore.');
          publish(toStore(migrated.store), true);
          markSemuaTermuat();
        }
        return;
      }

      // Browser: tidak ada backend, jadi localStorage tetap sumber data.
      const local = readLocalStore();
      let data = local.store;
      if (local.corrupted) {
        setLoadError(local.quarantined
          ? 'Database tersimpan tidak bisa dibaca dan sudah dikarantina. ' +
            'Buka menu Backup & Restore untuk memulihkan dari file cadangan.'
          : 'Database tersimpan rusak dan tidak bisa dikarantina. Jangan tutup aplikasi ini sebelum menghubungi administrator.');
      } else {
        // Migrasi Fase 3 hanya sekali per profil. Data yang dikarantina tidak
        // disentuh: pengguna memutuskan sendiri pemulihannya lewat menu Backup.
        let report = readMigrationMarker();
        if (!report) {
          const result = migrateStore(data);
          data = result.store;
          // Tulis hasil migrasi lebih dulu, marker belakangan. Autosave di-debounce
          // dan efek mount bisa berjalan dua kali (React StrictMode), jadi tanpa
          // tulisan langsung ini hasil migrasi hilang sementara markernya sudah
          // terpasang. Bila tulisannya gagal, marker tidak dipasang sehingga
          // migrasi diulang saat boot berikutnya — migrateStore idempoten.
          let committed = false;
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            committed = true;
          } catch (err) {
            console.error('[DataStore] Gagal menyimpan hasil migrasi:', err);
          }
          if (committed) writeMigrationMarker(result.report);
          report = result.report;
        }
        showReport(report);
      }
      publish(toStore(data));
      // Mode browser: localStorage sudah berisi seluruh store dan dimuat di sini,
      // jadi array di memori memang gambaran lengkap isi penyimpanan.
      markSemuaTermuat();
    };

    boot().catch(err => {
      console.error('[DataStore] Gagal menyiapkan database:', err);
      if (!cancelled) setLoadError(`Database tidak bisa dibuka: ${err?.message ?? err}`);
    });

    return () => { cancelled = true; };
  }, [applyDataset, markSemuaTermuat]); // hanya sekali saat mount

  // ── Simpan snapshot ke penyimpanan ───────────────────────────
  // Desktop: hanya collection yang isinya berubah yang dikirim ke main process,
  // dan SQLite di-diff per baris di sana. Browser: satu kunci localStorage.
  const persist = useCallback(async (): Promise<boolean> => {
    if (restorePending) return false;

    if (!useDb) {
      const str = JSON.stringify(dataRef.current);
      try {
        // Selalu coba tulis. Mendahului dengan pemindaian kuota hanya akan
        // membuat perubahan hilang tanpa jejak bila estimasinya meleset.
        localStorage.setItem(STORAGE_KEY, str);
        const changed = COLLECTION_KEYS.filter(name => dataRef.current[name] !== lastSavedRef.current[name]);
        for (const name of changed) lastSavedRef.current[name] = dataRef.current[name];
        bumpSaved(changed);
        setHasUnsavedChanges(false);
        setStorageWarning(
          str.length > STORE_BUDGET_CHARS
            ? `⚠️ Database sudah ${formatBytes(str.length)} dari anggaran ±4 MB. Segera backup dan arsipkan data lama.`
            : null
        );
        return true;
      } catch (err: any) {
        setHasUnsavedChanges(true);
        setStorageWarning(err?.name === 'QuotaExceededError'
          ? '🚨 Storage penuh — perubahan TERAKHIR TIDAK TERSIMPAN. Buka Backup & Restore, arsipkan data lama, lalu ulangi.'
          : `🚨 Gagal menyimpan database: ${err?.message ?? err}`);
        if (err?.name !== 'QuotaExceededError') console.error('[DataStore] Gagal menyimpan data:', err);
        return false;
      }
    }

    const store = dataRef.current;
    const dirty = COLLECTION_KEYS.filter(name => store[name] !== lastSavedRef.current[name]);
    if (dirty.length === 0) {
      setHasUnsavedChanges(false);
      return true;
    }

    // Pisahkan mana yang bisa dikirim sebagai patch baris dan mana yang harus
    // mengirim collection penuh — termasuk PENJAGA KERAS-nya: collection yang
    // belum pernah dibacakan penuh tidak boleh mewakili isi tabelnya di file,
    // karena simpanan penuh akan menghapus baris yang tidak ikut terbaca.
    // Aturannya hidup di src/store/writeGuard supaya bisa diuji sebagai unit.
    const rencana = rencanakanTulis(dirty, lastSavedRef.current, store, loadedRef.current);
    const { patches, full, buangan } = rencana;
    const tertahan = rencana.tertahan;

    const saved: string[] = [];
    if (Object.keys(patches).length > 0) {
      const patched = await dbPatchStore(patches);
      if (patched) saved.push(...Object.keys(patches));
      else {
        const ditolak = pesanDitolak();
        // Penolakan sengaja dari main process (peran, sesi, angka cacat): jalur
        // collection penuh mengirim muatan yang sama dan ditolak lagi, jadi yang
        // perlu terjadi adalah pengguna membaca alasannya, bukan menyimpan dua kali.
        if (ditolak) {
          setHasUnsavedChanges(true);
          setStorageWarning(`🚨 ${ditolak}\nPerubahan pada "${Object.keys(patches).join(', ')}" TIDAK tersimpan.`);
          return false;
        }
        // Main process menolak patch (mis. build lama tanpa kanal db-patch):
        // collection yang SUDAH termuat penuh ikut dikirim penuh di bawah supaya
        // tidak ada perubahan yang hilang. Yang belum termuat tidak pernah boleh
        // lewat jalur itu — itulah yang dijaga di atas.
        for (const name of Object.keys(patches)) {
          if (loadedRef.current[name]) full[name] = store[name];
          else tertahan.push(name);
        }
      }
    }
    if (Object.keys(full).length > 0) {
      const fullSaved = await dbSaveStore(full);
      if (fullSaved) saved.push(...Object.keys(full));
      else {
        const ditolak = pesanDitolak();
        if (ditolak) {
          setHasUnsavedChanges(true);
          setStorageWarning(`🚨 ${ditolak}\nPerubahan pada "${Object.keys(full).join(', ')}" TIDAK tersimpan.`);
          return false;
        }
      }
    }

    // Hanya yang benar-benar sampai di file yang boleh dianggap tersimpan.
    for (const name of saved) lastSavedRef.current[name] = store[name];
    bumpSaved(saved);

    if (tertahan.length > 0) {
      setHasUnsavedChanges(true);
      setStorageWarning(`🚨 Perubahan pada "${tertahan.join(', ')}" TIDAK BISA disimpan: ` +
        'collection itu belum selesai dimuat dari database, dan menuliskannya sebagai ' +
        'satu paket akan menghapus baris yang belum terbaca. Buka kembali menunya, ' +
        'lalu ulangi simpanan.');
      return false;
    }

    if (Object.keys(buangan).length > 0) {
      const rincian = Object.entries(buangan).map(([n, k]) => `${k} baris "${n}"`).join(', ');
      setHasUnsavedChanges(true);
      setStorageWarning(`⚠️ Penghapusan tertunda: ${rincian} tidak bisa dijamin karena ` +
        'collection-nya belum selesai dimuat dari database. Buka kembali menunya lalu ' +
        'hapus dari sana.');
      // Bagian yang ter-upsert sudah masuk file; jangan dianggap bersih sepenuhnya.
      return false;
    }

    if (saved.length !== dirty.length) {
      setHasUnsavedChanges(true);
      setStorageWarning('🚨 Perubahan TERAKHIR TIDAK TERSIMPAN ke database. Periksa Pemeliharaan Sistem, lalu ulangi simpanan.');
      return false;
    }
    setHasUnsavedChanges(false);
    setStorageWarning(null);
    return true;
  }, [useDb, bumpSaved]);

  /**
   * Salinan terbaru satu collection masuk ke memori, patch-nya masuk ke file.
   * Urutan ini sengaja: perubahan pengguna tidak boleh hilang dari layar hanya
   * karena tulisannya belum sampai — bila tulisannya gagal, array yang sudah
   * berubah tetap tertinggal di store dan `lastSavedRef` tidak diperbarui, jadi
   * simpanan berikutnya (debounce atau beforeunload) mengirim ulang.
   */
  const patchRows = useCallback(async (
    name: string,
    patch: RowPatch,
    nextRows: any[]
  ): Promise<boolean> => {
    const setter = collectionSetters[name];
    dataRef.current = { ...dataRef.current, [name]: nextRows };
    setter(nextRows);

    if (!useDb) {
      // localStorage bersifat sinkron dan simpanannya selalu penuh.
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      return persist();
    }

    // Patch ditolak main process bukan alasan untuk kehilangan perubahan:
    // jalannya jatuh ke simpanan collection penuh — TAPI hanya untuk collection
    // yang memang sudah termuat penuh. Untuk yang belum, jalur penuh itu berarti
    // menghapus baris yang tidak pernah dibaca layar ini.
    let ok = (await dbPatchStore({ [name]: patch })) !== null;
    const ditolak = ok ? null : pesanDitolak();
    if (!ok && !ditolak && loadedRef.current[name]) ok = (await dbSaveStore({ [name]: nextRows })) !== null;

    if (ditolak) {
      // Penolakan sengaja: perannya, sesinya, atau angkanya — bukan kegagalan
      // teknis yang layak diulang. Beritahu alasannya apa adanya.
      setHasUnsavedChanges(true);
      setStorageWarning(`🚨 ${ditolak}`);
      return false;
    }
    if (!ok) {
      setHasUnsavedChanges(true);
      setStorageWarning(loadedRef.current[name]
        ? `🚨 Perubahan pada "${name}" TIDAK TERSIMPAN ke database. ` +
          'Jangan tutup aplikasi ini; ulangi simpanan atau periksa Pemeliharaan Sistem.'
        : `🚨 Perubahan pada "${name}" TIDAK TERSIMPAN: collection ini belum selesai ` +
          'dimuat dari database dan patch-nya ditolak. Buka kembali menunya, lalu ulangi.');
      return false;
    }
    // Referensinya dicatat: debounce berikutnya melihat collection ini tidak
    // berubah, jadi apa yang baru saja masuk ke file tidak dikirim ulang.
    lastSavedRef.current[name] = nextRows;
    bumpSaved([name]);
    setHasUnsavedChanges(false);
    // Peringatan "TIDAK TERSIMPAN" dari percobaan sebelumnya tidak boleh
    // menetap setelah baris ini benar-benar masuk file — operator akan mengira
    // datanya masih hilang. Bila masih ada masalah lain, jalur simpan
    // berikutnya memasang peringatan itu lagi beserta alasannya.
    setStorageWarning(null);
    return true;
  }, [collectionSetters, persist, useDb, bumpSaved]);

  /**
   * Tulis beberapa baris yang berubah. Yang lewat IPC tetap hanya barisnya,
   * bukan collection-nya — ini untuk tindakan yang menyentuh lebih dari satu
   * record sekaligus (mis. migrasi foto unit).
   */
  const saveRows = useCallback(async (name: string, rows: any[]): Promise<boolean> => {
    if (!COLLECTION_KEYS.includes(name) || !Array.isArray(rows) || rows.length === 0) return false;
    if (restorePending) return false;
    const byKey = new Map<string, any>();
    for (const row of rows) {
      const key = rowKey(row);
      // Baris tanpa id tidak bisa dinyatakan sebagai patch; kirim lewat jalur
      // collection penuh saja supaya tidak ada perubahan yang hilang.
      if (key === null) return false;
      byKey.set(key, row);
    }
    const prev = dataRef.current[name] || [];
    const known = new Set(prev.map(rowKey));
    const diganti = prev.map(r => {
      const key = rowKey(r);
      return key !== null && byKey.has(key) ? byKey.get(key) : r;
    });
    // Baris baru ditaruh di depan: daftar yang ditampilkan halaman diurutkan by
    // SQLite, jadi urutan di memori hanya penting untuk pembaca tanpa query.
    const baru = [...byKey.values()].filter(row => !known.has(rowKey(row)));
    return patchRows(name, { upsert: [...byKey.values()], removeIds: [] }, [...baru, ...diganti]);
  }, [patchRows]);

  const saveRow = useCallback(async (name: string, row: any): Promise<boolean> => {
    if (!row) return false;
    return saveRows(name, [row]);
  }, [saveRows]);

  const removeRow = useCallback(async (name: string, id: string): Promise<HasilHapus> => {
    if (!COLLECTION_KEYS.includes(name) || id === undefined || id === null) {
      return { ok: false, alasan: 'Record tidak dikenal, jadi tidak ada yang dihapus.' };
    }
    if (restorePending) return { ok: false, alasan: 'Pemulihan data masih berjalan; belum ada yang boleh dihapus.' };
    const key = String(id);

    // Penjaga hapus hanya untuk database: di mode browser seluruh isi store ada di
    // memori layar ini dan tidak ada tabel yang bisa ditinggalkan setengah jalan.
    if (useDb) {
      const refs = await dbReferences(name, key);
      if (refs && refs.blocked) return { ok: false, alasan: alasanRujukan(refs) };
    }

    const prev = dataRef.current[name] || [];
    const nextRows = prev.filter(r => rowKey(r) !== key);
    // Perintah DELETE tetap dikirim walau id tidak ada di memori: pada collection
    // yang baru dimuat sebagian, "tidak ada di memori" bukan berarti "tidak ada di
    // file". Menghapus id yang tidak dikenal hanya mengubah 0 baris.
    const tersimpan = await patchRows(name, { upsert: [], removeIds: [key] }, nextRows);
    return tersimpan
      ? { ok: true }
      : { ok: false, alasan: `Penghapusan "${name}" tidak tersimpan ke database. Jangan tutup aplikasi; ulangi dari menunya.` };
  }, [patchRows, useDb]);

  const scheduleAutoSave = useCallback(() => {
    if (!isLoaded) return;

    dataRef.current = {
      units, brands, models, customers, suppliers, spareParts, invoices, sales, rentals, services,
      kas, deliveries, warehouse, purchases, documents, bankAccounts, breakdowns,
      operators, technicians, approvals,
    };

    // Hasil hidrasi yang baru mendarat di state bukan perubahan pengguna:
    // referensinya disamakan lebih dulu supaya autosave tidak mengirim ulang
    // seluruh collection yang baru saja dibaca, dan BARU setelah itu collection
    // itu boleh dianggap mewakili isi file.
    for (const [name, rows] of Object.entries(hydratedRef.current)) {
      if (dataRef.current[name] !== rows) continue;
      delete hydratedRef.current[name];
      lastSavedRef.current[name] = rows;
      loadedRef.current[name] = true;
    }

    // Debounce 800ms — cegah save saat user mengetik
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persist();
    }, 800);
  }, [
    isLoaded, persist,
    units, brands, models, customers, suppliers, spareParts, invoices, sales, rentals, services,
    kas, deliveries, warehouse, purchases, documents, bankAccounts, breakdowns,
    operators, technicians, approvals,
  ]);

  // Trigger save setiap kali data berubah
  useEffect(() => {
    scheduleAutoSave();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [scheduleAutoSave]);

  // Tulis tertunda tidak boleh hilang saat jendela ditutup.
  useEffect(() => {
    const flush = (e: BeforeUnloadEvent) => {
      if (restorePending) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        // localStorage bersifat sinkron, jadi tulis sekarang. Untuk SQLite pesan
        // IPC hanya dilepas — reload jendela tidak melewati handshake, sedangkan
        // penutupan jendela dijamin main process yang menahan close sampai
        // db-flush-done tiba.
        void persist();
      }
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [persist, hasUnsavedChanges]);

  // ── Handshake flush dengan main process ──────────────────────
  useEffect(() => {
    if (!useDb) return;
    dbOnFlushRequest(async () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await persist();
    });
  }, [useDb, persist]);

  // ── Actions ───────────────────────────────────────────────────
  const today = () => new Date().toISOString().split('T')[0];

  const updateUnitStatus = useCallback((unitId: string, status: UnitStatus) => {
    setUnits(prev => prev.map(u => u.id === unitId ? { ...u, status } : u));
  }, []);

  const consumeSparePart = useCallback((partId: string, quantity: number) => {
    setSpareParts(prev => prev.map(p =>
      p.id === partId ? { ...p, stock: Math.max(0, p.stock - quantity) } : p
    ));
  }, []);

  const restockSparePart = useCallback((partId: string, quantity: number) => {
    setSpareParts(prev => prev.map(p => (p.id === partId ? { ...p, stock: p.stock + quantity } : p)));
  }, []);

  // Satu invoice per sumber: aksi berulang dari halaman mana pun tidak boleh
  // menghasilkan tagihan ganda.
  const pushInvoice = useCallback((inv: any) => {
    setInvoices(prev => {
      const needle = String(inv.sourceNumber || '').trim().toLowerCase();
      const exists = prev.some(i =>
        (i.sourceType === inv.sourceType && String(i.sourceNumber || '').trim().toLowerCase() === needle) ||
        (needle !== '' && String(i.invoiceNo || '').toLowerCase() === String(inv.invoiceNo || '').toLowerCase())
      );
      return exists ? prev : [...prev, inv];
    });
  }, []);

  const createInvoiceFromSale = useCallback((sale: any) => pushInvoice(invoiceFromSale(sale)), [pushInvoice]);
  const createInvoiceFromRental = useCallback((rental: any) => pushInvoice(invoiceFromRental(rental)), [pushInvoice]);

  const addKasEntry = useCallback((entry: Omit<TransaksiKas, 'id'> & { id?: string }) => {
    setKas(prev => (validateKasKembar(entry, prev) ? prev : [{ id: entry.id ?? `${Date.now()}-kas`, ...entry }, ...prev]));
  }, []);

  const addWarehouseMovement = useCallback((movement: {
    type: 'INBOUND' | 'OUTBOUND';
    referenceDoc: string;
    itemDescription: string;
    qty: number;
    unit: string;
    warehouseName?: string;
    pic?: string;
    notes?: string;
  }) => {
    setWarehouse(prev => {
      if (prev.some(w => w.referenceDoc === movement.referenceDoc && w.type === movement.type && w.itemDescription === movement.itemDescription)) {
        return prev;
      }
      return [{
        id: `WH-${Date.now()}`,
        trxNo: `${movement.type === 'INBOUND' ? 'GR' : 'GI'}-${movement.referenceDoc}`,
        type: movement.type,
        warehouseName: movement.warehouseName || 'Yard Cikande Main Hub',
        itemDescription: movement.itemDescription,
        qty: movement.qty,
        unit: movement.unit,
        referenceDoc: movement.referenceDoc,
        date: today(),
        pic: movement.pic || '',
        notes: movement.notes || '',
      }, ...prev];
    });
  }, []);

  const ensureSupplier = useCallback((name: string) => {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return;
    setSuppliers(prev => prev.some(s => String(s.name).trim().toLowerCase() === wanted)
      ? prev
      : [{ id: `SUP-${Date.now()}`, name: String(name).trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...prev]);
  }, []);

  // Penjualan: satu aksi menutup semua handoff — status unit, invoice, DP ke kas,
  // dan dokumen pengiriman yang menunggu.
  const addSale = useCallback((sale: any) => {
    setSales(prev => (Array.isArray(prev) && prev.some(s => s.id === sale.id) ? prev : [sale, ...prev]));

    const serial = String(sale.serialNumber || '').trim().toLowerCase();
    if (serial) {
      setUnits(prev => prev.map(u => String(u.serialNumber || '').trim().toLowerCase() === serial ? { ...u, status: 'SOLD' } : u));
    }
    pushInvoice(invoiceFromSale(sale));

    if (Number(sale.downPayment) > 0) {
      addKasEntry({
        tanggal: sale.orderDate || today(),
        keterangan: `Penerimaan DP Penjualan ${sale.orderNo ?? ''} - ${sale.customerName || '-'}`.trim(),
        kategori: 'PENJUALAN',
        tipe: 'MASUK',
        jumlah: Number(sale.downPayment),
        rekening: 'Kas Tunai',
        referensi: String(sale.orderNo ?? sale.id),
      });
    }

    setDeliveries(prev => {
      const ref = String(sale.orderNo ?? sale.id);
      if (prev.some(d => String(d.salesOrderRef) === ref)) return prev;
      return [{
        id: `DO-${Date.now()}`,
        doNumber: `DO-${ref}`,
        salesOrderRef: ref,
        customerName: sale.customerName || '-',
        unitModel: sale.unitModel || '-',
        serialNumber: sale.serialNumber || '-',
        deliveryDate: '',
        destination: '',
        driverName: '',
        truckPlate: '',
        status: 'MENUNGGU',
        notes: 'Dibuat otomatis dari SPK; lengkapi jadwal dan tujuan pengiriman',
      }, ...prev];
    });
  }, [pushInvoice, addKasEntry]);

  const addRental = useCallback((rental: any) => {
    setRentals(prev => (Array.isArray(prev) && prev.some(r => r.id === rental.id) ? prev : [rental, ...prev]));

    const serial = String(rental.serialNumber || '').trim().toLowerCase();
    if (rental.status === 'ACTIVE') {
      if (serial) setUnits(prev => prev.map(u => String(u.serialNumber || '').trim().toLowerCase() === serial ? { ...u, status: 'RENTED' } : u));
      pushInvoice(invoiceFromRental(rental));
    }
  }, [pushInvoice]);

  const addDelivery = useCallback((delivery: any) => {
    setDeliveries(prev => prev.some(d => String(d.id) === String(delivery.id)) ? prev : [delivery, ...prev]);
  }, []);

  // Servis selesai: suku cadang terpakai benar-benar keluar dari gudang, unit
  // kembali beroperasi, dan biayanya menjadi tagihan SERVICE.
  const completeService = useCallback((
    serviceId: string,
    sparePartsUsed?: { partId: string; quantity: number }[],
    actualCost?: number,
  ) => {
    const wo = services.find(s => s.id === serviceId);
    // WO yang sudah COMPLETED tidak diproses ulang. Invoice, mutasi gudang, dan
    // kas sudah menolak duplikatnya sendiri, tetapi stok suku cadang TIDAK:
    // pemanggilan kedua tetap mengurangi stok sekali lagi. Satu Work Order
    // hanya boleh menutup sekali; membuka kembali WO adalah tindakan sadar
    // yang mengubah statusnya lebih dulu.
    if (!wo || wo.status === 'COMPLETED') return;

    const biaya = Number(actualCost);
    const biayaSah = actualCost !== undefined && actualCost !== null && Number.isFinite(biaya) && biaya >= 0;

    setServices(prev => prev.map(s => (s.id === serviceId
      ? {
        ...s,
        status: 'COMPLETED',
        completedDate: today(),
        // Biaya aktual yang diketik di modal harus mendarat di baris Work Order,
        // bukan hanya di invoice: kartu Unit membaca kolom ini untuk memilih
        // "aktual" alih-alih "estimasi", dan tanpa ini kolom itu selamanya
        // menampilkan estimasi walau teknisinya sudah mengisi angka sebenarnya.
        ...(biayaSah ? { actualCost: biaya } : {}),
      }
      : s)));

    (sparePartsUsed || []).forEach(({ partId, quantity }) => {
      const part = spareParts.find(p => p.id === partId);
      consumeSparePart(partId, quantity);
      if (part) {
        addWarehouseMovement({
          type: 'OUTBOUND',
          referenceDoc: String(wo?.woNumber ?? serviceId),
          itemDescription: `${quantity} ${part.name} (${part.sku ?? part.id})`,
          qty: quantity,
          unit: part.unit || 'pcs',
          notes: 'Pemakaian suku cadang Work Order',
        });
      }
    });

    const serial = String(wo?.serialNumber || '').trim().toLowerCase();
    // HM yang tercatat di Work Order adalah pembacaan meter paling baru yang
    // sah, dan servis berkala dihitung dari sana. Dulu completeService hanya
    // memulihkan status unit: `units.hourMeter` tidak pernah naik, `lastServiceHM`
    // tidak pernah ditulis (halaman Dasbor menjatuhkannya ke angka karangan
    // `hm - 500`), jadi siklus servis tidak pernah benar-benar berputar.
    // Meter yang MUNDUR terhadap unit tidak pernah diambil: ia dibiarkan apa
    // adanya, karena menurunkan HM akan menyeret turun seluruh hitungan servis
    // dan biaya per jam tanpa jejak koreksi.
    const hmServis = Number(wo?.hourMeter);
    const hmSah = Number.isFinite(hmServis) && hmServis >= 0;
    if (serial) {
      setUnits(prev => prev.map(u => {
        if (String(u.serialNumber || '').trim().toLowerCase() !== serial) return u;
        const hmUnit = Number(u.hourMeter);
        const maju = hmSah && hmServis >= (Number.isFinite(hmUnit) ? hmUnit : 0);
        return {
          ...u,
          status: 'AVAILABLE',
          hourMeter: maju ? hmServis : u.hourMeter,
          lastServiceHM: maju ? hmServis : u.lastServiceHM,
        };
      }));
    }

    if (wo) pushInvoice(invoiceFromService(wo, actualCost));
  }, [services, spareParts, consumeSparePart, addWarehouseMovement, pushInvoice]);

  // Penerimaan PO: dulu hanya mengubah status, sekarang mutasi gudang tercatat,
  // pemasok terhubung, stok bertambah, dan uang keluar masuk kas.
  const receivePurchase = useCallback((purchaseId: string, receivedBy?: string) => {
    const po = purchases.find(p => p.id === purchaseId);
    if (!po || po.status === 'RECEIVED') return;

    setPurchases(prev => prev.map(p => (p.id === purchaseId ? { ...p, status: 'RECEIVED', receivedDate: today() } : p)));

    const refDoc = String(po.poNumber ?? po.id);
    const qty = Number(String(po.itemName || '').match(/^\s*(\d+)/)?.[1] ?? 1) || 1;
    const unitLabel = po.category === 'UNIT' ? 'Unit' : 'Pcs';

    addWarehouseMovement({
      type: 'INBOUND',
      referenceDoc: refDoc,
      itemDescription: po.itemName,
      qty,
      unit: unitLabel,
      pic: receivedBy || '',
      notes: `Penerimaan otomatis dari PO ${refDoc}`,
    });

    ensureSupplier(po.supplierName);

    if (po.category !== 'UNIT') {
      const needle = String(po.itemName || '').trim().toLowerCase();
      const match = spareParts.find(p => {
        const name = String(p.name || '').trim().toLowerCase();
        const sku = String(p.sku || '').trim().toLowerCase();
        return name === needle || needle.includes(sku) || (sku !== '' && needle.includes(name)) || name.includes(needle);
      });
      if (match) restockSparePart(match.id, qty);
    }

    if (Number(po.totalAmount) > 0) {
      addKasEntry({
        tanggal: po.receivedDate || today(),
        keterangan: `Pembayaran PO ${refDoc} ke ${po.supplierName || '-'}`,
        kategori: 'PEMBELIAN',
        tipe: 'KELUAR',
        jumlah: Number(po.totalAmount),
        rekening: 'Kas Tunai',
        referensi: refDoc,
      });
    }
  }, [purchases, spareParts, addWarehouseMovement, ensureSupplier, restockSparePart, addKasEntry]);

  // Data contoh hanya masuk atas permintaan eksplisit, dan tidak pernah menimpa
  // record yang sudah ada id-nya.
  const loadSampleData = useCallback((): number => {
    const samples = buildSampleStore() as Record<string, any[]>;
    const current = dataRef.current as Record<string, any[]>;
    let added = 0;

    for (const [name, setter] of Object.entries(collectionSetters)) {
      const rows = samples[name];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const ids = new Set((current[name] || []).map(r => String(r?.id)));
      const fresh = rows.filter(r => !ids.has(String(r?.id)));
      if (fresh.length === 0) continue;
      added += fresh.length;
      setter(prev => [...prev, ...fresh]);
    }
    return added;
  }, [collectionSetters]);

  // Nilai context dibungkus useMemo: tanpa ini, setiap render provider membuat
  // objek baru sehingga SELURUH halaman yang memakai useDataStore ikut render ulang.
  const contextValue = useMemo<DataContextType>(() => ({
    // State
    units, brands, models, customers, suppliers, spareParts, invoices, sales, rentals, services, kas,
    deliveries, warehouse, purchases, documents, bankAccounts, breakdowns,
    operators, technicians, approvals, storageWarning, loadError, hasUnsavedChanges,
    migrationReport, savedTick,

    // Actions
    updateUnitStatus, createInvoiceFromSale, createInvoiceFromRental,
    consumeSparePart, restockSparePart, addKasEntry, addWarehouseMovement,
    ensureSupplier, addSale, addRental, addDelivery, completeService,
    receivePurchase, loadSampleData, saveRow, saveRows, removeRow, ensureLoaded,

    // Setters
    setUnits, setBrands, setModels, setCustomers, setSuppliers, setSpareParts, setInvoices, setSales,
    setRentals, setServices, setKas, setDeliveries, setWarehouse, setPurchases,
    setDocuments, setBankAccounts, setBreakdowns, setOperators, setTechnicians,
    setApprovals,
  }), [
    units, brands, models, customers, suppliers, spareParts, invoices, sales, rentals, services, kas,
    deliveries, warehouse, purchases, documents, bankAccounts, breakdowns,
    operators, technicians, approvals, storageWarning, loadError, hasUnsavedChanges,
    migrationReport, savedTick,
    updateUnitStatus, createInvoiceFromSale, createInvoiceFromRental,
    consumeSparePart, restockSparePart, addKasEntry, addWarehouseMovement,
    ensureSupplier, addSale, addRental, addDelivery, completeService,
    receivePurchase, loadSampleData, saveRow, saveRows, removeRow, ensureLoaded,
  ]);

  // Login tidak memanggil useDataStore sehingga aman dirender sebelum boot selesai.
  // ProtectedRoute + RouteGate memastikan rute yang butuh data sudah terhidrasi.
  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
};

export const useDataStore = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useDataStore harus digunakan di dalam DataProvider');
  }
  return context;
};
