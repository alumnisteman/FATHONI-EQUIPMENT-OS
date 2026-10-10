// Utility validasi form komprehensif untuk FATHONI EQUIPMENT OS

export interface ValidationRule {
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: any) => string | null;
}

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

/**
 * Validasi field tunggal
 */
export function validateField(value: any, rules: ValidationRule, fieldName: string): string | null {
  const kosong = value === null || value === undefined || value === '';

  // Validasi required. '   ' dihitung kosong di sini: pengguna yang menghapus
  // kolom lalu menyimpan tidak boleh membawa satu spasi masuk sebagai nama unit
  // atau serial number. Aturan lain tetap memakai pengertian lama, supaya
  // '   ' pada kolom opsional masih dinilai panjangnya.
  if (rules.required && (kosong || String(value).trim() === '')) {
    return `${fieldName} wajib diisi`;
  }

  // Skip validasi lain jika value kosong dan tidak required
  if (!rules.required && kosong) {
    return null;
  }

  // Aturan angka hanya berarti bila nilainya memang angka. NaN masuk lewat
  // Number() pada input yang baru saja dibersihkan atau data warisan tanpa field,
  // dan NaN yang lolos akan disimpan sebagai null di SQLite — hilang tanpa pesan.
  if ((rules.min !== undefined || rules.max !== undefined) && typeof value === 'number' && !Number.isFinite(value)) {
    return `${fieldName} harus berupa angka`;
  }

  // Validasi min number
  if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
    return `${fieldName} tidak boleh kurang dari ${rules.min}`;
  }

  // Validasi max number
  if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
    return `${fieldName} tidak boleh lebih dari ${rules.max}`;
  }

  // Validasi min length string
  if (rules.minLength !== undefined && typeof value === 'string' && value.length < rules.minLength) {
    return `${fieldName} minimal ${rules.minLength} karakter`;
  }

  // Validasi max length string
  if (rules.maxLength !== undefined && typeof value === 'string' && value.length > rules.maxLength) {
    return `${fieldName} maksimal ${rules.maxLength} karakter`;
  }

  // Validasi pattern regex
  if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
    return `${fieldName} format tidak valid`;
  }

  // Validasi custom
  if (rules.custom) {
    const customError = rules.custom(value);
    if (customError) {
      return customError;
    }
  }

  return null;
}

/**
 * Validasi form lengkap
 */
export function validateForm(data: Record<string, any>, rules: Record<string, ValidationRule>): ValidationResult {
  const errors: Record<string, string> = {};
  let isValid = true;

  for (const [field, value] of Object.entries(data)) {
    const fieldRules = rules[field];
    if (fieldRules) {
      const error = validateField(value, fieldRules, field);
      if (error) {
        errors[field] = error;
        isValid = false;
      }
    }
  }

  return { isValid, errors };
}

/**
 * Validasi tanggal - pastikan end date >= start date
 */
export function validateDateRange(startDate: string, endDate: string, startDateLabel: string = 'Tanggal mulai', endDateLabel: string = 'Tanggal selesai'): string | null {
  if (!startDate || !endDate) return null;

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Tanggal yang tidak bisa dibaca tidak punya urutan terhadap tanggal lain, jadi
  // membiarkannya lolos berarti menyimpan surat jalan yang tidak pernah bisa
  // muncul di laporan per-bulan.
  if (Number.isNaN(start.getTime())) {
    return `${startDateLabel} formatnya tidak valid`;
  }
  if (Number.isNaN(end.getTime())) {
    return `${endDateLabel} formatnya tidak valid`;
  }

  if (end < start) {
    return `${endDateLabel} tidak boleh sebelum ${startDateLabel}`;
  }

  return null;
}

/**
 * Validasi duplikat serial number
 */
export function validateUniqueSerialNumber(serialNumber: string, existingUnits: any[], excludeId?: string): string | null {
  if (!serialNumber) return null;

  const normalized = serialNumber.trim().toUpperCase();
  // Sisi simpanan juga dirapikan: serial ' KOM200-9 ' di dalam file adalah
  // serial yang sama, dan tanpa trim ia lolos dari pemeriksaan duplikat.
  const duplicate = existingUnits.find(
    unit => unit.serialNumber?.trim().toUpperCase() === normalized && unit.id !== excludeId
  );

  if (duplicate) {
    return `Serial Number ${serialNumber} sudah terdaftar pada unit lain`;
  }

  return null;
}

