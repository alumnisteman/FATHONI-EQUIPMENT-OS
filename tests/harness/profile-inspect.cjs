// tests/harness/profile-inspect.cjs
// Membaca isi localStorage sebuah profil Electron TANPA menyentuh profil aslinya.
// Profil disalin dulu, salinan itu yang dibuka. Tidak ada satu pun jalur tulis di
// sini: tidak memuat dist-electron/main.js, jadi aplikasi tidak boot dan tidak
// autosave.
//
// Jalankan:
//   cp -r "$APPDATA/hems-heavy-equipment-system" D:/SANY/tmp-harness/livecopy
//   HEMS_DATA_DIR=D:/SANY/tmp-harness/livecopy npx electron tests/harness/profile-inspect.cjs

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const dataDir = process.env.HEMS_DATA_DIR;
if (!dataDir) {
  console.error('HEMS_DATA_DIR wajib diisi ke folder SALINAN profil, bukan profil asli.');
  process.exit(1);
}
app.setPath('userData', dataDir);
app.disableHardwareAcceleration();

const KEYS_OF_INTEREST = /^HEMS_[A-Z_]+$|^hems_/;

app.whenReady().then(async () => {
  const page = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hems-inspect-')), 'index.html');
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>inspect</title>');

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await win.loadFile(page);

  const report = await win.webContents.executeJavaScript(`
    (() => {
      const rows = [];
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key) || '';
        total += key.length + value.length;
        let shape = '';
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            shape = 'array(' + parsed.length + ')' + (parsed[0] && typeof parsed[0] === 'object'
              ? ' contoh=' + Object.keys(parsed[0]).slice(0, 6).join(',') : '');
          } else if (parsed && typeof parsed === 'object') {
            shape = 'object{' + Object.keys(parsed).slice(0, 8).join(',') + '}';
          } else {
            shape = 'scalar=' + String(parsed).slice(0, 60);
          }
        } catch {
          shape = 'raw ' + value.slice(0, 60);
        }
        rows.push({ key, bytes: value.length, shape });
      }
      return { origin: location.href, total, rows: rows.sort((a, b) => b.bytes - a.bytes) };
    })()
  `);

  console.log(`Origin : ${report.origin}`);
  console.log(`Total  : ${(report.total / 1024).toFixed(1)} KB pada ${Object.keys(report.rows).length} key`);
  console.log('');
  for (const r of report.rows) {
    const flag = KEYS_OF_INTEREST.test(r.key) ? '  ' : '?? ';
    console.log(`${flag}${r.key.padEnd(28)} ${String(r.bytes).padStart(9)} B  ${r.shape.slice(0, 150)}`);
  }
  console.log('');
  console.log('?? = key tidak dikenal oleh kode aplikasi (bukan hems_*/HEMS_*)');

  // Salin isinya apa adanya supaya harness lain bisa memeriksa tanpa menyentuh
  // profil (mis. migration-dryrun.cjs).
  const dump = await win.webContents.executeJavaScript(`
    (() => {
      const all = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        all[key] = localStorage.getItem(key);
      }
      return JSON.stringify(all);
    })()
  `);
  const out = process.env.HEMS_DUMP || path.join(dataDir, 'localStorage-dump.json');
  fs.writeFileSync(out, dump);
  console.log(`\nSalinan isi profil: ${out}`);

  app.exit(0);
});
