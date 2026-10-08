import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Eyebrow } from '../components/ui';
import { getSupportTickets, resolveTicket, reopenTicket, type SupportTicket } from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

const selCls =
  'rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50';

export default function Support() {
  const [rows, setRows] = useState<SupportTicket[] | null>(null);
  const [status, setStatus] = useState<'' | 'open' | 'resolved'>('open');
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    getSupportTickets({ status: status || undefined })
      .then((r) => setRows(r.tickets))
      .catch(() => setRows([]));
  useEffect(() => {
    setRows(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch {
      alert('Falha na operação.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <Eyebrow>Atendimento</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Suporte</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Chamados abertos pelos clientes a partir do painel deles. Registrados independentemente da
          licença — clientes pagos ativos também são direcionados ao WhatsApp configurado em{' '}
          <Link to="/settings" className="underline hover:text-white">Configurações</Link>.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <label className="text-xs text-neutral-500">Status:</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as '' | 'open' | 'resolved')} className={selCls}>
          <option value="open">Abertos</option>
          <option value="resolved">Resolvidos</option>
          <option value="">Todos</option>
        </select>
      </div>

      {!rows && <p className="text-sm text-neutral-500">Carregando…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-neutral-500">Nenhum chamado.</p>}

      <div className="space-y-4">
        {rows?.map((t) => (
          <Card key={t.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge tone={t.status === 'open' ? 'neutral' : 'ok'}>
                    {t.status === 'open' ? 'Aberto' : 'Resolvido'}
                  </Badge>
                  {t.plan && <Badge tone="neutral">{t.plan}</Badge>}
                  <span className="text-sm text-white truncate">{t.email ?? 'sem e-mail'}</span>
                </div>
                <p className="text-xs text-neutral-500">{fmt(t.createdAt)}</p>
              </div>
              {t.status === 'open' ? (
                <Button variant="ghost" loading={busy === t.id} onClick={() => act(t.id, () => resolveTicket(t.id))}>
                  Resolver
                </Button>
              ) : (
                <button
                  type="button"
                  disabled={busy === t.id}
                  onClick={() => act(t.id, () => reopenTicket(t.id))}
                  className="text-xs text-neutral-400 hover:text-white disabled:opacity-50"
                >
                  Reabrir
                </button>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap rounded-lg border border-white/5 bg-black/30 p-3 text-sm text-neutral-200">
              {t.message}
            </p>
            {t.licenseKeyId && (
              <Link to={`/keys/${t.licenseKeyId}`} className="mt-2 inline-block text-[11px] text-blue-400 hover:text-blue-300 font-mono">
                {t.licenseKeyId.slice(0, 8)}
              </Link>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
