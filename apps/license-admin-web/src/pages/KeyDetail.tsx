import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Eyebrow } from '../components/ui';
import {
  getKey,
  getKeyEvents,
  revokeKey,
  activateKey,
  upgradeKey,
  expireKey,
  setKeyExpiry,
  reactivateTrial,
  deleteKey,
  type KeyDetail as KeyDetailT,
  type LicenseEvent,
} from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

const EVENT_LABEL: Record<string, string> = {
  provision: 'Provisionamento',
  provision_reused: 'Provisionamento (reuso)',
  activate: 'Ativação',
  activate_revoked: 'Ativação negada (revogada)',
  activate_expired: 'Ativação negada (expirada)',
  ip_changed: 'IP alterado',
  ip_alert: 'Alerta de IP',
  validate: 'Validação',
  deactivate: 'Desativação',
  purchase_intent: 'Intenção de compra',
  payment_confirmed: 'Pagamento confirmado',
  payment_renewed: 'Renovação paga',
  payment_refunded: 'Reembolso/estorno',
  trial_claimed: 'Teste concedido (retirado)',
  paid_claimed: 'Licença concedida (retirada)',
  admin_create: 'Admin: criada',
  admin_revoke: 'Admin: revogada',
  admin_activate: 'Admin: reativada',
  admin_upgrade: 'Admin: liberada como paga',
  admin_expire: 'Admin: expirada',
  admin_trial_grant: 'Admin: teste concedido',
  admin_paid_grant: 'Admin: licença concedida',
  admin_reactivate_trial: 'Admin: teste reativado',
  admin_set_expiry: 'Admin: vencimento alterado',
  admin_delete: 'Admin: chave excluída',
};

const STATUS_TONE: Record<string, 'ok' | 'error' | 'neutral'> = {
  active: 'ok',
  expired: 'error',
  revoked: 'error',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Ativa',
  expired: 'Expirada',
  revoked: 'Revogada',
};

// Compact override for the action buttons so they line up on a single row
// (the base ghost button uses px-8). `!` beats the base utilities.
const ACTION_BTN = '!px-4 !py-2 text-xs';

