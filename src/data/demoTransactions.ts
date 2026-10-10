// src/data/demoTransactions.ts
// Data contoh modul transaksi. Sengaja berada di luar file halaman agar
// store tidak mengimpor halaman (yang memecahkan code-splitting dan Fast Refresh).

import type { OrderStatus } from '../types';

export interface SalesOrder {
  id: string;
  orderNo: string;
  customerName: string;
  unitModel: string;
  serialNumber: string;
  orderDate: string;
  totalPrice: number;
  downPayment: number;
  paymentScheme: 'CASH' | 'LEASING' | 'INSTALLMENT';
  status: OrderStatus;
  salesPerson: string;
}

export interface RentalContract {
  id: string;
  contractNo: string;
  customerName: string;
  unitModel: string;
  serialNumber: string;
  startDate: string;
  endDate: string;
  location: string;
  monthlyRate: number;
  minimumHours: number;
  operatorIncluded: boolean;
  status: 'ACTIVE' | 'PENDING' | 'COMPLETED' | 'EXTENDED';
}

export interface WorkOrder {
  id: string;
  woNumber: string;
  unitModel: string;
  serialNumber: string;
  customerOrProject: string;
  serviceType: 'PERIODIC_250H' | 'PERIODIC_500H' | 'PERIODIC_1000H' | 'BREAKDOWN' | 'OVERHAUL' | 'INSPECTION';
  mechanicName: string;
  hourMeter: number;
  openDate: string;
  estimatedCost: number;
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'COMPLETED';
  complaintNotes: string;
}

export type TipeTransaksi = 'MASUK' | 'KELUAR';

export type KategoriKas = 'PENJUALAN' | 'RENTAL' | 'SERVICE' | 'PEMBELIAN' | 'OPERASIONAL' | 'GAJI' | 'LAINNYA';

export interface TransaksiKas {
  id: string;
  tanggal: string;
  keterangan: string;
  kategori: KategoriKas;
  tipe: TipeTransaksi;
  jumlah: number;
  rekening: string;
  referensi: string;
}

export const DEMO_SALES: SalesOrder[] = [
  {
    id: '1',
    orderNo: 'SO-2026-001',
    customerName: 'CV Maju Jaya Konstruksi',
    unitModel: 'SANY SY215C Excavator',
    serialNumber: 'SY-SY215C-003',
    orderDate: '2026-01-15',
    totalPrice: 1_750_000_000,
    downPayment: 500_000_000,
    paymentScheme: 'LEASING',
    status: 'IN_PROGRESS',
    salesPerson: 'Budi Santoso',
  },
  {
    id: '2',
    orderNo: 'SO-2026-002',
    customerName: 'PT Borneo Mineral Resources',
    unitModel: 'Komatsu PC200-8 Excavator',
    serialNumber: 'KMT-PC200-001',
    orderDate: '2026-01-28',
    totalPrice: 1_850_000_000,
    downPayment: 1_850_000_000,
    paymentScheme: 'CASH',
    status: 'COMPLETED',
    salesPerson: 'Sari Wulandari',
  },
  {
    id: '3',
    orderNo: 'SO-2026-003',
    customerName: 'PT Nusantara Jaya Quarry',
    unitModel: 'Caterpillar 320 GC Excavator',
    serialNumber: 'CAT-320GC-002',
    orderDate: '2026-02-05',
    totalPrice: 2_100_000_000,
    downPayment: 400_000_000,
    paymentScheme: 'INSTALLMENT',
    status: 'CONFIRMED',
    salesPerson: 'Budi Santoso',
  },
];

export const DEMO_RENTALS: RentalContract[] = [
  {
    id: '1',
    contractNo: 'RNT-2026-001',
    customerName: 'PT Tambang Nusa Persada',
    unitModel: 'Komatsu PC200-8 Excavator',
    serialNumber: 'KMT-PC200-001',
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    location: 'Jobsite Morowali, Sulawesi Tengah',
    monthlyRate: 95_000_000,
    minimumHours: 200,
    operatorIncluded: true,
    status: 'ACTIVE',
  },
  {
    id: '2',
    contractNo: 'RNT-2026-002',
    customerName: 'PT Borneo Mineral Resources',
    unitModel: 'Komatsu D85ESS-2 Bulldozer',
    serialNumber: 'KMT-D85-004',
    startDate: '2026-02-01',
    endDate: '2026-05-31',
    location: 'Jobsite Kutai Kartanegara, Kaltim',
    monthlyRate: 145_000_000,
    minimumHours: 200,
    operatorIncluded: false,
    status: 'ACTIVE',
  },
  {
    id: '3',
    contractNo: 'RNT-2026-003',
    customerName: 'CV Maju Jaya Konstruksi',
    unitModel: 'Caterpillar 320 GC Excavator',
    serialNumber: 'CAT-320GC-002',
    startDate: '2025-10-01',
    endDate: '2026-01-31',
    location: 'Proyek Tol Cileunyi, Jawa Barat',
    monthlyRate: 85_000_000,
    minimumHours: 150,
    operatorIncluded: true,
    status: 'COMPLETED',
  },
];

