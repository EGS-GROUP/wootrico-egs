import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Download, User, AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, Eyebrow, Field, Input } from '../components/ui';
import { getUsers, downloadUsersCsv, type UserRow } from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}
function fmtDate(ts: string): string {
  return new Date(ts).toLocaleDateString();
}

export default function Users() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (query = q) =>
    getUsers({ q: query.trim() || undefined })
      .then((r) => setUsers(r.users))
      .catch(() => setUsers([]));
  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportCsv() {
    setBusy(true);
    try {
      await downloadUsersCsv({ q: q.trim() || undefined });
    } catch {
      alert('Falha ao exportar CSV.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <Eyebrow>Cadastros</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Usuários</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Cadastros (por e-mail) com data de cadastro, última requisição e licenças.
          </p>
        </div>
        <Button onClick={exportCsv} loading={busy}>
          <Download size={16} /> Exportar CSV
        </Button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setUsers(null);
          load();
        }}
        className="mb-8 flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[220px]">
          <Field label="Buscar (nome ou e-mail)">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex.: maria, maria@x.com" />
          </Field>
        </div>
        <Button type="submit" variant="ghost">
          <Search size={16} /> Buscar
        </Button>
      </form>

      {!users ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum usuário encontrado.</p>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <Link key={u.email} to={`/users/${encodeURIComponent(u.email)}`} className="block">
              <Card className="hover:border-white/15 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/5 border border-white/10 shrink-0">
                    <User size={15} className="text-neutral-300" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">{u.name || u.email}</p>
                    <p className="text-xs text-neutral-500 truncate">{u.email}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2">
                    {u.active > 0 && <Badge tone="ok">{u.active} ativa(s)</Badge>}
                    {u.paid > 0 && <Badge tone="ok">{u.paid} paga(s)</Badge>}
                    {u.alerts > 0 && (
                      <span className="inline-flex items-center gap-1 text-red-300 text-[11px]">
                        <AlertTriangle size={12} /> {u.alerts}
                      </span>
                    )}
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-y-1 text-xs border-t border-white/5 pt-3">
                  <dt className="text-neutral-500">Chaves</dt>
                  <dd className="text-neutral-300">{u.keysTotal}</dd>
                  <dt className="text-neutral-500">Cadastro</dt>
                  <dd className="text-neutral-300">{fmtDate(u.firstSeen)}</dd>
                  <dt className="text-neutral-500">Última requisição</dt>
                  <dd className="text-neutral-300">{fmt(u.lastRequestAt)}</dd>
                  <dt className="text-neutral-500">Expiradas/revogadas</dt>
                  <dd className="text-neutral-300">{u.expired + u.revoked}</dd>
                </dl>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
