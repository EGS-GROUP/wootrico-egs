import { prisma } from '@wootrico/db';
import { decryptSecretAny, logger } from '@wootrico/config';
import { ensureLicenseSecret, getLicenseSecrets } from '@wootrico/license-client';
import type { ProviderConfig } from '@wootrico/types';
import { createProvider, type WhatsAppProvider } from '@wootrico/providers';
import { ChatwootClient } from '@wootrico/chatwoot-client';
import { buildWebhookUrls, publicBaseUrl } from '../lib/urls.js';

export interface IntegrationRuntime {
  integration: Awaited<ReturnType<typeof prisma.integration.findUnique>>;
  provider: WhatsAppProvider;
  chatwoot: ChatwootClient;
  inboxId: string;
  providerType: ProviderConfig['provider'];
}

/** Load + decrypt an integration and build its provider + Chatwoot clients. */
export async function loadIntegrationRuntime(
  integrationId: string,
): Promise<IntegrationRuntime | null> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    include: { providerConfig: true },
  });
  if (!integration || !integration.providerConfig) return null;

  // Credentials are license-sealed: try every secret the instance has had (the
  // seal secret rotates on reactivation). On failure, re-validate once to pull a
  // newer/complete secret list, then retry before giving up.
  const tryDecrypt = (secrets: string[]): { pc: ProviderConfig; token: string } | null => {
    try {
      return {
        pc: JSON.parse(decryptSecretAny(integration.providerConfig!.config, secrets)) as ProviderConfig,
        token: decryptSecretAny(integration.chatwootApiToken, secrets),
      };
    } catch {
      return null;
    }
  };
  let secrets = await getLicenseSecrets();
  let creds = secrets.length ? tryDecrypt(secrets) : null;
  if (!creds) {
    await ensureLicenseSecret().catch(() => undefined); // force a fresh validate
    secrets = await getLicenseSecrets();
    creds = secrets.length ? tryDecrypt(secrets) : null;
  }
  if (!creds) {
    logger.warn(
      { integrationId, secrets: secrets.length },
      'integration credentials could not be decrypted (license secret mismatch) — message dropped',
    );
    return null;
  }
  const providerConfig = creds.pc;
  const chatwootApiToken = creds.token;
  const provider = createProvider(providerConfig);

  const chatwoot = new ChatwootClient({
    baseUrl: integration.chatwootBaseUrl,
    apiToken: chatwootApiToken,
    accountId: integration.chatwootAccountId,
  });

  let inboxId = integration.chatwootInboxId;
  if (!inboxId) {
    const urls = buildWebhookUrls(await publicBaseUrl(), integration.webhookToken);
    inboxId = await chatwoot.ensureInbox({
      name: integration.chatwootInboxName,
      webhookUrl: urls.chatwoot,
      allowMessagesAfterResolved: true,
    });
    await prisma.integration.update({
      where: { id: integration.id },
      data: { chatwootInboxId: inboxId },
    });
  }

  return { integration, provider, chatwoot, inboxId, providerType: providerConfig.provider };
}
