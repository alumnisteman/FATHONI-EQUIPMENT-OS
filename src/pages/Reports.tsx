// src/pages/Reports.tsx - Modul Laporan & Analitik FATHONI EQUIPMENT OS
// Semua ANGKA pada halaman ini dihitung SQLite (sum/group lewat IPC), bukan dengan
// menelusuri seluruh isi invoices dan units di renderer. Daftar panjang dibatasi
// satu halaman untuk ditampilkan dan BATAS_EKSPOR baris untuk CSV/PDF — mengekspor
// "semua" dari tabel yang sedang tumbuh adalah cara paling cepat membekukan jendela.

import { useMemo, useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { printDocument, sanitize, getCompanyName } from '../utils/printHelper';
import { lastMonthKeys, isoDay } from '../domain/revenue';
import { buildCsv, downloadCsv } from '../utils/csvExport';
import { useCollectionCount, useCollectionGroup, useCollectionQuery, useCollectionSum } from '../hooks/useCollectionTotals';
import { usePagedCollection } from '../hooks/usePagedCollection';
import { dbQuery, type DbQueryRequest } from '../services/dbClient';
import Pager from '../components/Pager';

const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);

type TabLaporan = 'pendapatan' | 'unit' | 'piutang';

/** Jenis invoice yang dihitung sebagai pendapatan; SPAREPART tidak. */
const TIPE_PENDAPATAN = ['RENTAL', 'PENJUALAN', 'SERVICE'];
const WHERE_PIUTANG = { status: { in: ['UNPAID', 'PARTIAL'] } };
/** Satu halaman tampil; selebihnya tetap ada di SQLite sampai halamannya dibuka. */
const PAGE_SIZE = 25;
/** Batas aman satu kueri ekspor (MAX_PAGE_LIMIT di main process). */
const BATAS_EKSPOR = 500;

