import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, CopyButton, Eyebrow } from '../components/ui';
import { getLogs, type LogEntry } from '../lib/system-api';

type KindFilter = 'all' | 'message' | 'audit' | 'webhook';

const REFRESH_MS = 5000;
const PAGE_SIZES = [50, 120, 250, 500] as const;

/** Build a plain-text dump of the loaded entries (one line per event). */
function buildLogsTxt(entries: LogEntry[]): string {
  return entries
    .map(
      (e) =>
        `${fmtDate(e.at)} ${fmtClock(e.at)} — ${e.title}${e.actor ? ` — ${e.actor}` : ''} — [${e.detail}]`,
    )
    .join('\n');
}

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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Friendly source label so a layperson knows where the event came from.
const SOURCE_LABEL: Record<string, string> = {
  provider: 'WhatsApp',
  chatwoot: 'Chatwoot',
  admin: 'Painel',
};

function SourceTag({ source }: { source: string }) {
  return (
    <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-neutral-300 shrink-0">
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

export default function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [pageSize, setPageSize] = useState<number>(120);
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const apiKind: 'audit' | 'webhook' | 'message' | undefined = kind === 'all' ? undefined : kind;

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await getLogs({ kind: apiKind, limit: pageSize });
      setEntries(page.entries);
      setNextBefore(page.nextBefore);
    } catch {
      setError('Falha ao carregar os logs.');
    } finally {
      setLoading(false);
    }
  }, [apiKind, pageSize]);

  // Poll only NEW entries and prepend them (live tail, keeps loaded history).
  const pollNew = useCallback(async () => {
    try {
      const page = await getLogs({ kind: apiKind, limit: pageSize });
      setEntries((prev) => {
        if (!prev.length) return page.entries;
        const seen = new Set(prev.map((e) => e.id));
        const fresh = page.entries.filter((e) => !seen.has(e.id));
        return fresh.length ? [...fresh, ...prev] : prev;
      });
    } catch {
      /* transient — ignore on auto-refresh */
    }
  }, [apiKind, pageSize]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoading(true);
    try {
      const page = await getLogs({ kind: apiKind, before: nextBefore, limit: pageSize });
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.entries.filter((e) => !seen.has(e.id))];
      });
      setNextBefore(page.nextBefore);
    } finally {
      setLoading(false);
    }
  }

  // Reload from scratch whenever the kind filter changes.
  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  // Auto-refresh tail.
  const pollRef = useRef(pollNew);
  pollRef.current = pollNew;
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void pollRef.current(), REFRESH_MS);
    return () => clearInterval(t);
  }, [auto]);

  const FILTERS: { key: KindFilter; label: string }[] = [
    { key: 'all', label: 'Tudo' },
    { key: 'message', label: 'Mensagens' },
    { key: 'audit', label: 'Ações' },
    { key: 'webhook', label: 'Webhooks' },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <Eyebrow>Sistema</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Logs do sistema</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Histórico de eventos da integração — mensagens trocadas com o WhatsApp e o Chatwoot e
          ações no painel. Por privacidade, o <b>conteúdo</b> das mensagens e mídias nunca é
          registrado, apenas o tipo do evento.
        </p>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 bg-[#121212] border border-white/5 rounded-xl p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setKind(f.key)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                kind === f.key ? 'bg-[#1A1A1D] text-white' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-neutral-400 select-none">
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
          <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="accent-blue-500"
            />
            Atualização automática
          </label>
          <button
            type="button"
            onClick={() => downloadTxt(`logs-${new Date().toISOString().slice(0, 10)}.txt`, buildLogsTxt(entries))}
            disabled={entries.length === 0}
            className="text-xs text-neutral-400 hover:text-white disabled:opacity-40"
          >
            Exportar (.txt)
          </button>
          <Button type="button" variant="ghost" onClick={loadLatest} loading={loading}>
            Atualizar
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {/* console */}
      <div className="rounded-2xl border border-white/5 bg-[#0B0B0D]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
          <span className="ml-2 text-xs text-neutral-500">{entries.length} eventos</span>
          {auto && <span className="ml-auto text-xs text-emerald-400/80">● ao vivo</span>}
        </div>

        <div className="max-h-[64vh] overflow-y-auto divide-y divide-white/[0.04]">
          {entries.length === 0 && !loading ? (
            <p className="px-4 py-6 text-neutral-500">Nenhum evento registrado ainda.</p>
          ) : (
            entries.map((e) => {
              const copyText = `${fmtDate(e.at)} ${fmtClock(e.at)} — ${e.title}${
                e.actor ? ` — ${e.actor}` : ''
              } — [${e.detail}]`;
              return (
                <div
                  key={e.id}
                  className="group flex items-start gap-4 px-4 py-3.5 hover:bg-white/[0.025]"
                >
                  {/* date + time */}
                  <div className="shrink-0 w-[92px] leading-tight tabular-nums">
                    <div className="text-sm text-neutral-300">{fmtClock(e.at)}</div>
                    <div className="text-[11px] text-neutral-600">{fmtDate(e.at)}</div>
                  </div>
                  <span
                    className={`shrink-0 mt-1.5 ${e.level === 'warn' ? 'text-amber-400' : 'text-emerald-400/70'}`}
                    title={e.level === 'warn' ? 'atenção' : 'ok'}
                  >
                    {e.level === 'warn' ? '▲' : '●'}
                  </span>
                  <SourceTag source={e.source} />
                  {/* friendly title + technical detail */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm leading-snug ${
                        e.level === 'warn' ? 'text-amber-200' : 'text-neutral-100'
                      }`}
                    >
                      {e.title}
                    </p>
                    <p className="mt-0.5 text-[11px] font-mono text-neutral-600 truncate" title={e.detail}>
                      {e.detail}
                    </p>
                  </div>
                  {e.actor && (
                    <span
                      className="shrink-0 max-w-[14rem] truncate text-xs px-2 py-1 rounded-md bg-white/5 text-neutral-300"
                      title={e.actor}
                    >
                      {e.actor}
                    </span>
                  )}
                  <CopyButton
                    value={copyText}
                    title="Copiar este evento"
                    className="mt-1 shrink-0 opacity-0 group-hover:opacity-100"
                  />
                </div>
              );
            })
          )}
        </div>

        {nextBefore && (
          <div className="px-4 py-3 border-t border-white/5 text-center">
            <button
              onClick={loadMore}
              disabled={loading}
              className="text-sm text-neutral-400 hover:text-white disabled:opacity-50"
            >
              Carregar mais antigos
            </button>
          </div>
        )}
      </div>

      <div className="mt-3">
        <Badge tone="neutral">sem conteúdo de mensagens/mídia</Badge>
      </div>
    </div>
  );
}
