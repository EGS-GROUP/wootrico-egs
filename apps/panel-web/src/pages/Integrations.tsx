import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Plug, Pencil, AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, CopyButton, Eyebrow, useToast } from '../components/ui';
import {
  deleteIntegration,
  listIntegrations,
  updateIntegration,
  type IntegrationDTO,
} from '../lib/integrations-api';
import { getLicenseStatus, type LicenseStatus } from '../lib/license-api';

const PROVIDER_LABEL: Record<string, string> = {
  evolution: 'Evolution',
  uazapi: 'Uazapi',
  zapi: 'Z-API',
};

/** A labelled, copiable URL row for the integration card. */
function UrlRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 w-40 text-xs text-neutral-500">{label}</span>
      <span className="flex-1 min-w-0 truncate font-mono text-xs text-neutral-300" title={value}>
        {value}
      </span>
      <CopyButton value={value} title={`Copiar ${label}`} className="shrink-0" />
    </div>
  );
}

export default function Integrations() {
  const [items, setItems] = useState<IntegrationDTO[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const { show, node: toast } = useToast();

  const load = () => listIntegrations().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
    getLicenseStatus().then(setLicense).catch(() => {});
  }, []);

  // Active license required to create or enable integrations (option 1 gating).
  const licensed = license ? license.status === 'active' || license.status === 'warning' : true;

  async function remove(id: string) {
    if (!confirm('Remover esta integração?')) return;
    await deleteIntegration(id);
    load();
  }

  async function toggleEnabled(it: IntegrationDTO) {
    const next = !it.isEnabled;
    if (next && !licensed) {
      show('Licença inativa — não é possível ativar integrações. Regularize a licença primeiro.', 'warn');
      return;
    }
    setBusy(it.id);
    // optimistic update; revert on failure.
    setItems((prev) => prev?.map((x) => (x.id === it.id ? { ...x, isEnabled: next } : x)) ?? prev);
    try {
      await updateIntegration(it.id, { isEnabled: next });
    } catch (err) {
      setItems((prev) =>
        prev?.map((x) => (x.id === it.id ? { ...x, isEnabled: it.isEnabled } : x)) ?? prev,
      );
      const code = (err as { code?: string }).code;
      show(
        code === 'license_inactive'
          ? 'Licença inativa — não é possível ativar integrações.'
          : 'Não foi possível alterar o status da integração.',
        code === 'license_inactive' ? 'warn' : 'error',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {toast}
      <div className="flex items-start justify-between mb-10">
        <div>
          <Eyebrow>Integrações</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Integrações</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Cada integração liga uma conta/inbox do Chatwoot a uma instância de API não-oficial.
          </p>
        </div>
        {licensed ? (
          <Link to="/integrations/new">
            <Button>
              <Plus size={16} /> Nova
            </Button>
          </Link>
        ) : (
          <Button disabled title="Licença inativa">
            <Plus size={16} /> Nova
          </Button>
        )}
      </div>

      {!licensed && (
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
          <div className="text-sm text-amber-100">
            <p className="font-medium">Licença inativa</p>
            <p className="text-amber-200/80">
              As integrações estão pausadas e não é possível criar nem ativar novas. Seus dados
              continuam acessíveis.{' '}
              <Link to="/license" className="underline hover:text-white">
                Regularizar licença
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {items === null ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : items.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center text-center py-10 gap-3">
            <Plug className="text-neutral-600" size={32} />
            <p className="text-sm text-neutral-400">Nenhuma integração ainda.</p>
            {licensed ? (
              <Link to="/integrations/new">
                <Button>
                  <Plus size={16} /> Criar a primeira
                </Button>
              </Link>
            ) : (
              <Button disabled title="Licença inativa">
                <Plus size={16} /> Criar a primeira
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {items.map((it) => (
            <Card key={it.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <Link to={`/integrations/${it.id}`} className="text-white font-medium hover:underline">
                      {it.name}
                    </Link>
                    <Badge tone={it.status === 'ok' ? 'ok' : it.status === 'error' ? 'error' : 'neutral'}>
                      {it.status === 'ok' ? 'OK' : it.status === 'error' ? 'Erro' : 'Não configurada'}
                    </Badge>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Provedor {PROVIDER_LABEL[it.providerType] ?? it.providerType} · caixa{' '}
                    {it.chatwoot.inboxName}
                    {it.chatwoot.inboxId ? ` (#${it.chatwoot.inboxId})` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  {/* Ativar / desativar a integração */}
                  <button
                    type="button"
                    onClick={() => toggleEnabled(it)}
                    disabled={busy === it.id}
                    title={it.isEnabled ? 'Desativar integração' : 'Ativar integração'}
                    className="inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    <span
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        it.isEnabled
                          ? licensed
                            ? 'bg-blue-500'
                            : 'bg-amber-500/70' // enabled but paused by license
                          : 'bg-neutral-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                          it.isEnabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </span>
                    <span
                      className={`text-xs w-16 text-left ${
                        it.isEnabled && !licensed ? 'text-amber-300' : 'text-neutral-400'
                      }`}
                    >
                      {it.isEnabled ? (!licensed ? 'Pausada' : 'Ativa') : 'Inativa'}
                    </span>
                  </button>
                  <Link
                    to={`/integrations/${it.id}`}
                    className="text-neutral-500 hover:text-white transition-colors"
                    title="Editar"
                  >
                    <Pencil size={16} />
                  </Link>
                  <button
                    onClick={() => remove(it.id)}
                    className="text-neutral-500 hover:text-red-400 transition-colors"
                    title="Remover"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* URLs da integração — úteis para configurar o provedor e o Chatwoot */}
              <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
                <UrlRow label="URL do Chatwoot" value={it.chatwoot.baseUrl} />
                <UrlRow label="Webhook p/ o provedor" value={it.webhookUrls.provider} />
                <UrlRow label="Webhook p/ o Chatwoot" value={it.webhookUrls.chatwoot} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
