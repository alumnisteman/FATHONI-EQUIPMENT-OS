import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Build terpasang dimuat lewat file:// dan webRequest pada Electron tidak melihat
// respons skema tersebut, jadi CSP produksi harus ikut tertulis di dalam HTML.
// Nilai ini sengaja lebih ketat daripada CSP dev: tidak ada 'unsafe-inline' untuk
// script karena bundler tidak pernah menaruh skrip inline di index.html.
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // atribut style React + Tailwind
  "img-src 'self' data: blob:",       // foto unit dibaca sebagai blob/data URL
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  // frame-ancestors sengaja tidak dipakai di sini: direktif itu diabaikan bila
  // dikirim lewat <meta>, jadi perlindungan klikjacking ditangani oleh
  // penolakan navigasi/popup di main process.
].join('; ');

const productionCsp = {
  name: 'production-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: PRODUCTION_CSP },
      injectTo: 'head',
    },
  ],
} as PluginOption;

// https://vitejs.dev/config/
const pkgVersion: string = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')
).version;

export default defineConfig({
  plugins: [react(), productionCsp],
  // Satu sumber versi: yang tampil di layar login/tentang harus sama dengan
  // versi yang dipakai electron-builder dan app.getVersion() di main process.
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  base: './', // penting untuk Electron file:// protocol
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0', // akses LAN saat dev
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Hanya React core yang digabung manual. Memaksa recharts/jspdf masuk
        // ke chunk vendor membuat keduanya di-modulepreload saat aplikasi baru
        // dibuka (±760 KB JS sebelum layar login), padahal hanya dipakai di
        // halaman tertentu. Route lazy + dynamic import yang menangani sisanya.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});

