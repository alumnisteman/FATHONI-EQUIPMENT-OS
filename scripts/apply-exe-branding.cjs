// scripts/apply-exe-branding.cjs
// Beri ikon merek + metadata versi pada FATHONI.exe hasil electron-builder.
//
// Kenapa tidak memakai opsi electron-builder `win.signAndEditExecutable: true`?
// Opsi itu mengunduh arsip winCodeSign lalu mengekstraknya dengan 7za, dan arsip
// tersebut berisi symlink macOS (darwin/.../libcrypto.dylib). Membuat symlink
// butuh hak khusus yang tidak dimiliki proses build di mesin ini, jadi build
// berhenti di tengah jalan padahal berkas yang diperlukan (rcedit) sudah ada.
// Karena itu electron-builder dibiarkan hanya menyusun paket (tanpa mengedit
// exe) dan pengeditan dilakukan di sini dengan rcedit yang sama, yang
// dijalankan dari scripts\tools sehingga build tidak butuh jaringan maupun hak
// istimewa.
//
// scripts/tools/rcedit-x64.exe = rcedit v0.2.0 (MIT, github.com/electron/rcedit),
// alat yang sama yang dipakai electron-builder; disalin ke dalam proyek supaya
// build tidak bergantung pada cache maupun jaringan.
//
// Jalankan dari root proyek setelah `npm run dist:dir`:
//   node scripts/apply-exe-branding.cjs
//   node scripts/apply-exe-branding.cjs <folder-unpacked-lain>

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.resolve(root, process.argv[2] || 'dist-app/win-unpacked');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const productName = pkg.build.productName;
const executableName = pkg.build.executableName;
const publisher = typeof pkg.author === 'string' ? pkg.author : (pkg.author && pkg.author.name);
const icon = path.join(root, 'installer', 'assets', 'fathoni.ico');
const rcedit = path.join(__dirname, 'tools', 'rcedit-x64.exe');
const exe = path.join(outDir, `${executableName}.exe`);

function gagal(pesan) {
  console.error('GAGAL: ' + pesan);
  process.exit(1);
}

for (const [label, berkas] of [['paket exe', exe], ['ikon', icon], ['rcedit', rcedit]]) {
  if (!fs.existsSync(berkas)) gagal(`${label} tidak ditemukan: ${berkas}`);
}
if (!publisher) gagal('author tidak ada di package.json — CompanyName exe tidak bisa diisi');

// electron-builder menulis versi sebagai tiga angka; resource Windows menyimpan
// empat komponen, jadi build number ditambah nol di ujung.
const versi = pkg.version;
const args = [
  exe,
  '--set-icon', icon,
  '--set-requested-execution-level', 'asInvoker',
  '--set-file-version', versi,
  '--set-product-version', versi,
  '--set-version-string', 'ProductName', productName,
  '--set-version-string', 'FileDescription', productName,
  '--set-version-string', 'CompanyName', publisher,
  '--set-version-string', 'LegalCopyright', `© ${publisher}`,
  '--set-version-string', 'OriginalFilename', `${executableName}.exe`,
];

const hasil = spawnSync(rcedit, args, { encoding: 'utf8' });
if (hasil.status !== 0) {
  console.error(hasil.stdout || '');
  gagal(`rcedit keluar dengan kode ${hasil.status}: ${(hasil.stderr || '').trim()}`);
}

// Baca balik: rcedit diam saja kalau berhasil, jadi yang dipercaya adalah isi
// resource yang baru saja ditulis.
const baca = (kunci) => {
  const r = spawnSync(rcedit, [exe, '--get-version-string', kunci], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};

const harapan = {
  ProductName: productName,
  FileDescription: productName,
  CompanyName: publisher,
  OriginalFilename: `${executableName}.exe`,
};
let rusak = 0;
for (const [kunci, nilai] of Object.entries(harapan)) {
  const nyata = baca(kunci);
  if (nyata === nilai) console.log(`PASS  ${kunci} = ${nyata}`);
  else { console.log(`FAIL  ${kunci} = ${JSON.stringify(nyata)}, harusnya ${JSON.stringify(nilai)}`); rusak++; }
}
for (const [kunci, nilai] of [['FileVersion', versi], ['ProductVersion', versi]]) {
  const nyata = baca(kunci);
  if (nyata.startsWith(nilai)) console.log(`PASS  ${kunci} = ${nyata}`);
  else { console.log(`FAIL  ${kunci} = ${JSON.stringify(nyata)}, harusnya diawali ${nilai}`); rusak++; }
}

// Ikon tidak punya opsi baca-balik di rcedit v0.2.0, jadi hanya string versi yang
// diperiksa ulang di atas.

if (rusak) gagal(`${rusak} metadata exe tidak cocok setelah penulisan`);
console.log(`OK  branding diterapkan pada ${path.relative(root, exe)} (v${versi})`);
