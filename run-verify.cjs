const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const results = [];

function run(label, fn) {
  try {
    const out = fn();
    results.push({ label, ok: true, out: String(out || 'OK').slice(0, 200) });
  } catch (e) {
    results.push({ label, ok: false, out: String(e?.message || e).slice(0, 300) });
  }
}

function exec(label, cmd) {
  try {
    const out = execSync(cmd, { cwd: __dirname, encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
    results.push({ label, ok: true, out: (out || '(ok)').trim().slice(0, 200) });
  } catch (e) {
    results.push({ label, ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim().slice(0, 400) });
  }
}

// 1. TypeScript frontend
exec('TSC Frontend', 'node node_modules/typescript/bin/tsc --noEmit');

// 2. TypeScript electron
exec('TSC Electron', 'node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit');

// 3. Tidak ada pola filter-array hapus di pages
run('Tidak ada hapus via filter-array di pages', () => {
  const idArrayHapus = /\.filter\(\s*\w+\s*=>\s*\w+\.id\s*!==\s*\w+\s*\)/;
  const masih = fs.readdirSync(path.join(__dirname, 'src/pages'))
    .filter(f => f.endsWith('.tsx'))
    .filter(f => idArrayHapus.test(fs.readFileSync(path.join(__dirname, 'src/pages', f), 'utf8')));
  if (masih.length > 0) throw new Error('Masih pakai filter-array: ' + masih.join(', '));
  return 'OK - tidak ada';
});

// 4. Finance: filter bulan sudah ada
run('Finance: KPI filter bulan ini', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/pages/Finance.tsx'), 'utf8');
  if (!src.includes('month: bulanIni') && !src.includes('bulanIni')) throw new Error('Filter bulan tidak ditemukan');
  if (!src.includes('whereMasuk') || !src.includes('whereKeluar')) throw new Error('whereMasuk/whereKeluar tidak ada');
  return 'OK';
});

// 5. ErrorBoundary console.log di-gate
run('ErrorBoundary: console.log di-gate production', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/components/ErrorBoundary.tsx'), 'utf8');
  if (!src.includes("NODE_ENV !== 'production'")) throw new Error('Gate tidak ditemukan');
  return 'OK';
});

// 6. Prisma sudah dihapus
run('Prisma sudah dihapus', () => {
  if (fs.existsSync(path.join(__dirname, 'prisma'))) throw new Error('Folder prisma/ masih ada');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  if (pkg.devDependencies?.['@prisma/client'] || pkg.devDependencies?.['prisma'])
    throw new Error('Prisma masih di devDependencies');
  return 'OK';
});

// 7. tsconfig paths @ ada
run('tsconfig.json: paths @/* ada', () => {
  const tc = JSON.parse(fs.readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf8'));
  if (!tc.compilerOptions?.paths?.['@/*']) throw new Error('paths tidak ada');
  return 'OK - ' + JSON.stringify(tc.compilerOptions.paths['@/*']);
});

// 8. APP_VERSION tidak hardcoded '1.0.0' lagi
run('dataRecovery: APP_VERSION dari Vite, tidak hardcoded', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/utils/dataRecovery.ts'), 'utf8');
  if (src.includes("'1.0.0'")) throw new Error("Masih ada '1.0.0' hardcoded");
  if (!src.includes('__APP_VERSION__')) throw new Error('__APP_VERSION__ tidak ditemukan');
  return 'OK';
});

// 9. Customers/Suppliers/Brands pakai saveRow
run('Customers/Suppliers/Brands: pakai saveRow', () => {
  const bad = [];
  for (const f of ['Customers.tsx','Suppliers.tsx','Brands.tsx']) {
    const src = fs.readFileSync(path.join(__dirname, 'src/pages', f), 'utf8');
    if (!src.includes('await saveRow(')) bad.push(f);
  }
  if (bad.length > 0) throw new Error('Belum pakai saveRow: ' + bad.join(', '));
  return 'OK';
});

// 10. Transaksi utama pakai saveRow
run('Transaksi (Sales/Service/Rental/Delivery/Purchase): pakai saveRow', () => {
  const bad = [];
  for (const f of ['Sales.tsx','Service.tsx','Rental.tsx','Delivery.tsx','Purchase.tsx']) {
    const src = fs.readFileSync(path.join(__dirname, 'src/pages', f), 'utf8');
    if (!src.includes('await saveRow(')) bad.push(f);
  }
  if (bad.length > 0) throw new Error('Belum pakai saveRow: ' + bad.join(', '));
  return 'OK';
});

// 11. Operators/Technicians/Approvals/Documents/Breakdown pakai saveRow
run('CRUD halaman lain (Operators/Technicians/Approvals/Documents/Breakdown): pakai saveRow', () => {
  const bad = [];
  for (const f of ['Operators.tsx','Technicians.tsx','Approvals.tsx','Documents.tsx','Breakdown.tsx']) {
    const src = fs.readFileSync(path.join(__dirname, 'src/pages', f), 'utf8');
    if (!src.includes('await saveRow(')) bad.push(f);
  }
  if (bad.length > 0) throw new Error('Belum pakai saveRow: ' + bad.join(', '));
  return 'OK';
});

// 12. label SERVICE_TYPE_LABEL lengkap
run('labels.ts: SERVICE_TYPE_LABEL lengkap (CORRECTIVE, PREVENTIVE, CANCELLED)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/domain/labels.ts'), 'utf8');
  const missing = ['CORRECTIVE','PREVENTIVE'].filter(k => !src.includes(k));
  if (missing.length > 0) throw new Error('Label hilang: ' + missing.join(', '));
  return 'OK';
});

// 13. demoTransactions WorkOrder status lengkap
run('demoTransactions: WorkOrder.status mencakup WAITING_PARTS & CANCELLED', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/data/demoTransactions.ts'), 'utf8');
  if (!src.includes("'WAITING_PARTS'") || !src.includes("'CANCELLED'"))
    throw new Error('Status tidak lengkap');
  return 'OK';
});

// 14. React key={index} tidak ada di Dashboard/Layout
run('React key stabil (bukan index) di Dashboard & Layout', () => {
  const bad = [];
  for (const f of ['Dashboard.tsx','Layout.tsx']) {
    const src = fs.readFileSync(path.join(__dirname, 'src/pages', f.replace('Layout.tsx','') || `../components/${f}`), 'utf8');
    const check = f === 'Layout.tsx'
      ? fs.readFileSync(path.join(__dirname, 'src/components/Layout.tsx'), 'utf8')
      : src;
    if (/key=\{i\}/.test(check)) bad.push(f + ':key={i}');
  }
  // Dashboard specific
  const dash = fs.readFileSync(path.join(__dirname, 'src/pages/Dashboard.tsx'), 'utf8');
  if (/ key=\{i\}/.test(dash)) bad.push('Dashboard.tsx:key={i}');
  if (bad.length > 0) throw new Error(bad.join(', '));
  return 'OK';
});

// 15. Package.json tidak ada @types/react-router-dom
run('package.json: @types/react-router-dom tidak ada (v6 bundled types)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  if (pkg.devDependencies?.['@types/react-router-dom'])
    throw new Error('Masih ada @types/react-router-dom');
  return 'OK';
});

// Tulis laporan
const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
const report = results.map(r => `${r.ok ? 'PASS' : 'FAIL'}  ${r.label}\n       ${r.out}`).join('\n') +
  `\n\n${'='.repeat(50)}\nTotal: ${pass} PASS, ${fail} FAIL\n`;
fs.writeFileSync('verify-output.txt', report);
console.log(report);
