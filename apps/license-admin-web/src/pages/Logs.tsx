import { useCallback, useEffect, useRef, useState } from 'react';
import { Eyebrow } from '../components/ui';
import { getServerLogs, getEvents, type ServerLogEntry, type LicenseEvent } from '../lib/admin-api';

const REFRESH_MS = 5000;
const PAGE_SIZES = [50, 100, 250, 500] as const;

/** Trigger a client-side download of `content` as a .txt file. */
function downloadTxt(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function serverLogsToTxt(entries: ServerLogEntry[]): string {
  return entries
    .map(
      (e) =>
        `${new Date(e.at).toLocaleString()} [${e.levelLabel}] ${e.msg}${
          e.meta ? ` ${JSON.stringify(e.meta)}` : ''
        }`,
    )
    .join('\n');
}

function eventsToTxt(events: LicenseEvent[]): string {
  return events
    .map(
      (e) =>
        `${new Date(e.createdAt).toLocaleString()} — ${EVENT_LABEL[e.type] ?? e.type} — [${[
          e.ip,
          e.appVersion,
          e.licenseKeyId,
          e.meta ? JSON.stringify(e.meta) : null,
        ]
          .filter(Boolean)
          .join(' · ')}]`,
    )
    .join('\n');
}

const EVENT_LABEL: Record<string, string> = {
  provision: 'Provisionamento',
  provision_reused: 'Provisionamento (reuso)',
  provision_denied: 'Provisionamento negado (teste já usado)',
  activate: 'Ativação',
  activate_revoked: 'Ativação negada (revogada)',
  activate_expired: 'Ativação negada (expirada)',
  ip_changed: 'IP alterado',
  ip_alert: 'Alerta de IP (compartilhamento)',
  validate: 'Validação',
  deactivate: 'Desativação',
  purchase_intent: 'Intenção de compra',
  payment_confirmed: 'Pagamento confirmado',
  admin_create: 'Admin: criada',
  admin_revoke: 'Admin: revogada',
  admin_activate: 'Admin: reativada',
  admin_upgrade: 'Admin: liberada como paga',
  admin_expire: 'Admin: expirada',
};
const WARN = new Set(['ip_alert', 'ip_changed', 'activate_revoked', 'activate_expired']);
const ADMIN = new Set(['admin_create', 'admin_revoke', 'admin_activate', 'admin_upgrade', 'admin_expire', 'payment_confirmed']);

const LEVEL_DOT: Record<string, string> = {
  trace: 'text-neutral-600',
  debug: 'text-neutral-500',
  info: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  fatal: 'text-red-500',
};

export default function Logs() {
  const [tab, setTab] = useState<'server' | 'events'>('server');
  const [auto, setAuto] = useState(true);
  const [pageSize, setPageSize] = useState<number>(100);
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);
  const [events, setEvents] = useState<LicenseEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>();

  const refresh = useCallback(() => {
    if (tab === 'server')
      getServerLogs({ limit: pageSize }).then((r) => setServerLogs(r.entries)).catch(() => {});
    else
      getEvents({ limit: pageSize })
        .then((r) => {
          setEvents(r.events);
          setNextBefore(r.nextBefore);
        })
        .catch(() => {});
  }, [tab, pageSize]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    clearInterval(timer.current);
    if (auto) timer.current = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [auto, refresh]);

  async function loadMoreEvents() {
    if (!nextBefore) return;
    setLoading(true);
    try {
      const r = await getEvents({ limit: pageSize, before: nextBefore });
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...r.events.filter((e) => !seen.has(e.id))];
      });
      setNextBefore(r.nextBefore);
    } finally {
      setLoading(false);
    }
  }

  function onExport() {
    const stamp = new Date().toISOString().slice(0, 10);
    if (tab === 'server') downloadTxt(`server-logs-${stamp}.txt`, serverLogsToTxt(serverLogs));
    else downloadTxt(`license-events-${stamp}.txt`, eventsToTxt(events));
  }

  const exportDisabled = tab === 'server' ? serverLogs.length === 0 : events.length === 0;

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <Eyebrow>Operação</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Logs</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Logs do servidor e eventos de chaves/clientes (provisão, validação, IPs, pagamentos, admin).
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            Exibir
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-[#121212] border border-white/5 rounded-lg px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:border-blue-500/30"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onExport}
            disabled={exportDisabled}
            className="text-xs text-neutral-400 hover:text-white disabled:opacity-40"
          >
            Exportar (.txt)
          </button>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Atualizar
          </label>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {(['server', 'events'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t ? 'bg-[#1A1A1D] text-white border border-white/10' : 'text-neutral-400 hover:text-white border border-transparent'
            }`}
          >
            {t === 'server' ? 'Servidor' : 'Eventos'}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#0d0d0f] divide-y divide-white/5">
        {tab === 'server' ? (
          serverLogs.length === 0 ? (
            <p className="text-sm text-neutral-500 px-4 py-6">Sem logs ainda.</p>
          ) : (
            serverLogs.map((e, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-2 text-xs font-mono">
                <span className="text-neutral-600 w-36 shrink-0">{new Date(e.at).toLocaleTimeString()}</span>
                <span className={`w-12 shrink-0 ${LEVEL_DOT[e.levelLabel] ?? 'text-neutral-500'}`}>{e.levelLabel}</span>
                <span className="text-neutral-200 flex-1 break-all">
                  {e.msg}
                  {e.meta ? <span className="text-neutral-500"> {JSON.stringify(e.meta)}</span> : null}
                </span>
              </div>
            ))
          )
        ) : events.length === 0 ? (
          <p className="text-sm text-neutral-500 px-4 py-6">Sem eventos.</p>
        ) : (
          events.map((e) => {
            const tone = WARN.has(e.type) ? 'text-amber-400' : ADMIN.has(e.type) ? 'text-blue-400' : 'text-emerald-400';
            return (
              <div key={e.id} className="flex items-start gap-3 px-4 py-2 text-xs">
                <span className="text-neutral-600 w-36 shrink-0 font-mono">{new Date(e.createdAt).toLocaleString()}</span>
                <span className={`w-2 shrink-0 ${tone}`}>●</span>
                <span className="text-neutral-200 flex-1">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="text-neutral-500 font-mono truncate max-w-[45%]">
                  {[e.ip, e.appVersion, e.licenseKeyId?.slice(0, 8), e.meta ? JSON.stringify(e.meta) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            );
          })
        )}

        {tab === 'events' && nextBefore && (
          <div className="px-4 py-3 text-center">
            <button
              onClick={loadMoreEvents}
              disabled={loading}
              className="text-sm text-neutral-400 hover:text-white disabled:opacity-50"
            >
              Carregar mais antigos
            </button>
          </div>
        )}
      </div>

      {tab === 'server' && (
        <p className="mt-3 text-[11px] text-neutral-600">
          Os logs do servidor vêm de um buffer em memória (limitado aos mais recentes). Para histórico
          completo, use a aba Eventos.
        </p>
      )}
    </div>
  );
}
