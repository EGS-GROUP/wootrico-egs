import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Badge, Button, Card, Eyebrow, Field, Input } from '../components/ui';
import {
  getPayments,
  getPaymentsSummary,
  type PaymentRow,
  type PaymentsSummary,
} from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}
function money(v: number | null, currency: string | null): string {
  if (v == null) return '—';
  const cur = currency === 'BRL' || !currency ? 'BRL' : currency;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cur }).format(v);
  } catch {
    return `${v}`;
  }
}

const KIND: Record<string, { label: string; tone: 'ok' | 'error' | 'neutral' }> = {
  purchase: { label: 'Compra', tone: 'ok' },
  renewal: { label: 'Renovação', tone: 'ok' },
  refund: { label: 'Reembolso', tone: 'error' },
  chargeback: { label: 'Chargeback', tone: 'error' },
  cancel: { label: 'Cancelado', tone: 'error' },
};

const selCls =
  'rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50';

export default function Payments() {
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');

  const load = () =>
    getPayments({ q: q.trim() || undefined, kind: kind || undefined })
      .then((r) => setRows(r.payments))
      .catch(() => setRows([]));

  useEffect(() => {
    getPaymentsSummary().then(setSummary).catch(() => setSummary(null));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const t = summary?.totals;

  return (
    <div>
      <div className="mb-8">
        <Eyebrow>Financeiro</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Pagamentos</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Histórico de pagamentos (Hotmart), liberações e renovações. Receita considera compras e
          renovações aplicadas.
        </p>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Receita" value={t ? money(t.revenue, 'BRL') : '—'} />
        <Stat label="Pagamentos" value={t ? String(t.payments) : '—'} sub={t ? `${t.purchases} compras · ${t.renewals} renov.` : ''} />
        <Stat label="Pagas ativas" value={t ? String(t.paidActive) : '—'} sub={t ? `${t.expiringSoon} vencem em 30d` : ''} />
        <Stat label="Reembolsos" value={t ? String(t.refunds) : '—'} />
      </div>

      {/* Filtro */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setRows(null);
          load();
        }}
        className="mb-6 flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[220px]">
          <Field label="Buscar por e-mail">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="cliente@exemplo.com" />
          </Field>
        </div>
        <div>
          <Field label="Tipo">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={selCls}>
              <option value="">Todos</option>
              <option value="purchase">Compra</option>
              <option value="renewal">Renovação</option>
              <option value="refund">Reembolso</option>
              <option value="chargeback">Chargeback</option>
              <option value="cancel">Cancelado</option>
            </select>
          </Field>
        </div>
        <Button type="submit" variant="ghost">
          <Search size={16} /> Buscar
        </Button>
      </form>

      {!rows && <p className="text-sm text-neutral-500">Carregando…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-neutral-500">Nenhum pagamento ainda.</p>}

      <div className="space-y-3">
        {rows?.map((p) => {
          const k = KIND[p.kind] ?? { label: p.kind, tone: 'neutral' as const };
          return (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge tone={k.tone}>{k.label}</Badge>
                    {p.status && p.status !== 'applied' && <Badge tone="neutral">{p.status}</Badge>}
                    <span className="text-sm text-white truncate">{p.email ?? 'sem e-mail'}</span>
                  </div>
                  <p className="text-xs text-neutral-500 truncate">
                    {fmt(p.createdAt)} · {p.provider}
                    {p.transaction ? ` · ${p.transaction}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-white">{money(p.amount, p.currency)}</p>
                  {p.expiresAt && (
                    <p className="text-[11px] text-neutral-500">vence {new Date(p.expiresAt).toLocaleDateString()}</p>
                  )}
                  {p.licenseKeyId && (
                    <Link to={`/keys/${p.licenseKeyId}`} className="text-[11px] text-blue-400 hover:text-blue-300 font-mono">
                      {p.licenseKeyId.slice(0, 8)}
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-neutral-500">{sub}</p>}
    </Card>
  );
}
