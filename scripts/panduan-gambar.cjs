// scripts/panduan-gambar.cjs
// Perkakas baca-saja untuk penulis dokumentasi: membuka aplikasi pada profil
// sementara dan menyimpan tangkapan layar tiap jendela "buat record" ke
// panduan-gambar/, supaya Bab 13 PANDUAN_PENGGUNA.html bisa menunjukkan form
// sungguhan alih-alih hanya menamainya.
//
// Bukan langkah regresi: tidak mencetak assertion dan tidak dinilai
// tests/harness/regressi.sh. Karena itu ia tinggal di scripts/ — penjaga
// §15 (validation-check) mewajibkan setiap berkas Electron di tests/harness
// menjadi langkah rantai atau didaftarkan sebagai perkakas.
//
// Tidak ada satu pun tombol simpan yang diklik: yang dilakukan hanya login,
// membuka jendela form, memotret, lalu menutupnya. Satu-satunya tulis ke
// database adalah satu baris merek sementara yang dibuang lagi di akhir
// (form Model menolak terbuka tanpa merek di katalog).
//
// Cara menjalankan (satu proses Electron pada satu waktu):
//   HEMS_DATA_DIR=D:/SANY/tmp-harness/r-panduan \
//     node_modules/electron/dist/electron.exe scripts/panduan-gambar.cjs

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'panduan-gambar');
const selesai = require('../tests/harness/selesai.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const HELPERS = `
  function set(el, v) {
    if (!el) throw new Error('kolom tidak ada di layar');
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function byText(re, tag) {
    return [...document.querySelectorAll(tag || 'button')].find(x => re.test((x.innerText || '').trim()));
  }
  function klik(re) {
    const b = byText(re);
    if (!b) return 'TIDAK ADA TOMBOL ' + re + ' | tombol=' +
      [...document.querySelectorAll('button')].map(x => (x.innerText || '').trim()).filter(Boolean).slice(0, 25).join(' / ');
    b.click();
    return 'ok';
  }
  function judul() {
    const el = document.querySelector('.modal-title');
    return el ? el.innerText.trim() : null;
  }
  function tutup() {
    const b = document.querySelector('.modal-backdrop');
    if (b) b.click();
    return !document.querySelector('.modal-title');
  }
  function teks() { return document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160); }
`;

function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`);
}

// Urutan = urutan Bab 13. `rute` diisi hash renderer, `pemicu` tombolnya,
// `judul` teks persis di kepala jendela — ketiganya diperiksa, jadi kalau salah
// satu berubah alat ini berhenti dengan pesan, bukan menghasilkan gambar salah.
const FORM = [
  { file: '13-6-tambah-pengguna.png', rute: '#/users', pemicu: 'Tambah Pengguna$', judul: 'Tambah Pengguna Baru' },
  { file: '13-7-tambah-merek.png', rute: '#/brands', pemicu: '^Tambah Merek$', judul: 'Tambah Merek Baru' },
  { file: '13-7-tambah-model.png', rute: '#/brands', tab: 'Spesifikasi Model Unit', pemicu: '^Tambah Model Unit$', judul: 'Tambah Model Unit Baru' },
  { file: '13-8-tambah-suku-cadang.png', rute: '#/spareparts', pemicu: 'Tambah Spare Part$', judul: 'Tambah Data Suku Cadang' },
  { file: '13-8-mutasi-gudang.png', rute: '#/warehouse', pemicu: 'Catat Mutasi Stok$', judul: 'Catat Mutasi Masuk / Keluar Gudang' },
];

const MEREK_UJI = { id: 'PG-BRAND-1', name: 'SANY', country: 'Tiongkok', category: 'Excavator' };

async function waitFor(wc, expr, label, timeoutMs = 40000) {
  const mulai = Date.now();
  while (Date.now() - mulai < timeoutMs) {
    if (await ev(wc, `return !!(${expr});`)) return true;
    await wait(250);
  }
  console.log('GAGAL menunggu: ' + label + ' || layar: ' + await ev(wc, `return teks();`));
  return false;
}

async function potret(wc, file) {
  const image = await wc.capturePage();
  const buf = image.toPNG();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), buf);
  const u = image.getSize();
  console.log(`TERTULIS ${file} ${buf.length} byte ${u.width}x${u.height} (skala ${u.width / 1125})`);
}

