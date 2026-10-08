import { useCallback, useEffect, useState } from 'react';
import { Download, Search, User, Users } from 'lucide-react';
import { Button, CopyButton, CopyableText, Eyebrow, InfoTip } from '../components/ui';
import {
  exportContacts,
  fetchContactAvatarUrl,
  listContacts,
  type ContactDTO,
} from '../lib/contacts-api';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

// Shared grid template so the header and every row stay column-aligned.
const ROW_GRID =
  'md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.95fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]';

/** Origin badges: where the contact was observed (not mutually exclusive). */
function OriginCell({ contact }: { contact: ContactDTO }) {
  const { seenInDm, seenInGroup, groupName } = contact;
  if (!seenInDm && !seenInGroup) {
    return (
      <span className="text-xs text-neutral-600" title="Origem ainda não registrada">
        —
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1 min-w-0">
      {seenInDm && (
        <span
          title="Visto em conversa direta (1:1)"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300"
        >
          <User size={10} /> Direto
        </span>
      )}
      {seenInGroup && (
        <span
          title={groupName ? `Visto no grupo: ${groupName}` : 'Visto como participante de grupo'}
          className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-neutral-300"
        >
          <Users size={10} className="shrink-0" />
          <span className="truncate">{groupName ?? 'Grupo'}</span>
        </span>
      )}
    </div>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function initials(c: ContactDTO): string {
  const base = (c.pushName ?? c.pn ?? c.lid ?? '?').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return (base.slice(0, 2) || '?').toUpperCase();
}

/** Stable, non-UUID key (the canonical id is never exposed to the client). */
function contactKey(c: ContactDTO): string {
  return `${c.lid ?? ''}|${c.pn ?? ''}`;
}

function Avatar({ contact }: { contact: ContactDTO }) {
  // Prefer the stored bytes (auth-aware fetch → blob URL, permanent). While a
  // contact hasn't been re-synced yet, fall back to the raw WhatsApp URL (works
  // until it expires) so existing photos don't vanish. Initials as last resort.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [rawFailed, setRawFailed] = useState(false);
  useEffect(() => {
    setBlobUrl(null);
    if (!contact.hasAvatar) return;
    let alive = true;
    let blob: string | null = null;
    fetchContactAvatarUrl(contact.lid, contact.pn).then((u) => {
      if (!alive) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      blob = u;
      setBlobUrl(u);
    });
    return () => {
      alive = false;
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [contact.hasAvatar, contact.avatarVersion, contact.lid, contact.pn]);

  const src =
    blobUrl ?? (!contact.hasAvatar && contact.avatarUrl && !rawFailed ? contact.avatarUrl : null);

  return (
    <div className="w-9 h-9 rounded-full overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
      {src ? (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setRawFailed(true)}
        />
      ) : (
        <span className="text-[11px] font-medium text-neutral-400">{initials(contact)}</span>
      )}
    </div>
  );
}

function Mono({ value }: { value: string | null }) {
  if (!value) return <span className="text-neutral-600">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 group/mono">
      <span className="font-mono text-xs text-neutral-300 truncate" title={value}>
        {value}
      </span>
      <CopyButton value={value} className="opacity-0 group-hover/mono:opacity-100" />
    </span>
  );
}

export default function Contacts() {
  const [contacts, setContacts] = useState<ContactDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // debounced value sent to the API
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (p: number, q: string, size: number, append: boolean) => {
      setLoading(true);
      setError('');
      try {
        const res = await listContacts({ search: q || undefined, page: p, pageSize: size });
        setTotal(res.total);
        setPage(res.page);
        setContacts((prev) => (append ? [...prev, ...res.contacts] : res.contacts));
      } catch {
        setError('Falha ao carregar os contatos.');
        if (!append) setContacts([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Reload from the first page whenever the (debounced) query or page size changes.
  useEffect(() => {
    void load(1, query, pageSize, false);
  }, [query, pageSize, load]);

  const hasMore = contacts.length < total;

  async function onExport() {
    setExporting(true);
    setError('');
    try {
      await exportContacts(query || undefined);
    } catch {
      setError('Falha ao exportar os contatos.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <Eyebrow>Diretório</Eyebrow>
          <h1 className="mt-5 flex items-center gap-2 text-3xl font-semibold tracking-tight text-white">
            Contatos
            <InfoTip
              side="bottom"
              text={
                <>
                  Cada pessoa é uma <b>identidade única</b>: o número e o LID são pareados sob o
                  mesmo cadastro. Mesmo que o WhatsApp alterne entre número e LID de uma mensagem
                  para outra, a conversa <b>não se divide</b> — continua sendo o mesmo contato. O
                  identificador interno (UUID) nunca é exibido.
                </>
              }
            />
          </h1>
          <p className="mt-2 text-sm text-neutral-400">
            Diretório global de contatos do WhatsApp descobertos pelas integrações, com seus
            identificadores (número, LID e JID), nome, origem e datas de cadastro e atualização.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          title="Exportar contatos em CSV"
          onClick={onExport}
          loading={exporting}
          disabled={total === 0}
        >
          <Download size={16} />
          Exportar
        </Button>
      </div>

      {/* search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número, LID ou nome…"
            className="w-full bg-[#121212] border border-white/5 rounded-xl pl-9 pr-4 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/30 focus:bg-white/5 transition-all"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="whitespace-nowrap">Exibir</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="bg-[#121212] border border-white/5 rounded-lg px-2 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-blue-500/30 transition-colors"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="whitespace-nowrap">por página</span>
        </label>
        <span className="text-xs text-neutral-500 tabular-nums">
          {total} {total === 1 ? 'contato' : 'contatos'}
        </span>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      <div className="rounded-2xl border border-white/5 bg-[#0B0B0D] overflow-hidden">
        {/* header */}
        <div
          className={`hidden md:grid ${ROW_GRID} gap-4 px-4 py-3 border-b border-white/5 text-[11px] uppercase tracking-wider text-neutral-500`}
        >
          <span className="inline-flex items-center gap-1.5">
            Contato
            <InfoTip
              text={
                <>
                  Nome de exibição (<i>push name</i>) e foto do WhatsApp. Podem faltar: só aparecem
                  depois que a pessoa envia uma mensagem. Contatos vindos apenas da lista de um grupo
                  entram sem nome/foto até falarem.
                </>
              }
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            Número
            <InfoTip
              text={
                <>
                  Telefone (sem <code>@s.whatsapp.net</code>). O WhatsApp pode não enviá-lo na
                  primeira mensagem — é preenchido depois, assim que aparece.
                </>
              }
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            LID
            <InfoTip
              text={
                <>
                  Identificador privado do WhatsApp (<code>@lid</code>). É o id estável da pessoa; o
                  WhatsApp está migrando os contatos de número para LID.
                </>
              }
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            JID
            <InfoTip
              align="right"
              text={
                <>
                  Endereço técnico derivado: usa o número (<code>@s.whatsapp.net</code>) quando
                  conhecido, senão o LID (<code>@lid</code>). A aparência pode mudar quando o número é
                  descoberto — continua sendo a mesma pessoa.
                </>
              }
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            Origem
            <InfoTip
              align="right"
              text={
                <>
                  Onde o contato foi visto: <b>Direto</b> (conversa 1:1) e/ou <b>Grupo</b>
                  (participante). Não são exclusivos — a mesma pessoa pode ter as duas origens.
                </>
              }
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            Cadastro
            <InfoTip align="right" text="Quando o contato foi visto pela primeira vez." />
          </span>
          <span className="inline-flex items-center gap-1.5">
            Atualização
            <InfoTip align="right" text="Última vez que algum dado deste contato mudou." />
          </span>
        </div>

        <div className="divide-y divide-white/[0.04]">
          {contacts.length === 0 && !loading ? (
            <div className="flex flex-col items-center text-center py-12 gap-3">
              <Users className="text-neutral-700" size={32} />
              <p className="text-sm text-neutral-500">
                {query ? 'Nenhum contato encontrado para a busca.' : 'Nenhum contato registrado ainda.'}
              </p>
            </div>
          ) : (
            contacts.map((c) => (
              <div
                key={contactKey(c)}
                className={`grid grid-cols-1 ${ROW_GRID} gap-2 md:gap-4 px-4 py-3 hover:bg-white/[0.025] items-center`}
              >
                {/* contact (avatar + name) */}
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar contact={c} />
                  <div className="min-w-0">
                    <CopyableText
                      value={c.pushName}
                      fallback={<span className="text-sm text-neutral-500">sem nome</span>}
                      className="text-sm text-neutral-100"
                    />
                    <p className="md:hidden text-[11px] text-neutral-600">
                      {fmtDateTime(c.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="min-w-0">
                  <span className="md:hidden text-[11px] uppercase tracking-wider text-neutral-600 mr-2">
                    Número
                  </span>
                  <Mono value={c.pn} />
                </div>
                <div className="min-w-0">
                  <span className="md:hidden text-[11px] uppercase tracking-wider text-neutral-600 mr-2">
                    LID
                  </span>
                  <Mono value={c.lid} />
                </div>
                <div className="min-w-0">
                  <span className="md:hidden text-[11px] uppercase tracking-wider text-neutral-600 mr-2">
                    JID
                  </span>
                  <Mono value={c.jid} />
                </div>
                <div className="min-w-0">
                  <span className="md:hidden text-[11px] uppercase tracking-wider text-neutral-600 mr-2">
                    Origem
                  </span>
                  <OriginCell contact={c} />
                </div>
                <div className="hidden md:block text-xs text-neutral-400 tabular-nums">
                  {fmtDateTime(c.createdAt)}
                </div>
                <div className="hidden md:block text-xs text-neutral-400 tabular-nums">
                  {fmtDateTime(c.updatedAt)}
                </div>
              </div>
            ))
          )}
        </div>

        {hasMore && (
          <div className="px-4 py-3 border-t border-white/5 text-center">
            <button
              onClick={() => void load(page + 1, query, pageSize, true)}
              disabled={loading}
              className="text-sm text-neutral-400 hover:text-white disabled:opacity-50"
            >
              {loading ? 'Carregando…' : 'Carregar mais'}
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-neutral-600">
        <User size={12} className="shrink-0" />
        <span>
          O identificador interno (UUID) não é exibido. Contatos <b>sem nome ou foto</b> normalmente
          vêm apenas da lista de participantes de um grupo e ainda não enviaram mensagem — os dados
          chegam quando a pessoa fala. A foto do perfil pode não estar disponível.
        </span>
      </div>
    </div>
  );
}
