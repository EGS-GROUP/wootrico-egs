import type { Config } from 'tailwindcss';

// The design relies on arbitrary classes (bg-[#111117], rounded-[24px], conic
// gradients) which Tailwind JIT generates automatically. We also expose the
// core tokens as semantic names for convenience.
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