/**
 * Angka yang benar-benar bisa dipakai. NaN / undefined / string kosong masuk lewat
 * Number() pada input yang baru dihapus isinya atau record warisan tanpa field;
 * kalau diloloskan, nilainya tersimpan sebagai null di SQLite dan hilang tanpa
 * pesan apa pun.
 */
function angka(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validasi hour meter
 */
export function validateHourMeter(hm: number): string | null {
  if (angka(hm) === null) {
    return 'Hour Meter harus berupa angka';
  }
  if (hm < 0) {
    return 'Hour Meter tidak boleh negatif';
  }
  if (hm > 100000) {
    return 'Hour Meter tidak realistis (maksimal 100.000 HM)';
  }
  return null;
}

/**
 * Validasi tahun
 */
export function validateYear(year: string): string | null {
  const yearNum = parseInt(year);
  const currentYear = new Date().getFullYear();

  if (isNaN(yearNum)) {
    return 'Tahun harus berupa angka';
  }
  if (yearNum < 1990) {
    return 'Tahun minimal 1990';
  }
  if (yearNum > currentYear + 1) {
    return `Tahun tidak boleh lebih dari ${currentYear + 1}`;
  }

  return null;
}

/**
 * Validasi harga/uang
 */
export function validateAmount(amount: number, minAmount: number = 0, maxAmount: number = 10000000000): string | null {
  if (angka(amount) === null) {
    return 'Nilai harus berupa angka';
  }
  if (amount < minAmount) {
    return `Nilai minimal Rp ${minAmount.toLocaleString('id-ID')}`;
  }
  if (amount > maxAmount) {
    return `Nilai maksimal Rp ${maxAmount.toLocaleString('id-ID')}`;
  }
  return null;
}

/**
 * Validasi email
 */
export function validateEmail(email: string): string | null {
  if (!email) return null;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Format email tidak valid';
  }

  return null;
}

/**
 * Validasi nomor telepon (Indonesia)
 */
export function validatePhone(phone: string): string | null {
  if (!phone) return null;

  // Hanya angka, +, -, space, (, )
  const phoneRegex = /^[\d\+\-\(\)\s]+$/;
  if (!phoneRegex.test(phone)) {
    return 'Format nomor telepon tidak valid';
  }

  // Minimal 10 digit
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length < 10) {
    return 'Nomor telepon minimal 10 digit';
  }

  return null;
}

/**
 * Validasi persentase (0-100)
 */
export function validatePercentage(value: number): string | null {
  if (angka(value) === null) {
    return 'Persentase harus berupa angka';
  }
  if (value < 0) {
    return 'Persentase tidak boleh negatif';
  }
  if (value > 100) {
    return 'Persentase maksimal 100%';
  }
  return null;
}

/**
 * Validasi kategori unit
 */
export const VALID_UNIT_CATEGORIES = [
  'Excavator',
  'Dozer',
  'Wheel Loader',
  'Motor Grader',
  'Compactor',
  'Crane',
  'Dump Truck',
  'Truck Mixer',
  'Forklift',
  'Lainnya'
];

export function validateUnitCategory(category: string): string | null {
  if (!category) return null;

  if (!VALID_UNIT_CATEGORIES.includes(category)) {
    return `Kategori tidak valid. Pilih dari: ${VALID_UNIT_CATEGORIES.join(', ')}`;
  }

  return null;
}

/**
 * Validasi merek unit
 */
export const VALID_BRANDS = [
  'SANY',
  'Komatsu',
  'Caterpillar',
  'Kobelco',
  'Hitachi',
  'Volvo',
  'JCB',
  'XCMG',
  'Lainnya'
];

export function validateBrand(brand: string): string | null {
  if (!brand) return null;

  if (!VALID_BRANDS.includes(brand)) {
    return `Merek tidak valid. Pilih dari: ${VALID_BRANDS.join(', ')}`;
  }

  return null;
}

