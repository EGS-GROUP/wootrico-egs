import { useEffect, useState } from 'react';
import { Database, Network, Zap, Loader2, type LucideIcon } from 'lucide-react';
import { Badge, Button, Card, Eyebrow } from '../components/ui';
import ConnectionsEditor from '../components/ConnectionsEditor';
import MediaStorageEditor from '../components/MediaStorageEditor';
import LogRetentionEditor from '../components/LogRetentionEditor';
import ConversationRetentionEditor from '../components/ConversationRetentionEditor';
import {
  getSystemInfo,
  runDiagnostics,
  type Diagnostics,
  type SystemInfo,
} from '../lib/system-api';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-xs uppercase tracking-wider text-neutral-500">{label}</span>
      <span className="text-sm text-neutral-200 text-right break-all">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[#121212] border border-white/5 rounded-xl px-4 py-3">
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-neutral-500 mt-1">{label}</p>
    </div>
  );
}

const STATUS_TONE: Record<string, 'ok' | 'neutral' | 'error'> = {
  ok: 'ok',
  active: 'ok',
  warning: 'neutral',
  unactivated: 'neutral',
  unconfigured: 'neutral',
  error: 'error',
  blocked: 'error',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  active: 'Ativa',
  warning: 'Atenção',
  unactivated: 'Não ativada',
  unconfigured: 'Não configurada',
  error: 'Erro',
  blocked: 'Bloqueada',
  unknown: 'Desconhecida',
};
const stLabel = (s: string) => STATUS_LABEL[s] ?? s;

/** Turn a raw driver error into a short, human diagnosis (PT). */
function friendlyDetail(detail?: string): string {
  if (!detail) return '';
  const s = detail.toLowerCase();
  if (s.includes('enotfound') || s.includes('getaddrinfo')) {
    const host = detail.match(/(?:ENOTFOUND|getaddrinfo\s+\w+)\s+([^\s:]+)/i)?.[1];
    return host ? `host não encontrado: ${host}` : 'host não encontrado (DNS)';
  }
  if (s.includes('econnrefused')) return 'conexão recusada — porta fechada ou serviço fora';
  if (s.includes('etimedout') || s.includes('timeout')) return 'tempo esgotado — host inacessível';
  if (s.includes('ehostunreach') || s.includes('enetunreach')) return 'host inacessível na rede';
  if (s.includes('econnreset')) return 'conexão reiniciada pelo servidor';
  if (s.includes('28p01') || s.includes('authentication') || s.includes('password') || s.includes('access denied'))
    return 'autenticação falhou — usuário ou senha';
  if (s.includes('3d000') || s.includes('does not exist')) return 'banco de dados inexistente';
  if (s.includes('access') || s.includes('nxdomain')) return 'host não encontrado (DNS)';
  return detail;
}

function ConnRow({
  label,
  sub,
  icon: Icon,
  r,
  busy,
}: {
  label: string;
  sub: string;
  icon: LucideIcon;
  r?: { ok: boolean; detail?: string };
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-neutral-300" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-white">{label}</p>
          <p className="text-xs text-neutral-500">{sub}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 min-w-0 justify-end">
        {busy ? (
          <span className="flex items-center gap-1.5 text-xs text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> testando…
          </span>
        ) : r ? (
          <>
            {!r.ok && (
              <span className="text-xs text-red-300/90 truncate max-w-[15rem]" title={r.detail}>
                {friendlyDetail(r.detail)}
              </span>
            )}
            {r.ok && r.detail && (
              <span className="text-xs text-neutral-500 truncate max-w-[12rem]" title={r.detail}>
                {r.detail}
              </span>
            )}
            <Badge tone={r.ok ? 'ok' : 'error'}>{r.ok ? 'conectado' : 'falhou'}</Badge>
          </>
        ) : (
          <span className="text-xs text-neutral-600">não testado</span>
        )}
      </div>
    </div>
  );
}

