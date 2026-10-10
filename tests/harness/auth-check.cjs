// TEMP harness (dihapus setelah dipakai): menguji electron/auth.ts hasil build
// di folder userData sementara, tanpa membuka jendela.
const { app } = require('electron');
const selesai = require('./selesai.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fathoni-auth-'));
app.setPath('userData', path.join(tmp, 'data'));

let pass = 0, fail = 0;
const checks = [];
function ok(name, cond, extra) {
  if (cond) { pass++; checks.push('PASS ' + name); }
  else {
    fail++;
    checks.push('FAIL ' + name + (extra !== undefined && extra !== null ? ' -> ' + JSON.stringify(extra) : ''));
    console.log('FAIL ' + name + (extra !== undefined && extra !== null ? ' -> ' + JSON.stringify(extra) : ''));
  }
}

async function main() {
  const auth = require('../../dist-electron/auth.js');
  await auth.initAuth();

  // 1. login default pertama kali: berhasil + wajib ganti password
  const r1 = await auth.login('admin', 'admin123');
  ok('login admin default', r1.success === true, r1);
  ok('token sesi diberikan', typeof r1.token === 'string' && r1.token.length >= 32, r1);
  ok('wajib ganti password', r1.user?.mustChangePassword === true, r1.user);
  const fields = Object.keys(r1.user || {});
  ok('balasan login tanpa password/hash/salt',
     !fields.some(k => /^(password|hash|salt)$/i.test(k)), fields.sort().join(','));

  // 2. username salah tidak membocorkan mana yang salah
  const r2 = await auth.login('tidakada', 'admin123');
  const r3 = await auth.login('admin', 'salah');
  ok('username tak dikenal ditolak', r2.success === false, r2);
  ok('pesan generik untuk kedua kasus',
     r2.error === r3.error, { e1: r2.error, e2: r3.error });

  // 3. lima kali salah -> terkunci (pakai gudang agar admin tetap dipakai nanti)
  let last;
  for (let i = 0; i < 5; i++) last = await auth.login('GUDANG', 'salah');
  ok('akun terkunci setelah 5x salah', /dikunci/i.test(String(last?.error)), last);
  const locked = await auth.login('gudang', 'gudang123');
  ok('login benar saat terkunci tetap ditolak', locked.success === false && /dikunci/i.test(locked.error), locked);

  // 4. sesi
  const s1 = await auth.session(r1.token);
  ok('sesi valid', s1.success === true, s1);
  ok('sesi palsu ditolak', (await auth.session('.token-not-real-abcdef')).success === false);

  // 5. ganti password + aturan
  const weak = await auth.changePassword(r1.token, 'admin123', 'pendek');
  ok('password terlalu pendek ditolak', weak.success === false, weak);
  const padded = await auth.changePassword(r1.token, 'admin123', ' spasidiawal1');
  ok('password ber spasi di ujung ditolak', padded.success === false, padded);
  const control = await auth.changePassword(r1.token, 'admin123', 'ada\tkontrol1');
  ok('password dengan karakter kontrol ditolak', control.success === false, control);
  const reuse = await auth.changePassword(r1.token, 'admin123', 'sales123');
  ok('password bawaan lain ditolak', reuse.success === false, reuse);
  const wrongOld = await auth.changePassword(r1.token, 'bukanpassword', 'BaruSekali12');
  ok('password lama salah ditolak', wrongOld.success === false, wrongOld);
  // password yang sama dengan username diuji lewat pembuatan akun (butuh >=8 char)

  // 6. ganti password menutup sesi lain pada akun yang sama
  const rB = await auth.login('admin', 'admin123');
  ok('sesi kedua dibuat', rB.success === true, rB);
  const ch = await auth.changePassword(r1.token, 'admin123', 'BaruSekali12');
  ok('ganti password berhasil', ch.success === true, ch);
  ok('sesi lain ikut tertutup', (await auth.session(rB.token)).success === false);
  const keepAlive = await auth.session(r1.token);
  ok('sesi pemakai tetap berlaku', keepAlive.success === true, keepAlive);
  ok('flag wajib ganti hilang', keepAlive.user?.mustChangePassword === false, keepAlive.user);
  ok('password lama tidak lagi diterima', (await auth.login('admin', 'admin123')).success === false);
  const rNew = await auth.login('admin', 'BaruSekali12');
  ok('password baru diterima', rNew.success === true, rNew);

  // 7. berkas akun tidak menyimpan apa pun yang bisa dibaca
  const file = path.join(tmp, 'data', 'accounts.json');
  ok('berkas akun dibuat', fs.existsSync(file));
  const raw = fs.readFileSync(file, 'utf-8');
  ok('berkas tanpa password plaintext', !raw.includes('BaruSekali12') && !raw.includes('admin123'));
  ok('berkas punya salt per akun', (raw.match(/"salt"/g) || []).length >= 5);

  // 8. hak akses: hanya SUPERADMIN
  const sales = await auth.login('sales', 'sales123');
  ok('login sales', sales.success === true, sales);
  ok('sales tidak dapat daftar akun', (await auth.listAccounts(sales.token)).success === false);
  ok('sales tidak dapat membuat akun', (await auth.saveAccount(sales.token, {
    username: 'cobabaru', name: 'Coba', email: 'c@c.id', role: 'SALES', active: true, password: 'CobaBaru123',
  })).success === false);
  ok('sales tidak dapat baca log', (await auth.auditLog(sales.token)).success === false);

  // 9. operasi akun oleh super admin
  const admin = rNew.token;
  const created = await auth.saveAccount(admin, {
    username: 'Mekanik Baru', name: 'Agus', email: 'agus@fathoni.id', role: 'SERVICE', active: true, password: 'Toler12345',
  });
  ok('username dengan spasi/kapital ditolak', created.success === false, created);
  const created2 = await auth.saveAccount(admin, {
    username: 'mekanik1', name: 'Agus', email: 'agus@fathoni.id', role: 'SERVICE', active: true, password: 'Toler12345',
  });
  ok('akun baru dibuat', created2.success === true, created2);
  ok('akun baru tidak wajib ganti password', created2.account?.mustChangePassword === false, created2.account);
  const dup = await auth.saveAccount(admin, {
    username: 'mekanik1', name: 'Lain', email: 'l@l.id', role: 'SALES', active: true, password: 'Toler12345',
  });
  ok('username ganda ditolak', dup.success === false, dup);
  const badRole = await auth.saveAccount(admin, {
    username: 'perananeh', name: 'X', email: 'x@x.id', role: 'HACKER', active: true, password: 'Toler12345',
  });
  ok('role tak dikenal ditolak', badRole.success === false, badRole);

  const passLikeUser = await auth.saveAccount(admin, {
    username: 'superadmin1', name: 'X', email: 'x@x.id', role: 'SALES', active: true, password: 'superadmin1',
  });
  ok('password sama dengan username ditolak', passLikeUser.success === false, passLikeUser);

  const list = await auth.listAccounts(admin);
  ok('daftar akun super admin', list.success === true && (list.accounts || []).length >= 6, list);
  ok('daftar akun tanpa hash', !JSON.stringify(list.accounts || []).match(/"hash"|"salt"/), null);

  // 10. nonaktifkan -> sesi mati dan login ditolak
  const mekId = created2.account?.id ?? '';
  const off = await auth.saveAccount(admin, { id: mekId, name: 'Agus', email: 'agus@fathoni.id', role: 'SERVICE', active: false });
  ok('akun dinonaktifkan', off.success === true, off);
  const mekLogin = await auth.login('mekanik1', 'Toler12345');
  ok('akun nonaktif tidak bisa login', mekLogin.success === false && /dinonaktif/i.test(mekLogin.error), mekLogin);

  // 11. perlindungan mengunci diri sendiri
  const me = (list.accounts || []).find(a => a.username === 'admin') || {};
  ok('nonaktif akun sendiri ditolak', (await auth.saveAccount(admin, { id: me.id, name: 'Admin', email: 'a@a.id', role: 'SUPERADMIN', active: false })).success === false);
  ok('turunkan role sendiri ditolak', (await auth.saveAccount(admin, { id: me.id, name: 'Admin', email: 'a@a.id', role: 'SALES', active: true })).success === false);
  ok('hapus akun sendiri ditolak', (await auth.deleteAccount(admin, me.id)).success === false);

  const madeAdmin = await auth.saveAccount(admin, { username: 'admin2', name: 'Admin Dua', email: 'ad2@f.id', role: 'SUPERADMIN', active: true, password: 'AdminDua123' });
  ok('super admin kedua dibuat', madeAdmin.success === true, madeAdmin);

  // 11b. turun role akun lain menutup sesinya, dan hak akses ikut berubah
  const ad2 = await auth.login('admin2', 'AdminDua123');
  ok('login super admin kedua', ad2.success === true, ad2);
  const demote = await auth.saveAccount(ad2.token, { id: me.id, name: 'Admin', email: 'a@a.id', role: 'SALES', active: true });
  ok('boleh turun selama ada super admin lain', demote.success === true, demote);
  ok('sesi akun yang berubah peran langsung tertutup', (await auth.session(admin)).success === false);
  const relogin = await auth.login('admin', 'BaruSekali12');
  ok('login ulang setelah turun role', relogin.success === true, relogin);
  ok('mantan super admin tidak bisa mengelola akun', (await auth.listAccounts(relogin.token)).success === false);

  const restore = await auth.saveAccount(ad2.token, { id: me.id, name: 'Admin', email: 'a@a.id', role: 'SUPERADMIN', active: true });
  ok('role dipulihkan oleh super admin lain', restore.success === true, restore);

  // 12. logout
  ok('sesi admin2 masih berlaku sebelum logout', (await auth.session(ad2.token)).success === true);
  const finance = await auth.login('finance', 'finance123');
  ok('login finance', finance.success === true, finance);
  await auth.logout(finance.token);
  ok('sesi ditutup setelah logout', (await auth.session(finance.token)).success === false);

  // 13. audit log
  const audit = await auth.auditLog(ad2.token);
  const auditEntries = audit.entries || [];
  ok('log berisi kejadian login', audit.success === true && auditEntries.some(e => e.event === 'LOGIN_OK'), audit);
  ok('log terbaru lebih dulu', auditEntries.length > 1 ? auditEntries[0].at >= auditEntries[auditEntries.length - 1].at : false);
  ok('log mencatat percobaan gagal', auditEntries.some(e => e.event === 'LOGIN_FAIL' || e.event === 'LOGIN_LOCKED'));

  // 14. berkas akun rusak -> dikarantina lalu dibangun ulang, bukan terkunci
  fs.writeFileSync(file, '{ ini bukan json');
  delete require.cache[require.resolve('../../dist-electron/auth.js')];
  const auth2 = require('../../dist-electron/auth.js');
  await auth2.initAuth();
  const reseeded = await auth2.login('admin', 'admin123');
  ok('akun dibangun ulang dari template', reseeded.success === true, reseeded);
  ok('hasil reseed wajib ganti password', reseeded.user?.mustChangePassword === true, reseeded.user);
  ok('karantina dibuat', fs.readdirSync(path.join(tmp, 'data')).some(f => f.includes('_corrupt_')));

  console.log(checks.join('\n'));
  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

app.whenReady().then(main).catch(err => {
  console.error('HARNESS ERROR', err);
  selesai(app, 2);
});
