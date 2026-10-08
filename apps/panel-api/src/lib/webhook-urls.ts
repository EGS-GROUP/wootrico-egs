import { env } from '@wootrico/config';
import type { PrismaClient } from '@wootrico/db';

export interface WebhookUrls {
  provider: string;
  chatwoot: string;
}

export async function getPublicBaseUrl(prisma: PrismaClient): Promise<string> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  return (settings?.publicBaseUrl ?? env.PUBLIC_BASE_URL).replace(/\/$/, '');
}

export function buildWebhookUrls(baseUrl: string, webhookToken: string): WebhookUrls {
  const base = baseUrl.replace(/\/$/, '');
  return {
    provider: `${base}/webhook/${webhookToken}/provider`,
    chatwoot: `${base}/webhook/${webhookToken}/chatwoot`,
  };
}
