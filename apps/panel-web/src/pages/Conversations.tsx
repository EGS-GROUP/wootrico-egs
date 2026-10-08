import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Search, Users, User, MessageSquare, X, AlertTriangle } from 'lucide-react';
import { Button, Eyebrow, Field, Input } from '../components/ui';
import {
  listConversations,
  getConversation,
  exportConversations,
  type ConversationDTO,
  type ConversationMessage,
} from '../lib/conversations-api';
import { getLicenseStatus, type LicenseStatus } from '../lib/license-api';

const PAGE_SIZE = 50;

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Conversations() {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [rows, setRows] = useState<ConversationDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modal (popup) state for one conversation.
  const [openConv, setOpenConv] = useState<ConversationDTO | null>(null);
  const [detail, setDetail] = useState<ConversationMessage[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportingOne, setExportingOne] = useState(false);

  useEffect(() => {
    getLicenseStatus().then(setLicense).catch(() => {});
  }, []);

  const licensed = license ? license.status === 'active' || license.status === 'warning' : true;

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError('');
      try {
        const res = await listConversations({
          search: query || undefined,
          from: from || undefined,
          to: to || undefined,
          page: p,
          pageSize: PAGE_SIZE,
        });
        setRows(res.conversations);
        setTotal(res.total);
        setPage(res.page);
        setSelected(new Set());
      } catch (err) {
        const code = (err as { code?: string })?.code;
        setError(code === 'license_inactive' ? 'license_inactive' : 'Falha ao carregar as conversas.');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [query, from, to],
  );

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (licensed) void load(1);
  }, [licensed, load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function openModal(c: ConversationDTO) {
    setOpenConv(c);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await getConversation(c.id);
      setDetail(d.messages);
    } catch {
      setDetail([]);
    } finally {
      setDetailLoading(false);
    }
  }

  async function exportOne(format: 'json' | 'txt') {
    if (!openConv) return;
    setExportingOne(true);
    try {
      await exportConversations(format, { ids: [openConv.id] });
    } catch {
      setError('Falha ao exportar.');
    } finally {
      setExportingOne(false);
    }
  }

  async function doExport(format: 'json' | 'txt') {
    setExporting(true);
    try {
      await exportConversations(format, {
        ids: selected.size ? [...selected] : undefined,
        search: query || undefined,
        from: from || undefined,
        to: to || undefined,
      });
    } catch {
      setError('Falha ao exportar.');
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const exportLabel = selected.size ? `${selected.size} selecionada(s)` : 'todas';

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <Eyebrow>Dados</Eyebrow>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Conversas</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            Histórico das conversas capturadas, agrupadas por contato. Clique numa conversa para
            abri-la (texto <strong className="text-neutral-300">truncado</strong>); para o conteúdo
            completo, <strong className="text-neutral-300">exporte</strong>. Retenção em{' '}
            <Link to="/system" className="underline hover:text-white">Sistema</Link>.
          </p>
        </div>
        {licensed && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500 mr-1">Exportar {exportLabel}:</span>
            <Button variant="ghost" onClick={() => doExport('json')} loading={exporting} disabled={!total}>
              <Download size={16} /> JSON
            </Button>
            <Button variant="ghost" onClick={() => doExport('txt')} loading={exporting} disabled={!total}>
              <Download size={16} /> TXT
            </Button>
          </div>
        )}
      </div>

      {!licensed ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-200">
          <p className="font-medium">Licença inativa</p>
          <p className="mt-1 text-amber-200/80">
            As conversas capturadas e a exportação só ficam disponíveis com a licença ativa. Você pode
            ajustar as configurações normalmente.{' '}
            <Link to="/license" className="underline hover:text-white">Ativar licença</Link>.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Field label="Buscar (nome, número ou trecho)">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ex.: João, 5521…"
                    className="pl-9"
                  />
                </div>
              </Field>
            </div>
            <Field label="De">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Até">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>

          {error && error !== 'license_inactive' && <p className="mb-4 text-sm text-red-400">{error}</p>}

          {loading ? (
            <p className="text-sm text-neutral-500">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-neutral-500">Nenhuma conversa capturada ainda.</p>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-2 text-xs text-neutral-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={toggleAll}
                  className="accent-blue-500"
                />
                Selecionar todas (página)
              </label>

              <div className="space-y-2">
                {rows.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-3 rounded-xl border border-white/5 bg-[#0F0F11] p-4 hover:border-white/10 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 accent-blue-500 shrink-0"
                    />
                    <button type="button" onClick={() => openModal(c)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2 mb-0.5">
                        {c.isGroup ? (
                          <Users size={13} className="text-neutral-400 shrink-0" />
                        ) : (
                          <User size={13} className="text-neutral-400 shrink-0" />
                        )}
                        <span className="text-sm font-medium text-white truncate">
                          {c.name || c.number || 'Sem nome'}
                        </span>
                      </div>
                      <p className="flex items-start gap-1.5 text-sm text-neutral-300">
                        <MessageSquare size={13} className="mt-0.5 shrink-0 text-neutral-600" />
                        <span className="line-clamp-1">{c.preview || '—'}</span>
                      </p>
                    </button>
                    <div className="text-right text-[11px] text-neutral-500 shrink-0">
                      <p>{fmt(c.lastMessageAt)}</p>
                      {c.number && !c.isGroup && <p className="font-mono">{c.number}</p>}
                      <p>
                        {c.messageCount} msg{c.messageCount === 1 ? '' : 's'}
                        {c.integration ? ` · ${c.integration}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {total > PAGE_SIZE && (
            <div className="mt-5 flex items-center justify-between text-sm text-neutral-400">
              <span>{total} conversas</span>
              <div className="flex items-center gap-3">
                <button
                  className="hover:text-white disabled:opacity-40"
                  disabled={page <= 1 || loading}
                  onClick={() => void load(page - 1)}
                >
                  Anterior
                </button>
                <span>
                  {page} / {totalPages}
                </span>
                <button
                  className="hover:text-white disabled:opacity-40"
                  disabled={page >= totalPages || loading}
                  onClick={() => void load(page + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Popup da conversa */}
      {openConv && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpenConv(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#0B0B0D] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-white/5 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {openConv.isGroup ? (
                    <Users size={14} className="text-neutral-400 shrink-0" />
                  ) : (
                    <User size={14} className="text-neutral-400 shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-white truncate">
                    {openConv.name || openConv.number || 'Sem nome'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {openConv.number && !openConv.isGroup ? `${openConv.number} · ` : ''}
                  {openConv.messageCount} mensagem(ns){openConv.integration ? ` · ${openConv.integration}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenConv(null)}
                className="text-neutral-500 hover:text-white"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {/* Aviso de truncamento */}
            <div className="flex items-start gap-2 border-b border-white/5 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-200/90">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-300" />
              <span>
                Visualização <strong>truncada</strong> (até 200 caracteres por mensagem). Para o texto
                completo, exporte abaixo.
              </span>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {detailLoading ? (
                <p className="text-xs text-neutral-500">Carregando histórico…</p>
              ) : !detail || detail.length === 0 ? (
                <p className="text-xs text-neutral-500">Sem mensagens capturadas.</p>
              ) : (
                detail.map((m, i) => (
                  <div
                    key={i}
                    className={`flex flex-col ${m.direction === 'outgoing' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                        m.direction === 'outgoing'
                          ? 'bg-blue-500/15 text-blue-100'
                          : 'bg-white/5 text-neutral-200'
                      }`}
                    >
                      {m.sender && <span className="block text-[10px] text-neutral-400">{m.sender}</span>}
                      {m.text}
                    </div>
                    <span className="mt-0.5 text-[10px] text-neutral-600">{clock(m.at)}</span>
                  </div>
                ))
              )}
            </div>

            {/* Export desta conversa */}
            <div className="flex items-center justify-end gap-2 border-t border-white/5 p-3">
              <span className="mr-1 text-xs text-neutral-500">Exportar esta conversa:</span>
              <Button variant="ghost" onClick={() => exportOne('json')} loading={exportingOne}>
                <Download size={15} /> JSON
              </Button>
              <Button variant="ghost" onClick={() => exportOne('txt')} loading={exportingOne}>
                <Download size={15} /> TXT
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
