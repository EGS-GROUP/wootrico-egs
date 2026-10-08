import type { FastifyInstance, FastifyReply } from 'fastify';
import { detectPayloadOrigin } from '@wootrico/providers';
import { publishWebhook } from '@wootrico/queue';
import { assertLicenseActive } from '@wootrico/license-client';

function eventTypeOf(source: 'provider' | 'chatwoot', payload: any): string | undefined {
  if (source === 'chatwoot') return payload?.event;
  if (payload?.event) return String(payload.event);
  if (payload?.message) return 'message';
  return undefined;
}

export default async function webhookRoutes(app: FastifyInstance) {
  async function handle(
    source: 'provider' | 'chatwoot',
    token: string,
    payload: unknown,
    reply: FastifyReply,
  ) {
    const integration = await app.prisma.integration.findUnique({
      where: { webhookToken: token },
      select: { id: true, isEnabled: true },
    });
    if (!integration) return reply.code(404).send({ error: 'unknown_webhook_token' });

    const originDetected = source === 'provider' ? detectPayloadOrigin(payload) : 'chatwoot';
    const eventType = eventTypeOf(source, payload);

    // Gates: disabled integration / license.
    let accepted = true;
    let reason: string | undefined;
    if (!integration.isEnabled) {
      accepted = false;
      reason = 'integration_disabled';
    } else {
      const lic = await assertLicenseActive();
      if (!lic.allowed) {
        accepted = false;
        reason = `license_${lic.status}`;
      }
    }

    // The raw payload goes ONLY to the broker (ephemeral). Nothing with content
    // is persisted. We record a content-free audit row.
    //
    // A publish that the broker never confirmed is a LOST message: answering 200
    // would tell the provider it was delivered and it would never re-send it.
    // So we fail the request instead and let the provider re-deliver.
    let queueFailed = false;
    if (accepted) {
      try {
        await publishWebhook({
          integrationId: integration.id,
          source,
          payload,
          receivedAt: new Date().toISOString(),
        });
      } catch (err) {
        app.log.error({ err, integrationId: integration.id, source }, 'webhook: enqueue failed');
        accepted = false;
        reason = 'queue_unavailable';
        queueFailed = true;
      }
    }

    await app.prisma.webhookEvent.create({
      data: {
        integrationId: integration.id,
        source,
        webhookToken: token,
        originDetected,
        eventType,
        accepted,
        reason,
        // Retention is governed by AppSettings.logRetentionDays (createdAt-based
        // sweep in the cleanup job), not a fixed per-row TTL.
        expiresAt: null,
      },
    }).catch((err) => app.log.warn({ err }, 'webhook: audit row failed'));

    // 503 only when WE failed to keep the message; a deliberate refusal
    // (integration off / license inactive) stays 200 so the provider stops
    // retrying something we will never accept.
    return reply
      .code(queueFailed ? 503 : 200)
      .send({ accepted, ...(reason ? { reason } : {}) });
  }

  app.post('/webhook/:token/provider', async (req, reply) => {
    const { token } = req.params as { token: string };
    return handle('provider', token, req.body, reply);
  });

  app.post('/webhook/:token/chatwoot', async (req, reply) => {
    const { token } = req.params as { token: string };
    return handle('chatwoot', token, req.body, reply);
  });
}