export const DEMO_SERVICES: WorkOrder[] = [
  {
    id: '1',
    woNumber: 'WO-2026-001',
    unitModel: 'Komatsu PC200-8',
    serialNumber: 'KMT-PC200-001',
    customerOrProject: 'PT Tambang Nusa Persada (Morowali)',
    serviceType: 'PERIODIC_500H',
    mechanicName: 'Agus Sutrisno & Tim',
    hourMeter: 4850,
    openDate: '2026-02-14',
    estimatedCost: 8_500_000,
    status: 'IN_PROGRESS',
    complaintNotes: 'Ganti oli engine, filter oli, filter solar, dan greasing arm boom',
  },
  {
    id: '2',
    woNumber: 'WO-2026-002',
    unitModel: 'Caterpillar 320 GC',
    serialNumber: 'CAT-320GC-002',
    customerOrProject: 'CV Maju Jaya Konstruksi',
    serviceType: 'BREAKDOWN',
    mechanicName: 'Hendra Saputra',
    hourMeter: 1200,
    openDate: '2026-02-15',
    estimatedCost: 28_000_000,
    status: 'WAITING_PARTS',
    complaintNotes: 'Hydraulic main hose pecah & tekanan hidrolik drop saat swing',
  },
  {
    id: '3',
    woNumber: 'WO-2026-003',
    unitModel: 'SANY SY215C',
    serialNumber: 'SY-SY215C-003',
    customerOrProject: 'Yard Workshop Cikande',
    serviceType: 'INSPECTION',
    mechanicName: 'Dani Kurniawan',
    hourMeter: 150,
    openDate: '2026-02-10',
    estimatedCost: 2_500_000,
    status: 'COMPLETED',
    complaintNotes: 'PDI (Pre-Delivery Inspection) sebelum pengiriman ke customer',
  },
];

export const DEMO_KAS: TransaksiKas[] = [
  { id: '1', tanggal: '2026-02-15', keterangan: 'Penerimaan Pembayaran Rental PC200 (INV-2026-001)', kategori: 'RENTAL', tipe: 'MASUK', jumlah: 95_000_000, rekening: 'BCA - 1234567890', referensi: 'INV-2026-001' },
  { id: '2', tanggal: '2026-02-14', keterangan: 'Pembayaran Suku Cadang ke United Tractors', kategori: 'PEMBELIAN', tipe: 'KELUAR', jumlah: 185_000_000, rekening: 'Mandiri - 0987654321', referensi: 'PO-2026-002' },
  { id: '3', tanggal: '2026-02-13', keterangan: 'Terima DP Penjualan SANY SY215C (CV Maju Jaya)', kategori: 'PENJUALAN', tipe: 'MASUK', jumlah: 500_000_000, rekening: 'BCA - 1234567890', referensi: 'SO-2026-001' },
  { id: '4', tanggal: '2026-02-10', keterangan: 'Biaya Operasional Workshop & BBM Bulan Feb', kategori: 'OPERASIONAL', tipe: 'KELUAR', jumlah: 28_500_000, rekening: 'Kas Tunai', referensi: '-' },
  { id: '5', tanggal: '2026-02-05', keterangan: 'Pembayaran Gaji Karyawan Februari 2026', kategori: 'GAJI', tipe: 'KELUAR', jumlah: 145_000_000, rekening: 'BNI - 1122334455', referensi: 'GAJI-FEB-2026' },
  { id: '6', tanggal: '2026-02-01', keterangan: 'Penerimaan Rental Dozer Bulan Feb (PT Borneo)', kategori: 'RENTAL', tipe: 'MASUK', jumlah: 145_000_000, rekening: 'BCA - 1234567890', referensi: 'INV-2026-005' },
];
