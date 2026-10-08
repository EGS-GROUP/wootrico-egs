import { useEffect, useState } from 'react';
import { Card, Eyebrow } from '../components/ui';
import { BarChart } from '../components/Chart';
import { getStats, type StatsReport } from '../lib/admin-api';

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <p className={`text-3xl font-semibold ${tone ?? 'text-white'}`}>{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{label}</p>
    </Card>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<StatsReport | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
  }, []);

  return (
    <div>
      <div className="mb-8">
        <Eyebrow>Visão geral</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Painel</h1>
        <p className="mt-2 text-sm text-neutral-400">Métricas das licenças nos últimos 30 dias.</p>
      </div>

      {!stats ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Metric label="Usuários (cadastros)" value={stats.totals.users} />
            <Metric label="Chaves ativas" value={stats.totals.active} tone="text-emerald-400" />
            <Metric label="Instâncias ativas" value={stats.totals.activeInstances} />
            <Metric label="Alertas de IP" value={stats.totals.ipAlerts} tone={stats.totals.ipAlerts ? 'text-red-300' : 'text-white'} />
            <Metric label="Total de chaves" value={stats.totals.keys} />
            <Metric label="Teste (trial)" value={stats.totals.trial} />
            <Metric label="Pagas" value={stats.totals.paid} tone="text-blue-400" />
            <Metric label="Expiradas / revogadas" value={stats.totals.expired + stats.totals.revoked} tone="text-amber-300" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <h3 className="text-sm font-medium text-white mb-4">Chaves criadas / dia</h3>
              <BarChart data={stats.series.keysPerDay} color="fill-blue-400" />
            </Card>
            <Card>
              <h3 className="text-sm font-medium text-white mb-4">Validações / dia</h3>
              <BarChart data={stats.series.validationsPerDay} color="fill-emerald-400" />
            </Card>
            <Card>
              <h3 className="text-sm font-medium text-white mb-4">Pagamentos / dia</h3>
              <BarChart data={stats.series.paymentsPerDay} color="fill-violet-400" />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
