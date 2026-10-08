import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Badge, Card, Eyebrow } from '../components/ui';
import { getUser, type UserKeyRow } from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

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

export default function UserDetail() {
  const { email = '' } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof getUser>> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getUser(decodeURIComponent(email))
      .then(setData)
      .catch(() => setError('Usuário não encontrado.'));
  }, [email]);

  return (
    <div className="max-w-3xl">
      <Link to="/users" className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-white mb-6">
        <ArrowLeft size={14} /> Usuários
      </Link>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {data && (
        <>
          <div className="mb-8">
            <Eyebrow>Usuário</Eyebrow>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
              {data.user.name || data.user.email}
            </h1>
            <p className="mt-2 text-sm text-neutral-400">{data.user.email}</p>
          </div>

          <Card className="mb-8">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-y-2 text-sm">
              <dt className="text-neutral-500">Chaves</dt>
              <dd className="text-neutral-300">{data.user.keysTotal}</dd>
              <dt className="text-neutral-500">Cadastro</dt>
              <dd className="text-neutral-300">{fmt(data.user.firstSeen)}</dd>
              <dt className="text-neutral-500">Última requisição</dt>
              <dd className="text-neutral-300">{fmt(data.user.lastRequestAt)}</dd>
            </dl>
          </Card>

          <h3 className="text-sm font-medium text-white mb-3">Histórico de licenças</h3>
          <div className="space-y-3">
            {data.keys.map((k: UserKeyRow) => (
              <Link key={k.id} to={`/keys/${k.id}`} className="block">
                <Card className="hover:border-white/15 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge tone={STATUS_TONE[k.status] ?? 'neutral'}>{STATUS_LABEL[k.status] ?? k.status}</Badge>
                        <Badge tone={k.plan === 'paid' ? 'ok' : 'neutral'}>
                          {k.plan === 'paid' ? 'Paga' : 'Teste'}
                        </Badge>
                        {k.alerts > 0 && <span className="text-[11px] text-red-300">{k.alerts} alerta(s) IP</span>}
                      </div>
                      <p className="text-xs text-neutral-500 font-mono truncate">{k.id.slice(0, 8)}</p>
                    </div>
                    <div className="text-right text-xs text-neutral-500">
                      <p>criada {new Date(k.createdAt).toLocaleDateString()}</p>
                      <p>último sinal {fmt(k.lastHeartbeatAt)}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
