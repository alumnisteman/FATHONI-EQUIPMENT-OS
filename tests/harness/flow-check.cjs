// TEMP harness #3 (dihapus setelah dipakai): alur login nyata lewat UI React —
// login, layar wajib ganti password, pemulihan sesi setelah reload, dan halaman
// Pengguna yang membaca akun dari main process.
const { app } = require('electron');
const selesai = require('./selesai.cjs');

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, extra) {
  if (cond) { pass++; lines.push('PASS ' + name); }
  else { fail++; lines.push('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
  console.log(lines[lines.length - 1]);
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const HELPERS = `
  function setVal(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function byText(re, tag) {
    return [...document.querySelectorAll(tag || 'button')].find(x => re.test(x.innerText));
  }
`;

// executeJavaScript menolak `return` di top level, jadi setiap potongan dibungkus.
function ev(wc, body) {
  return wc.executeJavaScript(`(async () => { ${HELPERS}\n${body} })()`);
}

function typeInto(wc, pairs) {
  const code = Object.entries(pairs).map(([sel, val]) =>
    `setVal(document.querySelector(${JSON.stringify(sel)}), ${JSON.stringify(val)});`).join('\n');
  return ev(wc, `${code}\nreturn true;`);
}

function clickText(wc, re) {
  return ev(wc, `const b = byText(${re}); if (b) b.click(); return b ? 'ok' : 'not-found';`);
}

// scrypt sengaja berat: satu verifikasi bisa memakan detik pada mesin kecil,
// jadi setiap langkah menunggu kondisi, bukan waktu tetap.
async function waitFor(wc, expr, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await ev(wc, `return !!(${expr});`);
    if (value) return true;
    await wait(250);
  }
  console.log(`TIMEOUT menunggu: ${label}`);
  return false;
}

async function bodyText(wc) {
  return ev(wc, `return document.body.innerText;`);
}

let captured = null;
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev2, _lvl, msg) => {
    if (/error|uncaught|failed/i.test(msg)) console.log('RENDERER:', msg.slice(0, 300));
  });
  if (!captured && wc.getType() === 'window') {
    captured = wc;
    wc.once('did-finish-load', () => run(wc).catch(async err => {
      console.log('HARNESS ERROR', err && err.message);
      try {
        console.log('DOM:', JSON.stringify((await ev(wc, 'return document.body.innerText.slice(0,300);'))));
      } catch { /* abaikan */ }
      selesai(app, 2);
    }));
  }
});