export default function Reports() {
  const [activeTab, setActiveTab] = useState<TabLaporan>('pendapatan');
  const { units, invoices, savedTick } = useDataStore();
  const [pageUnit, setPageUnit] = useState(0);
  const [pagePiutang, setPagePiutang] = useState(0);

  /**
   * Piutang yang sudah lewat tempo, dibangun ulang tiap render supaya 'hari ini'
   * tidak membeku di tanggal aplikasi dibuka. `gt: ''` membuang baris tanpa
   * tanggal jatuh tempo — kolom TEXT menyimpan string kosong, dan string kosong
   * lebih kecil dari tanggal apa pun. Identitas objek baru tidak memicu kueri
   * ulang: hook agregat membandingkan isinya, bukan referensinya.
   */
  const whereJatuhTempo = { ...WHERE_PIUTANG, dueDate: { gt: '', lt: isoDay(0) } };

  const bulanLaporan = useMemo(() => lastMonthKeys(6), []);

  // Pendapatan per jenis, sepanjang seluruh invoice. Baris TOTAL pada tabel dan
  // kartu KPI memang angka sepanjang masa — bukan jumlah enam baris di atasnya,
  // yang hanya memuat 6 bulan terakhir.
  const jenisGroups = useCollectionGroup(
    { collection: 'invoices', by: ['type'], sum: 'totalAmount' },
    invoices, savedTick.invoices
  );
  const { totalRental, totalPenjualan, totalService, totalKeseluruhan } = useMemo(() => {
    const perJenis = new Map(jenisGroups.map(g => [g.keys[0], g.sum]));
    const rental = perJenis.get('RENTAL') || 0;
    const penjualan = perJenis.get('PENJUALAN') || 0;
    const service = perJenis.get('SERVICE') || 0;
    return {
      totalRental: rental, totalPenjualan: penjualan, totalService: service,
      totalKeseluruhan: rental + penjualan + service,
    };
  }, [jenisGroups]);

  // Enam baris bulanan dengan pemecahan per jenis: satu kueri GROUP BY
  // (month, type). Aturan pengelompokan sama persis dengan revenueByMonth yang
  // dipakai Dasbor — kolom `month` dihasilkan dari issueDate dengan cara yang
  // sama (dijaga db-check 13.20).
  const bulanGroups = useCollectionGroup({
    collection: 'invoices',
    by: ['month', 'type'],
    sum: 'totalAmount',
    where: {
      month: { between: [bulanLaporan[0].key, bulanLaporan[bulanLaporan.length - 1].key] },
      type: { in: TIPE_PENDAPATAN },
    },
  }, invoices, savedTick.invoices);
  const LAPORAN_PENDAPATAN = useMemo(() => {
    const perBulan = new Map(bulanGroups.map(g => [`${g.keys[0]}|${g.keys[1]}`, g.sum]));
    return bulanLaporan.map(m => {
      const rental = perBulan.get(`${m.key}|RENTAL`) || 0;
      const penjualan = perBulan.get(`${m.key}|PENJUALAN`) || 0;
      const service = perBulan.get(`${m.key}|SERVICE`) || 0;
      return { ...m, rental, penjualan, service, total: rental + penjualan + service };
    });
  }, [bulanGroups, bulanLaporan]);

  // Nominal piutang: SQLite menjumlahkan satu kolom, jadi selisih
  // (totalAmount - paidAmount) dihitung atas dua jumlah dari BARIS YANG SAMA.
  // Hasilnya identik dengan reduce lama dan tetap benar walau table bertambah.
  const tagihanPiutang = useCollectionSum('invoices', 'totalAmount', WHERE_PIUTANG, invoices, savedTick.invoices);
  const terbayarPiutang = useCollectionSum('invoices', 'paidAmount', WHERE_PIUTANG, invoices, savedTick.invoices);
  const totalPiutang = tagihanPiutang - terbayarPiutang;
  const jumlahPiutang = useCollectionCount('invoices', WHERE_PIUTANG, invoices, savedTick.invoices);

  const tagihanJatuhTempo = useCollectionSum('invoices', 'totalAmount', whereJatuhTempo, invoices, savedTick.invoices);
  const terbayarJatuhTempo = useCollectionSum('invoices', 'paidAmount', whereJatuhTempo, invoices, savedTick.invoices);
  const totalPiutangOverdue = tagihanJatuhTempo - terbayarJatuhTempo;
  const jumlahJatuhTempo = useCollectionCount('invoices', whereJatuhTempo, invoices, savedTick.invoices);

  // Rata-rata umur piutang (DSO) adalah aritmetika tanggal per baris, jadi ia
  // dikerjakan atas daftar yang sama dengan yang ditampilkan tabel: maksimum
  // BATAS_EKSPOR piutang terbaru. Kartu di bawah menyebut batas itu bila masih
  // ada piutang di luar daftar — angka yang salah diam-diam lebih berbahaya
  // daripada angka yang mengakui dirinya sebagian.
  const piutangHal = useCollectionQuery<any>({
    collection: 'invoices',
    where: WHERE_PIUTANG,
    sort: 'issueDate',
    desc: true,
    limit: BATAS_EKSPOR,
  }, invoices, savedTick.invoices);
  const unpaidInvoices = piutangHal.rows;
  const piutangTerpotong = piutangHal.total > unpaidInvoices.length;

  const avgUmurPiutang = useMemo(() => {
    if (unpaidInvoices.length === 0) return 0;
    const now = Date.now();
    return Math.floor(unpaidInvoices.reduce((a: number, i: any) =>
      a + Math.floor((now - new Date(i.issueDate).getTime()) / (1000 * 3600 * 24)), 0
    ) / unpaidInvoices.length);
  }, [unpaidInvoices]);

  // Daftar unit dibaca per halaman; seluruh armada tidak pernah masuk DOM.
  const unitLaporan = usePagedCollection({
    collection: 'units',
    search: '',
    sort: 'purchaseDate',
    desc: true,
    pageSize: PAGE_SIZE,
    page: pageUnit,
    localRows: units,
    localFields: u => [u.serialNumber, u.brand, u.model, u.status],
    revision: savedTick.units,
  });

  const halPiutang = unpaidInvoices.slice(
    pagePiutang * PAGE_SIZE, pagePiutang * PAGE_SIZE + PAGE_SIZE);
  const pagesPiutang = Math.max(1, Math.ceil(unpaidInvoices.length / PAGE_SIZE));

  /**
   * Satu kueri untuk ekspor: apa yang diunduh adalah BATAS_EKSPOR baris pertama
   * dari penyaringan yang sama, dengan catatan pemotongan di dalam file. Mode
   * browser tidak punya SQLite, jadi array store yang dipakai.
   */
  const ambilUntukEkspor = async (req: DbQueryRequest, fallback: any[]) => {
    const hasil = await dbQuery(req);
    if (hasil) return hasil;
    return { rows: fallback.slice(0, BATAS_EKSPOR), total: fallback.length };
  };

  const catatanPotong = (total: number, rows: number) =>
    total > rows ? `Ekspor dibatasi ${rows} baris pertama; total ${total} baris di database.` : '';


  const tabs: { key: TabLaporan; label: string }[] = [
    { key: 'pendapatan', label: '💰 Laporan Pendapatan' },
    { key: 'unit', label: '🚜 Laporan Kinerja Unit' },
    { key: 'piutang', label: '📋 Laporan Piutang (AR)' },
  ];

  // Ekspor sesuai tab aktif. Sebelumnya tab piutang ikut memakai cabang unit,
  // sehingga file yang diunduh berisi data yang salah.
  const handleExportCSV = async () => {
    const stamp = new Date().toISOString().split('T')[0];

    if (activeTab === 'pendapatan') {
      downloadCsv(`Laporan_Pendapatan_FATHONI_${stamp}.csv`, buildCsv(
        ['Bulan', 'Pendapatan Rental', 'Penjualan Unit', 'Layanan Servis', 'Total Pendapatan'],
        [
          ...LAPORAN_PENDAPATAN.map(r => [r.label, r.rental, r.penjualan, r.service, r.total]),
          ['TOTAL KESELURUHAN', totalRental, totalPenjualan, totalService, totalKeseluruhan],
        ],
      ));
      return;
    }

    if (activeTab === 'unit') {
      const { rows, total } = await ambilUntukEkspor(
        { collection: 'units', sort: 'purchaseDate', desc: true, limit: BATAS_EKSPOR }, units);
      const catatan = catatanPotong(total, rows.length);
      downloadCsv(`Laporan_Kinerja_Unit_FATHONI_${stamp}.csv`, buildCsv(
        ['Serial Number', 'Model', 'Status', 'Total HM', 'Harga Beli'],
        [
          ...rows.map(r => [r.serialNumber, `${r.brand} ${r.model}`, r.status, r.hourMeter, r.purchasePrice]),
          ...(catatan ? [[catatan]] : []),
        ],
      ));
      return;
    }

    const { rows, total } = await ambilUntukEkspor({
      collection: 'invoices', where: WHERE_PIUTANG, sort: 'issueDate', desc: true, limit: BATAS_EKSPOR,
    }, unpaidInvoices);
    const catatan = catatanPotong(total, rows.length);
    downloadCsv(`Laporan_Piutang_FATHONI_${stamp}.csv`, buildCsv(
      ['No Invoice', 'Pelanggan', 'Tanggal Terbit', 'Jatuh Tempo', 'Nominal', 'Terbayar', 'Sisa', 'Status'],
      [
        ...rows.map(i => [
          i.invoiceNo, i.customerName, i.issueDate, i.dueDate,
          i.totalAmount, i.paidAmount, i.totalAmount - i.paidAmount, i.status,
        ]),
        ...(catatan ? [[catatan]] : []),
      ],
    ));
  };

  const handlePrintPDF = async () => {
    const companyName = getCompanyName();
    let title = '';
    let tableHtml = '';

    if (activeTab === 'pendapatan') {
      title = 'LAPORAN REKAPITULASI PENDAPATAN';
      tableHtml = `
        <table>
          <thead>
            <tr>
              <th>Bulan</th>
              <th style="text-align:right">Rental</th>
              <th style="text-align:right">Penjualan</th>
              <th style="text-align:right">Service</th>
              <th style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${LAPORAN_PENDAPATAN.map(r => `
              <tr>
                <td>${sanitize(r.label)}</td>
                <td style="text-align:right">${fmt(r.rental)}</td>
                <td style="text-align:right">${fmt(r.penjualan)}</td>
                <td style="text-align:right">${fmt(r.service)}</td>
                <td style="text-align:right"><strong>${fmt(r.total)}</strong></td>
              </tr>
            `).join('')}
            <tr>
              <td><strong>TOTAL KESELURUHAN</strong></td>
              <td style="text-align:right"><strong>${fmt(totalRental)}</strong></td>
              <td style="text-align:right"><strong>${fmt(totalPenjualan)}</strong></td>
              <td style="text-align:right"><strong>${fmt(totalService)}</strong></td>
              <td style="text-align:right"><strong>${fmt(totalKeseluruhan)}</strong></td>
            </tr>
          </tbody>
        </table>
      `;
    } else if (activeTab === 'unit') {
      title = 'LAPORAN KINERJA & ASET UNIT ALAT BERAT';
      const hal = await ambilUntukEkspor(
        { collection: 'units', sort: 'purchaseDate', desc: true, limit: BATAS_EKSPOR }, units);
      const catatan = catatanPotong(hal.total, hal.rows.length);
      tableHtml = `
        <table>
          <thead>
            <tr>
              <th>Serial Number</th>
              <th>Model Unit</th>
              <th>Status Akhir</th>
              <th style="text-align:right">Total Jam (HM)</th>
              <th style="text-align:right">Nilai Aset</th>
            </tr>
          </thead>
          <tbody>
            ${hal.rows.map(r => `
              <tr>
                <td>${sanitize(r.serialNumber)}</td>
                <td>${sanitize(r.brand)} ${sanitize(r.model)}</td>
                <td>${sanitize(r.status)}</td>
                <td style="text-align:right">${new Intl.NumberFormat('id-ID').format(r.hourMeter || 0)} HM</td>
                <td style="text-align:right">${fmt(r.purchasePrice || 0)}</td>
              </tr>
            `).join('')}
            ${catatan ? `<tr><td colspan="5" style="text-align:center;color:#C00">${sanitize(catatan)}</td></tr>` : ''}
          </tbody>
        </table>
      `;
    } else {
      title = 'LAPORAN PIUTANG BEREDAR (ACCOUNT RECEIVABLES)';
      const hal = await ambilUntukEkspor({
        collection: 'invoices', where: WHERE_PIUTANG, sort: 'issueDate', desc: true, limit: BATAS_EKSPOR,
      }, unpaidInvoices);
      const catatan = catatanPotong(hal.total, hal.rows.length);
      tableHtml = `
        <div style="margin-bottom: 20px;">
          <strong>Total Piutang Berjalan:</strong> ${fmt(totalPiutang)} <br/>
          <strong>Total Jatuh Tempo (Overdue):</strong> <span style="color:#C00">${fmt(totalPiutangOverdue)}</span> <br/>
          <strong>Rata-rata Umur Piutang:</strong> ${avgUmurPiutang} Hari${piutangTerpotong ? ` (diukur atas ${unpaidInvoices.length} piutang terbaru dari ${piutangHal.total})` : ''}
        </div>
        <table>
          <thead>
            <tr>
              <th>No. Invoice</th>
              <th>Pelanggan</th>
              <th>Jatuh Tempo</th>
              <th style="text-align:right">Total Tagihan</th>
              <th style="text-align:right">Sisa Terutang</th>
              <th>Umur</th>
            </tr>
          </thead>
          <tbody>
            ${hal.rows.length === 0 ? `<tr><td colspan="6" style="text-align:center">Tidak ada piutang beredar.</td></tr>` : hal.rows.map(r => {
              const sisa = r.totalAmount - r.paidAmount;
              const msDiff = new Date().getTime() - new Date(r.issueDate).getTime();
              const umur = Math.floor(msDiff / (1000 * 3600 * 24));
              const isOverdue = new Date(r.dueDate) < new Date();
              return `
                <tr style="${isOverdue ? 'background-color:#ffebe6;' : ''}">
                  <td>${sanitize(r.invoiceNo)}</td>
                  <td>${sanitize(r.customerName)}</td>
                  <td>${sanitize(r.dueDate)}</td>
                  <td style="text-align:right">${fmt(r.totalAmount)}</td>
                  <td style="text-align:right"><strong>${fmt(sisa)}</strong></td>
                  <td>${umur > 0 ? umur : 0} Hari</td>
                </tr>
              `;
            }).join('')}
            ${catatan ? `<tr><td colspan="6" style="text-align:center;color:#C00">${sanitize(catatan)}</td></tr>` : ''}
          </tbody>
        </table>
      `;
    }

    const htmlContent = `
      <html><head><title>${title}</title><style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #111; }
        h2 { color: #111; margin-bottom: 4px; text-align: center; }
        .header { margin-bottom: 30px; padding-bottom: 15px; border-bottom: 2px solid #111; text-align: center; }
        .company { font-size: 20px; font-weight: bold; margin-bottom: 5px; }
        .date { font-size: 12px; color: #555; text-align: right; margin-bottom: 20px; }
        table { width:100%; border-collapse:collapse; margin-top:16px; font-size: 12px; }
        th,td { border:1px solid #ccc; padding:8px 10px; text-align:left; }
        th { background:#f0f0f0; } 
        .footer { margin-top:40px; display:flex; justify-content:flex-end; }
        .sign { text-align:center; width:160px; } .sign-line { border-top:1px solid #111; margin-top:60px; }
        @media print { body { padding: 20px; } }
      </style></head><body>
      <div class="header">
        <div class="company">${sanitize(companyName)}</div>
        <h2>${title}</h2>
      </div>
      <div class="date">Dicetak pada: ${new Date().toLocaleString('id-ID')}</div>
      ${tableHtml}
      <div class="footer">
        <div class="sign"><div class="sign-line"></div><div>Authorized Signature</div></div>
      </div>
    </body></html>
    `;
    printDocument(htmlContent, title);
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Laporan & Analitik</h1>
          <p className="page-subtitle">Laporan pendapatan, kinerja unit, piutang, dan rekap operasional bisnis alat berat</p>
        </div>
        <div className="page-header-actions" style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={handleExportCSV}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Ekspor CSV
          </button>
          <button className="btn btn-primary" onClick={handlePrintPDF}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
              <path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Cetak PDF
          </button>
        </div>
      </div>

      {/* Ringkasan KPI. Ini angka SELURUH invoice yang tersimpan, bukan jumlah
          enam baris tabel di bawahnya — labelnya harus menyebut itu, karena kartu
          "7 Bulan Terakhir" yang berisi angka sepanjang masa adalah cara tercepat
          membuat manajemen salah membaca laporan. */}
      <div className="grid-4 mb-4">
        <div className="card stat-card">
          <div className="card-title">Total Pendapatan Rental</div>
          <div className="card-value" style={{ color: 'var(--accent-blue)' }}>{fmt(totalRental)}</div>
          <div className="card-sub">Sepanjang masa</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Total Penjualan Unit</div>
          <div className="card-value" style={{ color: 'var(--status-operating)' }}>{fmt(totalPenjualan)}</div>
          <div className="card-sub">Sepanjang masa</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Pendapatan Jasa Service</div>
          <div className="card-value" style={{ color: 'var(--status-maintenance)' }}>{fmt(totalService)}</div>
          <div className="card-sub">Sepanjang masa</div>
        </div>
        <div className="card stat-card">
          <div className="card-title">Total Pendapatan</div>
          <div className="card-value" style={{ color: 'var(--sany-red)' }}>{fmt(totalKeseluruhan)}</div>
          <div className="card-sub">Gabungan 3 jenis, sepanjang masa</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-default)' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: '10px 18px', background: 'transparent', border: 'none',
            borderBottom: activeTab === t.key ? '2px solid var(--sany-red)' : '2px solid transparent',
            color: activeTab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === t.key ? 700 : 500, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Laporan Pendapatan */}
      {activeTab === 'pendapatan' && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Bulan <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({bulanLaporan[0].label}–{bulanLaporan[bulanLaporan.length - 1].label})</span></th>
                <th style={{ textAlign: 'right' }}>Pendapatan Rental</th>
                <th style={{ textAlign: 'right' }}>Pendapatan Penjualan</th>
                <th style={{ textAlign: 'right' }}>Pendapatan Service</th>
                <th style={{ textAlign: 'right', fontWeight: 800 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {LAPORAN_PENDAPATAN.map(row => (
                <tr key={row.label}>
                  <td style={{ fontWeight: 600 }}>{row.label}</td>
                  <td style={{ textAlign: 'right', color: 'var(--accent-blue)' }}>{fmt(row.rental)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--status-operating)' }}>{row.penjualan > 0 ? fmt(row.penjualan) : '—'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--status-maintenance)' }}>{fmt(row.service)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 14 }}>{fmt(row.total)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border-default)', background: 'var(--bg-elevated)' }}>
                <td style={{ fontWeight: 800 }}>TOTAL KESELURUHAN</td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--accent-blue)' }}>{fmt(totalRental)}</td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--status-operating)' }}>{fmt(totalPenjualan)}</td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--status-maintenance)' }}>{fmt(totalService)}</td>
                <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 15, color: 'var(--sany-red)' }}>{fmt(totalKeseluruhan)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Laporan Kinerja Unit */}
      {activeTab === 'unit' && (
        <div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Serial Number</th>
                  <th>Model Unit</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Total Jam Digunakan (HM)</th>
                  <th style={{ textAlign: 'right' }}>Harga Perolehan</th>
                </tr>
              </thead>
              <tbody>
                {unitLaporan.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                      Belum ada unit terdaftar.
                    </td>
                  </tr>
                ) : unitLaporan.rows.map(row => (
                    <tr key={row.id ?? row.serialNumber}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.serialNumber}</td>
                      <td style={{ fontWeight: 600 }}>{row.brand} {row.model}</td>
                      <td>
                        <span className={`badge ${row.status === 'ON_PROJECT' || row.status === 'RENTED' ? 'badge-info' : row.status === 'MAINTENANCE' ? 'badge-warning' : 'badge-success'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent-blue)' }}>{new Intl.NumberFormat('id-ID').format(row.hourMeter || 0)} HM</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--status-operating)' }}>
                        {fmt(row.purchasePrice || 0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Pager
            from={unitLaporan.from} to={unitLaporan.to} total={unitLaporan.total}
            page={pageUnit} pages={unitLaporan.pages} loading={unitLaporan.loading}
            onPage={setPageUnit}
          />
        </div>
      )}

      {/* Laporan Piutang */}
      {activeTab === 'piutang' && (
        <div>
          <div className="grid-3 mb-4">
            <div className="card stat-card">
              <div className="card-title">Total Piutang Beredar</div>
              <div className="card-value" style={{ color: 'var(--status-out)' }}>{fmt(totalPiutang)}</div>
              <div className="card-sub">{jumlahPiutang} Invoice Belum Lunas</div>
            </div>
            <div className="card stat-card">
              <div className="card-title">Piutang Jatuh Tempo</div>
              <div className="card-value" style={{ color: 'var(--status-out)' }}>{fmt(totalPiutangOverdue)}</div>
              <div className="card-sub">{jumlahJatuhTempo} Invoice Jatuh Tempo</div>
            </div>
            <div className="card stat-card">
              <div className="card-title">Rata-Rata Umur Piutang</div>
              <div className="card-value" style={{ color: 'var(--status-maintenance)' }}>{avgUmurPiutang} Hari</div>
              <div className="card-sub">
                {piutangTerpotong
                  ? `DSO atas ${unpaidInvoices.length} piutang terbaru dari ${piutangHal.total}`
                  : 'Days Sales Outstanding (DSO)'}
              </div>
            </div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>No. Invoice</th>
                  <th>Pelanggan</th>
                  <th>Keterangan</th>
                  <th>Jatuh Tempo</th>
                  <th style={{ textAlign: 'right' }}>Total Tagihan</th>
                  <th style={{ textAlign: 'right' }}>Sisa Tagihan</th>
                  <th>Umur (Hari)</th>
                </tr>
              </thead>
              <tbody>
                {halPiutang.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 36 }}>
                      Tidak ada piutang beredar.
                    </td>
                  </tr>
                ) : halPiutang.map(row => {
                  const sisa = row.totalAmount - row.paidAmount;
                  const msDiff = new Date().getTime() - new Date(row.issueDate).getTime();
                  const umur = Math.floor(msDiff / (1000 * 3600 * 24));
                  const isOverdue = new Date(row.dueDate) < new Date();
                  return (
                  <tr key={row.id ?? row.invoiceNo}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{row.invoiceNo}</td>
                    <td style={{ fontWeight: 600 }}>{row.customerName}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.unitOrDesc}</td>
                    <td style={{ fontSize: 12, color: isOverdue ? 'var(--status-out)' : 'var(--text-secondary)' }}>{row.dueDate}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(row.totalAmount)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--status-out)' }}>{fmt(sisa)}</td>
                    <td>
                      <span className={`badge ${isOverdue ? 'badge-danger' : umur > 14 ? 'badge-warning' : 'badge-muted'}`}>
                        {umur > 0 ? umur : 0} Hari
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager
            from={halPiutang.length === 0 ? 0 : pagePiutang * PAGE_SIZE + 1}
            to={pagePiutang * PAGE_SIZE + halPiutang.length}
            total={unpaidInvoices.length}
            page={pagePiutang}
            pages={pagesPiutang}
            onPage={setPagePiutang}
          />
          {piutangTerpotong && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              Daftar ini memuat {unpaidInvoices.length} piutang terbaru dari {piutangHal.total} yang beredar;
              sisanya tetap tersimpan di database dan ikut menghitung kartu di atas, hanya tidak ditampilkan
              di sini. Gunakan Ekspor CSV untuk mengambil daftar lengkap sampai {BATAS_EKSPOR} baris.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