export default function KeyDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<KeyDetailT | null>(null);
  const [events, setEvents] = useState<LicenseEvent[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getKey(id).then(setData).catch(() => {});
    getKeyEvents(id).then((r) => setEvents(r.events)).catch(() => {});
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      load();
    } catch {
      alert('Falha na operação.');
    } finally {
      setBusy(false);
    }
  }

  async function doExpire() {
    const reason = prompt('Motivo da expiração (opcional):') ?? undefined;
    await act(() => expireKey(id, reason || undefined));
  }

  async function doSetExpiry() {
    const cur = data?.key.expiresAt ? new Date(data.key.expiresAt).toISOString().slice(0, 10) : '';
    const input = prompt('Nova data de vencimento (AAAA-MM-DD):', cur);
    if (input === null) return; // cancelado
    const trimmed = input.trim();
    if (!trimmed || Number.isNaN(new Date(trimmed).getTime())) {
      alert('Informe uma data válida (AAAA-MM-DD).');
      return;
    }
    const iso = new Date(`${trimmed}T23:59:59`).toISOString();
    await act(() => setKeyExpiry(id, iso));
  }

  async function doDelete() {
    if (!confirm('Excluir esta chave PERMANENTEMENTE? Esta ação não pode ser desfeita.')) return;
    setBusy(true);
    try {
      await deleteKey(id);
      navigate('/keys');
    } catch {
      alert('Não foi possível excluir (a chave pode estar ativa).');
      setBusy(false);
    }
  }

  const k = data?.key;

  return (
    <div className="max-w-3xl">
      <Link to="/keys" className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-white mb-6">
        <ArrowLeft size={14} /> Chaves
      </Link>

      {k && (
        <>
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <Eyebrow>Licença</Eyebrow>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white font-mono">{k.id.slice(0, 8)}</h1>
              <p className="mt-2 text-sm text-neutral-400">{k.name || k.email || 'Sem titular'}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={k.plan === 'paid' ? 'ok' : 'neutral'}>{k.plan === 'paid' ? 'Paga' : 'Teste'}</Badge>
              <Badge tone={STATUS_TONE[k.status] ?? 'neutral'}>{STATUS_LABEL[k.status] ?? k.status}</Badge>
            </div>
          </div>

          <Card className="mb-6">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-neutral-500">Titular</dt>
              <dd className="text-neutral-300 truncate">
                {k.email ? (
                  <Link to={`/users/${encodeURIComponent(k.email)}`} className="hover:underline">
                    {k.name ? `${k.name} · ${k.email}` : k.email}
                  </Link>
                ) : (
                  k.name ?? '—'
                )}
              </dd>
              <dt className="text-neutral-500">Origem</dt>
              <dd className="text-neutral-300">{k.provisionedBy}</dd>
              <dt className="text-neutral-500">Criada em</dt>
              <dd className="text-neutral-300">{fmt(k.createdAt)}</dd>
              <dt className="text-neutral-500">Vencimento</dt>
              <dd className={k.status === 'expired' ? 'text-red-300' : 'text-neutral-300'}>
                {k.expiresAt ? fmt(k.expiresAt) : '—'}
              </dd>
              {k.statusReason && (
                <>
                  <dt className="text-neutral-500">Motivo</dt>
                  <dd className="text-amber-300">{k.statusReason}</dd>
                </>
              )}
              <dt className="text-neutral-500">Instâncias ativas</dt>
              <dd className="text-neutral-300">{k.activeInstances}</dd>
              <dt className="text-neutral-500">IPs distintos</dt>
              <dd className={k.distinctIps > 1 ? 'text-amber-300' : 'text-neutral-300'}>{k.distinctIps}</dd>
              {k.alerts > 0 && (
                <>
                  <dt className="text-neutral-500">Alertas de IP</dt>
                  <dd className="inline-flex items-center gap-1 text-red-300">
                    <AlertTriangle size={12} /> {k.alerts}
                  </dd>
                </>
              )}
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/5 pt-5">
              {/* Revogada: só dá pra reativar (desfaz a revogação) ou excluir. */}
              {k.status === 'revoked' && (
                <Button
                  variant="ghost"
                  className={ACTION_BTN}
                  loading={busy}
                  onClick={() => act(() => activateKey(k.id))}
                  title="Desfaz a revogação e devolve o acesso, mantendo plano e vencimento."
                >
                  Reativar
                </Button>
              )}
              {/* Ativa: pode revogar e expirar agora (qualquer plano). */}
              {k.status === 'active' && (
                <Button
                  variant="ghost"
                  className={ACTION_BTN}
                  loading={busy}
                  onClick={() => act(() => revokeKey(k.id))}
                  title="Bloqueia o acesso AGORA (trial ou paga). É reversível em 'Reativar' e não altera o vencimento. Use para abuso, reembolso ou disputa."
                >
                  Revogar
                </Button>
              )}
              {/* Alterar vencimento: só para chave PAGA não-revogada (sempre uma data). */}
              {k.plan === 'paid' && k.status !== 'revoked' && (
                <Button
                  variant="ghost"
                  className={ACTION_BTN}
                  loading={busy}
                  onClick={doSetExpiry}
                  title="Define a data de vencimento da licença paga (renova ou encurta). Sempre uma data — não existe vitalícia."
                >
                  Alterar vencimento
                </Button>
              )}
              {/* Converter um teste em paga (venda manual/offline) — padrão 12 meses. */}
              {k.plan === 'trial' && k.status !== 'revoked' && (
                <Button
                  variant="ghost"
                  className={ACTION_BTN}
                  loading={busy}
                  onClick={() => act(() => upgradeKey(k.id))}
                  title="Converte o teste em licença paga com vencimento de 12 meses (depois ajustável em 'Alterar vencimento')."
                >
                  Liberar como paga (12 meses)
                </Button>
              )}
              {/* Reativar teste: dá novo prazo a um trial expirado/revogado. */}
              {k.plan === 'trial' && (k.status === 'expired' || k.status === 'revoked') && (
                <Button
                  variant="ghost"
                  className={ACTION_BTN}
                  loading={busy}
                  onClick={() => act(() => reactivateTrial(k.id))}
                  title="Dá um novo período de teste (+14 dias) à chave trial e limpa qualquer revogação."
                >
                  Reativar teste (+14d)
                </Button>
              )}
              {/* Expirar agora: encerra a chave já (trial → compra; paga → renovação). */}
              {k.status === 'active' && (
                <Button
                  variant="ghost"
                  className={ACTION_BTN}
                  loading={busy}
                  onClick={doExpire}
                  title="Encerra a chave AGORA (vence). Trial leva ao fluxo de compra; paga, à renovação."
                >
                  Expirar agora
                </Button>
              )}
              {(k.status === 'expired' || k.status === 'revoked') && (
                <Button
                  variant="ghost"
                  className={`${ACTION_BTN} !border-red-500/40 hover:!bg-red-500 hover:!text-white !text-red-300`}
                  loading={busy}
                  onClick={doDelete}
                  title="Exclui a chave permanentemente. Disponível apenas para chaves expiradas ou revogadas (não ativas)."
                >
                  <Trash2 size={13} /> Excluir
                </Button>
              )}
            </div>
          </Card>

          <h3 className="text-sm font-medium text-white mb-3">Instâncias / IPs</h3>
          {data!.bindings.length === 0 ? (
            <p className="text-sm text-neutral-500 mb-6">Nenhuma instância vinculada.</p>
          ) : (
            <div className="space-y-2 mb-8">
              {data!.bindings.map((b) => (
                <Card key={b.id}>
                  <p className="text-xs font-mono text-neutral-300 truncate">{b.instanceId}</p>
                  <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-y-1 text-xs">
                    <dt className="text-neutral-500">1º IP</dt>
                    <dd className="text-neutral-300 font-mono">{b.firstIp ?? '—'}</dd>
                    <dt className="text-neutral-500">Último IP</dt>
                    <dd className="text-neutral-300 font-mono">{b.lastIp ?? '—'}</dd>
                    <dt className="text-neutral-500">Versão</dt>
                    <dd className="text-neutral-300">{b.appVersion ?? '—'}</dd>
                    <dt className="text-neutral-500">Último sinal</dt>
                    <dd className="text-neutral-300">{fmt(b.lastHeartbeatAt)}</dd>
                  </dl>
                </Card>
              ))}
            </div>
          )}

          <h3 className="text-sm font-medium text-white mb-3">Histórico de eventos</h3>
          <Card>
            {events.length === 0 ? (
              <p className="text-sm text-neutral-500">Sem eventos.</p>
            ) : (
              <ul className="space-y-2">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 text-xs border-b border-white/5 pb-2 last:border-0">
                    <span className="text-neutral-500 w-32 shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
                    <span className="text-neutral-200 flex-1">{EVENT_LABEL[e.type] ?? e.type}</span>
                    <span className="text-neutral-500 font-mono truncate max-w-[40%]">
                      {[e.ip, e.appVersion, e.meta ? JSON.stringify(e.meta) : null].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