async function run(wc) {
  await wait(500);
  await ev(wc, `
    localStorage.setItem('hems_business_modes', JSON.stringify({ modes: ['DEALER'], customMenus: [], isSetupComplete: true }));
    localStorage.removeItem('hems_session');
    return true;`);
  await wc.reload();
  await wait(1000);

  // 1. petunjuk kredensial plaintext sudah hilang
  const hint = await ev(wc, `return document.querySelector('.login-demo')?.innerText || '';`);
  ok('tidak ada teks Demo: admin/admin123', !/admin123/.test(hint), hint);
  ok('petunjuk desktop menjelaskan penguncian akun', /mengunci akun/i.test(hint), hint);

  // 2. login salah menampilkan pesan dari main process
  await typeInto(wc, { '#login-username': 'admin', '#login-password': 'salah123456' });
  ok('kredensial salah terbaca di form', await waitFor(wc,
    `document.querySelector('#login-username')?.value === 'admin' && document.querySelector('#login-password')?.value === 'salah123456'`,
    'isi form langkah 2'));
  await clickText(wc, '/Masuk ke FATHONI/');
  const msg1 = await waitFor(wc, `!!document.querySelector('.login-error')`, 'pesan login salah');
  const err1 = await ev(wc, `return document.querySelector('.login-error')?.innerText || '';`);
  ok('pesan login salah tampil', msg1 && /salah|terkunci/i.test(err1), err1);

  // 3. login benar -> layar wajib ganti password, bukan dashboard
  await typeInto(wc, { '#login-username': 'admin', '#login-password': 'admin123' });
  ok('kredensial benar terbaca di form', await waitFor(wc,
    `document.querySelector('#login-username')?.value === 'admin' && document.querySelector('#login-password')?.value === 'admin123'`,
    'isi form langkah 3'));
  await clickText(wc, '/Masuk ke FATHONI/');
  ok('login benar menuju layar ganti password', await waitFor(wc,
    `/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'hasil login benar', 45000));
  const gated = await bodyText(wc);
  ok('layar wajib ganti password muncul', /Ganti password sebelum melanjutkan/.test(gated), gated.slice(0, 140));
  ok('navigasi aplikasi tidak ditampilkan saat terkunci', !/Control Tower|Pelanggan|Laporan/.test(gated), gated.slice(0, 220));

  // 4. menu lain tetap terkunci
  await ev(wc, `window.location.hash = '#/units'; return true;`);
  await wait(800);
  const stillGated = await bodyText(wc);
  ok('navigasi menu tidak melewati layar ganti password', /Ganti password sebelum melanjutkan/.test(stillGated), stillGated.slice(0, 140));

  // 5. password baru lemah ditolak (validasi cepat di sisi renderer)
  await typeInto(wc, { '#cpw-current': 'admin123', '#cpw-next': 'pendek', '#cpw-confirm': 'pendek' });
  ok('form ganti password terbaca', await waitFor(wc,
    `document.querySelector('#cpw-next')?.value === 'pendek'`, 'isi form langkah 5'));
  await clickText(wc, '/Simpan password baru/');
  ok('validasi panjang muncul', await waitFor(wc, `!!document.querySelector('.cpw-error')`, 'error pendek'));
  const weakErr = await ev(wc, `return document.querySelector('.cpw-error')?.innerText || '';`);
  ok('password lemah ditolak di UI', /minimal 8/i.test(weakErr), weakErr);

  // 6. konfirmasi tidak sama
  await typeInto(wc, { '#cpw-current': 'admin123', '#cpw-next': 'BaruSekali12', '#cpw-confirm': 'Berbeda123' });
  await clickText(wc, '/Simpan password baru/');
  await wait(600);
  const mismatch = await ev(wc, `return document.querySelector('.cpw-error')?.innerText || '';`);
  ok('konfirmasi tidak sama ditolak', /tidak sama/i.test(mismatch), mismatch);

  // 7. ganti password berhasil -> aplikasi terbuka
  await typeInto(wc, { '#cpw-current': 'admin123', '#cpw-next': 'BaruSekali12', '#cpw-confirm': 'BaruSekali12' });
  await clickText(wc, '/Simpan password baru/');
  ok('pergantian password diterima', await waitFor(wc,
    `!/Ganti password sebelum melanjutkan/.test(document.body.innerText)`, 'gate hilang'));
  const after = await bodyText(wc);
  ok('layar ganti password hilang setelah berhasil', !/Ganti password sebelum melanjutkan/.test(after));
  ok('dashboard terbuka', /Dasbor|Armada|Kontrol/i.test(after), after.slice(0, 140));

  // 8. sesi disimpan sebagai token, key lama hilang
  const stored = await ev(wc, `
    const raw = localStorage.getItem('hems_session_v2');
    return { v2: !!raw, legacy: localStorage.getItem('hems_session'), token: raw ? JSON.parse(raw).token : null };`);
  ok('sesi baru tersimpan', stored.v2 === true && typeof stored.token === 'string' && stored.token.length >= 32, stored);
  ok('key sesi lama dibersihkan', stored.legacy === null, stored.legacy);
  ok('token tidak berupa password', !/BaruSekali12/.test(String(stored.token)));

  // 9. reload -> sesi dipulihkan tanpa login ulang
  await wc.reload();
  ok('aplikasi terbuka lagi dengan sesi tersimpan', await waitFor(wc,
    `!/Masuk ke FATHONI/.test(document.body.innerText) && document.body.innerText.length > 40`, 'boot dengan sesi', 40000));
  const afterReload = await bodyText(wc);
  ok('sesi dipulihkan setelah reload', !/Masuk ke FATHONI/.test(afterReload), afterReload.slice(0, 180));
  ok('tidak kembali ke layar wajib ganti password', !/Ganti password sebelum melanjutkan/.test(afterReload));

  // 10. halaman Pengguna membaca akun nyata dari main process
  await ev(wc, `window.location.hash = '#/users'; return true;`);
  ok('halaman Pengguna termuat', await waitFor(wc,
    `/admin/.test(document.body.innerText) && !/Memuat daftar akun/.test(document.body.innerText)`, 'daftar akun', 30000));
  const usersText = await bodyText(wc);
  ok('daftar akun asli dimuat', /\bsales\b|\bfinance\b/.test(usersText), usersText.slice(0, 240));
  ok('nama pengguna demo lama hilang', !/Sari Wulandari|Rudi Hermawan|Dewi Kusuma/.test(usersText));
  ok('username tampil di tabel', /\bgudang\b/.test(usersText), usersText.slice(0, 240));

  // 11. membuat akun baru lewat UI
  const addBtn = await clickText(wc, '/Tambah Pengguna/');
  await wait(800);
  const filled = await ev(wc, `
    setVal(document.querySelector('.modal input[placeholder="mis. mekanik1"]'), 'operator1');
    setVal(document.querySelectorAll('.modal input[type=text]')[1], 'Operator Satu');
    setVal(document.querySelector('.modal input[type=email]'), 'op1@fathoni.id');
    setVal(document.querySelector('#acct-password'), 'Operator123');
    const s = document.querySelector('.modal form button[type=submit]');
    if (!s) return 'no-submit';
    s.click();
    return 'submitted';`);
  ok('akun baru muncul di daftar', await waitFor(wc,
    `/operator1/.test(document.body.innerText)`, 'akun operator1', 30000));
  const created = await bodyText(wc);
  ok('pembuatan akun lewat UI lengkap', addBtn === 'ok' && filled === 'submitted' && /operator1/.test(created),
     { addBtn, filled, created: created.slice(0, 200) });

  // 12. akun baru bisa login dengan password yang dibuat
  const loginNew = await ev(wc, `return await window.electronAPI.login('operator1', 'Operator123');`);
  ok('akun hasil UI dapat login', loginNew && loginNew.success === true, loginNew);

  // 13. akun non-super-admin tidak bisa membuka pengelolaan akun
  const salesLogin = await ev(wc, `return await window.electronAPI.login('sales', 'sales123');`);
  const notAllowed = salesLogin.success === false
    ? 'kunci-default'
    : (await ev(wc, `return await window.electronAPI.listAccounts(${JSON.stringify(salesLogin.token)});`)).success === false;
  ok('akun non-super-admin ditolak saat mengelola akun', notAllowed === true || notAllowed === 'kunci-default', notAllowed);

  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

require('../../dist-electron/main.js');
