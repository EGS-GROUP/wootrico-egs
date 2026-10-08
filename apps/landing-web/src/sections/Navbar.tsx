import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Terminal, Instagram, Youtube } from 'lucide-react';

const LINKS = [
  { href: '#recursos', label: 'Recursos' },
  { href: '#integracoes', label: 'Integrações' },
  { href: '#ecossistema', label: 'Ecossistema' },
  { href: '#sobre', label: 'Sobre' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6 }}
      className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
        scrolled
          ? 'bg-black/90 sm:bg-black/70 sm:backdrop-blur-xl border-b border-white/10'
          : 'bg-transparent'
      }`}
    >
      <nav className="container mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
        <a href="#topo" className="flex items-center gap-2.5">
          <img
            src="/logo_wootrico.png"
            alt="Wootrico"
            className="w-[4.5rem] h-[4.5rem] rounded-xl object-contain"
          />
          <span className="text-lg font-bold tracking-tight">Wootrico</span>
        </a>

        <div className="hidden md:flex items-center gap-8">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-neutral-400 hover:text-white transition-colors"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href="https://www.instagram.com/erico.arenato"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Instagram"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-white text-sm font-semibold shadow-lg shadow-pink-500/25 transition hover:opacity-90 bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5]"
          >
            <Instagram className="w-4 h-4" />
            <span className="hidden lg:inline">Instagram</span>
          </a>
          <a
            href="https://www.youtube.com/@ericorenato.automacao"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="YouTube"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-white text-sm font-semibold shadow-lg shadow-red-500/25 transition hover:opacity-90 bg-[#FF0000]"
          >
            <Youtube className="w-4 h-4" />
            <span className="hidden lg:inline">YouTube</span>
          </a>
          <a
            href="#instalacao"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-blue-500/20"
          >
            <Terminal className="w-4 h-4" />
            Instalar
          </a>
        </div>
      </nav>
    </motion.header>
  );
}
