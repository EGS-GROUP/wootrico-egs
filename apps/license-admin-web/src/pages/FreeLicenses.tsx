import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input, Select } from '../components/ui';
import {
  grantLicense,
  getGrantedLicenses,
  reactivateTrial,
  revokeKey,
  activateKey,
  type GrantedLicenseRow,
} from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

function statusOf(r: GrantedLicenseRow): { label: string; tone: 'ok' | 'error' | 'neutral' } {
  if (r.revoked) return { label: 'Revogada', tone: 'error' };
  if (r.expired) return { label: 'Expirada', tone: 'error' };
  if (r.claimed) return { label: 'Em uso', tone: 'ok' };
  return { label: 'Aguardando ativação', tone: 'neutral' };
}

export default function FreeLicenses() {
  const [rows, setRows] = useState<GrantedLicenseRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<'trial' | 'paid'>('trial');
  const [error, setError] = useState('');

  const load = () =>
    getGrantedLicenses()
      .then((r) => setRows(r.licenses))
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Informe o e-mail do usuário.');
      return;
    }
    setBusy('new');
    try {
      await grantLicense({ email: email.trim(), name: name.trim() || undefined, plan });
      setEmail('');
      setName('');
      setPlan('trial');
      setShowNew(false);
      await load();
    } catch {
      setError('Falha ao conceder a licença.');
    } finally {
      setBusy(null);
    }
  }

  async function deactivate(r: GrantedLicenseRow) {
    if (!confirm(`Revogar a licença de ${r.email ?? 'usuário'}? O cliente perde o acesso.`)) return;
    setBusy(r.id);
    try {
      await revokeKey(r.id);
      await load();
    } catch {
      alert('Não foi possível revogar a licença.');
    } finally {
      setBusy(null);
    }
  }

  async function reactivate(r: GrantedLicenseRow) {
    setBusy(r.id);
    try {
      // Trial regains a fresh window; paid just clears the revocation.
      await (r.plan === 'trial' ? reactivateTrial(r.id) : activateKey(r.id));
      await load();
    } catch {
      alert('Não foi possível reativar a licença.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <Eyebrow>Licenças</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Licenças concedidas</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            Conceda uma licença a um usuário pelo e-mail — <strong className="text-neutral-300">teste</strong>{' '}
            (expira em ~14 dias) ou <strong className="text-neutral-300">paga</strong> (vence em 12 meses). O
            cliente <strong className="text-neutral-300">não precisa de chave</strong>: ao ativar o Wootrico
            com esse e-mail, o servidor entrega a licença automaticamente. Você pode reativar ou revogar a
            qualquer momento.
          </p>
        </div>
        <Button onClick={() => setShowNew((v) => !v)}>
          <Plus size={16} /> Conceder licença
        </Button>
      </div>

      {showNew && (
        <Card className="mb-6">
          <h3 className="text-sm font-medium text-white mb-5">Conceder licença</h3>
          <form onSubmit={submitNew} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="E-mail do usuário">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@exemplo.com"
                />
              </Field>
              <Field label="Nome (opcional)">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do titular" />
              </Field>
              <Field label="Tipo">
                <Select value={plan} onChange={(e) => setPlan(e.target.value as 'trial' | 'paid')}>
                  <option value="trial">Grátis (teste)</option>
                  <option value="paid">Paga (12 meses)</option>
                </Select>
              </Field>
            </div>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" loading={busy === 'new'}>
              Conceder
            </Button>
          </form>
        </Card>
      )}

      {!rows && <p className="text-sm text-neutral-500">Carregando…</p>}
      {rows && rows.length === 0 && (
        <p className="text-sm text-neutral-500">Nenhuma licença concedida ainda.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {rows?.map((r) => {
          const st = statusOf(r);
          const canReactivate = r.revoked || r.expired;
          return (
            <Card key={r.id}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <Badge tone="neutral">{r.plan === 'paid' ? 'Paga' : 'Teste'}</Badge>
                    <span className="text-sm text-white truncate">{r.email ?? 'sem e-mail'}</span>
                  </div>
                  <p className="text-xs text-neutral-500 truncate">{r.name ?? '—'}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {canReactivate && (
                    <button
                      type="button"
                      onClick={() => reactivate(r)}
                      disabled={busy === r.id}
                      className="text-xs text-neutral-400 hover:text-emerald-300 disabled:opacity-50"
                    >
                      {r.plan === 'trial' ? 'Reativar (+teste)' : 'Reativar'}
                    </button>
                  )}
                  {!r.revoked && (
                    <button
                      type="button"
                      onClick={() => deactivate(r)}
                      disabled={busy === r.id}
                      className="text-xs text-neutral-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Revogar
                    </button>
                  )}
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs border-t border-white/5 pt-4">
                <dt className="text-neutral-500">Expira em</dt>
                <dd className="text-neutral-300">{r.plan === 'paid' ? 'nunca' : fmt(r.expiresAt)}</dd>
                <dt className="text-neutral-500">Instâncias ativas</dt>
                <dd className="text-neutral-300">{r.activeInstances}</dd>
                <dt className="text-neutral-500">Última validação</dt>
                <dd className="text-neutral-300">{fmt(r.lastHeartbeatAt)}</dd>
                <dt className="text-neutral-500">Concedida em</dt>
                <dd className="text-neutral-300">{fmt(r.createdAt)}</dd>
              </dl>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
