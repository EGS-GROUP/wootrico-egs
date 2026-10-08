import { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff, KeyRound } from 'lucide-react';
import { Badge, Card, Eyebrow } from '../components/ui';
import { getHealth, type HealthReport } from '../lib/admin-api';

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

export default function Health() {
  const [data, setData] = useState<HealthReport | null>(null);

  useEffect(() => {
    getHealth().then(setData).catch(() => {});
  }, []);

  return (
    <div>
      <div className="mb-8">
        <Eyebrow>Saúde / Detecção</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Saúde das licenças</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Sinais de abuso para você agir: instâncias que pararam de validar (cliente offline ou
          adulterado) e chaves usadas em IPs diferentes (possível compartilhamento).
        </p>
      </div>

      {!data ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Card>
              <div className="flex items-center gap-3">
                <KeyRound size={18} className="text-emerald-400" />
                <div>
                  <p className="text-2xl font-semibold text-white">{data.summary.activeKeys}</p>
                  <p className="text-xs text-neutral-500">chaves ativas</p>
                </div>
              </div>
            </Card>
            <Card>
              <div>
                <p className="text-2xl font-semibold text-white">
                  {data.summary.trialActive}
                  <span className="text-neutral-500 text-base"> / {data.summary.paidActive}</span>
                </p>
                <p className="text-xs text-neutral-500">teste ativas / pagas ativas</p>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <WifiOff size={18} className="text-amber-300" />
                <div>
                  <p className="text-2xl font-semibold text-white">{data.summary.staleInstances}</p>
                  <p className="text-xs text-neutral-500">sem validar há +{data.staleHours}h</p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <AlertTriangle size={18} className="text-red-300" />
                <div>
                  <p className="text-2xl font-semibold text-white">{data.summary.keysWithIpAlerts}</p>
                  <p className="text-xs text-neutral-500">chaves com alerta de IP</p>
                </div>
              </div>
            </Card>
          </div>

          <h3 className="text-sm font-medium text-white mb-3">Instâncias que pararam de validar</h3>
          {data.stale.length === 0 ? (
            <p className="text-sm text-neutral-500 mb-8">Nenhuma — todas validaram recentemente.</p>
          ) : (
            <div className="space-y-3 mb-8">
              {data.stale.map((s) => (
                <Card key={`${s.licenseKeyId}-${s.instanceId}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{s.name || s.email || 'Sem titular'}</p>
                      <p className="text-xs text-neutral-500 font-mono truncate">
                        {s.instanceId} · {s.licenseKeyId.slice(0, 8)}
                      </p>
                    </div>
                    <Badge tone="error">{s.plan === 'paid' ? 'Paga' : 'Teste'}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs border-t border-white/5 pt-3">
                    <dt className="text-neutral-500">Última validação</dt>
                    <dd className="text-amber-300">{fmt(s.lastHeartbeatAt)}</dd>
                    <dt className="text-neutral-500">Último IP</dt>
                    <dd className="text-neutral-300 font-mono">{s.lastIp ?? '—'}</dd>
                    <dt className="text-neutral-500">Versão</dt>
                    <dd className="text-neutral-300">{s.appVersion ?? '—'}</dd>
                  </dl>
                </Card>
              ))}
            </div>
          )}

          <h3 className="text-sm font-medium text-white mb-3">Alertas de IP (possível compartilhamento)</h3>
          {data.ipAlerts.length === 0 ? (
            <p className="text-sm text-neutral-500">Nenhum alerta de IP.</p>
          ) : (
            <div className="space-y-3">
              {data.ipAlerts.map((a) => (
                <Card key={a.licenseKeyId ?? Math.random()}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{a.name || a.email || 'Sem titular'}</p>
                      <p className="text-xs text-neutral-500 font-mono truncate">
                        {a.licenseKeyId?.slice(0, 8)} · último: {fmt(a.lastAlertAt)}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/40 px-2 py-0.5 text-red-300 text-[11px]">
                      <AlertTriangle size={12} /> {a.alerts} alerta(s)
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
