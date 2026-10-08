import type { FastifyInstance } from 'fastify';
import { encryptSecret, decryptSecretAny, randomToken } from '@wootrico/config';
import { getLicenseSecret, getLicenseSecrets, ensureLicenseSecret } from '@wootrico/license-client';
import {
  CreateIntegrationSchema,
  UpdateIntegrationSchema,
  TestChatwootSchema,
  CheckInboxSchema,
  ProviderConfigSchema,
  providerIdentifier,
  type ProviderConfig,
} from '@wootrico/types';
import { createProvider } from '@wootrico/providers';
import { ChatwootClient } from '@wootrico/chatwoot-client';
import { serializeIntegration } from '../lib/integration-serializer.js';
import { buildWebhookUrls, getPublicBaseUrl } from '../lib/webhook-urls.js';
import { canManageIntegrations } from '../lib/license-guard.js';

export default async function integrationRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  // ── list ──
  app.get('/api/integrations', guard, async () => {
    const base = await getPublicBaseUrl(app.prisma);
    const rows = await app.prisma.integration.findMany({ orderBy: { createdAt: 'desc' } });
    return { integrations: rows.map((r) => serializeIntegration(r, base)) };
  });

  // ── get one (includes decrypted secrets so the edit form can prefill) ──
  app.get('/api/integrations/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await app.prisma.integration.findUnique({
      where: { id },
      include: { providerConfig: true },
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const base = await getPublicBaseUrl(app.prisma);
    const secrets = await getLicenseSecrets();

    let providerConfig: ProviderConfig | null = null;
    if (row.providerConfig) {
      try {
        providerConfig = JSON.parse(decryptSecretAny(row.providerConfig.config, secrets)) as ProviderConfig;
      } catch {
        providerConfig = null;
      }
    }
    let chatwootApiToken = '';
    try {
      chatwootApiToken = decryptSecretAny(row.chatwootApiToken, secrets);
    } catch {
      chatwootApiToken = '';
    }

    return {
      integration: serializeIntegration(row, base),
      secrets: { chatwootApiToken, providerConfig },
    };
  });

  // ── create ──
  app.post('/api/integrations', guard, async (req, reply) => {
    const lic = await canManageIntegrations();
    if (!lic.allowed) {
      return reply.code(403).send({ error: 'license_inactive', status: lic.status });
    }
    const secret = await ensureLicenseSecret();
    if (!secret) return reply.code(403).send({ error: 'license_inactive' });
    const parsed = CreateIntegrationSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    const d = parsed.data;
    if (d.providerConfig.provider !== d.providerType)
      return reply.code(400).send({ error: 'provider_mismatch' });

    const webhookToken = randomToken();
    const created = await app.prisma.integration.create({
      data: {
        name: d.name,
        isEnabled: d.isEnabled,
        webhookToken,
        chatwootBaseUrl: d.chatwootBaseUrl,
        chatwootApiToken: encryptSecret(d.chatwootApiToken, secret),
        chatwootAccountId: d.chatwootAccountId,
        chatwootInboxName: d.chatwootInboxName,
        conversationStatus: d.conversationStatus,
        reabrirConversa: d.reabrirConversa,
        desconsiderarGrupo: d.desconsiderarGrupo,
        assinarMensagem: d.assinarMensagem,
        defaultCountry: d.defaultCountry,
        providerType: d.providerType,
        providerConfig: {
          create: {
            providerType: d.providerType,
            config: encryptSecret(JSON.stringify(d.providerConfig), secret),
            providerIdentifier: providerIdentifier(d.providerConfig),
          },
        },
      },
    });

    // Reconcile the Chatwoot inbox: create it (API channel) or update the webhook
    // of an existing API inbox; a non-API inbox is left for manual configuration.
    const base = await getPublicBaseUrl(app.prisma);
    const urls = buildWebhookUrls(base, webhookToken);
    let status: 'unconfigured' | 'ok' | 'error' = 'ok';
    let inboxId: string | null = null;
    let inbox: { action: string; channelType: string | null; error?: string } = {
      action: 'not_created',
      channelType: null,
    };
    try {
      const cw = new ChatwootClient({
        baseUrl: d.chatwootBaseUrl,
        apiToken: d.chatwootApiToken,
        accountId: d.chatwootAccountId,
      });
      const setup = await cw.setupInbox({
        name: d.chatwootInboxName,
        webhookUrl: urls.chatwoot,
        createIfMissing: d.createInboxIfMissing,
        allowMessagesAfterResolved: true,
      });
      inboxId = setup.inboxId;
      inbox = { action: setup.action, channelType: setup.channelType };
      status = inboxId ? 'ok' : 'unconfigured';
    } catch (err) {
      status = 'error';
      inbox = { action: 'error', channelType: null, error: (err as Error).message };
      app.log.warn({ err }, 'setupInbox failed during integration create');
    }

    const updated = await app.prisma.integration.update({
      where: { id: created.id },
      data: { chatwootInboxId: inboxId, status },
    });

    await app.prisma.auditLog.create({
      data: {
        adminUserId: req.user.sub,
        action: 'integration.created',
        entityType: 'integration',
        entityId: created.id,
      },
    });

    return reply.code(201).send({ integration: serializeIntegration(updated, base), inbox });
  });

  // ── check whether a Chatwoot inbox exists (pre-save) ──
  app.post('/api/integrations/inbox/check', guard, async (req, reply) => {
    const parsed = CheckInboxSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    try {
      const cw = new ChatwootClient({
        baseUrl: parsed.data.chatwootBaseUrl,
        apiToken: parsed.data.chatwootApiToken,
        accountId: parsed.data.chatwootAccountId,
      });
      return await cw.checkInbox(parsed.data.chatwootInboxName);
    } catch (err) {
      return reply.code(400).send({ error: 'check_failed', detail: (err as Error).message });
    }
  });

  // ── update ──
  app.patch('/api/integrations/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await app.prisma.integration.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const parsed = UpdateIntegrationSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    const d = parsed.data;
    const secret =
      d.chatwootApiToken || d.providerConfig
        ? await ensureLicenseSecret()
        : await getLicenseSecret();

    // Enabling an integration requires an active license (disabling/editing is
    // always allowed so customers can still clean up while unlicensed).
    if (d.isEnabled === true && !existing.isEnabled) {
      const lic = await canManageIntegrations();
      if (!lic.allowed) {
        return reply.code(403).send({ error: 'license_inactive', status: lic.status });
      }
    }

    // Writing credentials requires the per-license secret to seal them.
    if ((d.chatwootApiToken || d.providerConfig) && !secret) {
      return reply.code(403).send({ error: 'license_inactive' });
    }

    const data: Record<string, unknown> = {};
    for (const k of [
      'name',
      'isEnabled',
      'chatwootBaseUrl',
      'chatwootAccountId',
      'chatwootInboxName',
      'conversationStatus',
      'reabrirConversa',
      'desconsiderarGrupo',
      'assinarMensagem',
      'defaultCountry',
    ] as const) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    if (d.chatwootApiToken) data.chatwootApiToken = encryptSecret(d.chatwootApiToken, secret!);

    if (d.providerConfig) {
      if (d.providerType && d.providerConfig.provider !== d.providerType)
        return reply.code(400).send({ error: 'provider_mismatch' });
      data.providerType = d.providerConfig.provider;
      await app.prisma.providerConfig.update({
        where: { integrationId: id },
        data: {
          providerType: d.providerConfig.provider,
          config: encryptSecret(JSON.stringify(d.providerConfig), secret!),
          providerIdentifier: providerIdentifier(d.providerConfig),
        },
      });
    }

    let updated = await app.prisma.integration.update({ where: { id }, data });

    // Re-reconcile the Chatwoot inbox/webhook with the (possibly new) settings.
    const base = await getPublicBaseUrl(app.prisma);
    const urls = buildWebhookUrls(base, updated.webhookToken);
    let inbox: { action: string; channelType: string | null; error?: string } = {
      action: 'unchanged',
      channelType: null,
    };
    try {
      const cw = new ChatwootClient({
        baseUrl: updated.chatwootBaseUrl,
        apiToken: d.chatwootApiToken ?? decryptSecretAny(existing.chatwootApiToken, await getLicenseSecrets()),
        accountId: updated.chatwootAccountId,
      });
      const setup = await cw.setupInbox({
        name: updated.chatwootInboxName,
        webhookUrl: urls.chatwoot,
        createIfMissing: d.createInboxIfMissing ?? true,
        allowMessagesAfterResolved: true,
        knownInboxId: updated.chatwootInboxId,
      });
      inbox = { action: setup.action, channelType: setup.channelType };
      updated = await app.prisma.integration.update({
        where: { id },
        data: { chatwootInboxId: setup.inboxId, status: setup.inboxId ? 'ok' : 'unconfigured' },
      });
    } catch (err) {
      inbox = { action: 'error', channelType: null, error: (err as Error).message };
      app.log.warn({ err }, 'setupInbox failed during integration update');
    }

    await app.prisma.auditLog.create({
      data: {
        adminUserId: req.user.sub,
        action: 'integration.updated',
        entityType: 'integration',
        entityId: id,
      },
    });
    return { integration: serializeIntegration(updated, base), inbox };
  });

  // ── delete ──
  app.delete('/api/integrations/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await app.prisma.integration.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await app.prisma.integration.delete({ where: { id } });
    await app.prisma.auditLog.create({
      data: {
        adminUserId: req.user.sub,
        action: 'integration.deleted',
        entityType: 'integration',
        entityId: id,
      },
    });
    return reply.code(204).send();
  });

  // ── test connection: Chatwoot ──
  app.post('/api/integrations/test/chatwoot', guard, async (req, reply) => {
    const parsed = TestChatwootSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    const cw = new ChatwootClient({
      baseUrl: parsed.data.chatwootBaseUrl,
      apiToken: parsed.data.chatwootApiToken,
      accountId: parsed.data.chatwootAccountId,
    });
    return cw.testConnection();
  });

  // ── test connection: provider ──
  app.post('/api/integrations/test/provider', guard, async (req, reply) => {
    const parsed = ProviderConfigSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    try {
      const provider = createProvider(parsed.data as ProviderConfig);
      return await provider.testConnection();
    } catch (err) {
      return reply.code(400).send({ ok: false, detail: (err as Error).message });
    }
  });
}
