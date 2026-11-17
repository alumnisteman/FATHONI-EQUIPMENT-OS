// tests/harness/tahan-run.cjs
// Driver bertenaga node untuk tahan-check.cjs. Kenapa perlu driver: salah satu
// stage-nya harus MATI dengan benar-benar paksa, dan tidak ada proses di dalam
// Electron yang boleh membunuh dirinya sendiri lalu hidup lagi untuk membuktikan
// apa yang tersisa. Driver ini yang menahan, men-switch profil, dan memakai
// taskkill /F /T (pohon proses penuh, tanpa kesempatan flush) untuk tahap
// "listrik padam".
//
// Tiga tahap berurutan di atas SATU profil:
//   isi    : sesi panjang + kanal data mati lalu pulih + tutup WAJAR saat
//            simpanan masih tertunda (proses keluar sendiri, rapi).
//   paksa  : satu perubahan ditinggal di jendela debounce 800 ms; driver yang
//            membunuhnya begitu marker TAHAN-B SIAP tercetak.
//   bukti  : profil yang sama dibuka lagi dan diperiksa apakah file sehat dan
//            apa yang bertahan.
//
// PASS/FAIL ketiga tahap digabung jadi satu ringkasan rantai.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ELEKTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const CHECK = path.join(__dirname, 'tahan-check.cjs');
const PROFIL = path.join(ROOT, 'tmp-harness', 'r-tahan');

let lulus = 0, gagal = 0;

function terbitkan(chunk) {
  for (const baris of String(chunk).split(/\r?\n/)) {
    if (!baris) continue;
    if (baris.startsWith('PASS ')) lulus++;
    else if (baris.startsWith('FAIL ')) gagal++;
    console.log(baris);
  }
}

// Satu tahap Electron. mode 'paksa' dihentikan paksa setelah markernya muncul;
// yang lain dinilai dari kode keluarnya sendiri.
function tahap(nama, opts) {
  return new Promise(resolve => {
    const mulai = Date.now();
    console.log(`=== TAHAP ${nama}`);
    const anak = spawn(ELEKTRON, [CHECK], {
      cwd: ROOT,
      env: { ...process.env, HEMS_DATA_DIR: PROFIL.split(path.sep).join('/'), TAHAN_MODE: nama },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let selesaiKarenaMarker = false;
    let tuntas = false;
    const akhir = (hasil) => {
      if (tuntas) return;
      tuntas = true;
      clearTimeout(pengaman);
      console.log(`--- tahap ${nama}: ${hasil} (${Math.round((Date.now() - mulai) / 1000)} s)`);
      resolve();
    };
    const pengaman = setTimeout(() => {
      console.log(`TIMEOUT tahap ${nama} setelah ${opts.timeoutMs / 1000} s — pohon proses dibunuh`);
      gagal++;
      bunuhPaksa(anak, () => akhir('waktu habis'));
    }, opts.timeoutMs);

    anak.stdout.on('data', chunk => {
      terbitkan(chunk);
      if (opts.marker && String(chunk).includes(opts.marker) && !selesaiKarenaMarker) {
        // Marker muncul: driver sengaja menunggu sebagian kecil dari jendela
        // debounce (800 ms) supaya simpanan tertunda benar-benar masih tertunda,
        // baru membunuhnya.
        selesaiKarenaMarker = true;
        setTimeout(() => bunuhPaksa(anak, () => akhir('dibunuh paksa sesuai rencana')), opts.jedaSebelumBunuh ?? 250);
      }
    });
    anak.stderr.on('data', chunk => terbitkan(chunk));
    anak.on('error', err => {
      console.log('FAIL proses ' + nama + ' tidak bisa dijalankan: ' + err.message);
      akhir('gagal start');
    });
    anak.on('exit', kode => {
      if (selesaiKarenaMarker) return akhir('keluar sesudah dibunuh');
      if (opts.harusKelarBersih && kode !== 0) {
        console.log(`FAIL tahap ${nama} keluar tidak bersih (kode ${kode})`);
      }
      akhir('keluar kode=' + kode);
    });
  });
}

// taskkill /F /T = pohon prosesnya habis, termasuk renderer dan GPU process,
// tanpa satu pun kesempatan flush. Inilah "ditutup paksa" yang sebenarnya.
function bunuhPaksa(anak, lalu) {
  const p = spawn('taskkill', ['/F', '/T', '/PID', String(anak.pid)], { stdio: 'ignore' });
  p.on('exit', () => setTimeout(lalu, 1200));
  p.on('error', () => { anak.kill('SIGKILL'); setTimeout(lalu, 1200); });
}

async function utama() {
  if (!fs.existsSync(ELEKTRON)) {
    console.log('HARNESS ERROR: ' + ELEKTRON + ' tidak ada');
    console.log('SELESAI kode=8');
    process.exit(8);
  }
  fs.rmSync(PROFIL, { recursive: true, force: true });
  fs.mkdirSync(PROFIL, { recursive: true });

  await tahap('isi', { timeoutMs: 20 * 60000, harusKelarBersih: true });
  await tahap('paksa', { timeoutMs: 8 * 60000, marker: 'TAHAN-B SIAP', jedaSebelumBunuh: 250 });
  await tahap('bukti', { timeoutMs: 12 * 60000, harusKelarBersih: true });

  fs.rmSync(PROFIL, { recursive: true, force: true });
  console.log(`\n=== tahan-check: ${lulus} lulus, ${gagal} gagal ===`);
  console.log(`SELESAI kode=${gagal === 0 ? 0 : 1}`);
  process.exit(gagal === 0 ? 0 : 1);
}

utama().catch(err => {
  console.log('HARNESS ERROR', err && (err.stack || err.message));
  console.log('SELESAI kode=2');
  process.exit(2);
});
