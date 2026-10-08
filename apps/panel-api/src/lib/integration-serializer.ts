import type { Integration } from '@wootrico/db';
import { buildWebhookUrls } from './webhook-urls.js';

/** Public representation of an integration — NEVER includes secrets. */
export function serializeIntegration(i: Integration, publicBaseUrl: string) {
  return {
    id: i.id,
    name: i.name,
    isEnabled: i.isEnabled,
    providerType: i.providerType,
    status: i.status,
    chatwoot: {
      baseUrl: i.chatwootBaseUrl,
      accountId: i.chatwootAccountId,
      inboxName: i.chatwootInboxName,
      inboxId: i.chatwootInboxId,
    },
    flags: {
      conversationStatus: i.conversationStatus,
      reabrirConversa: i.reabrirConversa,
      desconsiderarGrupo: i.desconsiderarGrupo,
      assinarMensagem: i.assinarMensagem,
      defaultCountry: i.defaultCountry,
    },
    webhookUrls: buildWebhookUrls(publicBaseUrl, i.webhookToken),
    lastTestChatwootAt: i.lastTestChatwootAt,
    lastTestProviderAt: i.lastTestProviderAt,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}
