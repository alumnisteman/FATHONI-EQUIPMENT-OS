// tests/harness/db-backup-run.cjs
// Orkestrator harness Fase 4 (cadangan berbasis berkas SQLite): menjalankan
// db-backup-check.cjs tiga kali pada satu folder data sementara.
//
//   node tests/harness/db-backup-run.cjs
//
// Butuh `npm run build` + `npm run build:electron` terlebih dahulu.
//
// Folder data sementara wajib: tanpa HEMS_DATA_DIR setiap fase membuka profil
// %APPDATA%\hems-heavy-equipment-system yang berisi data pengguna sungguhan.
//
// Di antara fase ada dua bersih-bersih yang masing-masing menguji satu hal:
//  - sesudah seed: file database dibuang, jadi fase snapshots benar-benar
//    mengimpor localStorage ke SQLite kosong seperti profil yang baru naik versi;
//  - sesudah snapshots: folder snapshots dikosongkan, jadi apa pun yang dicari di
//    fase page (snapshot pengaman, daftar di layar) pasti dihasilkan fase itu
//    sendiri. File database sengaja ditinggalkan — fase page harus boot dari
//    berkas hasil fase sebelumnya.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// electron.cmd tidak bisa di-spawn tanpa shell; cli.js milik paket electron
// meneruskan argumen ke binary yang sama dan berjalan di bawah Node ini.
const ELECTRON_CLI = path.join(__dirname, '..', '..', 'node_modules', 'electron', 'cli.js');
const CHECK = path.join(__dirname, 'db-backup-check.cjs');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fathoni-backup-'));
const dataDir = path.join(base, 'profile');
const snapDir = path.join(dataDir, 'snapshots');
fs.mkdirSync(dataDir, { recursive: true });

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

function runPhase(phase, timeoutMs) {
  console.log(`\n──────── fase ${phase} ────────`);
  const started = Date.now();
  const res = spawnSync(process.execPath, [ELECTRON_CLI, CHECK], {
    encoding: 'utf8',
    maxBuffer: 60 * 1024 * 1024,
    timeout: timeoutMs,
    cwd: path.join(__dirname, '..', '..'),
    env: Object.assign({}, process.env, {
      HEMS_DATA_DIR: dataDir,
      HEMS_HARNESS_PHASE: phase,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    }),
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  out.split(/\r?\n/).filter(Boolean).forEach(line => {
    if (/^(PASS|FAIL|RENDERER|TIMEOUT|HARNESS ERROR|SEED-DONE|MARK|EVSAFE|===)/.test(line)) console.log(line);
  });
  ok(`fase ${phase}: proses keluar dengan bersih`, res.status === 0 && !res.error,
    { status: res.status, error: res.error && String(res.error), out: out.slice(-800) });
  ok(`fase ${phase}: tidak menggantung (${Date.now() - started} ms)`, Date.now() - started < timeoutMs);
  return { out, status: res.status };
}

const seed = runPhase('seed', 180000);
ok('fase seed menanam localStorage', /SEED-DONE/.test(seed.out));

fs.readdirSync(dataDir).forEach(name => {
  if (/^fathoni\.db/.test(name)) fs.rmSync(path.join(dataDir, name), { force: true });
});
ok('file database dibuang sebelum fase snapshots', !fs.existsSync(path.join(dataDir, 'fathoni.db')));

const snap = runPhase('snapshots', 300000);
ok('folder snapshot terbentuk di dalam profil uji', fs.existsSync(snapDir));
ok('database hidup masih di tempatnya sesudah restore-restore',
  fs.existsSync(path.join(dataDir, 'fathoni.db')));

fs.rmSync(snapDir, { recursive: true, force: true });
ok('folder snapshot dikosongkan sebelum fase page', !fs.existsSync(snapDir));

const page = runPhase('page', 600000);
ok('file ekspor .sanybak tertulis lewat dialog', fs.existsSync(path.join(dataDir, 'export-uji.sanybak')));
ok('halaman page membuat snapshot berkas sendiri', fs.existsSync(snapDir));

const all = seed.out + snap.out + page.out;
const phasePass = (all.match(/^PASS /gm) || []).length;
const phaseFail = (all.match(/^FAIL /gm) || []).length;
console.log(`\n=== db-backup-check: ${phasePass + passed} lulus, ${phaseFail + failed} gagal ===`);

if (process.env.HEMS_KEEP_TMP) {
  console.log('folder data uji dipertahankan:', base);
} else {
  // Fase yang kena batas waktu meninggalkan Electron yang masih memegang folder,
  // dan Windows menolak penghapusan itu. Bukan hasil uji, jadi hanya dilaporkan.
  try { fs.rmSync(base, { recursive: true, force: true }); }
  catch (err) { console.log(`catatan: folder uji ${base} tidak bisa dibersihkan (${err.code})`); }
}

process.exit(phaseFail + failed === 0 ? 0 : 1);
