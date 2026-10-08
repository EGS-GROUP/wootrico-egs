import { useEffect, useState } from 'react';
import { Badge, Button, ErrorText, Field, Input } from './ui';
import { getConversationsConfig, saveConversationsConfig } from '../lib/system-api';

/**
 * Editor for the captured-conversations retention. Conversation openers older
 * than the configured number of days are purged by the worker's hourly sweep.
 * Empty = keep forever. Default is 90 days.
 */
export default function ConversationRetentionEditor() {
  const [retention, setRetention] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConversationsConfig()
      .then((c) => {
        setRetention(c.retentionDays != null ? String(c.retentionDays) : '');
        setLoaded(true);
      })
      .catch(() => setError('Falha ao carregar a configuração de conversas.'));
  }, []);

  async function onSave() {
    setError('');
    setSaved(false);
    const trimmed = retention.trim();
    let days: number | null = null;
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) {
        setError('Informe um número inteiro de dias maior que zero, ou deixe em branco.');
        return;
      }
      days = n;
    }
    setBusy(true);
    try {
      await saveConversationsConfig(days);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setError('Falha ao salvar a configuração de conversas.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0F0F11] p-5">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-white">Retenção de conversas</h3>
        <p className="text-xs text-neutral-500 mt-1">
          As aberturas de conversa capturadas (apenas o início de cada conversa) mais antigas que esse
          período são excluídas automaticamente. Padrão: 90 dias. Em branco = manter para sempre.
        </p>
      </div>

      <div className="space-y-5">
        <Field
          label="Retenção (dias) — em branco = manter para sempre"
          hint="A mudança é retroativa: ao reduzir o prazo, registros antigos são removidos na próxima limpeza."
        >
          <Input
            type="number"
            min={1}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            placeholder="90"
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
    </div>
  );
}
