import { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Download,
  Eye,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  ArrowDownLeft,
  ArrowUpRight,
  X,
  Trash2,
  Images,
} from 'lucide-react';
import { Badge, Button, Eyebrow, Field, Input, Select } from '../components/ui';
import {
  listMedia,
  fetchMediaBlobUrl,
  downloadMedia,
  deleteMedia,
  type MediaAssetDTO,
  type MediaFilters,
  type MediaType,
} from '../lib/media-api';
import { listIntegrations, type IntegrationDTO } from '../lib/integrations-api';

const PAGE_SIZE = 48;

const TYPE_ICON: Record<MediaType, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  document: FileText,
};
const TYPE_LABEL: Record<MediaType, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
};

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

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileNameOf(m: MediaAssetDTO): string {
  return m.fileName ?? `${m.messageType}-${m.id}`;
}

/** Lazily fetches an authenticated thumbnail for image assets. */
function Thumb({ media }: { media: MediaAssetDTO }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const Icon = TYPE_ICON[media.messageType];

  useEffect(() => {
    if (media.messageType !== 'image') return;
    let revoked: string | null = null;
    let alive = true;
    fetchMediaBlobUrl(media.id)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        revoked = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      alive = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [media.id, media.messageType]);

  if (media.messageType === 'image' && url && !failed) {
    return <img src={url} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />;
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-white/[0.03]">
      <Icon size={28} className="text-neutral-600" />
    </div>
  );
}

/** Full preview modal: renders inline per media type via an auth'd blob URL. */
function PreviewModal({
  media,
  onClose,
  onDelete,
}: {
  media: MediaAssetDTO;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    let revoked: string | null = null;
    let alive = true;
    fetchMediaBlobUrl(media.id)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        revoked = u;
        setUrl(u);
      })
      .catch(() => setError(true));
    return () => {
      alive = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [media.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-3xl w-full max-h-[90vh] overflow-auto rounded-2xl border border-white/10 bg-[#0B0B0D] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-neutral-400 hover:text-white"
          title="Fechar"
        >
          <X size={18} />
        </button>

        <div className="mb-4 pr-8">
          <p className="text-sm text-white truncate">{fileNameOf(media)}</p>
          <p className="text-xs text-neutral-500">
            {TYPE_LABEL[media.messageType]} · {media.mimeType} · {fmtSize(media.size)}
          </p>
        </div>

        <div className="flex items-center justify-center min-h-[200px]">
          {error ? (
            <p className="text-sm text-red-400">Não foi possível carregar a mídia.</p>
          ) : !url ? (
            <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-blue-500 animate-spin" />
          ) : media.messageType === 'image' ? (
            <img src={url} alt="" className="max-w-full max-h-[70vh] rounded-lg" />
          ) : media.messageType === 'video' ? (
            <video src={url} controls className="max-w-full max-h-[70vh] rounded-lg" />
          ) : media.messageType === 'audio' ? (
            <audio src={url} controls className="w-full" />
          ) : (
            <div className="text-center">
              <FileText size={40} className="text-neutral-600 mx-auto mb-3" />
              <a href={url} download={fileNameOf(media)} className="text-sm text-blue-400 hover:underline">
                Abrir documento
              </a>
            </div>
          )}
        </div>

        {media.caption && (
          <p className="mt-4 text-sm text-neutral-300 whitespace-pre-wrap border-t border-white/5 pt-3">
            {media.caption}
          </p>
        )}

        {/* actions */}
        <div className="mt-5 flex items-center gap-3 border-t border-white/5 pt-4">
          <button
            onClick={() => void downloadMedia(media.id, fileNameOf(media))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 hover:bg-white/5"
          >
            <Download size={14} /> Baixar
          </button>
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">
                Excluir {storageLabel(media.storageDriver)}?
              </span>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                <Trash2 size={14} /> {deleting ? 'Excluindo…' : 'Confirmar'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded-lg border border-white/15 px-3 py-2 text-xs text-neutral-300 hover:bg-white/5"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
            >
              <Trash2 size={14} /> Excluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: MediaAssetDTO['direction'] }) {
  return direction === 'incoming' ? (
    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300" title="Recebida">
      <ArrowDownLeft size={11} /> Recebida
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] text-blue-300" title="Enviada">
      <ArrowUpRight size={11} /> Enviada
    </span>
  );
}

/** Human label for where the binary lives (used in the delete confirmation). */
function storageLabel(driver: 'local' | 's3'): string {
  return driver === 's3' ? 'no repositório S3' : 'no banco de dados';
}

function Card({
  media,
  onView,
  onDelete,
}: {
  media: MediaAssetDTO;
  onView: () => void;
  onDelete: () => Promise<void>;
}) {
  const [downloading, setDownloading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const who = media.senderName ?? media.phone ?? media.jid ?? media.lid ?? '—';

  async function onDownload() {
    setDownloading(true);
    try {
      await downloadMedia(media.id, fileNameOf(media));
    } catch {
      /* ignored */
    } finally {
      setDownloading(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="group rounded-2xl border border-white/5 bg-[#0B0B0D] overflow-hidden flex flex-col">
      <div className="relative aspect-square bg-black/40 overflow-hidden">
        <button onClick={onView} className="absolute inset-0 w-full h-full" title="Visualizar">
          <Thumb media={media} />
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <Eye size={22} className="text-white" />
          </span>
        </button>
        <span className="absolute top-2 left-2 pointer-events-none">
          <Badge tone="neutral">{TYPE_LABEL[media.messageType]}</Badge>
        </span>
        {/* delete trigger (top-right, on hover) */}
        <button
          onClick={() => setConfirming(true)}
          title="Excluir mídia"
          className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-black/50 text-neutral-300 hover:bg-red-500/80 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
        >
          <Trash2 size={14} />
        </button>

        {/* inline confirmation overlay */}
        {confirming && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/85 p-3 text-center">
            <p className="text-xs text-neutral-200">
              Excluir esta mídia <span className="text-neutral-400">({storageLabel(media.storageDriver)})</span>?
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                <Trash2 size={13} /> {deleting ? 'Excluindo…' : 'Excluir'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <p className="text-sm text-neutral-100 truncate" title={who}>
          {who}
        </p>
        <div className="flex items-center justify-between gap-2">
          <DirectionBadge direction={media.direction} />
          {media.isGroup && <span className="text-[10px] text-neutral-500">Grupo</span>}
        </div>
        {media.phone && <p className="font-mono text-[11px] text-neutral-500 truncate">{media.phone}</p>}
        <p className="text-[11px] text-neutral-600 truncate" title={media.integrationName ?? ''}>
          {media.integrationName ?? '—'}
        </p>
        <p className="text-[11px] text-neutral-600">{fmtDateTime(media.sentAt ?? media.createdAt)}</p>

        <div className="mt-auto flex items-center gap-2 pt-2">
          <button
            onClick={onView}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
          >
            <Eye size={13} /> Ver
          </button>
          <button
            onClick={onDownload}
            disabled={downloading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
          >
            <Download size={13} /> {downloading ? '…' : 'Baixar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MediaLibrary() {
  const [items, setItems] = useState<MediaAssetDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [integrations, setIntegrations] = useState<IntegrationDTO[]>([]);
  const [preview, setPreview] = useState<MediaAssetDTO | null>(null);

  // filters
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [integrationId, setIntegrationId] = useState('');
  const [messageType, setMessageType] = useState('');
  const [direction, setDirection] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneQ, setPhoneQ] = useState('');
  const [jid, setJid] = useState('');
  const [jidQ, setJidQ] = useState('');
  const [lid, setLid] = useState('');
  const [lidQ, setLidQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    listIntegrations().then(setIntegrations).catch(() => {});
  }, []);

  // Debounce the free-text inputs.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPhoneQ(phone.trim());
      setJidQ(jid.trim());
      setLidQ(lid.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [search, phone, jid, lid]);

  const filters: MediaFilters = {
    search: query || undefined,
    integrationId: integrationId || undefined,
    messageType: (messageType as MediaType) || undefined,
    direction: (direction as MediaFilters['direction']) || undefined,
    phone: phoneQ || undefined,
    jid: jidQ || undefined,
    lid: lidQ || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  };
  // Stable dependency key so the effect re-runs when any filter changes.
  const filterKey = JSON.stringify(filters);

  const load = useCallback(
    async (p: number, append: boolean) => {
      setLoading(true);
      setError('');
      try {
        const res = await listMedia({ ...JSON.parse(filterKey), page: p, pageSize: PAGE_SIZE });
        setTotal(res.total);
        setPage(res.page);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      } catch {
        setError('Falha ao carregar as mídias.');
        if (!append) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [filterKey],
  );

  useEffect(() => {
    void load(1, false);
  }, [load]);

  const hasMore = items.length < total;

  async function handleDelete(id: string) {
    await deleteMedia(id);
    setItems((prev) => prev.filter((m) => m.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    setPreview((p) => (p?.id === id ? null : p));
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <Eyebrow>Biblioteca</Eyebrow>
        <h1 className="mt-5 flex items-center gap-2 text-3xl font-semibold tracking-tight text-white">
          <Images size={26} className="text-blue-400" /> Mídias
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Todas as mídias que passaram pelas integrações — enviadas e recebidas. Filtre por contato,
          número, integração, tipo e data; visualize ou baixe.
        </p>
      </div>

      {/* filters */}
      <div className="space-y-3 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, número, jid, arquivo ou legenda…"
              className="w-full bg-[#121212] border border-white/5 rounded-xl pl-9 pr-4 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/30 focus:bg-white/5 transition-all"
            />
          </div>
          <Select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
            <option value="">Todas as integrações</option>
            {integrations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
          <Select value={messageType} onChange={(e) => setMessageType(e.target.value)}>
            <option value="">Todos os tipos</option>
            <option value="image">Imagem</option>
            <option value="video">Vídeo</option>
            <option value="audio">Áudio</option>
            <option value="document">Documento</option>
          </Select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="">Enviadas e recebidas</option>
            <option value="incoming">Recebidas</option>
            <option value="outgoing">Enviadas</option>
          </Select>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Número" />
          <Input value={jid} onChange={(e) => setJid(e.target.value)} placeholder="JID" />
          <Input value={lid} onChange={(e) => setLid(e.target.value)} placeholder="LID" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="De (data)">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Até (data)">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="md:col-span-2 flex items-end justify-end">
            <span className="text-xs text-neutral-500 tabular-nums">
              {total} {total === 1 ? 'mídia' : 'mídias'}
            </span>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {items.length === 0 && !loading ? (
        <div className="flex flex-col items-center text-center py-16 gap-3 rounded-2xl border border-white/5 bg-[#0B0B0D]">
          <Images className="text-neutral-700" size={36} />
          <p className="text-sm text-neutral-500">Nenhuma mídia encontrada.</p>
          <p className="text-xs text-neutral-600 max-w-sm">
            A biblioteca captura mídias conforme as mensagens fluem. Se estiver desativada, ative em
            <b> Sistema → Biblioteca de Mídias</b>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {items.map((m) => (
            <Card
              key={m.id}
              media={m}
              onView={() => setPreview(m)}
              onDelete={() => handleDelete(m.id)}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-5 text-center">
          <Button type="button" variant="ghost" onClick={() => void load(page + 1, true)} loading={loading}>
            Carregar mais
          </Button>
        </div>
      )}

      {preview && (
        <PreviewModal
          media={preview}
          onClose={() => setPreview(null)}
          onDelete={() => handleDelete(preview.id)}
        />
      )}
    </div>
  );
}