export default function System() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  useEffect(() => {
    getSystemInfo()
      .then(setInfo)
      .catch(() => setError('Falha ao carregar informações do sistema.'));
  }, []);

  async function testConnections() {
    setDiag(null); // limpa para os rows mostrarem "testando…"
    setDiagBusy(true);
    try {
      setDiag(await runDiagnostics());
    } catch {
      setDiag({
        postgres: { ok: false, detail: 'falha na requisição' },
        rabbitmq: { ok: false, detail: 'falha na requisição' },
        redis: { ok: false, detail: 'falha na requisição' },
      });
    } finally {
      setDiagBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-10">
        <Eyebrow>Sistema</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Configuração</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Visão geral do que está configurado e em uso nesta instância.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!info && !error && <p className="text-sm text-neutral-500">Carregando…</p>}

      {info && (
        <div className="space-y-6">
          {/* Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Integrações" value={info.integrations.total} />
            <Stat label="Ativas" value={info.integrations.enabled} />
            <Stat label="Contatos (diretório)" value={info.directory.contactIdentities} />
            <Stat label="Administradores" value={info.app.admins} />
          </div>

          {/* Aplicação */}
          <Card>
            <h3 className="text-sm font-medium text-white mb-4">Aplicação</h3>
            <Row label="URL pública" value={info.app.publicBaseUrl} />
            <Row label="Base de webhook" value={info.app.webhookBase} />
            <Row
              label="Configuração inicial"
              value={
                <Badge tone={info.app.setupCompleted ? 'ok' : 'neutral'}>
                  {info.app.setupCompleted ? 'concluído' : 'pendente'}
                </Badge>
              }
            />
            <Row label="Ambiente" value={info.app.nodeEnv} />
          </Card>

          {/* Conexões */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium text-white">Conexões</h3>
                <p className="text-xs text-neutral-500 mt-1">
                  Testa Postgres, RabbitMQ e Redis de dentro do container.
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={testConnections} loading={diagBusy}>
                Testar conexões
              </Button>
            </div>
            <ConnRow label="Postgres" sub="Banco de dados" icon={Database} r={diag?.postgres} busy={diagBusy} />
            <ConnRow label="RabbitMQ" sub="Fila de mensagens" icon={Network} r={diag?.rabbitmq} busy={diagBusy} />
            <ConnRow label="Redis" sub="Cache e travas" icon={Zap} r={diag?.redis} busy={diagBusy} />
            {diag && !diagBusy && (
              <p className="mt-3 text-xs text-neutral-500">
                {[diag.postgres, diag.rabbitmq, diag.redis].every((d) => d.ok)
                  ? '✓ Todas as conexões estão OK.'
                  : 'Alguma conexão falhou — ajuste em "Conexões (configuração)" logo abaixo.'}
              </p>
            )}
          </Card>

          {/* Configuração de conexões (editável) */}
          <ConnectionsEditor />

          {/* Biblioteca de mídias (armazenamento local/S3) */}
          <MediaStorageEditor />

          {/* Retenção de logs do sistema */}
          <LogRetentionEditor />

          {/* Retenção de conversas capturadas */}
          <ConversationRetentionEditor />

          {/* Licença */}
          <Card>
            <h3 className="text-sm font-medium text-white mb-4">Licença</h3>
            <Row
              label="Status"
              value={
                <Badge tone={STATUS_TONE[info.license.status] ?? 'neutral'}>
                  {stLabel(info.license.status)}
                </Badge>
              }
            />
            <Row label="Obrigatória" value={info.license.required ? 'sim' : 'não'} />
            {info.license.instanceId && <Row label="Instância" value={info.license.instanceId} />}
            {info.license.serverUrl && <Row label="Servidor" value={info.license.serverUrl} />}
            {info.license.lastHeartbeatAt && (
              <Row
                label="Último sinal de atividade"
                value={new Date(info.license.lastHeartbeatAt).toLocaleString()}
              />
            )}
          </Card>

          {/* Em uso */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Em uso</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(info.integrations.byProvider)
                  .filter(([, n]) => n > 0)
                  .map(([p, n]) => (
                    <Badge key={p} tone="neutral">
                      {p}: {n}
                    </Badge>
                  ))}
              </div>
            </div>
            {info.integrations.items.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhuma integração configurada.</p>
            ) : (
              <div className="space-y-2">
                {info.integrations.items.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center justify-between gap-4 bg-[#121212] border border-white/5 rounded-xl px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{i.name}</p>
                      <p className="text-xs text-neutral-500 truncate">
                        {i.providerType} · conta {i.chatwootAccountId} · inbox {i.chatwootInboxName}
                        {i.chatwootInboxId ? ` (#${i.chatwootInboxId})` : ' (não criada)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!i.isEnabled && <Badge tone="neutral">desativada</Badge>}
                      <Badge tone={STATUS_TONE[i.status] ?? 'neutral'}>{stLabel(i.status)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
