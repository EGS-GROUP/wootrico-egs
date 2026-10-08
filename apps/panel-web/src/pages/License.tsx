import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import {
  provisionLicense,
  purchaseLicense,
  deactivateLicense,
  getLicenseStatus,
  triggerHeartbeat,
  type LicenseStatus,
} from '../lib/license-api';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api-client';

const TONE: Record<string, 'ok' | 'error' | 'neutral'> = {
  active: 'ok',
  warning: 'neutral',
  blocked: 'error',
  unactivated: 'neutral',
};

const LABEL: Record<string, string> = {
  active: 'Ativa',
  warning: 'Atenção',
  blocked: 'Bloqueada',
  unactivated: 'Não ativada',
};

/** Whole days remaining until the given ISO date (0 when past). */
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** Human, non-alarming message for an activation/provision failure. */
function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.code ?? '';
    if (/unreachable|fetch failed|ENOTFOUND|ECONNREFUSED|timeout|network/i.test(code)) {
      return 'Não foi possível falar com o servidor de licenças (ele pode estar temporariamente indisponível). Tente novamente em instantes.';
    }
    return `Falha: ${code}`;
  }
  return 'Falha ao processar a solicitação. Tente novamente.';
}

export default function License() {
  const { user } = useAuth();
  const [info, setInfo] = useState<LicenseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [licName, setLicName] = useState('');
  const [licEmail, setLicEmail] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const load = () => getLicenseStatus().then(setInfo).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  // While the license screen is OPEN, re-validate with the server periodically so
  // admin actions (revogar, expirar, liberar como paga, alterar vencimento) reflect
  // in ~30–45s instead of waiting for the next scheduled heartbeat (~6h). Faster (25s) when
  // blocked, to recover quickly. Only runs while this page is mounted, so it
  // doesn't add global load.
  useEffect(() => {
    if (!info || info.status === 'unactivated') return;
    const intervalMs = info.status === 'blocked' ? 25_000 : 45_000;
    const id = setInterval(() => {
      void triggerHeartbeat().then(load).catch(() => {});
    }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.status]);

  // Prefill owner from the logged-in admin (editable, required for the first key).
  useEffect(() => {
    if (user?.name) setLicName((v) => v || (user.name ?? ''));
    if (user?.email) setLicEmail((v) => v || user.email);
  }, [user]);

  const serverBase = info?.serverUrl ? info.serverUrl.replace(/\/$/, '') : null;

  // Feature-detect Google login on the (vendor) license server.
  useEffect(() => {
    if (!serverBase) return;
    fetch(`${serverBase}/auth/google/config`)
      .then((r) => r.json())
      .then((d) => setGoogleEnabled(!!d.enabled))
      .catch(() => {});
  }, [serverBase]);

  async function provisionWith(name: string, email: string) {
    if (!name || !email) {
      setError('Informe nome e e-mail para ativar a licença.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await provisionLicense({ name, email });
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function provision() {
    await provisionWith(licName.trim(), licEmail.trim());
  }

  function loginWithGoogle() {
    if (!serverBase) return;
    const nonce =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Math.random()).slice(2) + Date.now();
    const popup = window.open(
      `${serverBase}/auth/google?origin=${encodeURIComponent(window.location.origin)}&nonce=${nonce}`,
      'wootrico-google',
      'width=480,height=640',
    );
    // Poll the result (robust even when the popup's window.opener is severed by COOP).
    const started = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - started > 120000) {
        clearInterval(poll);
        return;
      }
      try {
        const r = await fetch(`${serverBase}/auth/google/result?nonce=${nonce}`, { cache: 'no-store' });
        const d = (await r.json()) as { email?: string; name?: string };
        if (d && d.email) {
          clearInterval(poll);
          try {
            popup?.close();
          } catch {
            /* ignore */
          }
          setLicName(d.name || '');
          setLicEmail(d.email);
          void provisionWith(d.name || d.email, d.email);
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
  }

  // Receive the verified Google identity from the license server popup, then
  // register/activate with it.
  useEffect(() => {
    if (!serverBase) return;
    let allowed = '';
    try {
      allowed = new URL(serverBase).origin;
    } catch {
      /* ignore */
    }
    const onMsg = (e: MessageEvent) => {
      if (allowed && e.origin !== allowed) return;
      const d = e.data as { source?: string; email?: string; name?: string } | null;
      if (d && d.source === 'wootrico-google' && d.email) {
        setLicName(d.name || '');
        setLicEmail(d.email);
        void provisionWith(d.name || d.email, d.email);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBase]);

  async function buy() {
    setError('');
    setBusy(true);
    try {
      const { checkoutUrl } = await purchaseLicense();
      await load();
      if (checkoutUrl) window.open(checkoutUrl, '_blank', 'noopener');
      else setError('Solicitação registrada. Em breve entraremos em contato para concluir a compra.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!confirm('Desativar a licença nesta instância? (libera a chave para outra instância)')) return;
    setBusy(true);
    await deactivateLicense().catch(() => {});
    await load();
    setBusy(false);
  }

  const activated = info && info.status !== 'unactivated';
  const isActive = info?.status === 'active' || info?.status === 'warning';
  const isBlocked = info?.status === 'blocked';
  const remaining = isActive ? daysLeft(info?.expiresAt ?? null) : null;
  // Why it's blocked drives the message + CTA. The server tells us: an
  // expired/revoked/inactive key means BUY/RENEW; 'offline' (server unreachable
  // 48h) means just reconnect — no purchase. Default unknown blocks to offline.
  const reason = info?.blockedReason ?? null;
  const offlineBlocked = isBlocked && (reason === 'offline' || reason === null);
  const purchaseBlocked = isBlocked && !offlineBlocked; // expired | revoked | inactive
  const isRevoked = reason === 'revoked';
  const isPaidExpired = purchaseBlocked && info?.plan === 'paid' && !isRevoked;

  return (
    <div className="max-w-2xl">
      <div className="mb-10">
        <Eyebrow>Licença</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Licença</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Gerencie a licença desta instância do Wootrico.
        </p>
      </div>

      {info && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-medium text-white">Status</h3>
            <Badge tone={TONE[info.status] ?? 'neutral'}>{LABEL[info.status] ?? info.status}</Badge>
          </div>

          {/* Dias restantes (quando ativa e há prazo). Sem detalhar a renovação. */}
          {isActive && remaining !== null && (
            <div className="mb-5 rounded-lg border border-white/5 bg-white/[0.03] px-4 py-3">
              <p className="text-2xl font-semibold text-white">
                {remaining} {remaining === 1 ? 'dia restante' : 'dias restantes'}
              </p>
            </div>
          )}

          {/* Aviso: servidor de licenças indisponível — a licença CONTINUA ativa. */}
          {!isBlocked && info.offline && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
              <div className="text-sm">
                <p className="font-medium text-amber-200">Servidor de licenças indisponível</p>
                <p className="text-amber-200/80">
                  Não conseguimos validar a licença com o servidor agora — ele pode estar
                  temporariamente fora do ar. Sua licença continua ativa e o processamento segue
                  normal. Vamos tentar de novo automaticamente.
                </p>
              </div>
            </div>
          )}

          {/* Bloqueio por falta de validação (servidor inacessível por +48h). */}
          {offlineBlocked && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-300" />
              <div className="text-sm">
                <p className="font-medium text-red-200">Licença sem validação</p>
                <p className="text-red-200/80">
                  Não foi possível validar sua licença com o servidor por mais de 48h, então o
                  processamento foi pausado por segurança. Assim que a conexão for restabelecida, sua
                  licença é reativada automaticamente. Seus dados continuam acessíveis.
                </p>
              </div>
            </div>
          )}

          {/* Banner de licença inativa (vencida / revogada / inativa pelo servidor). */}
          {purchaseBlocked && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-300" />
              <div className="text-sm">
                <p className="font-medium text-red-200">
                  {isRevoked
                    ? 'Licença revogada'
                    : isPaidExpired
                      ? 'Licença vencida'
                      : info.plan === 'trial'
                        ? 'Período de teste encerrado'
                        : 'Licença inativa'}
                </p>
                <p className="text-red-200/80">
                  O processamento de mensagens está pausado e as integrações foram desativadas.
                  Seus dados continuam acessíveis.
                </p>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-neutral-500">Titular</dt>
            <dd className="text-neutral-300 truncate">
              {user?.name ? `${user.name} · ${user.email}` : (user?.email ?? '—')}
            </dd>
            <dt className="text-neutral-500">Seu ID de instalação</dt>
            <dd className="text-neutral-300 font-mono text-xs truncate">{info.instanceId ?? '—'}</dd>
            <dt className="text-neutral-500">Última validação</dt>
            <dd className="text-neutral-300">
              {info.lastValidatedAt ? new Date(info.lastValidatedAt).toLocaleString() : '—'}
            </dd>
          </dl>
        </Card>
      )}

      <Card>
        {!activated && (
          <>
            <h3 className="text-sm font-medium text-white mb-2">Ativar</h3>
            <p className="text-sm text-neutral-400 mb-5">
              Cadastre-se com o Google ou confirme seu nome e e-mail para registrar esta instância.
            </p>
            {googleEnabled && (
              <div className="mb-5">
                <GoogleButton onClick={loginWithGoogle} />
                <p className="mt-3 text-xs text-neutral-500">ou preencha manualmente:</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Field label="Nome">
                <Input value={licName} onChange={(e) => setLicName(e.target.value)} placeholder="Seu nome" />
              </Field>
              <Field label="E-mail">
                <Input value={licEmail} onChange={(e) => setLicEmail(e.target.value)} placeholder="voce@exemplo.com" />
              </Field>
            </div>
            <ErrorText>{error}</ErrorText>
            <Button onClick={provision} loading={busy}>
              Ativar
            </Button>
          </>
        )}

        {activated && isActive && (
          <>
            <h3 className="text-sm font-medium text-white mb-2">Licença ativa</h3>
            <p className="text-sm text-neutral-400 mb-5">
              Sua instância está ativa e funcionando normalmente.
            </p>
            <ErrorText>{error}</ErrorText>
            <button
              type="button"
              onClick={deactivate}
              className="text-sm text-neutral-400 hover:text-red-300"
            >
              Desativar nesta instância
            </button>
          </>
        )}

        {offlineBlocked && (
          <>
            <h3 className="text-sm font-medium text-white mb-2">Reconectando ao servidor</h3>
            <p className="text-sm text-neutral-400 mb-5">
              Estamos tentando validar sua licença com o servidor automaticamente. Assim que a
              conexão voltar, o processamento é retomado sozinho — não é preciso fazer nada.
            </p>
            <ErrorText>{error}</ErrorText>
          </>
        )}

        {purchaseBlocked && (
          <>
            <h3 className="text-sm font-medium text-white mb-2">
              {isPaidExpired ? 'Renovar licença' : 'Adquirir licença'}
            </h3>
            <p className="text-sm text-neutral-400 mb-4">
              {isRevoked
                ? 'Sua licença foi revogada e o processamento está pausado. Adquira uma licença para voltar a operar — seus dados continuam acessíveis.'
                : isPaidExpired
                  ? 'Sua licença anual venceu e o processamento está pausado. Renove para voltar a operar — seus dados continuam acessíveis.'
                  : 'Seu acesso está inativo e as integrações estão pausadas. Garanta sua licença para voltar a processar — seus dados continuam acessíveis.'}
            </p>

            {/* Preço + validade de 1 ano. */}
            <div className="mb-5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
              <p className="text-2xl font-semibold text-white">
                R$ 57,90 <span className="text-sm font-normal text-neutral-300">à vista</span>
              </p>
              <p className="text-sm text-neutral-300">ou 12x de R$ 8,42</p>
              <p className="mt-1 text-xs text-blue-200/90">Acesso por 1 ano · renovável</p>
            </div>

            <ErrorText>{error}</ErrorText>
            <div className="flex flex-wrap items-center gap-4">
              <Button onClick={buy} loading={busy}>
                {isPaidExpired ? 'Renovar agora' : 'Adquirir licença'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** "Sign in with Google" button (broker flow via the license server popup). */
function GoogleButton({ onClick, label = 'Entrar com Google' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-3 rounded-lg border border-white/15 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      {label}
    </button>
  );
}
