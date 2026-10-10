// src/data/sampleData.ts
// Kumpulan data contoh (dulu MOCK_* di dalam dataStore). Tidak pernah dimuat otomatis:
// hanya dipakai oleh aksi eksplisit "Muat data contoh" dan oleh migrasi yang mengenali
// record contoh mana yang belum pernah disunting pengguna.

import type {
  Customer, SparePart, Breakdown, Operator, Technician, ApprovalRequest
} from '../types';
import { DEMO_SALES, DEMO_RENTALS, DEMO_SERVICES, DEMO_KAS } from './demoTransactions';

// ── Mock Data ─────────────────────────────────────────────────
const MOCK_CUSTOMERS: Customer[] = [
  { id: 'CUST-001', name: 'PT Konstruksi Maju',   phone: '081234567890', address: 'Jl. Jend. Sudirman No. 1, Jakarta',  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'CUST-002', name: 'CV Tambang Abadi',     phone: '081987654321', address: 'Jl. Merdeka No. 45, Balikpapan',    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

const MOCK_UNITS: any[] = [
  { id: 'U-SY215-01', serialNumber: 'SY215-2023001', brand: 'SANY',        model: 'SY215C',    status: 'AVAILABLE', notes: 'Ready for deployment',   hourMeter: 1250, location: 'Gudang Utama',      category: 'Excavator', purchasePrice: 1_750_000_000, currentValue: 1_750_000_000, purchaseDate: '2025-01-10', year: '2025' },
  { id: 'U-SY215-02', serialNumber: 'SY215-2023002', brand: 'SANY',        model: 'SY215C',    status: 'RENTED',    notes: 'Currently at site A',     hourMeter: 3200, location: 'Jobsite Morowali', category: 'Excavator', purchasePrice: 1_750_000_000, currentValue: 1_420_000_000, purchaseDate: '2024-06-15', year: '2024' },
  { id: 'U-SY75-01',  serialNumber: 'SY75-2023005',  brand: 'SANY',        model: 'SY75C',     status: 'AVAILABLE', notes: 'New arrival',             hourMeter: 450,  location: 'Gudang Utama',      category: 'Excavator', purchasePrice: 1_200_000_000, currentValue: 1_200_000_000, purchaseDate: '2025-02-01', year: '2025' },
  { id: 'U-KMT-001',  serialNumber: 'KMT-PC200-001', brand: 'Komatsu',     model: 'PC200-8',   status: 'AVAILABLE', notes: 'Ready stock',             hourMeter: 8900, location: 'Gudang Utama',      category: 'Excavator', purchasePrice: 1_850_000_000, currentValue: 1_420_000_000, purchaseDate: '2023-01-15', year: '2022' },
  { id: 'U-CAT-001',  serialNumber: 'CAT-320GC-002', brand: 'Caterpillar', model: '320 GC',    status: 'AVAILABLE', notes: 'New unit',                hourMeter: 1200, location: 'Gudang Utama',      category: 'Excavator', purchasePrice: 2_100_000_000, currentValue: 1_800_000_000, purchaseDate: '2024-02-20', year: '2024' },
];

const MOCK_DELIVERIES: any[] = [
  { id: '1', doNumber: 'DO-2026-001', salesOrderRef: 'SO-2026-002', customerName: 'PT Borneo Mineral Resources',  unitModel: 'Komatsu PC200-8 Excavator',      serialNumber: 'KMT-PC200-001',  deliveryDate: '2026-02-10', destination: 'Jobsite Kutai Kartanegara, Kalimantan Timur', driverName: 'Supomo',         truckPlate: 'B 9812 XY', status: 'SELESAI',          notes: 'Pengiriman menggunakan trailer lowbed 50 ton' },
  { id: '2', doNumber: 'DO-2026-002', salesOrderRef: 'SO-2026-003', customerName: 'PT Nusantara Jaya Quarry',    unitModel: 'Caterpillar 320 GC Excavator',    serialNumber: 'CAT-320GC-002',  deliveryDate: '2026-03-05', destination: 'Quarry Site Purwakarta, Jawa Barat',         driverName: 'Hendra Wijaya', truckPlate: 'D 1456 JK', status: 'DALAM_PERJALANAN', notes: 'Estimasi tiba 2 hari' },
  { id: '3', doNumber: 'DO-2026-003', salesOrderRef: 'RNT-2026-003', customerName: 'CV Maju Jaya Konstruksi',   unitModel: 'SANY SY215C Excavator',           serialNumber: 'SY-SY215C-003',  deliveryDate: '2026-03-10', destination: 'Proyek Tol Cileunyi, Jawa Barat',           driverName: '-',             truckPlate: '-',         status: 'MENUNGGU',         notes: 'Menunggu konfirmasi jadwal mobilisasi dari customer' },
];

const MOCK_BREAKDOWNS: Breakdown[] = [
  {
    id: 'BD-001', breakdownNumber: 'BD-2026-001', unitSerialNumber: 'KMT-PC200-001', unitModel: 'Komatsu PC200-8',
    location: 'Jobsite Morowali', reportedBy: 'Budi Santoso', reportedAt: '2026-03-15T08:30:00',
    severity: 'MAJOR', status: 'REPAIRING', description: 'Hydraulic pump tidak berfungsi, unit tidak bisa digerakkan',
    diagnosis: 'Hydraulic pump seal rusak', assignedTechnician: 'Agus Sutrisno',
    estimatedRepairCost: 15_000_000, startTime: '2026-03-15T09:00:00', partsUsed: [], resolutionNotes: '',
  },
  {
    id: 'BD-002', breakdownNumber: 'BD-2026-002', unitSerialNumber: 'CAT-320GC-002', unitModel: 'Caterpillar 320 GC',
    location: 'Jobsite Purwakarta', reportedBy: 'Ahmad Hidayat', reportedAt: '2026-03-18T14:20:00',
    severity: 'MINOR', status: 'RESOLVED', description: 'Track roller satu unit aus berat',
    diagnosis: 'Track roller perlu diganti', assignedTechnician: 'Dedi Kurniawan',
    estimatedRepairCost: 3_500_000, actualRepairCost: 3_200_000,
    startTime: '2026-03-18T15:00:00', endTime: '2026-03-19T17:00:00', downtimeHours: 26,
    partsUsed: [{ partName: 'Track Roller Single Flange', quantity: 1, cost: 1_750_000 }],
    resolutionNotes: 'Track roller diganti, unit siap operasi kembali',
  },
];

const MOCK_OPERATORS: Operator[] = [
  {
    id: 'OP-001', operatorNumber: 'OP-2026-001', name: 'Budi Santoso', phone: '081234567890',
    email: 'budi@example.com', nik: '3201010101010001', status: 'ACTIVE',
    certifications: [{ name: 'Excavator Operator License', issueDate: '2020-01-15', expiryDate: '2025-01-15' }],
    assignedUnit: 'KMT-PC200-001', assignedProject: 'Jobsite Morowali', totalHours: 4500,
    startDate: '2020-02-01', licenseNumber: 'LIC-OP-2020-001', licenseExpiry: '2025-01-15',
    notes: 'Operator berpengalaman',
  },
  {
    id: 'OP-002', operatorNumber: 'OP-2026-002', name: 'Ahmad Hidayat', phone: '081987654321',
    email: 'ahmad@example.com', nik: '3202020202020002', status: 'ACTIVE',
    certifications: [{ name: 'Excavator Operator License', issueDate: '2021-03-20', expiryDate: '2026-03-20' }],
    assignedUnit: 'CAT-320GC-002', assignedProject: 'Jobsite Purwakarta', totalHours: 3200,
    startDate: '2021-04-01', licenseNumber: 'LIC-OP-2021-002', licenseExpiry: '2026-03-20',
    notes: 'Operator handal',
  },
];

const MOCK_TECHNICIANS: Technician[] = [
  {
    id: 'TECH-001', technicianNumber: 'TECH-2026-001', name: 'Agus Sutrisno', phone: '082345678901',
    email: 'agus@example.com', nik: '3203030303030003', status: 'ACTIVE',
    specializations: ['Hydraulic', 'Engine'],
    certifications: [{ name: 'Heavy Equipment Technician', issueDate: '2018-06-10', expiryDate: '2028-06-10' }],
    totalWorkOrders: 150, totalHours: 2400, startDate: '2018-07-01',
    skills: ['Hydraulic Repair', 'Engine Overhaul', 'Electrical'], notes: 'Senior technician',
  },
  {
    id: 'TECH-002', technicianNumber: 'TECH-2026-002', name: 'Dedi Kurniawan', phone: '082345678902',
    email: 'dedi@example.com', nik: '3204040404040004', status: 'ACTIVE',
    specializations: ['Undercarriage', 'Transmission'],
    certifications: [{ name: 'Heavy Equipment Technician', issueDate: '2019-08-15', expiryDate: '2029-08-15' }],
    totalWorkOrders: 120, totalHours: 1900, startDate: '2019-09-01',
    skills: ['Undercarriage Repair', 'Transmission Service', 'Brake System'], notes: 'Specialist undercarriage',
  },
];

const MOCK_APPROVALS: ApprovalRequest[] = [
  {
    id: 'APR-001', requestNumber: 'APR-2026-001', type: 'PURCHASE_REQUEST',
    title: 'Purchase Hydraulic Pump', description: 'Request pembelian hydraulic pump untuk unit KMT-PC200-001',
    requestedBy: 'Agus Sutrisno', requestedAt: '2026-03-15T10:00:00', amount: 48_000_000,
    status: 'PENDING', approverLevel: 1, currentApprover: 'Manager Operations',
    notes: 'Unit breakdown dan butuh hydraulic pump segera',
  },
  {
    id: 'APR-002', requestNumber: 'APR-2026-002', type: 'MAINTENANCE_REQUEST',
    title: 'Major Overhaul Unit SY215-2023001', description: 'Request major overhaul untuk unit SY215-2023001 di 5000 HM',
    requestedBy: 'Budi Santoso', requestedAt: '2026-03-18T14:00:00', amount: 150_000_000,
    status: 'APPROVED', approvedBy: 'Manager Operations', approvedAt: '2026-03-19T09:00:00',
    approverLevel: 2, notes: 'Overhaul dijadwalkan bulan depan',
  },
];

const MOCK_SPARE_PARTS: SparePart[] = [
  { id: 'SP-001', name: 'Engine Oil Filter Cartridge',   sku: '6736-51-5142',  stock: 24, minStock: 10, price: 285_000,    unit: 'pcs' },
  { id: 'SP-002', name: 'Air Filter Primary',            sku: '6735-51-5141',  stock: 10, minStock: 15, price: 320_000,    unit: 'pcs' },
  { id: 'SP-003', name: 'Track Roller Single Flange',    sku: 'TR-200-8-1',    stock: 14, minStock: 12, price: 1_750_000,  unit: 'pcs' },
  { id: 'SP-004', name: 'Main Hydraulic Pump Assembly',  sku: 'SY-HYD-708-2L', stock:  1, minStock:  2, price: 48_000_000, unit: 'unit' },
  { id: 'SP-005', name: 'Alternator 24V 60A',            sku: '600-821-6120',  stock:  4, minStock:  3, price: 3_800_000,  unit: 'pcs' },
];

const SAMPLE_DOCUMENTS = [
  {
    id: '1', jenisDokumen: 'SIA (Surat Izin Alat)', nomorDokumen: 'SIA-2024-8891-JKT',
    masaBerlaku: '2026-01-15', statusLegalitas: 'AKTIF', keterangan: 'Untuk seluruh armada excavator',
  },
];

const SAMPLE_BANK_ACCOUNTS = [
  { id: '1', namaBank: 'BCA',     nomorRekening: '1234567890', namaPemilik: 'CV. MUGHNY NAMASKARABUMI KURNIA', cabang: 'Jakarta', mataUang: 'IDR', isActive: true, keterangan: 'Rekening utama untuk operasional' },
  { id: '2', namaBank: 'Mandiri', nomorRekening: '0987654321', namaPemilik: 'CV. MUGHNY NAMASKARABUMI KURNIA', cabang: 'Jakarta', mataUang: 'IDR', isActive: true, keterangan: 'Rekening cadangan' },
];

// Semua collection contoh dalam satu paket, dipakai halaman Pemeliharaan Sistem.
export function buildSampleStore() {
  return {
    units: MOCK_UNITS, customers: MOCK_CUSTOMERS, suppliers: [] as any[],
    spareParts: MOCK_SPARE_PARTS, invoices: [] as any[],
    sales: DEMO_SALES, rentals: DEMO_RENTALS, services: DEMO_SERVICES, kas: DEMO_KAS,
    deliveries: MOCK_DELIVERIES, warehouse: [] as any[], purchases: [] as any[],
    documents: SAMPLE_DOCUMENTS, bankAccounts: SAMPLE_BANK_ACCOUNTS,
    breakdowns: MOCK_BREAKDOWNS, operators: MOCK_OPERATORS,
    technicians: MOCK_TECHNICIANS, approvals: MOCK_APPROVALS,
  };
}

export const SAMPLE_COLLECTIONS: Record<string, any[]> = {
  units: MOCK_UNITS, customers: MOCK_CUSTOMERS, spareParts: MOCK_SPARE_PARTS,
  sales: DEMO_SALES, rentals: DEMO_RENTALS, services: DEMO_SERVICES, kas: DEMO_KAS,
  deliveries: MOCK_DELIVERIES, breakdowns: MOCK_BREAKDOWNS, operators: MOCK_OPERATORS,
  technicians: MOCK_TECHNICIANS, approvals: MOCK_APPROVALS,
  documents: SAMPLE_DOCUMENTS, bankAccounts: SAMPLE_BANK_ACCOUNTS,
};
