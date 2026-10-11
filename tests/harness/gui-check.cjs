// Harness fungsional/keamanan permanen: menguji aplikasi desktop sungguhan —
// main.js + preload.js + dist build — lewat renderer yang sudah di-sandbox.
// HEMS_DATA_DIR diarahkan ke folder sementara supaya data pengguna yang asli tidak
// tersentuh (lihat tests/harness/regressi.sh).
const { app, BrowserWindow, shell } = require('electron');
const selesai = require('./selesai.cjs');
const fs = require('fs');
const path = require('path');

// Bagian 8 menguji apa yang terjadi kalau halaman mencoba membuka tautan luar.
// Handler main process menyerahkannya ke shell.openExternal — yang di mesin ini
// berarti Chrome sungguhan terbuka ke https://example.com SETIAP KALI langkah 'gui'
// dijalankan, di desktop orang yang sedang bekerja. Jadi openExternal ditambal lebih
// dulu dengan perekam: tidak ada browser yang terbuka, dan penyerahan URL-nya justru
// bisa dinyatakan sebagai assertion (sebelum ini hanya dibuktikan lewat jendela yang
// muncul di layar pengguna).
const luarDiserahkan = [];
shell.openExternal = (url) => { luarDiserahkan.push(String(url)); return Promise.resolve(true); };

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, extra) {
  if (cond) { pass++; lines.push('PASS ' + name); }
  else { fail++; lines.push('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

const cspViolations = [];
let captured = null;

app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev, level, message) => {
    if (/Content Security Policy/i.test(message)) cspViolations.push(message);
  });
  if (!captured && wc.getType() === 'window' && !wc.getURL().includes('untrusted')) {
    captured = wc;
    wc.once('did-finish-load', () => run(wc).catch(err => {
      console.log('HARNESS ERROR', err && err.message);
      console.log(lines.join('\n'));
      selesai(app, 2);
    }));
  }
});

// Halaman di luar folder dist: IPC darinya harus ditolak.
function writeUntrustedPage() {
  const dir = path.join(app.getPath('temp'), 'fathoni-untrusted');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'untrusted.html');
  fs.writeFileSync(file, '<!doctype html><html><body><h1>asing</h1></body></html>');
  return file;
}

async function evalIn(wc, code) {
  return wc.executeJavaScript(`(async () => { ${code} })()`, true);
}

