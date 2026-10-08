import type { ProviderType } from '@wootrico/config';

/**
 * Best-effort detection of which provider a webhook payload came from.
 * The authoritative routing is the per-integration webhook token; this is a
 * safety-net / sanity check used for logging and provider selection.
 */
export function detectPayloadOrigin(body: unknown): ProviderType | 'unknown' {
  const b = body as Record<string, any> | null | undefined;
  if (!b || typeof b !== 'object') return 'unknown';

  // uazapi: message.content + message.sender
  if (b.message?.content && b.message?.sender) return 'uazapi';

  // zapi: phone + momment
  if (b.phone && b.momment) return 'zapi';

  // evolution (Evolution-API style): event + data with key/message
  if (typeof b.event === 'string' && b.data && (b.data.key || b.data.message)) {
    return 'evolution';
  }

  return 'unknown';
}
