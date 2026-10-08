import { useEffect, useState } from 'react';
import { Eye, EyeOff, Database, Cloud, ShieldAlert } from 'lucide-react';
import { Badge, Button, Checkbox, ErrorText, Field, Input, Select } from './ui';
import {
  getMediaConfig,
  updateMediaConfig,
  testMediaS3,
  type MediaConfigDTO,
} from '../lib/media-api';

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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

/**
 * Editor for the media-library storage configuration. Reused in the System page
 * and (compact) in the setup wizard. Saves are test-before-apply for S3.
 */
export default function MediaStorageEditor({ heading = true }: { heading?: boolean }) {
  const [cfg, setCfg] = useState<MediaConfigDTO | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [driver, setDriver] = useState<'local' | 's3'>('local');
  const [retention, setRetention] = useState('');
  // S3 fields
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [forcePathStyle, setForcePathStyle] = useState(false);

  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<{ ok: boolean; detail?: string } | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getMediaConfig()
      .then((c) => {
        setCfg(c);
        setEnabled(c.enabled);
        setDriver(c.driver);
        setRetention(c.retentionDays != null ? String(c.retentionDays) : '');
        setEndpoint(c.s3.endpoint ?? '');
        setRegion(c.s3.region ?? '');
        setBucket(c.s3.bucket ?? '');
        setAccessKeyId(c.s3.accessKeyId ?? '');
        setForcePathStyle(Boolean(c.s3.forcePathStyle));
      })
      .catch(() => setError('Falha ao carregar a configuração de mídias.'));
  }, []);

  const secretSet = cfg?.s3.secretSet ?? false;

  function s3Body() {
    return {
      endpoint: endpoint.trim() || undefined,
      region: region.trim(),
      bucket: bucket.trim(),
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secret,
      forcePathStyle,
    };
  }

  async function onTest() {
    setError('');
    setTestState(null);
    if (!secret) {
      setError('Informe a chave secreta para testar.');
      return;
    }
    setBusy(true);
    try {
      setTestState(await testMediaS3(s3Body()));
    } catch {
      setTestState({ ok: false, detail: 'falha na requisição' });
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    setError('');
    setSaved(false);
    setBusy(true);
    try {
      const retentionDays = retention.trim() ? Math.max(1, parseInt(retention, 10) || 0) : null;
      const body = {
        enabled,
        driver,
        retentionDays,
        s3:
          driver === 's3'
            ? {
                endpoint: endpoint.trim() || undefined,
                region: region.trim(),
                bucket: bucket.trim(),
                accessKeyId: accessKeyId.trim(),
                // Omit the secret when left blank to keep the stored one.
                secretAccessKey: secret || undefined,
                forcePathStyle,
              }
            : undefined,
      };
      await updateMediaConfig(body);
      setSaved(true);
      setSecret('');
      getMediaConfig().then(setCfg).catch(() => {});
    } catch (e) {
      const detail = (e as { code?: string }).code;
      setError(
        detail === 's3_test_failed'
          ? 'O teste de conexão com o S3 falhou — verifique as credenciais e o bucket.'
          : 'Falha ao salvar a configuração.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#0F0F11] p-5">
        <p className="text-sm text-neutral-500">{error || 'Carregando…'}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0F0F11] p-5">
      {heading && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-white">Biblioteca de Mídias</h3>
          <p className="text-xs text-neutral-500 mt-1">
            Armazena cada mídia que passa pelas integrações (enviada/recebida) para consulta. Escolha
            onde guardar os arquivos.
          </p>
        </div>
      )}

      <div className="space-y-5">
        <Checkbox label="Biblioteca ativada (captura mídias enviadas e recebidas)" checked={enabled} onChange={setEnabled} />

        {/* privacy note */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <ShieldAlert size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] leading-relaxed text-amber-200/80">
            Ao ativar, o conteúdo das mídias e os números/JIDs são armazenados. Trate como dado
            sensível (LGPD) — considere definir um período de retenção.
          </p>
        </div>

        <Field label="Onde armazenar">
          <Select value={driver} onChange={(e) => setDriver(e.target.value as 'local' | 's3')}>
            <option value="local">Local (no banco de dados)</option>
            <option value="s3">S3 / compatível (MinIO, R2, AWS)</option>
          </Select>
        </Field>

        {driver === 'local' ? (
          <div className="flex items-start gap-2 text-xs text-neutral-500">
            <Database size={14} className="mt-0.5 shrink-0" />
            <span>
              As mídias ficam no próprio banco de dados da instância — funciona sem configuração extra.
              Para grande volume de mídias, prefira o S3 (evita inchar o banco).
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-xs text-neutral-500">
              <Cloud size={14} className="mt-0.5 shrink-0" />
              <span>Recomendado em produção: desacopla o armazenamento dos containers.</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Região"><Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" /></Field>
              <Field label="Bucket"><Input value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="wootrico-media" /></Field>
            </div>
            <Field label="Endpoint (opcional — MinIO/R2)">
              <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://s3.exemplo.com" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Access Key ID"><Input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} /></Field>
              <Field label={secretSet ? 'Secret Access Key (deixe em branco p/ manter)' : 'Secret Access Key'}>
                <SecretInput value={secret} onChange={setSecret} placeholder={secretSet ? '•••••••• (mantida)' : ''} />
              </Field>
            </div>
            <Checkbox label="Path-style (necessário para MinIO)" checked={forcePathStyle} onChange={setForcePathStyle} />
            <div className="flex items-center gap-3">
              <Button type="button" variant="ghost" onClick={onTest} loading={busy}>
                Testar conexão
              </Button>
              {testState && (
                <Badge tone={testState.ok ? 'ok' : 'error'}>
                  {testState.ok ? 'conexão ok' : `falhou${testState.detail ? `: ${testState.detail}` : ''}`}
                </Badge>
              )}
            </div>
          </div>
        )}

        <Field label="Retenção (dias) — em branco = manter para sempre" hint="Mídias mais antigas que isso são removidas automaticamente.">
          <Input
            type="number"
            min={1}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            placeholder="ex.: 90"
          />
        </Field>

        <ErrorText>{error}</ErrorText>

        <div className="flex items-center gap-4">
          <Button type="button" onClick={onSave} loading={busy}>
            Salvar
          </Button>
          {saved && <Badge tone="ok">salvo</Badge>}
        </div>
      </div>
    </div>
  );
}