/**
 * Validasi status unit
 */
export const VALID_UNIT_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'SOLD',
  'RENTED',
  'ON_PROJECT',
  'IN_TRANSIT',
  'MAINTENANCE',
  'BREAKDOWN',
  'INACTIVE',
  'DISPOSED'
];

export function validateUnitStatus(status: string): string | null {
  if (!status) return null;

  if (!VALID_UNIT_STATUSES.includes(status)) {
    return `Status tidak valid. Pilih dari: ${VALID_UNIT_STATUSES.join(', ')}`;
  }

  return null;
}

/**
 * Validasi tipe servis
 */
export const VALID_SERVICE_TYPES = [
  'PERIODIC_250H',
  'PERIODIC_500H',
  'PERIODIC_1000H',
  'CORRECTIVE',
  'OVERHAUL',
  'INSPECTION',
  'BREAKDOWN',
  'PREVENTIVE'
];

export function validateServiceType(type: string): string | null {
  if (!type) return null;

  if (!VALID_SERVICE_TYPES.includes(type)) {
    return `Tipe servis tidak valid. Pilih dari: ${VALID_SERVICE_TYPES.join(', ')}`;
  }

  return null;
}

/**
 * Validasi status pesanan (Sales/Rental)
 */
export const VALID_ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
];

export function validateOrderStatus(status: string): string | null {
  if (!status) return null;

  if (!VALID_ORDER_STATUSES.includes(status)) {
    return `Status tidak valid. Pilih dari: ${VALID_ORDER_STATUSES.join(', ')}`;
  }

  return null;
}

/**
 * Validasi kategori pembelian (Purchase)
 */
export const VALID_PURCHASE_CATEGORIES = [
  'UNIT',
  'SPAREPART',
  'FUEL',
  'LUBRICANT',
  'OTHER'
];

export function validatePurchaseCategory(category: string): string | null {
  if (!category) return null;

  if (!VALID_PURCHASE_CATEGORIES.includes(category)) {
    return `Kategori tidak valid. Pilih dari: ${VALID_PURCHASE_CATEGORIES.join(', ')}`;
  }

  return null;
}

/**
 * Format currency untuk display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

/**
 * Sanitasi input untuk mencegah XSS
 */
export function sanitizeInput(input: string): string {
  if (!input) return '';
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validasi panjang nama (untuk customer, supplier, dll)
 */
export function validateName(name: string, minLength: number = 2, maxLength: number = 100): string | null {
  if (!name) return null;

  if (name.length < minLength) {
    return `Nama minimal ${minLength} karakter`;
  }
  if (name.length > maxLength) {
    return `Nama maksimal ${maxLength} karakter`;
  }

  // Cek jika hanya angka atau simbol
  if (/^[\d\W]+$/.test(name)) {
    return 'Nama tidak valid';
  }

  return null;
}

/**
 * Validasi alamat
 */
export function validateAddress(address: string, minLength: number = 10): string | null {
  if (!address) return null;

  if (address.length < minLength) {
    return `Alamat minimal ${minLength} karakter`;
  }

  return null;
}

/**
 * Validasi deskripsi/keterangan
 */
export function validateDescription(description: string, minLength: number = 10, maxLength: number = 500): string | null {
  if (!description) {
    return 'Deskripsi wajib diisi';
  }

  if (description.length < minLength) {
    return `Deskripsi minimal ${minLength} karakter`;
  }

  if (description.length > maxLength) {
    return `Deskripsi maksimal ${maxLength} karakter`;
  }

  return null;
}

/**
 * Validasi file size (untuk upload foto)
 */
export function validateFileSize(file: File, maxSizeMB: number = 5): string | null {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return `Ukuran file maksimal ${maxSizeMB}MB`;
  }
  return null;
}

/**
 * Validasi file type (untuk upload foto)
 */
export function validateFileType(file: File, allowedTypes: string[] = ['image/jpeg', 'image/png', 'image/jpg']): string | null {
  if (!allowedTypes.includes(file.type)) {
    return `Tipe file tidak valid. Hanya: ${allowedTypes.join(', ')}`;
  }
  return null;
}
