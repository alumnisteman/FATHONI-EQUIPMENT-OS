// src/types/index.ts
// ============================================================
// FATHONI EQUIPMENT OS — Type Definitions Lengkap
// ============================================================

// ----- ENUM -----
export type UserRole = 'SUPERADMIN' | 'SALES' | 'WAREHOUSE' | 'SERVICE' | 'FINANCE';

// 10 Status Siklus Hidup Unit Alat Berat
export type UnitStatus =
  | 'AVAILABLE'      // Tersedia / Ready Stock
  | 'RESERVED'       // Dipesan / Booking
  | 'SOLD'           // Terjual
  | 'RENTED'         // Disewa / On Rental
  | 'ON_PROJECT'     // Di Jobsite / On Project
  | 'IN_TRANSIT'     // Dalam Perjalanan
  | 'MAINTENANCE'    // Sedang Diservis
  | 'BREAKDOWN'      // Rusak / Breakdown
  | 'INACTIVE'       // Tidak Aktif / Standby
  | 'DISPOSED';      // Afkir / Scrapped

export type OrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';

// ----- AUTH -----
export interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  active: boolean;
  // Password masih bawaan instalasi: aplikasi memaksa ganti password sekali.
  mustChangePassword: boolean;
  lastLoginAt?: string | null;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// ----- CUSTOMER & SUPPLIER -----
export interface Customer {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  npwp?: string;
  pic?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  npwp?: string;
  bankName?: string;
  bankAccount?: string;
  createdAt: string;
  updatedAt: string;
}

// ----- PERALATAN BERAT -----
export interface Brand {
  id: string;
  name: string;
  logo?: string;
  categories?: Category[];
}

export interface Category {
  id: string;
  name: string;
  brandId: string;
  brand?: Brand;
  models?: EquipmentModel[];
}

export interface EquipmentModel {
  id: string;
  name: string;
  categoryId: string;
  category?: Category;
  units?: Unit[];
}

export interface Unit {
  id: string;
  serialNumber: string;
  modelId: string;
  model?: EquipmentModel;
  status: UnitStatus;
  purchasePrice?: number;
  purchaseDate?: string;
  notes?: string;
  serviceRecords?: ServiceRecord[];
}

// ----- SERVICE -----
export interface ServiceRecord {
  id: string;
  unitId: string;
  unit?: Unit;
  date: string;
  type: 'PREVENTIVE' | 'CORRECTIVE' | 'OVERHAUL';
  description: string;
  cost: number;
  technician?: string;
  spareParts?: ServiceSparePart[];
  createdAt: string;
}

export interface ServiceSparePart {
  id: string;
  serviceRecordId: string;
  sparePartId: string;
  sparePart?: SparePart;
  quantity: number;
  unitPrice: number;
}

// ----- SPARE PARTS -----
export interface SparePart {
  id: string;
  name: string;
  sku: string;
  stock: number;
  minStock: number;
  price: number;
  unit: string;
  supplierId?: string;
  supplier?: Supplier;
  compatibleModels?: string[];
  location?: string;
}

// ----- PENJUALAN -----
export interface SalesOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customer?: Customer;
  date: string;
  status: OrderStatus;
  total: number;
  discount?: number;
  tax?: number;
  grandTotal: number;
  notes?: string;
  items: SalesOrderItem[];
}

