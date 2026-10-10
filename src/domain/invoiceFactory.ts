// src/domain/invoiceFactory.ts
// Satu-satunya tempat bentuk invoice ditentukan. Halaman, action store, dan migrasi
// memakai factory yang sama supaya invoice hasil backfill tidak berbeda bentuk
// dengan invoice hasil transaksi baru.

export type InvoiceSource = 'SALES' | 'RENTAL' | 'SERVICE';

const DATE_ONLY = (d: Date) => d.toISOString().split('T')[0];

function money(...candidates: (number | undefined | null)[]): number {
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

// Status mengikuti pembayaran yang sudah tercatat. Tanpa ini invoice penjualan tunai
// (DP = harga total) tetap berlabel UNPAID dan membesar-besarkan piutang di Laporan.
function statusFor(total: number, paid: number): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (paid > 0 && paid >= total) return 'PAID';
  if (paid > 0) return 'PARTIAL';
  return 'UNPAID';
}

export function invoiceFromSale(sale: any, issueDate?: string): any {
  const orderNo = sale.orderNo ?? sale.orderNumber ?? sale.id;
  const issued = issueDate ?? sale.orderDate ?? DATE_ONLY(new Date());
  const unitDesc = [sale.unitModel, sale.serialNumber].filter(Boolean).join(' - ') || 'Unit Penjualan';
  const total = money(sale.totalPrice, sale.grandTotal, sale.total);
  const paid = money(sale.downPayment);

  return {
    id: `INV-SALE-${orderNo}`,
    invoiceNo: `INV/SALE/${orderNo}`,
    sourceType: 'SALES',
    sourceNumber: String(orderNo),
    customerName: sale.customerName || '-',
    unitOrDesc: `Penjualan ${unitDesc}`,
    type: 'PENJUALAN',
    issueDate: DATE_ONLY(new Date(issued)),
    dueDate: DATE_ONLY(new Date(new Date(issued).getTime() + 30 * 86_400_000)),
    totalAmount: total,
    paidAmount: paid,
    status: statusFor(total, paid),
  };
}

export function invoiceFromRental(rental: any, issueDate?: string): any {
  const contractNo = rental.contractNo ?? rental.rentalNumber ?? rental.id;
  const issued = issueDate ?? rental.startDate ?? DATE_ONLY(new Date());
  const unitDesc = rental.unitModel || 'Unit Sewa';

  return {
    id: `INV-RENT-${contractNo}`,
    invoiceNo: `INV/RENT/${contractNo}`,
    sourceType: 'RENTAL',
    sourceNumber: String(contractNo),
    customerName: rental.customerName || '-',
    unitOrDesc: `Rental ${unitDesc} (Sewa Bulan Pertama)`,
    type: 'RENTAL',
    issueDate: DATE_ONLY(new Date(issued)),
    dueDate: DATE_ONLY(new Date(new Date(issued).getTime() + 14 * 86_400_000)),
    totalAmount: money(rental.monthlyRate, rental.rate, rental.totalAmount),
    paidAmount: 0,
    status: 'UNPAID',
  };
}

export function invoiceFromService(workOrder: any, actualCost?: number): any {
  const woNumber = workOrder.woNumber ?? workOrder.workOrderNumber ?? workOrder.id;
  const issued = workOrder.completedDate ?? workOrder.closeDate ?? workOrder.openDate ?? DATE_ONLY(new Date());
  const amount = money(actualCost, workOrder.actualCost, workOrder.estimatedCost);

  return {
    id: `INV-SVC-${woNumber}`,
    invoiceNo: `INV/SVC/${woNumber}`,
    sourceType: 'SERVICE',
    sourceNumber: String(woNumber),
    customerName: workOrder.customerOrProject || '-',
    unitOrDesc: `Servis ${[workOrder.unitModel, workOrder.serialNumber].filter(Boolean).join(' - ') || 'Work Order'}`,
    type: 'SERVICE',
    issueDate: DATE_ONLY(new Date(issued)),
    dueDate: DATE_ONLY(new Date(new Date(issued).getTime() + 14 * 86_400_000)),
    totalAmount: amount,
    paidAmount: 0,
    status: 'UNPAID',
  };
}

/** Invoice dianggap sudah ada bila nomor sumbernya pernah ditagihkan. */
export function hasInvoiceFor(invoices: any[], source: InvoiceSource, number: string): boolean {
  const needle = String(number || '').trim().toLowerCase();
  if (!needle) return false;
  return invoices.some(inv => {
    if (inv.sourceType === source && String(inv.sourceNumber || '').trim().toLowerCase() === needle) return true;
    // invoice lama tidak punya sourceType; nomornya selalu memuat nomor sumber
    return typeof inv.invoiceNo === 'string' && inv.invoiceNo.toLowerCase().includes(needle);
  });
}
