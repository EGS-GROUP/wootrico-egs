import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Boxes, Check, Database, Eye, EyeOff, Globe, Images, KeyRound, Loader2, Network } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import MediaStorageEditor from '../components/MediaStorageEditor';
import { completeSetup, setBaseUrl } from '../lib/setup-api';
import { useAuth } from '../lib/auth';
import {
  activateLicense,
  provisionLicense,
  getLicenseStatus,
  type LicenseStatus,
} from '../lib/license-api';
import {
  getConnections,
  restartSystem,
  saveConnections,
  testConnection,
  type ConnectionsState,
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
import { ApiError } from '../lib/api-client';

const STEPS = ['Banco', 'Fila', 'Cache', 'Domínio', 'Mídias', 'Licença'] as const;

type Service = 'postgres' | 'rabbitmq' | 'redis';
type TestState = { state: 'idle' | 'testing' | 'ok' | 'fail'; detail?: string };

/**
 * Auto-tests a connection URL: re-runs (debounced) whenever the URL changes and
 * exposes runTest() for an explicit "test now" / "before advancing" check. A
 * request id guards against stale responses so the latest edit always wins.
 */
function useAutoTest(service: Service, url: string) {
  const [test, setTest] = useState<TestState>({ state: 'idle' });
  const reqId = useRef(0);

  const runTest = useCallback(async (): Promise<boolean> => {
    if (!url) {
      setTest({ state: 'fail', detail: 'preencha os campos' });
      return false;
    }
    const id = ++reqId.current;
    setTest({ state: 'testing' });
    try {
      const r = await testConnection(service, url);
      if (id !== reqId.current) return false; // a newer test superseded this one
      setTest({ state: r.ok ? 'ok' : 'fail', detail: r.detail });
      return r.ok;
    } catch {
      if (id !== reqId.current) return false;
      setTest({ state: 'fail', detail: 'falha na requisição' });
      return false;
    }
  }, [service, url]);

  // Debounced auto-test as the user edits the fields.
  useEffect(() => {
    if (!url) return;
    const t = setTimeout(() => void runTest(), 700);
    return () => clearTimeout(t);
  }, [url, runTest]);

  return { test, runTest };
}

export default function SetupWizard() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // License owner identity (required for the first key; prefilled from the admin).
  const [licName, setLicName] = useState('');
  const [licEmail, setLicEmail] = useState('');

  // connections (pre-filled from the installer's .env via /api/system/connections)
  const [conn, setConn] = useState<ConnectionsState | null>(null);
  const [pg, setPg] = useState<PgFields | null>(null);
  const [rb, setRb] = useState<RbFields | null>(null);
  const [rd, setRd] = useState<RdFields | null>(null);

  // public URL + license
  const [baseUrl, setBaseUrlValue] = useState(window.location.origin);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState('');

  // restart screen
  const [restarting, setRestarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const builtPg = pg ? buildPg(pg) : '';
  const builtRb = rb ? buildRb(rb) : '';
  const builtRd = rd ? buildRd(rd) : '';
  const pgT = useAutoTest('postgres', builtPg);
  const rbT = useAutoTest('rabbitmq', builtRb);
  const rdT = useAutoTest('redis', builtRd);

  useEffect(() => {
    getConnections()
      .then((c) => {
        setConn(c);
        setPg(parsePg(c.services.postgres.value));
        setRb(parseRb(c.services.rabbitmq.value));
        setRd(parseRd(c.services.redis.value));
      })
      .catch(() => setError('Falha ao carregar o ambiente.'));
  }, []);

  useEffect(() => {
    if (step === 5) getLicenseStatus().then(setLicense).catch(() => {});
  }, [step]);

  // Prefill the license owner from the logged-in admin (editable, required).
  useEffect(() => {
    if (user?.name) setLicName((v) => v || (user.name ?? ''));
    if (user?.email) setLicEmail((v) => v || user.email);
  }, [user]);

  // ── restart screen: poll /api/health until the container is back, then go ──
  useEffect(() => {
    if (!restarting) return;
    let cancelled = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(secs);
      // Give the container a few seconds to actually go down before we trust an
      // "ok" — otherwise we'd redirect into the old process that's about to exit.
      if (secs > 5) {
        try {
          const res = await fetch('/api/health', { cache: 'no-store' });
          if (res.ok && (await res.json())?.status === 'ok') {
            cancelled = true;
            // Reload completo: novo bundle + status/auth frescos após o restart.
            window.location.assign('/');
            return;
          }
        } catch {
          /* container is down — keep waiting */
        }
      }
      timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [restarting]);

  /** Advance only after the current service connects (auto-tested or on click). */
  async function advanceAfterTest(t: { test: TestState; runTest: () => Promise<boolean> }, next: number) {
    setError('');
    if (t.test.state === 'ok') {
      setStep(next);
      return;
    }
    setBusy(true);
    const ok = await t.runTest();
    setBusy(false);
    if (ok) setStep(next);
    else setError('A conexão falhou — ajuste os campos e tente novamente.');
  }

  /** Persist changed RabbitMQ/Redis, set base URL, complete setup, then restart. */
  async function finish() {
    if (!conn) return;
    setError('');
    setBusy(true);
    try {
      // 1) Persist RabbitMQ/Redis if they changed (tested again before saving).
      //    Postgres is read from the environment at boot, so it isn't persisted
      //    here — to point at another database, re-run the installer.
      const body: { rabbitmqUrl?: string; redisUrl?: string } = {};
      if (builtRb && builtRb !== conn.services.rabbitmq.value) body.rabbitmqUrl = builtRb;
      if (builtRd && builtRd !== conn.services.redis.value) body.redisUrl = builtRd;
      let needRestart = false;
      if (Object.keys(body).length > 0) {
        const r = await saveConnections(body);
        if (!r.ok) {
          const failed = Object.entries(r.results)
            .filter(([, v]) => !v.ok)
            .map(([k]) => (k === 'rabbitmqUrl' ? 'RabbitMQ' : 'Redis'))
            .join(', ');
          setError(`Não foi possível salvar: ${failed || 'conexão inválida'}.`);
          setBusy(false);
          return;
        }
        needRestart = true;
      }

      // 2) Public base URL (non-fatal — ajustável depois em Sistema) + 3) marcar
      //    o setup como concluído. Um erro ao salvar a base URL NÃO pode impedir
      //    a conclusão, senão o gate de 1º acesso prende o usuário no wizard.
      try {
        await setBaseUrl(baseUrl.trim());
      } catch {
        /* segue — a base URL pode ser corrigida depois */
      }
      await completeSetup();

      // 4) Apply via restart (RabbitMQ/Redis take effect on boot) or go straight.
      //    Reload COMPLETO (não navegação SPA) para buscar status/auth e o bundle
      //    frescos — evita ficar preso no wizard por estado obsoleto.
      if (needRestart) {
        setBusy(false);
        setRestarting(true);
        restartSystem().catch(() => {
          /* the server is going down — expected */
        });
      } else {
        window.location.assign('/');
      }
    } catch {
      setError('Falha ao concluir a configuração.');
      setBusy(false);
    }
  }

  async function activate() {
    setError('');
    setBusy(true);
    try {
      await activateLicense(key.trim());
      setLicense(await getLicenseStatus());
      await finish();
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError ? `Falha na licença: ${e.code}` : 'Falha ao ativar a licença.');
    }
  }

  async function activateAndFinish() {
    const name = licName.trim();
    const email = licEmail.trim();
    if (!name || !email) {
      setError('Informe nome e e-mail para ativar a licença.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await provisionLicense({ name, email });
      setLicense(await getLicenseStatus());
      await finish();
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError ? `Falha na licença: ${e.code}` : 'Falha ao ativar a licença.');
    }
  }

  if (restarting) return <RestartScreen elapsed={elapsed} />;

  const loading = !conn || !pg || !rb || !rd;

  return (
    <div className="min-h-screen bg-black relative flex items-center justify-center px-6 py-12 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/50 to-black" />
        <div className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2">
          <div className="w-[40rem] h-[40rem] rounded-full bg-blue-600/20 blur-[120px] mix-blend-screen" />
        </div>
      </div>

      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <Eyebrow>Configuração inicial</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Bem-vindo ao Wootrico</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Detectamos seu ambiente — confirme cada conexão e pronto.
          </p>
        </div>

        {/* stepper */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium border ${
                  i < step
                    ? 'bg-blue-500 text-white border-blue-500'
                    : i === step
                      ? 'bg-white/10 text-white border-white/40'
                      : 'bg-transparent text-neutral-500 border-white/10'
                }`}
              >
                {i < step ? <Check size={14} /> : i + 1}
              </span>
              <span className={`text-xs ${i === step ? 'text-white' : 'text-neutral-500'}`}>{label}</span>
              {i < STEPS.length - 1 && <span className="w-6 h-px bg-white/10" />}
            </div>
          ))}
        </div>

        <Card>
          {loading ? (
            <p className="text-sm text-neutral-500">{error || 'Detectando o ambiente…'}</p>
          ) : (
            <>
              {/* ── 0 · Postgres (already running — confirmation) ── */}
              {step === 0 && (
                <StepShell
                  icon={<Database size={16} className="text-blue-400" />}
                  title="Banco de dados (Postgres)"
                  desc="O painel já está usando este banco. Confira a conexão e siga."
                >
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Host"><Input value={pg.host} disabled /></Field>
                    <Field label="Porta"><Input value={pg.port} disabled /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Usuário"><Input value={pg.user} disabled /></Field>
                    <Field label="Banco"><Input value={pg.database} disabled /></Field>
                  </div>
                  <p className="text-xs text-neutral-500">
                    O banco é definido na instalação. Para apontar para outro Postgres, rode o
                    instalador novamente.
                  </p>
                  <TestRow test={pgT.test} onTest={pgT.runTest} />
                  <ActionRow
                    onContinue={() => advanceAfterTest(pgT, 1)}
                    busy={busy}
                    testState={pgT.test.state}
                  />
                </StepShell>
              )}

              {/* ── 1 · RabbitMQ ── */}
              {step === 1 && (
                <StepShell
                  icon={<Network size={16} className="text-blue-400" />}
                  title="Fila de mensagens (RabbitMQ)"
                  desc="Confirme ou ajuste o acesso. Testamos automaticamente ao editar."
                >
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Host"><Input value={rb.host} onChange={(e) => setRb({ ...rb, host: e.target.value })} /></Field>
                    <Field label="Porta"><Input value={rb.port} onChange={(e) => setRb({ ...rb, port: e.target.value })} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Usuário"><Input value={rb.user} onChange={(e) => setRb({ ...rb, user: e.target.value })} /></Field>
                    <Field label="Senha"><Secret value={rb.password} onChange={(v) => setRb({ ...rb, password: v })} /></Field>
                  </div>
                  <Field label="VHost (padrão: /; nomeado: só o nome, ex.: padrao)">
                    <Input value={rb.vhost} onChange={(e) => setRb({ ...rb, vhost: e.target.value })} placeholder="/" />
                  </Field>
                  <TestRow test={rbT.test} onTest={rbT.runTest} />
                  <ActionRow
                    onContinue={() => advanceAfterTest(rbT, 2)}
                    onBack={() => setStep(0)}
                    busy={busy}
                    testState={rbT.test.state}
                  />
                </StepShell>
              )}

              {/* ── 2 · Redis ── */}
              {step === 2 && (
                <StepShell
                  icon={<Boxes size={16} className="text-blue-400" />}
                  title="Cache (Redis)"
                  desc="Confirme ou ajuste o acesso. Testamos automaticamente ao editar."
                >
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Host"><Input value={rd.host} onChange={(e) => setRd({ ...rd, host: e.target.value })} /></Field>
                    <Field label="Porta"><Input value={rd.port} onChange={(e) => setRd({ ...rd, port: e.target.value })} /></Field>
                  </div>
                  <Field label="Senha (opcional)">
                    <Secret value={rd.password} onChange={(v) => setRd({ ...rd, password: v })} />
                  </Field>
                  <TestRow test={rdT.test} onTest={rdT.runTest} />
                  <ActionRow
                    onContinue={() => advanceAfterTest(rdT, 3)}
                    onBack={() => setStep(1)}
                    busy={busy}
                    testState={rdT.test.state}
                  />
                </StepShell>
              )}

              {/* ── 3 · Public URL ── */}
              {step === 3 && (
                <StepShell
                  icon={<Globe size={16} className="text-blue-400" />}
                  title="URL pública desta instância"
                  desc="Usada para montar as URLs de webhook que você cola no Chatwoot e na API."
                >
                  <Field label="Base URL">
                    <Input value={baseUrl} onChange={(e) => setBaseUrlValue(e.target.value)} />
                  </Field>
                  <ErrorText>{error}</ErrorText>
                  <div className="flex items-center gap-4">
                    <Button onClick={() => setStep(4)}>Continuar</Button>
                    <button onClick={() => setStep(2)} className="text-sm text-neutral-400 hover:text-white">
                      Voltar
                    </button>
                  </div>
                </StepShell>
              )}

              {/* ── 4 · Media library (optional) ── */}
              {step === 4 && (
                <StepShell
                  icon={<Images size={16} className="text-blue-400" />}
                  title="Biblioteca de Mídias (opcional)"
                  desc="Guarde as mídias que passam pelas integrações para consulta. Configure o armazenamento agora ou pule e ajuste depois em Sistema."
                >
                  <MediaStorageEditor heading={false} />
                  <div className="flex items-center gap-4">
                    <Button onClick={() => setStep(5)}>Continuar</Button>
                    <button onClick={() => setStep(3)} className="text-sm text-neutral-400 hover:text-white">
                      Voltar
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Salve a configuração acima se quiser ativar o S3 ou definir retenção. Por padrão, a
                    biblioteca fica ativada com armazenamento local.
                  </p>
                </StepShell>
              )}

              {/* ── 5 · License + finish ── */}
              {step === 5 && (
                <StepShell
                  icon={<KeyRound size={16} className="text-blue-400" />}
                  title="Ativação"
                  desc="A ativação é obrigatória para usar o Wootrico. Confirme seu nome e e-mail para registrar esta instância."
                  badge={
                    license ? (
                      <Badge tone={license.status === 'active' ? 'ok' : 'neutral'}>
                        {license.status === 'active' ? 'Ativo' : 'Pendente'}
                      </Badge>
                    ) : undefined
                  }
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Nome">
                      <Input value={licName} onChange={(e) => setLicName(e.target.value)} placeholder="Seu nome" />
                    </Field>
                    <Field label="E-mail">
                      <Input value={licEmail} onChange={(e) => setLicEmail(e.target.value)} placeholder="voce@exemplo.com" />
                    </Field>
                  </div>
                  <ErrorText>{error}</ErrorText>
                  <p className="text-xs text-neutral-500">
                    Se você alterou RabbitMQ ou Redis, a aplicação reinicia ao concluir para aplicar —
                    leva alguns segundos.
                  </p>
                  <div className="flex flex-wrap items-center gap-4">
                    <Button onClick={key.trim() ? activate : activateAndFinish} loading={busy}>
                      Ativar e concluir
                    </Button>
                    <button onClick={() => setStep(4)} className="text-sm text-neutral-400 hover:text-white">
                      Voltar
                    </button>
                  </div>
                  <details className="mt-2">
                    <summary className="text-xs text-neutral-500 hover:text-white cursor-pointer">
                      Tenho uma chave (ativar manualmente)
                    </summary>
                    <div className="mt-3">
                      <Field label="Chave de licença">
                        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="WTR-..." />
                      </Field>
                    </div>
                  </details>
                </StepShell>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function StepShell({
  icon,
  title,
  desc,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-white">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
        {badge}
      </div>
      <p className="text-sm text-neutral-400">{desc}</p>
      {children}
    </div>
  );
}

function TestRow({ test, onTest }: { test: TestState; onTest: () => Promise<boolean> }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-[#121212] px-4 py-3">
      <div className="flex items-center gap-2 min-w-0">
        {test.state === 'testing' && <Loader2 size={14} className="animate-spin text-neutral-400" />}
        {test.state === 'ok' && <Activity size={14} className="text-emerald-400" />}
        {test.state === 'fail' && <Activity size={14} className="text-red-400" />}
        <span className="text-xs text-neutral-400 truncate" title={test.detail}>
          {test.state === 'idle' && 'aguardando…'}
          {test.state === 'testing' && 'testando conexão…'}
          {test.state === 'ok' && 'conexão ok'}
          {test.state === 'fail' && `falhou${test.detail ? `: ${test.detail}` : ''}`}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void onTest()}
        className="text-xs text-neutral-400 hover:text-white shrink-0"
      >
        Testar agora
      </button>
    </div>
  );
}

function ActionRow({
  onContinue,
  onBack,
  busy,
  testState,
}: {
  onContinue: () => void;
  onBack?: () => void;
  busy: boolean;
  testState: TestState['state'];
}) {
  return (
    <div className="flex items-center gap-4">
      <Button onClick={onContinue} loading={busy || testState === 'testing'}>
        Continuar
      </Button>
      {onBack && (
        <button onClick={onBack} className="text-sm text-neutral-400 hover:text-white">
          Voltar
        </button>
      )}
    </div>
  );
}

function Secret({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

/** Full-screen wait while the container restarts — survives the backend going
 *  away because it's already loaded in the browser and only polls /api/health. */
function RestartScreen({ elapsed }: { elapsed: number }) {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <Loader2 size={32} className="animate-spin text-blue-400 mx-auto" />
        <h1 className="mt-6 text-2xl font-semibold text-white">Aplicando e reiniciando…</h1>
        <p className="mt-3 text-sm text-neutral-400">
          Seu Wootrico estará pronto em alguns segundos. Esta página redireciona sozinha — não feche o
          navegador.
        </p>
        <p className="mt-4 text-xs text-neutral-600">aguardando há {elapsed}s</p>
      </div>
    </div>
  );
}
