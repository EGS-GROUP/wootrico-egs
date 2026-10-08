import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, CopyButton, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import {
  createWebhookKey,
  getWebhookKeys,
  revokeWebhookKey,
  type WebhookKeyRow,
} from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

export default function WebhookKeys() {
  const [keys, setKeys] = useState<WebhookKeyRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    getWebhookKeys()
      .then((r) => setKeys(r.keys))
      .catch(() => setKeys([]));
  useEffect(() => {
    load();
  }, []);

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreatedKey(null);
    setBusy('new');
    try {
      const res = await createWebhookKey(newName.trim() || undefined);
      setCreatedKey(res.key);
      setNewName('');
      await load();
    } catch {
      setError('Falha ao criar a chave de webhook.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(k: WebhookKeyRow) {
    if (!confirm('Revogar esta chave de webhook? Chamadas com ela deixarão de ser aceitas.')) return;
    setBusy(k.id);
    try {
      await revokeWebhookKey(k.id);
      await load();
    } catch {
      alert('Não foi possível revogar a chave.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <Eyebrow>Pagamentos</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Chaves de webhook</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Use estas chaves para autenticar o webhook de pagamento{' '}
            <code className="text-neutral-300">POST /webhook/payment</code> (cabeçalho{' '}
            <code className="text-neutral-300">Authorization: Bearer WHK-…</code>). Crie, rotacione
            (revogue e crie outra) ou revogue conforme necessário.
          </p>
        </div>
        <Button onClick={() => setShowNew((v) => !v)}>
          <Plus size={16} /> Nova chave
        </Button>
      </div>

      <Card className="mb-6">
        <h3 className="text-sm font-medium text-white mb-2">Payload esperado pelo webhook</h3>
        <p className="text-xs text-neutral-400 mb-4">
          O sistema de pagamento deve chamar <code className="text-neutral-200">POST /webhook/payment</code>{' '}
          com o cabeçalho <code className="text-neutral-200">Authorization: Bearer WHK-…</code> e o corpo
          JSON abaixo. O servidor libera a <strong>última intenção de compra pendente</strong> daquele{' '}
          <code className="text-neutral-200">email</code> e cunha a chave paga; o cliente se atualiza
          sozinho. Use <code className="text-neutral-200">paymentRef</code> (id da transação) para
          idempotência — reenvios com o mesmo valor não duplicam.
        </p>
        <div className="rounded-lg border border-white/5 bg-black/40 p-3 overflow-x-auto">
          <pre className="text-[11px] leading-relaxed text-neutral-300 font-mono whitespace-pre">{`curl -X POST https://SEU_DOMINIO/webhook/payment \\
  -H "Authorization: Bearer WHK-suachavedewebhook" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "cliente@exemplo.com",
    "paymentRef": "txn_1234567890",
    "name": "Cliente Exemplo"
  }'`}</pre>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="font-mono text-neutral-200">email</dt>
          <dd className="text-neutral-400">obrigatório — identifica o comprador (casa com a intenção de compra).</dd>
          <dt className="font-mono text-neutral-200">paymentRef</dt>
          <dd className="text-neutral-400">opcional — id da transação no provedor; garante idempotência.</dd>
          <dt className="font-mono text-neutral-200">name</dt>
          <dd className="text-neutral-400">opcional — nome do titular gravado na chave gerada.</dd>
        </dl>
        <p className="mt-4 text-[11px] text-neutral-500">
          Respostas: <code className="text-neutral-300">200 {'{ ok: true, intentId }'}</code> (liberado) ·{' '}
          <code className="text-neutral-300">200 {'{ ok: true, alreadyProcessed: true }'}</code> (reenvio) ·{' '}
          <code className="text-neutral-300">401</code> (chave inválida/revogada) ·{' '}
          <code className="text-neutral-300">404 no_pending_intent</code> (sem compra pendente para o e-mail).
        </p>
      </Card>

      {showNew && (
        <Card className="mb-6">
          <h3 className="text-sm font-medium text-white mb-5">Criar chave de webhook</h3>
          <form onSubmit={submitNew} className="space-y-4">
            <Field label="Nome (identificação)">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ex.: stripe, hotmart" />
            </Field>
            <ErrorText>{error}</ErrorText>
            {createdKey && (
              <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2">
                <span className="text-xs text-neutral-300">Chave criada (copie agora):</span>
                <code className="text-xs text-blue-300 font-mono truncate">{createdKey}</code>
                <CopyButton value={createdKey} className="ml-auto" />
              </div>
            )}
            <Button type="submit" loading={busy === 'new'}>
              Criar chave
            </Button>
          </form>
        </Card>
      )}

      {!keys && <p className="text-sm text-neutral-500">Carregando…</p>}
      {keys && keys.length === 0 && (
        <p className="text-sm text-neutral-500">Nenhuma chave de webhook ainda.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {keys?.map((k) => (
          <Card key={k.id}>
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={k.revoked ? 'error' : 'ok'}>{k.revoked ? 'Revogada' : 'Ativa'}</Badge>
                  <span className="text-sm text-white truncate">{k.name ?? 'sem nome'}</span>
                </div>
                <p className="text-xs text-neutral-500 font-mono truncate">{k.id.slice(0, 8)}</p>
              </div>
              {!k.revoked && (
                <button
                  type="button"
                  onClick={() => revoke(k)}
                  disabled={busy === k.id}
                  className="text-xs text-neutral-400 hover:text-red-300 disabled:opacity-50 shrink-0"
                >
                  Revogar
                </button>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs border-t border-white/5 pt-4">
              <dt className="text-neutral-500">Último uso</dt>
              <dd className="text-neutral-300">{fmt(k.lastUsedAt)}</dd>
              <dt className="text-neutral-500">Criada em</dt>
              <dd className="text-neutral-300">{fmt(k.createdAt)}</dd>
            </dl>
          </Card>
        ))}
      </div>
    </div>
  );
}
