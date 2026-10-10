/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sany: {
          red: '#E60012',
          redHover: '#CC0010',
          redDark: '#99000C',
          dark: '#121316',
          charcoal: '#1A1C21',
          surface: '#23262D',
          border: '#323742',
          textMuted: '#94A3B8',
          yellow: '#F59E0B',
          green: '#10B981',
          blue: '#3B82F6',
        }
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'glow-red': '0 0 15px rgba(230, 0, 18, 0.35)',
        'card-dark': '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
      }
    },
  },
  plugins: [],
}
