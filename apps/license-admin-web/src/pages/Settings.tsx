import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import { getSettings, updateSettings, type ServerSettings } from '../lib/admin-api';

export default function Settings() {
  const [retention, setRetention] = useState('');
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [hottok, setHottok] = useState('');
  const [productId, setProductId] = useState('');
  const [supportWhatsapp, setSupportWhatsapp] = useState('');
  const [envDefaults, setEnvDefaults] = useState<ServerSettings['envDefaults']>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setRetention(s.logRetentionDays != null ? String(s.logRetentionDays) : '');
        setCheckoutUrl(s.checkoutUrl ?? '');
        setHottok(s.hotmartHottok ?? '');
        setProductId(s.hotmartProductId ?? '');
        setSupportWhatsapp(s.supportWhatsapp ?? '');
        setEnvDefaults(s.envDefaults);
        setLoaded(true);
      })
      .catch(() => setError('Falha ao carregar as configurações.'));
  }, []);

  async function onSave() {
    setError('');
    setSaved(false);
    const trimmed = retention.trim();
    let days: number | null = null;
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) {
        setError('Retenção: informe um inteiro maior que zero, ou deixe em branco.');
        return;
      }
      days = n;
    }
    const url = checkoutUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setError('Link de checkout inválido (precisa começar com http).');
      return;
    }
    setBusy(true);
    try {
      await updateSettings({
        logRetentionDays: days,
        checkoutUrl: url || null,
        hotmartHottok: hottok.trim() || null,
        hotmartProductId: productId.trim() || null,
        supportWhatsapp: supportWhatsapp.trim() || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setError('Falha ao salvar as configurações.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <Eyebrow>Operação</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Configurações</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Ajustes do servidor de licenças. Valores em branco usam o padrão do ambiente (.env).
        </p>
      </div>

      <Card className="max-w-xl mb-6">
        <h3 className="text-sm font-medium text-white mb-4">Pagamento (Hotmart)</h3>
        <div className="space-y-5">
          <Field
            label="Link de checkout"
            hint={
              envDefaults?.checkoutUrl
                ? `Em branco usa o padrão: ${envDefaults.checkoutUrl}`
                : 'Página de pagamento Hotmart para onde o cliente é enviado ao comprar.'
            }
          >
            <Input
              value={checkoutUrl}
              onChange={(e) => setCheckoutUrl(e.target.value)}
              placeholder={envDefaults?.checkoutUrl ?? 'https://pay.hotmart.com/...'}
              disabled={!loaded}
            />
          </Field>

          <Field
            label="Token do webhook (hottok)"
            hint={
              envDefaults?.hotmartHottokSet
                ? 'Há um valor definido no .env; preencher aqui o substitui.'
                : 'Token do Postback 2.0 da Hotmart — valida que o webhook veio mesmo da Hotmart.'
            }
          >
            <Input
              value={hottok}
              onChange={(e) => setHottok(e.target.value)}
              placeholder="cole o hottok da Hotmart"
              disabled={!loaded}
            />
          </Field>

          <Field
            label="ID do produto (opcional)"
            hint="Se preenchido, só aceita eventos desse produto Hotmart."
          >
            <Input
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder={envDefaults?.hotmartProductId ?? 'ex.: 1234567'}
              disabled={!loaded}
            />
          </Field>

          <p className="text-xs text-neutral-500">
            Configure o Webhook 2.0 da Hotmart apontando para{' '}
            <code className="text-neutral-300">/webhook/hotmart</code> deste servidor.
          </p>
        </div>
      </Card>

      <Card className="max-w-xl mb-6">
        <h3 className="text-sm font-medium text-white mb-4">Suporte (WhatsApp)</h3>
        <div className="space-y-5">
          <Field
            label="Número do WhatsApp de suporte"
            hint="Apenas dígitos com código do país (ex.: 5521999999999). É entregue a TODOS os clientes na validação da licença; clientes pagos ativos são direcionados a ele."
          >
            <Input
              value={supportWhatsapp}
              onChange={(e) => setSupportWhatsapp(e.target.value)}
              placeholder={envDefaults?.supportWhatsapp ?? '5521999999999'}
              disabled={!loaded}
            />
          </Field>
        </div>
      </Card>

      <Card className="max-w-xl">
        <h3 className="text-sm font-medium text-white mb-4">Retenção de logs</h3>
        <div className="space-y-5">
          <Field
            label="Retenção (dias) — em branco = manter para sempre"
            hint="Eventos e heartbeats mais antigos que esse período são removidos na limpeza periódica (de hora em hora)."
          >
            <Input
              type="number"
              min={1}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              placeholder="ex.: 60"
              disabled={!loaded}
            />
          </Field>

          <ErrorText>{error}</ErrorText>

          <div className="flex items-center gap-4">
            <Button type="button" onClick={onSave} loading={busy} disabled={!loaded}>
              Salvar
            </Button>
            {saved && <Badge tone="ok">salvo</Badge>}
          </div>
        </div>
      </Card>
    </div>
  );
}