async function run(wc) {
  await new Promise(r => setTimeout(r, 400));

  // 1. jembatan preload hanya fungsi yang terdaftar
  const surface = await evalIn(wc, `return {
      login: typeof window.electronAPI?.login,
      invoke: typeof (window.require && window.require('electron')),
      extra: typeof window.electronAPI?.ipcRenderer,
    };`);
  ok('electronAPI.login tersedia', surface.login === 'function', surface);
  ok('Node tidak bocor ke renderer', surface.invoke === 'undefined', surface);
  ok('ipcRenderer mentah tidak diekspos', surface.extra === 'undefined', surface);

  // 2. CSP produksi ada di dokumen
  const csp = await evalIn(wc, `return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || null;`);
  ok('meta CSP ada di build', typeof csp === 'string' && csp.includes("script-src 'self'"), csp);

  // 3. skrip inline diblokir
  const inline = await evalIn(wc, `
    const s = document.createElement('script');
    s.textContent = 'window.__cspInline = 1';
    document.head.appendChild(s);
    await new Promise(r => setTimeout(r, 250));
    return window.__cspInline === 1 ? 'ALLOWED' : 'blocked';`);
  ok('skrip inline diblokir CSP', inline === 'blocked', inline);
  // Uji di atas sengaja memicu satu pelanggaran; hanya pesan setelah baris ini
  // yang dihitung sebagai kejutan.
  const cspBaseline = cspViolations.length;

  // 4. aplikasi benar-benar berjalan di bawah CSP
  const rootChildren = await evalIn(wc, `return document.getElementById('root')?.children.length || 0;`);
  ok('halaman login ter-render', rootChildren > 0, rootChildren);
  const hasForm = await evalIn(wc, `return !!document.getElementById('login-username');`);
  ok('form login tampil', hasForm === true);

  // 5. rute lazy (dynamic import chunk) tetap jalan
  await evalIn(wc, `window.location.hash = '#/users'; return true;`);
  await new Promise(r => setTimeout(r, 700));
  const stillUp = await evalIn(wc, `return document.getElementById('root')?.children.length || 0;`);
  ok('rute lazy ter-render', stillUp > 0, stillUp);

  // 6. login lewat IPC + token sesi
  const login = await evalIn(wc, `return window.electronAPI.login('admin', 'admin123');`);
  ok('login IPC berhasil', login.success === true, login);
  ok('token sesi diterima', typeof login.token === 'string' && login.token.length >= 32);
  ok('data akun tanpa hash/salt', !JSON.stringify(login.user ?? {}).match(/"(hash|salt|password)"/i), login.user);
  ok('wajib ganti password ditandai', login.user?.mustChangePassword === true, login.user);
  const badLogin = await evalIn(wc, `return window.electronAPI.login('admin', 'salahsekali');`);
  ok('login salah ditolak', badLogin.success === false, badLogin);
  const noCred = await evalIn(wc, `return window.electronAPI.login(null, undefined);`);
  ok('panggilan IPC dengan argimen rusak ditahan', noCred.success === false, noCred);

  // 7. sesi disimpan & dipulihkan lewat authClient (bentuk localStorage)
  await evalIn(wc, `
    localStorage.setItem('hems_session_v2', JSON.stringify({ token: ${JSON.stringify(login.token)}, user: ${JSON.stringify(login.user)} }));
    localStorage.removeItem('hems_session');
    return true;`);
  const restored = await evalIn(wc, `return window.electronAPI.session(localStorage.getItem('hems_session_v2') ? JSON.parse(localStorage.getItem('hems_session_v2')).token : '');`);
  ok('sesi tersimpan valid saat boot', restored.success === true, restored);
  const forged = await evalIn(wc, `return window.electronAPI.session('a'.repeat(64));`);
  ok('token palsu ditolak', forged.success === false, forged);

  // 8. popup eksternal diblokir, dan tautannya diserahkan ke browser sistem
  const popup = await evalIn(wc, `return window.open('https://example.com') === null;`);
  ok('window.open ke situs luar diblokir', popup === true, popup);
  ok('8.1b URL luar diteruskan ke browser sistem, bukan dijadikan jendela Electron',
    luarDiserahkan.length === 1 && luarDiserahkan[0].replace(/\/$/, '') === 'https://example.com',
    luarDiserahkan);

  // 9. validasi berkas pada channel sensitif
  const printEmpty = await evalIn(wc, `return window.electronAPI.printDocument('', {});`);
  ok('cetak dokumen kosong ditolak', printEmpty.success === false, printEmpty);
  const printHuge = await evalIn(wc, `return window.electronAPI.printDocument('x'.repeat(1024 * 1024 * 2), {});`);
  ok('cetak dokumen terlalu besar ditolak', printHuge.success === false, printHuge);
  const backupEmpty = await evalIn(wc, `return window.electronAPI.exportBackup('');`);
  ok('backup kosong ditolak', backupEmpty.success === false, backupEmpty);
  const photoBad = await evalIn(wc, `return window.electronAPI.readPhoto('../../Windows/system32/config/sam');`);
  ok('path foto di luar folder ditolak', photoBad.success !== true || (photoBad.data === undefined && photoBad.success === false), photoBad);

  // 10. cetak nyata lewat jendela cetak khusus (tanpa printer: harus selesai, bukan menggantung)
  const printed = await Promise.race([
    evalIn(wc, `return window.electronAPI.printDocument('<h1>Uji cetak</h1>', { silent: true, deviceName: 'printer-tidak-ada-xyz', pageSize: 'A4' });`),
    new Promise(r => setTimeout(() => r('TIMEOUT'), 15000)),
  ]);
  ok('kanal cetak merespons (tidak menggantung)', printed !== 'TIMEOUT' && typeof printed === 'object', printed);

  // 11. jendela dengan halaman asing tidak boleh memakai IPC
  const alien = new BrowserWindow({
    show: false, width: 400, height: 300,
    webPreferences: {
      preload: path.join(__dirname, '../../dist-electron/preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  await alien.loadFile(writeUntrustedPage());
  const alienResult = await alien.webContents.executeJavaScript(
    `(async () => await window.electronAPI.login('admin','admin123'))()`
  );
  ok('11.1 IPC dari halaman luar ditolak', alienResult && alienResult.success === false, alienResult);
  const alienPhoto = await alien.webContents.executeJavaScript(
    `(async () => await window.electronAPI.readPhoto('a.jpg'))()`
  );
  ok('11.2 baca foto dari halaman luar ditolak', alienPhoto && alienPhoto.success === false, alienPhoto);

  // 11b. kanal database Fase 4 diperlakukan sama: halaman asing tidak boleh
  // membaca, menulis, atau menumpuk snapshot.
  const A = alien.webContents;
  const alienLoad = await A.executeJavaScript(`(async () => await window.electronAPI.dbLoad())()`);
  ok('11.3 db-load dari halaman luar tidak mengeluarkan isi database',
    alienLoad && alienLoad.success === false && !Array.isArray(alienLoad.units), alienLoad);
  const alienPatch = await A.executeJavaScript(
    `(async () => await window.electronAPI.dbPatch({ units: { upsert: [{ id: 'ALIEN-1', serialNumber: 'ALIEN-1', brand: 'X' }], removeIds: [] } }))()`
  );
  ok('11.4 db-patch dari halaman luar ditolak', alienPatch && alienPatch.success === false, alienPatch);
  const alienSave = await A.executeJavaScript(
    `(async () => await window.electronAPI.dbSave({ customers: [{ id: 'ALIEN-C', name: 'asing' }] }))()`
  );
  ok('11.5 db-save dari halaman luar ditolak', alienSave && alienSave.success === false, alienSave);
  const alienQuery = await A.executeJavaScript(
    `(async () => await window.electronAPI.dbQuery({ collection: 'units', limit: 5 }))()`
  );
  ok('11.6 db-query dari halaman luar ditolak', alienQuery && alienQuery.success === false, alienQuery);
  const alienSum = await A.executeJavaScript(
    `(async () => await window.electronAPI.dbSum('units', 'purchasePrice'))()`
  );
  ok('11.7 db-sum dari halaman luar ditolak', alienSum && alienSum.success === false, alienSum);
  const alienGroup = await A.executeJavaScript(
    `(async () => await window.electronAPI.dbGroup({ collection: 'units', by: ['status'] }))()`
  );
  ok('11.8 db-group dari halaman luar ditolak', alienGroup && alienGroup.success === false, alienGroup);
  const alienStats = await A.executeJavaScript(`(async () => await window.electronAPI.dbStats())()`);
  const alienSnap = await A.executeJavaScript(
    `(async () => await window.electronAPI.dbSnapshotCreate({ reason: 'manual', settings: {} }))()`
  );
  ok('11.9 diagnostik dan snapshot dari halaman luar ditolak',
    alienStats && alienStats.success === false && alienSnap && alienSnap.success === false, { alienStats, alienSnap });
  // Kanal pemeriksaan rujukan ikut dirusak dari halaman asing kalau ia tidak
  // dijaga: hasilnya berisi nomor dokumen milik pengguna.
  const alienRefs = await A.executeJavaScript(
    `(async () => await window.electronAPI.dbReferences('units', 'GUI-UJI-1'))()`
  );
  ok('11.10 pemeriksaan rujukan dari halaman luar ditolak',
    alienRefs && alienRefs.success === false && alienRefs.blocked === undefined, alienRefs);
  const bocor = JSON.stringify([alienLoad, alienPatch, alienSave, alienQuery, alienSum, alienGroup, alienStats, alienSnap, alienRefs]);
  ok('11.11 penolakan tidak membocorkan path profil', !/[A-Za-z]:\\|fathoni\.db/.test(bocor), bocor.slice(0, 200));
  const sisaAsing = await evalIn(wc, `
    const q = await window.electronAPI.dbQuery({ collection: 'units', search: 'ALIEN-1', limit: 5 });
    const c = await window.electronAPI.dbQuery({ collection: 'customers', search: 'ALIEN-C', limit: 5 });
    return { units: q.total, customers: c.total };`);
  ok('11.12 upaya halaman asing benar-benar tidak meninggalkan data',
    sisaAsing.units === 0 && sisaAsing.customers === 0, sisaAsing);
  const daftarSnapAsing = await evalIn(wc, `return await window.electronAPI.dbSnapshotList();`);
  ok('11.13 snapshot percobaan asing tidak terbentuk',
    Array.isArray(daftarSnapAsing && daftarSnapAsing.snapshots) && daftarSnapAsing.snapshots.length === 0,
    daftarSnapAsing);
  alien.destroy();

  // 12. tidak ada pelanggaran CSP yang tak disengaja
  const unexpected = cspViolations.slice(cspBaseline);
  ok('tidak ada pelanggaran CSP tak terduga', unexpected.length === 0, unexpected.slice(0, 4));

  // 13. argumen rusak dari DALAM aplikasi: ditolak dengan rapi, tidak membuat
  // main process melempar exception mentah, dan tidak mengubah isi database.
  // Lima baris_seed dipakai supaya "query tetap mengembalikan baris" bisa
  // dibuktikan di profil kosong; semuanya dibersihkan lagi di bagian 14.
  const sebelum13 = await evalIn(wc, `
    return (await window.electronAPI.dbQuery({ collection: 'units', limit: 1 })).total;`);
  const seed = await evalIn(wc, `
    const rows = [];
    for (let i = 1; i <= 5; i++) rows.push({ id: 'GUI-UJI-' + i, serialNumber: 'GUI-UJI-' + i, brand: 'SANY', model: 'SY215C', status: 'AVAILABLE' });
    return await window.electronAPI.dbPatch({ units: { upsert: rows, removeIds: [] } });`);
  ok('13.0 penyiapan uji lewat jalur patch tersimpan', seed && seed.units && seed.units.inserted === 5, seed);
  const h1 = await evalIn(wc, `return await window.electronAPI.dbQuery({ collection: 'sqlite_master', limit: 5 });`);
  ok('13.1 tabel sistem bukan collection yang boleh dibaca renderer', h1 && h1.success === false, h1);
  const h2 = await evalIn(wc, `return await window.electronAPI.dbPatch({ tidakada: { upsert: [{ id: 'X' }] } });`);
  ok('13.2 nama collection asing pada patch ditolak', h2 && h2.success === false, h2);
  const h3 = await evalIn(wc, `return await window.electronAPI.dbPatch({ units: { upsert: [{ brand: 'tanpa id' }] } });`);
  ok('13.3 baris tanpa id pada patch ditolak, bukan ditulis diam-diam', h3 && h3.success === false, h3);
  const h4 = await evalIn(wc, `return await window.electronAPI.dbSave({ units: 'bukan daftar' });`);
  ok('13.4 isi collection yang bukan daftar ditolak', h4 && h4.success === false, h4);
  const h5 = await evalIn(wc, `return await window.electronAPI.dbQuery(null);`);
  const h6 = await evalIn(wc, `return await window.electronAPI.dbSum(undefined, undefined);`);
  ok('13.5 permintaan tanpa isi dijawab, tidak membuat jendela macet',
    h5 && h5.success === false && (typeof h6 === 'number' || (h6 && h6.success === false)), { h5, h6 });
  const h7 = await evalIn(wc, `
    const r = await window.electronAPI.dbQuery({ collection: 'units', where: { 'payload"="x" OR 1=1': 'y', brand: ['SANY'] }, limit: 3 });
    return { rows: (r.rows || []).length, total: r.total, error: r.error };`);
  ok('13.6 penyaringan rusak diabaikan sehingga halaman tetap mendapat baris',
    h7.rows === 3 && h7.error === undefined, h7);
  const h8 = await evalIn(wc, `
    const r = await window.electronAPI.dbQuery({ collection: 'units', limit: 100000, offset: -50 });
    return { rows: (r.rows || []).length, limit: r.limit, offset: r.offset };`);
  ok('13.7 batas halaman dan offset negatif ditegakkan di main process',
    h8.rows <= 500 && h8.limit <= 500 && h8.offset === 0, h8);
  const h9 = await evalIn(wc, `
    const r = await window.electronAPI.dbQuery({ collection: 'units', search: 'x'.repeat(3000), limit: 3 });
    return { total: r.total, error: r.error };`);
  ok('13.8 pencarian sangat panjang dipotong, bukan membuat query meledak',
    h9.total === 0 && h9.error === undefined, h9);
  const h10 = await evalIn(wc, `
    return {
      teks: await window.electronAPI.dbSum('invoices', 'invoiceNo'),
      asing: await window.electronAPI.dbSum('invoices', 'totalAmount", 0 FROM invoices WHERE 1=1 --'),
      benar: await window.electronAPI.dbSum('invoices', 'totalAmount'),
    };`);
  ok('13.9 penjumlahan hanya pada kolom angka yang terdaftar',
    h10.teks === 0 && h10.asing === 0 && typeof h10.benar === 'number', h10);

  // Kanal agregat kelompok punya permukaan yang sama lebarnya dengan db-query,
  // jadi bentuk asing diuji dari dalam aplikasi juga: permintaan sah dijawab,
  // permintaan asing ditolak atau dilewati, dan tidak ada yang membuat jendela
  // renderer menunggu.
  const g1 = await evalIn(wc, `
    const sahih = await window.electronAPI.dbGroup({ collection: 'units', by: ['status'] });
    return { kelompok: (sahih.groups || []).length, jumlah: (sahih.groups || [])[0]?.count, error: sahih.error };`);
  ok('13.10 db-group menjawab permintaan sah dari dalam aplikasi',
    g1.kelompok === 1 && g1.jumlah === 5 && g1.error === undefined, g1);
  const g2 = await evalIn(wc, `
    const collectionAsing = await window.electronAPI.dbGroup({ collection: 'sqlite_master', by: ['type'] });
    const tanpaIsi = await window.electronAPI.dbGroup(null);
    const kolomAsing = await window.electronAPI.dbGroup({ collection: 'units', by: ['payload" OR 1=1 --'] });
    const operatorAsing = await window.electronAPI.dbGroup({ collection: 'units', by: ['status'], where: { status: { op: 'LIKE', value: '%' } } });
    const banyakKolom = await window.electronAPI.dbGroup({ collection: 'units', by: ['status', 'brand', 'model', 'serialNumber'], sum: 'purchasePrice' });
    return {
      collectionAsing: collectionAsing.success === false ? 'ditolak' : JSON.stringify(collectionAsing).slice(0, 50),
      errorCollection: collectionAsing.error,
      tanpaIsi: tanpaIsi.success === false ? 'ditolak' : JSON.stringify(tanpaIsi).slice(0, 50),
      kolomAsing: (kolomAsing.groups || []).length, errorKolom: kolomAsing.error,
      operatorAsing: (operatorAsing.groups || []).length, jumlahOperator: (operatorAsing.groups || [])[0]?.count,
      banyak: (banyakKolom.groups || []).length, panjang: (banyakKolom.groups || [])[0]?.keys?.length,
    };`);
  ok('13.11 db-group menolak collection asing dan permintaan tanpa isi',
    g2.collectionAsing === 'ditolak' && g2.tanpaIsi === 'ditolak', g2);
  ok('13.12 kolom kelompok asing dilewati tanpa error',
    g2.kolomAsing === 0 && g2.errorKolom === undefined, g2);
  ok('13.13 operator asing tidak menyaring apa pun, bukan menolak seluruh kueri',
    g2.operatorAsing === 1 && g2.jumlahOperator === 5, g2);
  ok('13.14 lebih dari tiga kolom kelompok dipotong, bukan membuat kueri gagal',
    g2.banyak > 0 && g2.panjang === 3, g2);
  const bocorGroup = JSON.stringify([g1, g2]);
  ok('13.15 penolakan db-group tidak membocorkan path profil',
    !/[A-Za-z]:\\|fathoni\.db/.test(bocorGroup), bocorGroup.slice(0, 200));

  // 14. satu putaran tulis-baca-hapus sungguhan lewat kanal patch, lalu semua
  // percobaan di atas terbukti tidak meninggalkan jejak.
  const putaran = await evalIn(wc, `
    const patch = { units: { upsert: [{ id: 'IPC-UJI-1', serialNumber: 'IPC-UJI-1', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE' }], removeIds: [] } };
    const ditulis = await window.electronAPI.dbPatch(patch);
    const ketemu = await window.electronAPI.dbQuery({ collection: 'units', search: 'IPC-UJI-1', limit: 5 });
    const dihapus = await window.electronAPI.dbPatch({ units: { upsert: [], removeIds: ['IPC-UJI-1', 'GUI-UJI-1', 'GUI-UJI-2', 'GUI-UJI-3', 'GUI-UJI-4', 'GUI-UJI-5'] } });
    const sesudah = await window.electronAPI.dbQuery({ collection: 'units', limit: 1 });
    const sehat = await window.electronAPI.dbIntegrity();
    return { ditulis, baris: (ketemu.rows || []).length, sisa: sesudah.total, dihapus, ok: sehat.ok };`);
  ok('14.1 jalur patch tulis-baca-hapus bekerja dari renderer',
    putaran.ditulis && putaran.ditulis.units && putaran.ditulis.units.inserted === 1
      && putaran.baris === 1 && putaran.dihapus.units.deleted === 6, putaran);
  ok('14.2 jumlah unit kembali seperti sebelum percobaan',
    putaran.sisa === sebelum13, { sebelum: sebelum13, sesudah: putaran.sisa });
  ok('14.3 database tetap utuh sesudah semua percobaan keamanan', putaran.ok === true, putaran);

  // 15. muat sebagian lewat kanal db-load (#38). Boot tidak lagi memindahkan seluruh
  // store ke renderer, jadi kanal ini punya dua bentuk: tanpa argumen (jalur Backup,
  // sengaja) dan dengan daftar nama (hidrasi per menu). Nama di luar daftar putih
  // harus DITOLAK — kalau diterima dan dilewati diam-diam, halaman akan mengira
  // collection itu kosong lalu menulisnya kosong.
  const muatSebagian = await evalIn(wc, `
    const satu = await window.electronAPI.dbLoad(['units']);
    const asing = await window.electronAPI.dbLoad(['tidak-ada']);
    const bukanDaftar = await window.electronAPI.dbLoad('units');
    const jejak = await window.electronAPI.dbStats();
    return {
      kunciSatu: Object.keys(satu || {}),
      unitSatu: Array.isArray(satu && satu.units) ? satu.units.length : null,
      totalUnit: (await window.electronAPI.dbQuery({ collection: 'units', limit: 1 })).total,
      asing: asing && asing.success === false ? 'ditolak' : JSON.stringify(asing).slice(0, 80),
      bukanDaftar: bukanDaftar && bukanDaftar.success === false ? 'ditolak' : JSON.stringify(bukanDaftar).slice(0, 80),
      reads: jejak.reads,
    };`);
  ok('15.1 dbLoad([nama]) hanya mengembalikan collection yang diminta',
    muatSebagian.kunciSatu.join() === 'units' && muatSebagian.unitSatu === muatSebagian.totalUnit,
    muatSebagian);
  ok('15.2 nama collection asing pada db-load ditolak, bukan dilewati kosong',
    muatSebagian.asing === 'ditolak', muatSebagian);
  ok('15.3 argumen yang bukan daftar ditolak dan tidak berubah menjadi muat semua',
    muatSebagian.bukanDaftar === 'ditolak', muatSebagian);
  ok('15.4 jejak baca membuktikan jendela aplikasi tidak pernah meminta seluruh store',
    muatSebagian.reads && muatSebagian.reads.subsetCalls >= 1
      && muatSebagian.reads.rows >= muatSebagian.totalUnit
      && muatSebagian.reads.fullCalls === 0,
    muatSebagian.reads);
  const bocorLoad = JSON.stringify(muatSebagian);
  ok('15.5 penolakan db-load tidak membocorkan path profil',
    !/[A-Za-z]:\\|fathoni\.db/.test(bocorLoad), bocorLoad.slice(0, 200));

  // 16. dua jaminan yang hanya bisa dibuktikan lewat kanal IPC asli, bukan lewat
  // akses langsung seperti di integrity-check:
  //   a) satu patch yang membawa beberapa collection tidak boleh menyisakan
  //      collection pertama tertulis kalau collection berikutnya ditolak ATAU
  //      meledak di tengah transaksi;
  //   b) pemeriksaan "masih dirujuk" menjawab dari main process atas kunci bisnis
  //      (serialNumber), termasuk varian beda huruf dan spasi yang tidak tertangkap
  //      oleh persamaan persis sehingga jatuh ke fallback blob pencarian.
  const atomis = await evalIn(wc, `
    const campuran = { units: { upsert: [{ id: 'GUI-ATOM-1', serialNumber: 'GUI-ATOM-1', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE' }], removeIds: [] }, tidakada: { upsert: [{ id: 'X' }] } };
    const ditolak = await window.electronAPI.dbPatch(campuran);
    const sisa1 = await window.electronAPI.dbQuery({ collection: 'units', search: 'GUI-ATOM-1', limit: 5 });
    const linking = { id: 'GUI-ATOM-C', name: 'pelanggan melingkar' };
    linking.diri = linking;
    const meledak = await window.electronAPI.dbPatch({
      units: { upsert: [{ id: 'GUI-ATOM-2', serialNumber: 'GUI-ATOM-2', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE' }], removeIds: [] },
      customers: { upsert: [linking], removeIds: [] },
    });
    const sisa2 = await window.electronAPI.dbQuery({ collection: 'units', search: 'GUI-ATOM-2', limit: 5 });
    const sehat = await window.electronAPI.dbIntegrity();
    const sah = await window.electronAPI.dbPatch({
      units: { upsert: [{ id: 'GUI-ATOM-3', serialNumber: 'GUI-ATOM-3', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE' }], removeIds: [] },
      customers: { upsert: [{ id: 'GUI-ATOM-K', name: 'Pelanggan Atom Uji' }], removeIds: [] },
    });
    const ketemu3 = {
      units: (await window.electronAPI.dbQuery({ collection: 'units', search: 'GUI-ATOM-3', limit: 5 })).total,
      customers: (await window.electronAPI.dbQuery({ collection: 'customers', search: 'Pelanggan Atom Uji', limit: 5 })).total,
    };
    const dibersihkan = await window.electronAPI.dbPatch({
      units: { upsert: [], removeIds: ['GUI-ATOM-1', 'GUI-ATOM-2', 'GUI-ATOM-3'] },
      customers: { upsert: [], removeIds: ['GUI-ATOM-K'] },
    });
    return {
      ditolak: ditolak.success === false, errorDitolak: ditolak.error,
      tertulis1: sisa1.total,
      meledak: meledak.success === false, errorMeledak: meledak.error,
      tertulis2: sisa2.total, utuh: sehat.ok,
      duaDua: sah && sah.units && sah.units.inserted === 1 && sah.customers && sah.customers.inserted === 1,
      ketemu3,
      // Hanya GUI-ATOM-3 yang pernah benar-benar tertulis (1 dan 2 dibatalkan),
      // jadi jumlah yang terhapus di sini adalah bukti rolled back-nya yang tadi.
      hapusUnit: dibersihkan.units.deleted, hapusPelanggan: dibersihkan.customers.deleted,
      sisaUnit: (await window.electronAPI.dbQuery({ collection: 'units', search: 'GUI-ATOM', limit: 10 })).total,
      sisaPelanggan: (await window.electronAPI.dbQuery({ collection: 'customers', search: 'Atom Uji', limit: 10 })).total,
    };`);
  ok('16.1 collection yang membuat seluruh patch ditolak tidak menulis apa pun',
    atomis.ditolak === true && atomis.tertulis1 === 0, atomis);
  ok('16.2 kegagalan di tengah transaksi tetap membatalkan collection pertama',
    atomis.meledak === true && atomis.tertulis2 === 0 && atomis.utuh === true, atomis);
  ok('16.3 penolakan tidak membocorkan isi error mentah',
    !/[A-Za-z]:\\|JSON|circle|circular/i.test(String(atomis.errorDitolak) + ' ' + String(atomis.errorMeledak)),
    { errorDitolak: atomis.errorDitolak, errorMeledak: atomis.errorMeledak });
  ok('16.4 patch multi-collection yang sah menulis kedua collection',
    atomis.duaDua === true && atomis.ketemu3.units === 1 && atomis.ketemu3.customers === 1, atomis);
  ok('16.5 pembersihan uji atomisitas tidak meninggalkan baris',
    atomis.hapusUnit === 1 && atomis.hapusPelanggan === 1 && atomis.sisaUnit === 0 && atomis.sisaPelanggan === 0, atomis);

  const rujukan = await evalIn(wc, `
    const patch = {
      units: { upsert: [
        { id: 'GUI-REF-1', serialNumber: 'GUI-REF-SER-1', brand: 'SANY', model: 'SY215C', status: 'IN_SERVICE' },
        { id: 'GUI-REF-2', serialNumber: 'GUI-REF-SER-2', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE' },
        { id: 'GUI-REF-3', serialNumber: 'GUI-REF-VAR-1', brand: 'SANY', model: 'SY215C', status: 'AVAILABLE' },
      ], removeIds: [] },
      services: { upsert: [
        { id: 'GUI-REF-WO1', woNumber: 'WO-GUI-REF-1', serialNumber: 'GUI-REF-SER-1', unitModel: 'SY215C', status: 'OPEN', openDate: '2026-10-01' },
        { id: 'GUI-REF-WO2', woNumber: 'WO-GUI-REF-2', serialNumber: 'gui  ref  var  1', unitModel: 'SY215C', status: 'OPEN', openDate: '2026-10-01' },
      ], removeIds: [] },
    };
    const siap = await window.electronAPI.dbPatch(patch);
    const tertahan = await window.electronAPI.dbReferences('units', 'GUI-REF-1');
    const bebas = await window.electronAPI.dbReferences('units', 'GUI-REF-2');
    const varian = await window.electronAPI.dbReferences('units', 'GUI-REF-3');
    const asing = await window.electronAPI.dbReferences('tidakada', 'X');
    const kosong = await window.electronAPI.dbReferences('units', '');
    const dibersihkan = await window.electronAPI.dbPatch({
      units: { upsert: [], removeIds: ['GUI-REF-1', 'GUI-REF-2', 'GUI-REF-3'] },
      services: { upsert: [], removeIds: ['GUI-REF-WO1', 'GUI-REF-WO2'] },
    });
    const sisaUnit = (await window.electronAPI.dbQuery({ collection: 'units', limit: 1 })).total;
    const sisaServis = (await window.electronAPI.dbQuery({ collection: 'services', search: 'GUI-REF', limit: 5 })).total;
    return {
      siap: siap && siap.units && siap.units.inserted === 3 && siap.services && siap.services.inserted === 2,
      tertahanBlokir: tertahan.blocked,
      label: (tertahan.hits || []).map(h => h.collection + ':' + h.label).join(','),
      contoh: (tertahan.hits || []).map(h => h.contoh.join('/')).join(','),
      bebasBlokir: bebas.blocked, bebasHits: (bebas.hits || []).length,
      varianBlokir: varian.blocked,
      varianLabel: (varian.hits || []).map(h => h.collection).join(','),
      asing: asing.success === false, kosongBlokir: kosong.blocked,
      hapus: dibersihkan.units.deleted === 3 && dibersihkan.services.deleted === 2,
      unitKembali: sisaUnit, servisSisa: sisaServis,
    };`);
  ok('16.6 penyiapan uji rujukan lewat jalur patch', rujukan.siap === true, rujukan);
  ok('16.7 unit yang masih punya Work Order ditahan lewat kanal IPC',
    rujukan.tertahanBlokir === true && /services:Work Order Servis/.test(rujukan.label)
      && rujukan.contoh.indexOf('WO-GUI-REF-1') >= 0, rujukan);
  ok('16.8 varian serial beda huruf dan spasi tetap tertahan (fallback blob)',
    rujukan.varianBlokir === true && rujukan.varianLabel === 'services', rujukan);
  ok('16.9 unit tanpa dokumen tetap bebas dihapus',
    rujukan.bebasBlokir === false && rujukan.bebasHits === 0, rujukan);
  ok('16.10 nama collection asing dan id kosong ditolak tanpa melempar',
    rujukan.asing === true && rujukan.kosongBlokir === false, rujukan);
  ok('16.11 isi database kembali seperti sebelum uji rujukan',
    rujukan.hapus === true && rujukan.unitKembali === sebelum13 && rujukan.servisSisa === 0, rujukan);
  const bocorRujukan = JSON.stringify([atomis, rujukan]);
  ok('16.12 jawaban kanal rujukan tidak membocorkan path profil',
    !/[A-Za-z]:\\|fathoni\.db/.test(bocorRujukan), bocorRujukan.slice(0, 200));

  console.log(lines.join('\n'));
  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  selesai(app, fail === 0 ? 0 : 1);
}

const readyTimer = setTimeout(() => {
  console.log('HARNESS ERROR: jendela aplikasi tidak muncul (aplikasi lain sedang berjalan?)');
  selesai(app, 3);
}, 20000);
app.on('window-all-closed', () => { /* biarkan harness memutuskan */ });

require('../../dist-electron/main.js');
app.whenReady().then(() => clearTimeout(readyTimer));