export interface SalesOrderItem {
  id: string;
  salesOrderId: string;
  productType: 'UNIT' | 'SPARE_PART' | 'SERVICE';
  unitId?: string;
  unit?: Unit;
  sparePartId?: string;
  sparePart?: SparePart;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

// ----- PEMBELIAN -----
export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplier?: Supplier;
  date: string;
  status: OrderStatus;
  total: number;
  tax?: number;
  grandTotal: number;
  notes?: string;
  items: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productType: 'UNIT' | 'SPARE_PART';
  unitId?: string;
  sparePartId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

// ----- INVOICE -----
export interface Invoice {
  id: string;
  invoiceNumber: string;
  salesOrderId: string;
  salesOrder?: SalesOrder;
  date: string;
  dueDate: string;
  amount: number;
  paid: boolean;
  paymentStatus: PaymentStatus;
  paidAmount?: number;
  paidAt?: string;
  notes?: string;
}

// ----- RENTAL -----
export interface Rental {
  id: string;
  rentalNumber: string;
  unitId: string;
  unit?: Unit;
  customerId: string;
  customer?: Customer;
  startDate: string;
  endDate?: string;
  dailyRate: number;
  totalCost?: number;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  notes?: string;
  operatorName?: string;
}

// ----- PENGIRIMAN -----
export interface Delivery {
  id: string;
  deliveryNumber: string;
  orderId: string;
  orderType: 'SALES' | 'RENTAL';
  address: string;
  customerName: string;
  unitModel: string;
  serialNumber: string;
  deliveryDate: string;
  destination: string;
  driverName: string;
  truckPlate: string;
  status: 'MENUNGGU' | 'DALAM_PERJALANAN' | 'SELESAI';
  notes?: string;
  salesOrderRef?: string;
}

// ----- DOKUMEN -----
export interface Document {
  id: string;
  jenisDokumen: string;
  nomorDokumen: string;
  masaBerlaku: string;
  statusLegalitas: 'AKTIF' | 'EXPIRED' | 'REVOKED' | 'PENDING';
  fileUrl?: string;
  fileName?: string;
  keterangan?: string;
}

// ----- REKENING BANK -----
export interface BankAccount {
  id: string;
  namaBank: string;
  nomorRekening: string;
  namaPemilik: string;
  cabang: string;
  mataUang: string;
  isActive: boolean;
  keterangan?: string;
}

// ----- KAS & BANK -----
export interface CashBank {
  id: string;
  tanggal: string;
  keterangan: string;
  kategori: 'PENJUALAN' | 'RENTAL' | 'SERVICE' | 'PEMBELIAN' | 'OPERASIONAL' | 'GAJI' | 'LAINNYA';
  tipe: 'MASUK' | 'KELUAR';
  jumlah: number;
  rekening: string;
  referensi: string;
}

// ----- DASHBOARD STATS -----
// (definisi lengkap ada di bawah, baris ~477)

// ----- DATA STORE HELPERS -----
export interface ServiceType {
  id: string;
  woNumber: string;
  unitModel: string;
  serialNumber: string;
  hourMeter: number;
  customerOrProject: string;
  serviceType: 'PERIODIC_250H' | 'PERIODIC_500H' | 'PERIODIC_1000H' | 'CORRECTIVE' | 'OVERHAUL' | 'INSPECTION' | 'BREAKDOWN' | 'PREVENTIVE';
  complaintNotes?: string;
  mechanicName: string;
  estimatedCost: number;
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'COMPLETED' | 'CANCELLED';
  openDate: string;
  completeDate?: string;
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
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  notes?: string;
}

export interface InvoiceItem {
  id: string;
  invoiceNo: string;
  customerName: string;
  unitOrDesc: string;
  type: 'PENJUALAN' | 'RENTAL' | 'SERVICE' | 'SPAREPART';
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
}

// ----- KEUANGAN -----
export interface JournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  account: string;
  refType?: string;
  refId?: string;
}

export interface CashBankAccount {
  id: string;
  name: string;
  type: 'CASH' | 'BANK';
  balance: number;
  bankName?: string;
  accountNumber?: string;
}

// ----- BREAKDOWN MANAGEMENT -----
export type BreakdownSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR';
export type BreakdownStatus = 'REPORTED' | 'INSPECTING' | 'DIAGNOSING' | 'REPAIRING' | 'TESTING' | 'RESOLVED' | 'CANCELLED';

export interface Breakdown {
  id: string;
  breakdownNumber: string;
  unitSerialNumber: string;
  unitModel: string;
  location: string;
  reportedBy: string;
  reportedAt: string;
  severity: BreakdownSeverity;
  status: BreakdownStatus;
  description: string;
  diagnosis?: string;
  assignedTechnician?: string;
  estimatedRepairCost?: number;
  actualRepairCost?: number;
  startTime?: string;
  endTime?: string;
  downtimeHours?: number;
  partsUsed?: Array<{ partName: string; quantity: number; cost: number }>;
  resolutionNotes?: string;
  photos?: string[];
}

// ----- OPERATOR MANAGEMENT -----
export type OperatorStatus = 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'SUSPENDED';

export interface Operator {
  id: string;
  operatorNumber: string;
  name: string;
  phone: string;
  email?: string;
  nik?: string;
  status: OperatorStatus;
  certifications: Array<{ name: string; issueDate: string; expiryDate: string }>;
  assignedUnit?: string;
  assignedProject?: string;
  totalHours: number;
  startDate: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  notes?: string;
}

// ----- TECHNICIAN MANAGEMENT -----
export type TechnicianStatus = 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'SUSPENDED';

export interface Technician {
  id: string;
  technicianNumber: string;
  name: string;
  phone: string;
  email?: string;
  nik?: string;
  status: TechnicianStatus;
  specializations: string[];
  certifications: Array<{ name: string; issueDate: string; expiryDate: string }>;
  totalWorkOrders: number;
  totalHours: number;
  startDate: string;
  skills: string[];
  notes?: string;
}

// ----- APPROVAL WORKFLOW -----
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ApprovalType = 'PURCHASE_REQUEST' | 'MAINTENANCE_REQUEST' | 'RENTAL_CONTRACT' | 'DISCOUNT' | 'PAYMENT' | 'EXPENSE';

export interface ApprovalRequest {
  id: string;
  requestNumber: string;
  type: ApprovalType;
  title: string;
  description: string;
  requestedBy: string;
  requestedAt: string;
  amount?: number;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  entityType?: string;
  entityId?: string;
  approverLevel: number;
  currentApprover?: string;
  notes?: string;
}

// ----- DASHBOARD -----
export interface DashboardStats {
  totalUnits: number;
  operatingUnits: number;
  maintenanceUnits: number;
  pendingSales: number;
  pendingService: number;
  totalRevenue: number;
  totalAR: number;
  totalAP: number;
  activeRentals: number;
  lowStockParts: number;
}

// ----- PAGINATION -----
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface QueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}
