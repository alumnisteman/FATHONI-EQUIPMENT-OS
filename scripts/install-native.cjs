// scripts/install-native.cjs
// Ambil prebuild better-sqlite3 untuk ABI Electron yang dipakai proyek ini.
//
// Mesin pengembangan tidak punya toolchain Visual Studio, jadi node-gyp selalu
// gagal. prebuild-install mengunduh build jadi (mis. electron-v123-win32-x64),
// dan nomor ABI-nya harus sama dengan Electron yang terpasang — itu sebabnya
// versinya dibaca dari node_modules/electron, bukan ditulis di sini.
//
// Jalankan: npm run rebuild:native

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = (name) => path.join(root, 'node_modules', name, 'package.json');

const electronVersion = JSON.parse(fs.readFileSync(pkg('electron'), 'utf8')).version;
const target = path.join(root, 'node_modules', 'better-sqlite3');

if (!fs.existsSync(target)) {
  console.error('better-sqlite3 belum terpasang. Jalankan: npm install');
  process.exit(1);
}

const args = ['-r', 'electron', '-t', electronVersion, '-a', process.arch, '--verbose'];
console.log(`Mengunduh prebuild better-sqlite3 untuk electron ${electronVersion} (${process.arch})...`);

const result = spawnSync('npx', ['--no-install', 'prebuild-install', ...args], {
  cwd: target, stdio: 'inherit', shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.error('Gagal mengunduh prebuild. Cek koneksi, atau build dari sumber dengan toolchain Visual Studio.');
  process.exit(result.status || 1);
}

const binary = path.join(target, 'build', 'Release', 'better_sqlite3.node');
console.log(fs.existsSync(binary) ? `OK: ${binary}` : 'Peringatan: prebuild selesai tapi file .node tidak ditemukan.');
