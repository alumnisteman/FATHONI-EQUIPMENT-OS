// tests/harness/smoke-paket-check.cjs
// Uji asap terhadap FATHONI.exe HASIL PAKET (bukan jalur dev), di profil sandbox.
//
// Kenapa sandbox wajib: packaged build mem-pin folder datanya di
// electron/main.ts (hems-heavy-equipment-system di %APPDATA%) supaya pergantian
// nama aplikasi tidak pernah memindahkan database pengguna. Variabel APPDATA yang
// kita override tidak didengar Electron — Windows mengambil folder profil dari API
// shell, bukan dari environment anak. Karena itu paket dipakai --user-data-dir,
// switch resmi Chromium yang juga dihormati pin tersebut, sehingga profil uji
// berada di tmp-harness\appdata-smoke dan password admin serta jejak audit
// pengguna nyata tidak tersentuh.
//
// Sandbox diisi salinan arsip localStorage pra-SQLite bila tersedia, sehingga
// jalur sekali-impor (11 baris asli, baris contoh dibuang) ikut teruji. Tanpa
// arsip, profil kosong dipakai dan yang teruji adalah jalur instalasi baru.
//
// Perlu paket: npm run make:installer (atau npm run dist:dir). Tanpa paket,
// harness melaporkan LEWAT dan tidak menjadikan rantai regresi rusak.
//
// Jalankan: node tests/harness/smoke-paket-check.cjs

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..', '..');
const EXE = path.join(ROOT, 'dist-app', 'win-unpacked', 'FATHONI.exe');
const SANDBOX = path.join(ROOT, 'tmp-harness', 'appdata-smoke');
const NAMA_PROFIL = 'hems-heavy-equipment-system';
const PROFIL = path.join(SANDBOX, NAMA_PROFIL);
const DB = path.join(PROFIL, 'fathoni.db');
// Arsip pra-SQLite untuk menguji jalur impor. Sumbernya salinan profil nyata yang
// dibuat sebelum migrasi; bila hilang, uji tetap jalan sebagai instalasi baru.
const ARSIP = process.env.SMOKE_ARSIP || 'C:\\tmp\\profil-live-sebelum-3.0.0';
const PORT = 9223;
const PASSWORD = 'SandiSmokeTest';

// Kunci localStorage yang sah ditulis di mode desktop. Apa pun di luar daftar ini
// berarti ada kode yang masih memperlakukan localStorage sebagai tempat data —
// persis cacat yang ditemukan uji asap ini pada pertama kali: probe healthCheck
// menulis kunci '_hems_health_test_' setiap siklus sehingga arsip lama terus
// bertambah.
const DI_IZINKAN = new Set([
  'set:hems_session_v2', 'del:hems_session_v2',   // token sesi aktif
  'del:hems_session',                             // sesi lama berbentuk JSON polos dibuang
  'set:hems_data_migration_v1',                   // penanda impor sekali jalan
]);

let lulus = 0, gagal = 0;
const ok = (n, c, e) => {
  if (c) { lulus++; console.log('PASS ' + n); }
  else { gagal++; console.log('FAIL ' + n + (e !== undefined ? ' -> ' + JSON.stringify(e) : '')); }
};
const tunggu = (ms) => new Promise(r => setTimeout(r, ms));

// ── CDP minimal ────────────────────────────────────────────────
let ws, urutan = 0;
const kirim = (method, params) => new Promise((res, rej) => {
  const id = ++urutan;
  const pada = (ev) => {
    const pesan = JSON.parse(ev.data);
    if (pesan.id !== id) return;
    ws.removeEventListener('message', pada);
    if (pesan.error) rej(new Error(pesan.error.message));
    else res(pesan.result);
  };
  ws.addEventListener('message', pada);
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  setTimeout(() => { ws.removeEventListener('message', pada); rej(new Error('CDP timeout: ' + method)); }, 60000);
});

