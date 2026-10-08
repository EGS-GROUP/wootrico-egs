import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  Plug,
  Users,
  MessagesSquare,
  Images,
  KeyRound,
  Terminal,
  SlidersHorizontal,
  LifeBuoy,
  BookOpen,
  Instagram,
  Youtube,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

const UTM = '?utm_source=wootrico_panel';
const FOOTER_LINKS = [
  { href: `https://ericorenato.com.br/privacidade${UTM}`, label: 'Privacidade' },
  { href: `https://ericorenato.com.br/termos${UTM}`, label: 'Política de uso' },
  { href: `https://clawhermes.ericorenato.com.br/${UTM}`, label: 'OpenClaw Hermes' },
  { href: `https://evogo.ericorenato.com.br${UTM}`, label: 'Evolution Go' },
  { href: `https://ericorenato.com.br${UTM}`, label: 'ericorenato.com.br' },
];

function PanelFooter() {
  return (
    <footer className="border-t border-white/5 px-6 py-5">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          {FOOTER_LINKS.map((l, i) => (
            <span key={l.href} className="flex items-center gap-3">
              {i > 0 && <span className="text-neutral-700">·</span>}
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-neutral-200 transition-colors"
              >
                {l.label}
              </a>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span>por Érico Renato</span>
          <a
            href="https://www.instagram.com/erico.arenato"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Instagram"
            className="text-neutral-500 hover:text-white transition-colors"
          >
            <Instagram size={16} />
          </a>
          <a
            href="https://www.youtube.com/@ericorenato.automacao"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="YouTube"
            className="text-neutral-500 hover:text-white transition-colors"
          >
            <Youtube size={16} />
          </a>
        </div>
      </div>
    </footer>
  );
}

const NAV = [
  { to: '/', label: 'Início', icon: LayoutDashboard, end: true },
  { to: '/integrations', label: 'Integrações', icon: Plug },
  { to: '/contacts', label: 'Contatos', icon: Users },
  { to: '/conversations', label: 'Conversas', icon: MessagesSquare },
  { to: '/media', label: 'Mídias', icon: Images },
  { to: '/system', label: 'Sistema', icon: SlidersHorizontal },
  { to: '/license', label: 'Licença', icon: KeyRound },
  { to: '/support', label: 'Suporte', icon: LifeBuoy },
  { to: '/manual', label: 'Manual', icon: BookOpen },
  { to: '/logs', label: 'Logs', icon: Terminal },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white flex">
      <aside className="hidden md:flex w-64 flex-col bg-gradient-to-br from-white/10 to-white/0 border-r border-white/5 px-5 py-6">
        <div className="flex items-center gap-3 px-2 mb-10">
          <img
            src="/logo_wootrico.png"
            alt="Wootrico"
            className="w-9 h-9 rounded-xl object-contain"
          />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Wootrico</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Painel</p>
          </div>
        </div>

        <nav className="space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#1A1A1D] text-white border border-white/5'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto pt-6">
          <div className="px-2 mb-3">
            <p className="text-xs text-neutral-400 truncate">{user?.email}</p>
            <p className="text-[10px] uppercase tracking-wider text-neutral-600">{user?.role}</p>
          </div>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 bg-[#050509] min-h-screen flex flex-col">
        <div className="flex-1 w-full max-w-6xl mx-auto px-6 py-10">{children}</div>
        <PanelFooter />
      </main>
    </div>
  );
}
