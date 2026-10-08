import type { Config } from 'tailwindcss';

// Mesmos tokens do painel (apps/panel-web) para a landing combinar com o produto:
// fundo escuro + acento azul. Tailwind JIT gera as classes arbitrárias usadas
// nas seções (bg-[#111117], shadow-blue-500/20, gradientes, etc).
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