const evaluasi = async (ekspresi) => {
  // Runtime.evaluate menerima EXPRESI, bukan isi fungsi. Semua snippet di bawah
  // memakai `return`, jadi dibungkus IIFE; tanpa ini Chrome mengirim SyntaxError
  // di exceptionDetails dan hasilnya selalu undefined.
  const r = await kirim('Runtime.evaluate', {
    expression: '(() => {' + ekspresi + '})()',
    awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error('Renderer menolak snippet: ' +
      (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result && r.result.value;
};

async function nilai(di) {
  // Boot paket di mesin 3,8 GB bisa puluhan detik; polled sampaiSnippet bernilai benar.
  for (let x = 0; x < 60; x++) {
    const r = await evaluasi(di);
    if (r) return r;
    await tunggu(500);
  }
  return false;
}

const SET = `
  function setVal(el,v){const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));}
  function byText(re,t){return [...document.querySelectorAll(t||'button')].find(x=>re.test((x.innerText||'').trim()));}`;

// Ukuran berkas DATA leveldb (LOG/LOCK/CURRENT ditulis ulang Chromium setiap
// jendela dibuka, jadi tidak membuktikan apa pun).
const sidil = (dir) => JSON.stringify(
  Object.fromEntries(fs.readdirSync(dir).sort()
    .filter(f => /\.log$|\.ldb$/i.test(f) && !/^LOG$/i.test(f))
    .map(f => [f, fs.statSync(path.join(dir, f)).size])));

function siapkanSandbox() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(PROFIL, { recursive: true });
  const sumber = path.join(ARSIP, 'Local Storage');
  if (fs.existsSync(sumber)) {
    fs.cpSync(sumber, path.join(PROFIL, 'Local Storage'), { recursive: true });
    return 'impor';
  }
  return 'instalasi-baru';
}

// ── mulai ──────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(EXE)) {
    console.log('LEWAT smoke-paket: paket belum dibangun (' + EXE + '). Jalankan npm run make:installer.');
    console.log(`\n=== smoke-paket: ${lulus} lulus, ${gagal} gagal ===`);
    console.log('SELESAI kode=0');
    return process.exit(0);
  }
  ok('0.1 paket ada', true);

  const mode = siapkanSandbox();
  console.log('INFO mode profil sandbox:', mode, '| sandbox:', PROFIL);
  // Profil nyata tidak boleh tersentuh sama sekali; kalau sandbox bekerja, isi
  // leveldb profil live tidak berubah selama uji.
  const profilLive = path.join(process.env.APPDATA, NAMA_PROFIL, 'Local Storage', 'leveldb');
  const sebelumLive = fs.existsSync(profilLive) ? sidil(profilLive) : '(tidak ada)';

  const anak = spawn(EXE, [`--user-data-dir=${PROFIL}`, `--remote-debugging-port=${PORT}`], {
    detached: true, stdio: 'ignore',
  });
  console.log('INFO PID', anak.pid);
  let mati = false;
  anak.on('exit', (kode, sinyal) => { mati = true; console.log('INFO proses keluar', kode, sinyal); });

  try {
    let target = null;
    for (let x = 0; x < 60 && !target; x++) {
      await tunggu(500);
      try {
        const daftar = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = daftar.find(t => t.type === 'page' && /index\.html|file:\/\/|localhost/.test(t.url));
      } catch { /* port belum dibuka */ }
    }
    ok('1.1 jendela renderer tersedia lewat CDP', !!target, target && target.url);
    if (!target) throw new Error('tidak ada target CDP');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    await kirim('Runtime.enable');

    const judul = await nilai(`${SET} return /FATHONI/i.test(document.title) ? document.title : null;`);
    ok('1.2 halaman ter-render dari dalam paket', !!judul, judul);

    // Pencatat tulis localStorage dipasang SEBELUM login. Ukuran berkas tidak bisa
    // dipakai sebagai bukti: Chromium menambah WAL untuk setiap tulis, termasuk
    // tulis sesi yang memang sah.
    await evaluasi(`${SET}
      window.__ulis = [];
      const asliSet = Storage.prototype.setItem, asliDel = Storage.prototype.removeItem;
      Storage.prototype.setItem = function(k,v){ window.__ulis.push('set:'+k); return asliSet.call(this,k,v); };
      Storage.prototype.removeItem = function(k){ window.__ulis.push('del:'+k); return asliDel.call(this,k); };
      return true;`);

    ok('2.1 layar login muncul', await nilai(`${SET} return !!document.querySelector('#login-username');`));

    await evaluasi(`${SET}
      setVal(document.querySelector('#login-username'),'admin');
      setVal(document.querySelector('#login-password'),'admin123');
      const b=byText(/Masuk/); if(b)b.click(); return !!b;`);
    ok('2.2 login diterima main process lalu gerbang ganti password tampil',
      await nilai(`${SET} return !!document.querySelector('#cpw-next');`));

    await evaluasi(`${SET}
      setVal(document.querySelector('#cpw-current'),'admin123');
      setVal(document.querySelector('#cpw-next'),'${PASSWORD}');
      setVal(document.querySelector('#cpw-confirm'),'${PASSWORD}');
      const b=byText(/Simpan password/); if(b)b.click(); return !!b;`);
    ok('2.3 aplikasi terbuka setelah ganti password',
      await nilai(`${SET} return !document.querySelector('#cpw-next') && /Dasbor|Armada|Kontrol/i.test(document.body.innerText);`));

    const adaIsi = mode === 'impor';
    for (const [rute, nama, mika] of [
      ['#/suppliers', 'Pemasok', true], ['#/purchase', 'Pembelian', true],
      ['#/warehouse', 'Gudang', true], ['#/units', 'Armada', false],
    ]) {
      await evaluasi(`${SET} window.location.hash='${rute}'; return true;`);
      await nilai(`${SET} return document.querySelectorAll('tbody tr').length > 0 || document.body.innerText.length > 400;`);
      await tunggu(700);
      const u = await evaluasi(`${SET}
        const baris=document.querySelectorAll('tbody tr').length;
        const kartu=document.querySelectorAll('.card, .unit-card, [class*=card]').length;
        const docGulir=document.documentElement.scrollWidth-document.documentElement.clientWidth;
        return {baris, kartu, teks:document.body.innerText.length, docGulir,
                galat:/gagal|tidak dapat|rusak/i.test(document.body.innerText)};`);
      console.log(`INFO ${nama}: ${JSON.stringify(u)}`);
      const berisi = u.baris > 0 || u.kartu > 0;
      if (adaIsi && mika) ok(`3.x ${nama} menampilkan baris hasil impor`, berisi, u);
      else ok(`3.x ${nama} ter-render tanpa pesan kegagalan`, u.teks > 400 && !u.galat, u);
      ok(`3.x ${nama} tidak memotong dokumen di lebar jendela`, u.docGulir <= 2, u.docGulir);
    }

    // Halaman Jejak Audit dulu menayangkan baris karangan. Di paket ini isinya
    // harus kejadian yang baru saja terjadi.
    await evaluasi(`${SET} window.location.hash='#/audit-log'; return true;`);
    await tunggu(1200);
    const log = await evaluasi(`${SET} return { baris: document.querySelectorAll('tbody tr').length, teks: document.body.innerText };`);
    console.log('INFO Jejak Audit: baris =', log.baris);
    ok('3.x Jejak Audit menampilkan LOGIN_OK yang sungguh terjadi', /Login berhasil/.test(log.teks), log.teks.slice(0, 160));
    ok('3.x Jejak Audit menampilkan PASSWORD_CHANGED dari langkah login barusan', /Password diganti/.test(log.teks));
    ok('3.x Jejak Audit tidak memuat log karangan', !/AUDIT-00\d|Simulate/i.test(log.teks));

    const tulisan = await evaluasi(`${SET} return window.__ulis;`) || [];
    console.log('INFO tulis localStorage selama sesi:', JSON.stringify([...new Set(tulisan)]));
    const arsanka = [...new Set(tulisan.filter(k => !DI_IZINKAN.has(k)))];
    ok('4.1 tidak ada kunci arsip lama yang ditulis aplikasi', arsanka.length === 0, arsanka);
    ok('4.2 healthCheck tidak menulis probe ke localStorage di mode desktop',
      !tulisan.some(k => k.includes('health_test')), tulisan);

    try { execFileSync('taskkill', ['/PID', String(anak.pid)], { stdio: 'pipe' }); } catch { /* sudah keluar */ }
    for (let x = 0; x < 60 && !mati; x++) await tunggu(500);
  } finally {
    if (!mati) { try { execFileSync('taskkill', ['/PID', String(anak.pid)], { stdio: 'pipe' }); } catch { } }
    for (let x = 0; x < 60 && !mati; x++) await tunggu(500);
    try { ws && ws.close(); } catch { /* sudah tertutup */ }
  }

  ok('5.1 proses keluar setelah jendela ditutup', mati);
  // Keluar bersih = tidak ada -wal yang tertinggal. SQLite menghapus berkas itu
  // setelah checkpoint, jadi "tidak ada" sama benarnya dengan "ukurannya nol".
  const adaWal = fs.existsSync(DB + '-wal');
  ok('5.2 WAL database di-checkpoint saat keluar', !adaWal || fs.statSync(DB + '-wal').size === 0,
    { walAda: adaWal, walBytes: adaWal ? fs.statSync(DB + '-wal').size : 0 });

  // ── keadaan file sandbox setelah aplikasi mati ──
  const db = new DatabaseSync(DB, { readOnly: true });
  const meta = Object.fromEntries(db.prepare('SELECT key,value FROM db_meta').all().map(r => [r.key, r.value]));
  const ringkas = {};
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('db_meta','sqlite_sequence') ORDER BY name")
    .all().map(r => r.name)) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    if (n) ringkas[t] = n;
  }
  db.close();
  const total = Object.values(ringkas).reduce((a, b) => a + b, 0);
  console.log('INFO collection berisi:', JSON.stringify(ringkas));
  console.log('INFO db_meta:', JSON.stringify(meta));

  ok('6.1 penanda impor localStorage terpasang', !!meta.localStorageImportedAt, meta);
  ok('6.2 versi skema tercatat', Number(meta.schema_version) >= 1, meta.schema_version);
  if (mode === 'impor') {
    ok('6.3 hanya baris asli yang berpindah (11 baris: pemasok/PO/gudang)', total === 11, { total, ringkas });
    ok('6.4 baris contoh tidak ikut berpindah',
      !ringkas.units && !ringkas.customers && !ringkas.sales, ringkas);
  } else {
    ok('6.3 instalasi baru mulai dari database kosong', total === 0, ringkas);
  }

  const mentah = fs.readFileSync(path.join(PROFIL, 'accounts.json'), 'utf8');
  ok('6.5 accounts.json tidak memuat password plaintext', !/"password"\s*:\s*"[^"]+"/.test(mentah));
  ok('6.6 accounts.json memuat hash dan salt', /"hash"/.test(mentah) && /"salt"/.test(mentah));

  const profilSandbox = path.join(PROFIL, 'Local Storage', 'leveldb');
  console.log('INFO isi leveldb sandbox:', fs.existsSync(profilSandbox) ? sidil(profilSandbox) : '(tidak dibuat)');
  const sesudahLive = fs.existsSync(profilLive) ? sidil(profilLive) : '(tidak ada)';
  ok('7.1 profil pengguna nyata tidak tersentuh (uji berjalan dengan --user-data-dir)',
    sebelumLive === sesudahLive, { sebelumLive, sesudahLive });

  console.log(`\n=== smoke-paket: ${lulus} lulus, ${gagal} gagal ===`);
  console.log('SELESAI kode=' + (gagal === 0 ? 0 : 1));
  process.exit(gagal === 0 ? 0 : 1);
})();
