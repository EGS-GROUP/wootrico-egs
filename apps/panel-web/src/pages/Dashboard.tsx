import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Database,
  Inbox,
  RefreshCw,
  Send,
  Server,
  Users,
  Zap,
} from 'lucide-react';
import { Badge, Card, Eyebrow } from '../components/ui';
import { FlowChart } from '../components/FlowChart';
import {
  getLogs,
  getSystemInfo,
  getSystemStats,
  runDiagnostics,
  type Diagnostics,
  type LogEntry,
  type PingResult,
  type ProviderType,
  type SystemInfo,
  type SystemStats,
} from '../lib/system-api';

const REFRESH_MS = 20000;

type ProviderFilter = 'all' | ProviderType;

const PROVIDERS: { key: ProviderFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'evolution', label: 'Evolution' },
  { key: 'zapi', label: 'Z-API' },
  { key: 'uazapi', label: 'Uazapi' },
];

const PROVIDER_LABEL: Record<string, string> = {
  evolution: 'Evolution',
  zapi: 'Z-API',
  uazapi: 'Uazapi',
};

const LIC_TONE: Record<string, 'ok' | 'error' | 'neutral'> = {
  active: 'ok',
  warning: 'neutral',
  blocked: 'error',
  unactivated: 'neutral',
};
const LIC_LABEL: Record<string, string> = {
  active: 'Ativa',
  warning: 'Atenção',
  blocked: 'Bloqueada',
  unactivated: 'Não ativada',
  unknown: 'Desconhecida',
};

