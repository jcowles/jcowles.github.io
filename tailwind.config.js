/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#715dfa',
          secondary: '#5fe8d6',
          accent: '#ffb86b',
          dark: '#0b0c1e',
          light: '#f6f6ff',
        },
      },
      fontFamily: {
        sans: ['"Inter Tight"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 45px rgba(113, 93, 250, 0.45)',
      },
      backgroundImage: {
        'grid-glow':
          'radial-gradient(circle at center, rgba(113, 93, 250, 0.25) 0%, rgba(11, 12, 30, 0.85) 55%, rgba(11, 12, 30, 1) 100%)',
      },
    },
  },
  plugins: [],
}

