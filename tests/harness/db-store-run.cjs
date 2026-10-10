// tests/harness/db-store-run.cjs
// Orkestrator harness Fase 4 (SQLite): menjalankan db-store-check.cjs tiga kali
// pada satu folder data sementara, dan memeriksa batas waktu handshake flush di
// antara fase. Dijalankan dengan Node biasa:
//
//   node tests/harness/db-store-run.cjs
//
// Butuh `npm run build` + `npm run build:electron` terlebih dahulu.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// electron.cmd tidak bisa di-spawn tanpa shell; cli.js milik paket electron
// meneruskan argumen ke binary yang sama dan berjalan di bawah Node ini.
const ELECTRON_CLI = path.join(__dirname, '..', '..', 'node_modules', 'electron', 'cli.js');
const CHECK = path.join(__dirname, 'db-store-check.cjs');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fathoni-dbstore-'));
const dataDir = path.join(base, 'profile');
fs.mkdirSync(dataDir, { recursive: true });

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

function runPhase(phase) {
  console.log(`\n──────── fase ${phase} ────────`);
  const res = spawnSync(process.execPath, [ELECTRON_CLI, CHECK], {
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
    cwd: path.join(__dirname, '..', '..'),
    env: Object.assign({}, process.env, {
      HEMS_DATA_DIR: dataDir,
      HEMS_HARNESS_PHASE: phase,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    }),
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  out.split(/\r?\n/).filter(Boolean).forEach(line => {
    if (/^(PASS|FAIL|RENDERER|TIMEOUT|HARNESS ERROR|SEED-DONE|FLUSH-MARK|===)/.test(line)) console.log(line);
  });
  const flushMark = /FLUSH-MARK (\d+)/.exec(out);
  ok(`fase ${phase}: proses keluar dengan bersih`, res.status === 0 && !res.error,
    { status: res.status, error: res.error && String(res.error), out: out.slice(-500) });
  return { out, status: res.status, flushMark };
}

// Fase seed: app boot sekali di folder kosong, lalu seed localStorage ditanam.
const seed = runPhase('seed');
ok('fase seed selesai dengan bersih', seed.status === 0, { status: seed.status });
ok('seed tertanam di profil sementara', /SEED-DONE/.test(seed.out));

// File database hasil boot pertama dibuang supaya fase import benar-benar
// memulai dari SQLite kosong, seperti profil pengguna yang baru naik versi.
fs.readdirSync(dataDir).forEach(name => {
  if (/^fathoni\.db/.test(name)) fs.rmSync(path.join(dataDir, name), { force: true });
});
ok('file database dibuang sebelum fase import', !fs.existsSync(path.join(dataDir, 'fathoni.db')));

const imported = runPhase('import');
ok('fase import selesai dengan bersih', imported.status === 0, { status: imported.status });
const quitMs = imported.flushMark ? Date.now() - Number(imported.flushMark[1]) : Number.MAX_SAFE_INTEGER;
ok('quit tidak menggantung (handshake flush <= 6 detik)', quitMs <= 6000, { quitMs });

const verified = runPhase('verify');
ok('fase verify selesai dengan bersih', verified.status === 0, { status: verified.status });

const all = seed.out + imported.out + verified.out;
const phasePass = (all.match(/^PASS /gm) || []).length;
const phaseFail = (all.match(/^FAIL /gm) || []).length;
console.log(`\n=== db-store-check: ${phasePass + passed} lulus, ${phaseFail + failed} gagal ===`);

if (!process.env.HEMS_KEEP_TMP) fs.rmSync(base, { recursive: true, force: true });
else console.log('folder data uji dipertahankan:', base);

process.exit(phaseFail + failed === 0 ? 0 : 1);