const SOURCE_LABEL: Record<string, string> = {
  provider: 'WhatsApp',
  chatwoot: 'Chatwoot',
  admin: 'Painel',
};

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function Dashboard() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const [provider, setProvider] = useState<ProviderFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (r: '24h' | '7d', prov: ProviderFilter) => {
      setRefreshing(true);
      await Promise.all([
        getSystemInfo().then(setInfo).catch(() => {}),
        runDiagnostics().then(setDiag).catch(() => {}),
        getSystemStats(r, prov === 'all' ? undefined : prov)
          .then(setStats)
          .catch(() => {}),
        getLogs({ limit: 7 }).then((p) => setLogs(p.entries)).catch(() => {}),
      ]);
      setRefreshing(false);
    },
    [],
  );

  useEffect(() => {
    void load(range, provider);
  }, [load, range, provider]);

  // Auto-refresh keeps the overview "live" without manual reloads.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const t = setInterval(() => void loadRef.current(range, provider), REFRESH_MS);
    return () => clearInterval(t);
  }, [range, provider]);

  const enabled = info?.integrations.enabled ?? 0;
  const totalInt = info?.integrations.total ?? 0;
  const erroredInt = info?.integrations.byStatus?.error ?? 0;
  const license = info?.license;
  const rangeLabel = range === '7d' ? '7 dias' : '24 h';

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Eyebrow>Início</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Visão geral</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Estado dos serviços, fluxo de mensagens e atividade recente da sua instância.
          </p>
        </div>
        <button
          onClick={() => void load(range, provider)}
          className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-neutral-300 transition-colors hover:text-white hover:border-white/20"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {/* ── service health ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <ServiceCard
          icon={<Database size={15} />}
          label="Banco de dados"
          sub="PostgreSQL"
          result={diag?.postgres}
          loading={diag === null}
        />
        <ServiceCard
          icon={<Server size={15} />}
          label="Fila de mensagens"
          sub="RabbitMQ"
          result={diag?.rabbitmq}
          loading={diag === null}
        />
        <ServiceCard
          icon={<Zap size={15} />}
          label="Cache"
          sub="Redis"
          result={diag?.redis}
          loading={diag === null}
        />
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Link to="/integrations">
          <KpiCard
            icon={<Activity size={15} />}
            label="Integrações ativas"
            value={info ? String(enabled) : '…'}
            hint={
              info
                ? `${totalInt} no total${erroredInt > 0 ? ` · ${erroredInt} com erro` : ''}`
                : ''
            }
            hover
          />
        </Link>
        <Link to="/contacts">
          <KpiCard
            icon={<Users size={15} />}
            label="Contatos"
            value={info ? String(info.directory.contactIdentities) : '…'}
            hint="no diretório"
            hover
          />
        </Link>
        <KpiCard
          icon={<Inbox size={15} className="text-emerald-400" />}
          label="Recebidas"
          value={stats ? String(stats.totals.received) : '…'}
          hint={`WhatsApp · ${rangeLabel}`}
        />
        <KpiCard
          icon={<Send size={15} className="text-violet-400" />}
          label="Enviadas"
          value={stats ? String(stats.totals.sent) : '…'}
          hint={`Chatwoot · ${rangeLabel}`}
        />
      </div>

      {/* ── message flow chart ── */}
      <Card className="mb-4">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white">Fluxo de mensagens</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Eventos trocados com WhatsApp e Chatwoot (sem conteúdo)
              {provider !== 'all' ? ` · ${PROVIDER_LABEL[provider]}` : ''}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/5 bg-[#121212] p-1">
              {PROVIDERS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setProvider(p.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    provider === p.key ? 'bg-[#1A1A1D] text-white' : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-white/5 bg-[#121212] p-1">
              {(['24h', '7d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    range === r ? 'bg-[#1A1A1D] text-white' : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {r === '24h' ? '24 horas' : '7 dias'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {stats ? (
          <>
            <FlowChart buckets={stats.buckets} range={stats.range} />
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/5 pt-4 text-xs text-neutral-400">
              <span>
                Total de eventos:{' '}
                <span className="font-medium text-neutral-200">{stats.totals.events}</span>
              </span>
              <span>
                Aceitos:{' '}
                <span className="font-medium text-emerald-400">{stats.totals.accepted}</span>
              </span>
              <span>
                Descartados:{' '}
                <span className="font-medium text-amber-400">{stats.totals.discarded}</span>
              </span>
            </div>

            {/* per-provider split */}
            {stats.byProvider.length > 0 && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {stats.byProvider.map((p) => (
                  <button
                    key={p.provider}
                    onClick={() => setProvider(p.provider as ProviderFilter)}
                    className={`rounded-xl border bg-[#121212] px-4 py-3 text-left transition-colors ${
                      provider === p.provider
                        ? 'border-blue-500/30'
                        : 'border-white/5 hover:border-white/15'
                    }`}
                  >
                    <p className="text-xs text-neutral-300">
                      {PROVIDER_LABEL[p.provider] ?? p.provider}
                    </p>
                    <div className="mt-2 flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-sm bg-emerald-400" />
                        <span className="font-medium text-neutral-100">{p.received}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-sm bg-violet-400" />
                        <span className="font-medium text-neutral-100">{p.sent}</span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="h-[240px] animate-pulse rounded-xl bg-white/[0.02]" />
        )}
      </Card>

      {/* ── recent activity + side info ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Últimos eventos</h2>
            <Link to="/logs" className="text-xs text-blue-400 hover:underline">
              Ver todos →
            </Link>
          </div>
          {logs.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">Nenhum evento registrado ainda.</p>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {logs.map((e) => (
                <div key={e.id} className="flex items-start gap-3 py-2.5">
                  <span className="w-[44px] shrink-0 pt-0.5 text-xs tabular-nums text-neutral-500">
                    {fmtClock(e.at)}
                  </span>
                  <span
                    className={`mt-1 shrink-0 text-[10px] ${
                      e.level === 'warn' ? 'text-amber-400' : 'text-emerald-400/70'
                    }`}
                  >
                    {e.level === 'warn' ? '▲' : '●'}
                  </span>
                  <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
                    {SOURCE_LABEL[e.source] ?? e.source}
                  </span>
                  <p
                    className={`min-w-0 flex-1 truncate text-sm ${
                      e.level === 'warn' ? 'text-amber-200' : 'text-neutral-200'
                    }`}
                    title={e.title}
                  >
                    {e.title}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs text-neutral-400">Licença</span>
              {license && (
                <Badge tone={LIC_TONE[license.status] ?? 'neutral'}>
                  {LIC_LABEL[license.status] ?? license.status}
                </Badge>
              )}
            </div>
            <p className="text-2xl font-semibold tracking-tight text-white">
              {license ? (LIC_LABEL[license.status] ?? license.status) : '…'}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">
              {license?.status === 'active' || license?.status === 'warning'
                ? license?.plan === 'paid'
                  ? 'definitiva'
                  : 'ativa'
                : license?.status === 'blocked'
                  ? 'inativa'
                  : 'não ativada'}
            </p>
            <Link to="/license" className="mt-3 inline-block text-xs text-blue-400 hover:underline">
              Gerenciar →
            </Link>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-medium text-white">Tipos de evento</h2>
            {stats && stats.byEventType.length > 0 ? (
              <EventTypeBars data={stats.byEventType} />
            ) : (
              <p className="py-2 text-xs text-neutral-500">Sem eventos no período.</p>
            )}
          </Card>
        </div>
      </div>

      {totalInt === 0 && info && (
        <Card className="mt-4">
          <p className="text-sm text-neutral-400">
            Nenhuma integração ainda.{' '}
            <Link to="/integrations/new" className="text-blue-400 hover:underline">
              Criar a primeira →
            </Link>
          </p>
        </Card>
      )}
    </div>
  );
}

function ServiceCard({
  icon,
  label,
  sub,
  result,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  result?: PingResult;
  loading: boolean;
}) {
  const ok = result?.ok;
  const tone = loading ? 'bg-neutral-500' : ok ? 'bg-emerald-500' : 'bg-red-500';
  const text = loading ? 'Verificando…' : ok ? 'Operacional' : 'Falha';
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-neutral-400">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <span className={`h-2 w-2 rounded-full ${tone} ${loading ? 'animate-pulse' : ''}`} />
      </div>
      <p className={`text-xl font-semibold tracking-tight ${ok ? 'text-white' : loading ? 'text-neutral-400' : 'text-red-300'}`}>
        {text}
      </p>
      <p className="mt-1 truncate text-[11px] text-neutral-500" title={result?.detail ?? sub}>
        {result?.detail ?? sub}
      </p>
    </Card>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  hover,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  hover?: boolean;
}) {
  return (
    <Card className={hover ? 'transition-colors hover:border-blue-500/25' : ''}>
      <div className="mb-3 flex items-center gap-2 text-neutral-400">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-neutral-500">{hint}</p>}
    </Card>
  );
}

function EventTypeBars({
  data,
}: {
  data: Array<{ source: string; eventType: string | null; n: number }>;
}) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate text-neutral-300" title={d.eventType ?? '—'}>
              <span className="text-neutral-500">{SOURCE_LABEL[d.source] ?? d.source} · </span>
              {d.eventType ?? '—'}
            </span>
            <span className="shrink-0 tabular-nums text-neutral-400">{d.n}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className={d.source === 'provider' ? 'h-full bg-emerald-400/70' : 'h-full bg-violet-400/70'}
              style={{ width: `${(d.n / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
