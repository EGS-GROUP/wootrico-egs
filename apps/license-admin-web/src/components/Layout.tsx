import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { KeyRound, Terminal, LogOut, Webhook, Activity, LayoutDashboard, Users, Settings, Gift, CreditCard, LifeBuoy } from 'lucide-react';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Início', icon: LayoutDashboard, end: true },
  { to: '/users', label: 'Usuários', icon: Users },
  { to: '/keys', label: 'Chaves', icon: KeyRound },
  { to: '/free-licenses', label: 'Concedidas', icon: Gift },
  { to: '/payments', label: 'Pagamentos', icon: CreditCard },
  { to: '/support', label: 'Suporte', icon: LifeBuoy },
  { to: '/health', label: 'Saúde', icon: Activity },
  { to: '/logs', label: 'Logs', icon: Terminal },
  { to: '/webhook-keys', label: 'Webhooks', icon: Webhook },
  { to: '/settings', label: 'Configurações', icon: Settings },
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
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Licenças</p>
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
            <p className="text-[10px] uppercase tracking-wider text-neutral-600">Administrador</p>
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

      <main className="flex-1 bg-[#050509] min-h-screen">
        <div className="max-w-6xl mx-auto px-6 py-10">{children}</div>
      </main>
    </div>
  );
}
