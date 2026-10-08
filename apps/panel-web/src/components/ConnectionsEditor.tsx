import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Badge, Button, ErrorText, Field, Input } from './ui';
import {
  getConnections,
  restartSystem,
  saveConnections,
  testConnection,
  type ConnectionsState,
  type PingResult,
  type SaveConnectionsResult,
} from '../lib/system-api';
import {
  buildPg,
  buildRb,
  buildRd,
  parsePg,
  parseRb,
  parseRd,
  type PgFields,
  type RbFields,
  type RdFields,
} from '../lib/connection-fields';

function SecretInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-12"
        autoComplete="off"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white transition-colors"
        title={show ? 'Ocultar' : 'Mostrar'}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

type Tab = 'postgres' | 'rabbitmq' | 'redis';
const TABS: { key: Tab; label: string }[] = [
  { key: 'postgres', label: 'Postgres' },
  { key: 'rabbitmq', label: 'RabbitMQ' },
  { key: 'redis', label: 'Redis' },
];
const PUT_KEY: Record<Tab, 'databaseUrl' | 'rabbitmqUrl' | 'redisUrl'> = {
  postgres: 'databaseUrl',
  rabbitmq: 'rabbitmqUrl',
  redis: 'redisUrl',
};

export default function ConnectionsEditor({ heading = true }: { heading?: boolean }) {
  const [conn, setConn] = useState<ConnectionsState | null>(null);
  const [tab, setTab] = useState<Tab>('postgres');
  const [pg, setPg] = useState<PgFields | null>(null);
  const [rb, setRb] = useState<RbFields | null>(null);
  const [rd, setRd] = useState<RdFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SaveConnectionsResult | null>(null);
  const [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);
  // Standalone "test now" — independent of save; keyed by tab+url so editing
  // invalidates the shown result.
  const [testBusy, setTestBusy] = useState(false);
  const [testState, setTestState] = useState<{ tab: Tab; url: string; result: PingResult } | null>(null);

  async function load() {
    const c = await getConnections();
    setConn(c);
    setPg(parsePg(c.services.postgres.value));
    setRb(parseRb(c.services.rabbitmq.value));
    setRd(parseRd(c.services.redis.value));
  }

  useEffect(() => {
    load().catch(() => setError('Falha ao carregar as conexões.'));
  }, []);

  if (!conn || !pg || !rb || !rd) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#0F0F11] p-5">
        <p className="text-sm text-neutral-500">{error || 'Carregando conexões…'}</p>
      </div>
    );
  }

  const built: Record<Tab, string> = {
    postgres: buildPg(pg),
    rabbitmq: buildRb(rb),
    redis: buildRd(rd),
  };
  const dirty = (t: Tab) => built[t] !== conn.services[t].value;
  const pendingRestart = (['rabbitmq', 'redis'] as Tab[]).some((t) => conn.services[t].changed);

  async function save() {
    setError('');
    setRes(null);
    const body: { databaseUrl?: string; rabbitmqUrl?: string; redisUrl?: string } = {};
    (Object.keys(built) as Tab[]).forEach((t) => {
      if (dirty(t)) body[PUT_KEY[t]] = built[t];
    });
    if (Object.keys(body).length === 0) {
      setError('Nenhuma alteração para salvar.');
      return;
    }
    setBusy(true);
    try {
      const r = await saveConnections(body);
      setRes(r);
      if (r.ok) await load();
    } catch {
      setError('Falha ao salvar/testar as conexões.');
    } finally {
      setBusy(false);
    }
  }

  // Testa a conexão do serviço ATUAL com os valores em tela, sem salvar — sempre
  // disponível (mesmo sem alterações).
  async function testNow() {
    setError('');
    setTestBusy(true);
    const url = built[tab];
    try {
      const result = await testConnection(tab, url);
      setTestState({ tab, url, result });
    } catch {
      setTestState({ tab, url, result: { ok: false, detail: 'falha na requisição' } });
    } finally {
      setTestBusy(false);
    }
  }

  async function restart() {
    setRestarting(true);
    try {
      await restartSystem();
    } catch {
      /* server going down — expected */
    }
    setTimeout(() => window.location.reload(), 8000);
  }

  const svc = conn.services[tab];
  const result = res?.results?.[PUT_KEY[tab]];

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0F0F11] p-5">
      {heading && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-white">Conexões (configuração)</h3>
          <p className="text-xs text-neutral-500 mt-1">
            Edite por serviço. Ao salvar, cada conexão é <b>testada antes de aplicar</b>; se falhar,
            nada é gravado. RabbitMQ e Redis entram em vigor ao <b>reiniciar</b>; o Postgres exige
            reimplantação pelo instalador.
          </p>
        </div>
      )}

      {/* tabs */}
      <div className="flex items-center gap-1 bg-[#121212] border border-white/5 rounded-xl p-1 mb-5 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
              tab === t.key ? 'bg-[#1A1A1D] text-white' : 'text-neutral-400 hover:text-white'
            }`}
          >
            {t.label}
            {dirty(t.key) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="não salvo" />}
            {!dirty(t.key) && conn.services[t.key].changed && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" title="pendente de reinício" />
            )}
          </button>
        ))}
      </div>

      {/* fields per tab */}
      {tab === 'postgres' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Host"><Input value={pg.host} onChange={(e) => setPg({ ...pg, host: e.target.value })} /></Field>
            <Field label="Porta"><Input value={pg.port} onChange={(e) => setPg({ ...pg, port: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Usuário"><Input value={pg.user} onChange={(e) => setPg({ ...pg, user: e.target.value })} /></Field>
            <Field label="Senha"><SecretInput value={pg.password} onChange={(v) => setPg({ ...pg, password: v })} /></Field>
          </div>
          <Field label="Banco de dados"><Input value={pg.database} onChange={(e) => setPg({ ...pg, database: e.target.value })} /></Field>
        </div>
      )}

      {tab === 'rabbitmq' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Host"><Input value={rb.host} onChange={(e) => setRb({ ...rb, host: e.target.value })} /></Field>
            <Field label="Porta"><Input value={rb.port} onChange={(e) => setRb({ ...rb, port: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Usuário"><Input value={rb.user} onChange={(e) => setRb({ ...rb, user: e.target.value })} /></Field>
            <Field label="Senha"><SecretInput value={rb.password} onChange={(v) => setRb({ ...rb, password: v })} /></Field>
          </div>
          <Field label="VHost (padrão: /; nomeado: só o nome, ex.: padrao)">
            <Input value={rb.vhost} onChange={(e) => setRb({ ...rb, vhost: e.target.value })} placeholder="/" />
          </Field>
        </div>
      )}

      {tab === 'redis' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Host"><Input value={rd.host} onChange={(e) => setRd({ ...rd, host: e.target.value })} /></Field>
            <Field label="Porta"><Input value={rd.port} onChange={(e) => setRd({ ...rd, port: e.target.value })} /></Field>
          </div>
          <Field label="Senha (opcional)"><SecretInput value={rd.password} onChange={(v) => setRd({ ...rd, password: v })} /></Field>
        </div>
      )}

      {/* per-service status */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 mt-4">
        <span>em uso: <code className="text-neutral-400">{svc.running || '—'}</code></span>
        {dirty(tab) && <Badge tone="neutral">alteração não salva</Badge>}
        {!dirty(tab) && svc.changed && <Badge tone="neutral">pendente de reinício</Badge>}
        {!svc.hotApply && <Badge tone="neutral">requer redeploy (instalador)</Badge>}
        {result && (
          <Badge tone={result.ok ? 'ok' : 'error'}>
            {result.ok ? 'testado: ok' : `falhou: ${result.detail ?? ''}`}
          </Badge>
        )}
        {testState && testState.tab === tab && testState.url === built[tab] && (
          <Badge tone={testState.result.ok ? 'ok' : 'error'}>
            {testState.result.ok ? 'conexão ok' : `falhou: ${testState.result.detail ?? ''}`}
          </Badge>
        )}
      </div>

      <ErrorText>{error}</ErrorText>

      {pendingRestart && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-200">
            Há alterações testadas que <b>ainda não foram aplicadas</b> (RabbitMQ/Redis). Entram em
            vigor ao reiniciar a aplicação.
          </p>
          <div className="flex items-center gap-4 mt-3">
            <Button type="button" onClick={restart} loading={restarting}>
              Reiniciar agora
            </Button>
            <span className="text-xs text-neutral-400">Ou reinicie depois — a marcação permanece.</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mt-5">
        <Button type="button" onClick={save} loading={busy}>
          Salvar e testar
        </Button>
        <Button type="button" variant="ghost" onClick={testNow} loading={testBusy}>
          Testar conexão
        </Button>
        {!pendingRestart && (
          <button
            type="button"
            onClick={restart}
            disabled={restarting}
            className="text-sm text-neutral-400 hover:text-white disabled:opacity-50"
          >
            {restarting ? 'reiniciando…' : 'Reiniciar aplicação'}
          </button>
        )}
      </div>
    </div>
  );
}
