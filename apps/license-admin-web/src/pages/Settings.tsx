import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import { getSettings, updateSettings, type ServerSettings } from '../lib/admin-api';

const selCls =
  'w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50';

export default function Settings() {
  const [retention, setRetention] = useState('');
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [billingProvider, setBillingProvider] = useState('odoo');
  const [odooSecret, setOdooSecret] = useState('');
  const [idempiereSecret, setIdempiereSecret] = useState('');
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
        setBillingProvider(s.billingProvider ?? s.envDefaults?.billingProvider ?? 'odoo');
        setOdooSecret(s.odooSecret ?? '');
        setIdempiereSecret(s.idempiereSecret ?? '');
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
      setError('Link de checkout inválido (precisa começar com http:// ou https://).');
      return;
    }
    setBusy(true);
    try {
      await updateSettings({
        logRetentionDays: days,
        checkoutUrl: url || null,
        billingProvider: billingProvider || null,
        odooSecret: odooSecret.trim() || null,
        idempiereSecret: idempiereSecret.trim() || null,
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
        <h3 className="text-sm font-medium text-white mb-4">Faturamento e Cobrança</h3>
        <div className="space-y-5">
          <Field
            label="Provedor de Faturamento"
            hint="Define qual sistema processa a venda e dispara o webhook de renovação/ativação da licença."
          >
            <select
              value={billingProvider}
              onChange={(e) => setBillingProvider(e.target.value)}
              className={selCls}
              disabled={!loaded}
            >
              <option value="odoo">Odoo v17 + IzyPay (Recomendado)</option>
              <option value="idempiere">iDempiere REST (Standard Webhooks)</option>
              <option value="hotmart">Hotmart</option>
              <option value="generic">Genérico (Tokens WHK-...)</option>
            </select>
          </Field>

          <Field
            label="Link de checkout / Loja"
            hint={
              envDefaults?.checkoutUrl
                ? `Página de pagamento. Em branco usa o padrão: ${envDefaults.checkoutUrl}`
                : 'URL para onde o cliente é enviado ao comprar (o servidor adiciona ?sck=<intentId>&email=...).'
            }
          >
            <Input
              value={checkoutUrl}
              onChange={(e) => setCheckoutUrl(e.target.value)}
              placeholder={envDefaults?.checkoutUrl ?? 'https://loja.suaempresa.com/...'}
              disabled={!loaded}
            />
          </Field>

          {/* Seção Odoo v17 */}
          {(billingProvider === 'odoo' || billingProvider === 'generic') && (
            <div className="pt-4 border-t border-white/5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                  Odoo v17 + IzyPay
                </span>
                <Badge tone="ok">endpoint /webhook/odoo</Badge>
              </div>
              <Field
                label="Secret / Token do Webhook Odoo"
                hint={
                  envDefaults?.odooSecretSet
                    ? 'Há um valor definido no .env; preencher aqui o substitui.'
                    : 'Secret esperado nos cabeçalhos X-Odoo-Secret ou Authorization: Bearer da Ação Automatizada do Odoo.'
                }
              >
                <Input
                  value={odooSecret}
                  onChange={(e) => setOdooSecret(e.target.value)}
                  placeholder="cole o secret configurado no Odoo"
                  disabled={!loaded}
                />
              </Field>
              <p className="text-xs text-neutral-500">
                Configure a Ação Automatizada (Webhook) no Odoo para disparar em Ordens de Venda confirmadas
                apontando para <code className="text-neutral-300">/webhook/odoo</code> deste servidor.
              </p>
            </div>
          )}

          {/* Seção iDempiere */}
          {(billingProvider === 'idempiere' || billingProvider === 'generic') && (
            <div className="pt-4 border-t border-white/5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                  iDempiere REST
                </span>
                <Badge tone="ok">endpoint /webhook/idempiere</Badge>
              </div>
              <Field
                label="Secret do Standard Webhook (whsec_...)"
                hint={
                  envDefaults?.idempiereSecretSet
                    ? 'Há um valor definido no .env; preencher aqui o substitui.'
                    : 'Secret HMAC-SHA256 (iniciado por whsec_...) para validação de cabeçalhos webhook-signature.'
                }
              >
                <Input
                  value={idempiereSecret}
                  onChange={(e) => setIdempiereSecret(e.target.value)}
                  placeholder="whsec_..."
                  disabled={!loaded}
                />
              </Field>
              <p className="text-xs text-neutral-500">
                Configure o Webhook em iDempiere para o evento de conclusão de documento C_Order (DocStatus CO/CL)
                apontando para <code className="text-neutral-300">/webhook/idempiere</code> deste servidor.
              </p>
            </div>
          )}

          {/* Seção Hotmart */}
          {billingProvider === 'hotmart' && (
            <div className="pt-4 border-t border-white/5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                  Hotmart Postback 2.0
                </span>
                <Badge tone="neutral">endpoint /webhook/hotmart</Badge>
              </div>
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
            </div>
          )}
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
