import type { Config } from 'tailwindcss';

// Mirrors apps/panel-web/tailwind.config.ts so the license admin panel uses the
// exact same design tokens and arbitrary-class conventions.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#000000',
        section: '#050509',
        panel: '#09090b',
        card: '#111117',
        input: '#121212',
        sidebar: '#1A1A1D',
      },
      borderRadius: {
        card: '24px',
        panel: '28px',
        xpanel: '32px',
      },
    },
  },
  plugins: [],
} satisfies Config;
