/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17191E',
        muted: '#5B606B',
        faint: '#8A8E97',
        line: '#E4E3DE',
        line2: '#CFCDC6',
        divider: '#EFEEEA',
        ground: '#F4F3EF',
        chip: '#F1F0EC',
        panel: '#F8F7F4',
        accent: { DEFAULT: '#C23E22', dark: '#8F2C17', soft: '#FBEAE5' },
        danger: '#A33519',
        ok: { DEFAULT: '#1F7A4D', text: '#1F5C3C', soft: '#E6F1EA' },
        warn: { text: '#7A4E0F', soft: '#FBF0DC', icon: '#C2841F' },
        avatar: '#E9E1D6',
        photo: '#E3DFD6',
        map: { land: '#ECEAE4', water: '#CBDAE2', park: '#D5E2CC', label: '#A29E94', river: '#6E8794' },
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        float: '0 1px 2px rgba(23,25,30,0.08), 0 4px 16px rgba(23,25,30,0.08)',
        pop: '0 2px 4px rgba(23,25,30,0.08), 0 12px 32px rgba(23,25,30,0.18)',
        pin: '0 4px 10px rgba(23,25,30,0.25)',
      },
    },
  },
  plugins: [],
};