async function run(wc) {
  const win = BrowserWindow.fromWebContents(wc);
  let gagal = 0;

  console.log('LANGKAH 1 tunggu layar login');
  if (!await waitFor(wc, `!!document.querySelector('#login-username') && !!document.querySelector('#login-password')`, 'form login')) {
    return selesai(app, 1);
  }
  console.log('LANGKAH 2 masuk ' + await ev(wc, `
    set(document.querySelector('#login-username'), 'admin');
    set(document.querySelector('#login-password'), 'admin123');
    return klik(/Masuk ke FATHONI/);`));
  console.log('LANGKAH 3 gerbang password ' + await waitFor(wc, `/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'gerbang'));
  console.log('LANGKAH 4 ganti password ' + await ev(wc, `
    set(document.querySelector('#cpw-current'), 'admin123');
    set(document.querySelector('#cpw-next'), 'Panduan2026x');
    set(document.querySelector('#cpw-confirm'), 'Panduan2026x');
    return klik(/Simpan password baru/);`));
  if (!await waitFor(wc, `!/Ganti password sebelum melanjutkan/.test(document.body.innerText) && (/Selamat Datang/.test(document.body.innerText) || !!document.querySelector('.sidebar-item'))`, 'setelah gerbang')) {
    return selesai(app, 1);
  }

  // Profil baru selalu berhenti di layar "Selamat Datang ... Pilih satu atau
  // lebih profil" sebelum shell muncul. Layar itu bukan bagian yang dipotret,
  // jadi profil bisnis ditandai selesai lewat localStorage yang sama dipakai
  // halaman pengaturan, lalu renderer dimuat ulang.
  console.log('LANGKAH 5 profil bisnis ' + await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    return 'ok';`));
  await wc.reload();
  if (!await waitFor(wc, `!!document.querySelector('.sidebar-item') && document.body.innerText.length > 300`, 'shell')) {
    return selesai(app, 1);
  }

  // Katalog merek harus punya satu baris supaya jendela Model bisa dibuka;
  // ditulis lewat jalur database lalu renderer dimuat ulang agar hidrasinya
  // membaca ulang SQLite (menulis setelah boot tidak terlihat halaman).
  console.log('LANGKAH 6 seed merek ' + JSON.stringify(await ev(wc, `
    return window.electronAPI.dbPatch({ brands: { upsert: [${JSON.stringify(MEREK_UJI)}], removeIds: [] } });`)));
  await wc.reload();
  if (!await waitFor(wc, `!!document.querySelector('.sidebar-item') && document.body.innerText.length > 300`, 'shell setelah seed')) {
    return selesai(app, 1);
  }

  // Lebar konten 1125 = lebar jendela tangkapan contoh pembaca, jadi semua
  // gambar panduan punya skala yang sama.
  win.setContentSize(1125, 809);
  win.center();
  win.focus();
  await wait(500);

  for (const f of FORM) {
    await ev(wc, `window.location.hash = '${f.rute}'; return true;`);
    await wait(500);
    // Tab dipilih lebih dulu: di halaman Merek & Model tombol pemicunya baru
    // bernama "Tambah Model Unit" setelah tab Model aktif.
    if (f.tab) {
      console.log('TAB ' + await ev(wc, `return klik(/${f.tab}/);`));
      await wait(600);
    }
    if (!await waitFor(wc, `!!byText(/${f.pemicu}/)`, `tombol ${f.file}`, 25000)) { gagal++; continue; }
    console.log('BUKA ' + f.judul + ' ' + await ev(wc, `return klik(/${f.pemicu}/);`));
    if (!await waitFor(wc, `judul() === ${JSON.stringify(f.judul)}`, `jendela ${f.judul}`, 20000)) { gagal++; continue; }
    await wait(700);
    await potret(wc, f.file);
    await ev(wc, `return tutup();`);
    if (!await waitFor(wc, `!document.querySelector('.modal-title')`, `tutup ${f.judul}`, 10000)) { gagal++; }
    await wait(250);
  }

  console.log('BERSIH ' + JSON.stringify(await ev(wc, `
    return window.electronAPI.dbPatch({ brands: { upsert: [], removeIds: ['${MEREK_UJI.id}'] } });`)));
  console.log(`\n=== panduan-gambar: ${FORM.length - gagal} dari ${FORM.length} potret, ${gagal} gagal ===`);
  selesai(app, gagal === 0 ? 0 : 1);
}

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    wc.once('did-finish-load', () => run(wc).catch((err) => {
      console.log('ALAT ERROR', err && (err.stack || err.message));
      ev(wc, `return teks();`).then((t) => console.log('LAYAR:', t)).catch(() => { /* jendela sudah tertutup */ });
      selesai(app, 2);
    }));
  }
});
app.on('window-all-closed', () => { /* biarkan alat memutuskan sendiri */ });

require('../dist-electron/main.js');
app.whenReady().then(() => { /* main.js yang membuka jendela */ });
