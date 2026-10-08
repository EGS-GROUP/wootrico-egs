import { prisma } from '@wootrico/db';
import { env } from '@wootrico/config';

export async function publicBaseUrl(): Promise<string> {
  const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  return (s?.publicBaseUrl ?? env.PUBLIC_BASE_URL).replace(/\/$/, '');
}

export function buildWebhookUrls(base: string, token: string) {
  const b = base.replace(/\/$/, '');
  return {
    provider: `${b}/webhook/${token}/provider`,
    chatwoot: `${b}/webhook/${token}/chatwoot`,
  };
}
