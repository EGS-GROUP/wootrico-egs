import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_VERSION, env, encrypt, decrypt, encryptJson, decryptJson } from '@wootrico/config';
import { evaluateLicense, getLicenseState } from '@wootrico/license-client';
import { pingRabbit, testRabbitUrl } from '@wootrico/queue';
import { pingRedis, testRedisUrl } from '@wootrico/cache';
import { PrismaClient } from '@wootrico/db';
import { getConnSnapshot } from '@wootrico/db/conn';
import { testS3, type S3Config } from '@wootrico/storage';
import { MediaConfigSchema, S3ConfigSchema } from '@wootrico/types';
import { getPublicBaseUrl } from '../lib/webhook-urls.js';

/** System-log retention: positive day count or null ("keep forever"). */
const LogConfigSchema = z.object({
  retentionDays: z.number().int().positive().nullable(),
});

/** Hide the password component of a connection URL for display. */
function maskUrl(url: string): string {
  return url ? url.replace(/\/\/([^:/@]+):([^@/]+)@/, '//$1:****@') : '';
}

/** Validate a Postgres URL by opening a throwaway client and running SELECT 1. */
async function testPgUrl(url: string): Promise<{ ok: boolean; detail?: string }> {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

/** System configuration overview — what's set up and what's in use. */
export default async function systemRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  app.get('/api/system/info', guard, async () => {
    const publicBaseUrl = await getPublicBaseUrl(app.prisma);
    const settings = await app.prisma.appSettings.findUnique({ where: { id: 'singleton' } });

    const [integrations, identityCount, adminCount] = await Promise.all([
      app.prisma.integration.findMany({
        select: {
          id: true,
          name: true,
          isEnabled: true,
          providerType: true,
          status: true,
          chatwootAccountId: true,
          chatwootInboxName: true,
          chatwootInboxId: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      app.prisma.contactIdentity.count(),
      app.prisma.adminUser.count(),
    ]);

    const byProvider = { evolution: 0, uazapi: 0, zapi: 0 } as Record<string, number>;
    const byStatus = { ok: 0, error: 0, unconfigured: 0 } as Record<string, number>;
    for (const i of integrations) {
      byProvider[i.providerType] = (byProvider[i.providerType] ?? 0) + 1;
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    }

    let license: Record<string, unknown> = { status: 'unknown' };
    try {
      const status = await evaluateLicense();
      const state = await getLicenseState();
      license = {
        status,
        required: true, // licensing is always enforced
        instanceId: state.instanceId,
        serverUrl: process.env.LICENSE_SERVER_URL,
        plan: state.plan,
        expiresAt: state.expiresAt,
        lastValidatedAt: state.lastValidatedAt,
        lastHeartbeatAt: state.lastHeartbeatAt,
      };
    } catch {
      license = { status: 'unknown', required: true };
    }

    return {
      app: {
        // Which build this instance runs — every install pulls the same
        // `:latest`, so support needs this to know what code is out there.
        version: APP_VERSION,
        publicBaseUrl,
        webhookBase: `${publicBaseUrl}/webhook`,
        setupCompleted: settings?.setupCompleted ?? false,
        admins: adminCount,
        nodeEnv: process.env.NODE_ENV ?? 'production',
      },
      license,
      directory: { contactIdentities: identityCount },
      integrations: {
        total: integrations.length,
        enabled: integrations.filter((i) => i.isEnabled).length,
        byProvider,
        byStatus,
        items: integrations,
      },
    };
  });

  // Live connection diagnostics — tests Postgres/RabbitMQ/Redis from INSIDE the
  // running container (so it validates exactly what the app uses, no installer).
  app.post('/api/system/diagnostics', guard, async () => {
    const testPostgres = async () => {
      const t0 = Date.now();
      try {
        await app.prisma.$queryRaw`SELECT 1`;
        return { ok: true, detail: `ok (${Date.now() - t0}ms)` };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    };

    // Hard cap each probe so a single unreachable service never hangs the whole
    // request (which would freeze the dashboard on "Verificando…").
    const withTimeout = (p: Promise<{ ok: boolean; detail?: string }>, label: string) =>
      Promise.race([
        p,
        new Promise<{ ok: boolean; detail?: string }>((res) =>
          setTimeout(() => res({ ok: false, detail: `timeout (${label})` }), 6000),
        ),
      ]);

    const [postgres, rabbitmq, redis] = await Promise.all([
      withTimeout(testPostgres(), 'postgres'),
      withTimeout(pingRabbit(), 'rabbitmq'),
      withTimeout(pingRedis(), 'redis'),
    ]);

    return { postgres, rabbitmq, redis };
  });

  // ── connection settings (editable; applied on restart) ──
  // Returns the desired connection strings (decrypted, for editing — admin-only,
  // no-store) plus what's actually running and whether a restart is pending.
  app.get('/api/system/connections', guard, async () => {
    const s = await app.prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    const snap = getConnSnapshot();

    const dec = (v?: string | null) => {
      if (!v) return '';
      try {
        return decrypt(v);
      } catch {
        return '';
      }
    };

    const rabbitDesired = dec(s?.rabbitmqUrl) || env.RABBITMQ_URL;
    const redisDesired = dec(s?.redisUrl) || env.REDIS_URL;
    const pgDesired = dec(s?.databaseUrl) || process.env.DATABASE_URL || '';

    const runningRabbit = snap?.rabbitmqUrl ?? env.RABBITMQ_URL;
    const runningRedis = snap?.redisUrl ?? env.REDIS_URL;
    const runningPg = snap?.databaseUrl ?? process.env.DATABASE_URL ?? '';

    return {
      restartRequestedAt: s?.restartRequestedAt ?? null,
      services: {
        postgres: {
          value: pgDesired,
          running: maskUrl(runningPg),
          changed: pgDesired !== runningPg,
          hotApply: false, // Postgres can't be hot-applied (needed to read settings)
        },
        rabbitmq: {
          value: rabbitDesired,
          running: maskUrl(runningRabbit),
          changed: rabbitDesired !== runningRabbit,
          hotApply: true,
        },
        redis: {
          value: redisDesired,
          running: maskUrl(runningRedis),
          changed: redisDesired !== runningRedis,
          hotApply: true,
        },
      },
    };
  });

  // ── edit connection settings: TEST each provided value before persisting ──
  // Body: { rabbitmqUrl?, redisUrl?, databaseUrl? }. "" clears the override
  // (revert to env). If any test fails, nothing is saved.
  app.put('/api/system/connections', guard, async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: Array<{
      key: 'rabbitmqUrl' | 'redisUrl' | 'databaseUrl';
      service: string;
      test: (url: string) => Promise<{ ok: boolean; detail?: string }>;
    }> = [
      { key: 'rabbitmqUrl', service: 'RabbitMQ', test: testRabbitUrl },
      { key: 'redisUrl', service: 'Redis', test: testRedisUrl },
      { key: 'databaseUrl', service: 'Postgres', test: testPgUrl },
    ];

    const data: Record<string, string | null> = {};
    const results: Record<string, { ok: boolean; detail?: string }> = {};

    for (const f of fields) {
      if (!(f.key in body)) continue;
      const raw = String(body[f.key] ?? '').trim();
      if (!raw) {
        // Clear the override → fall back to env on next boot.
        data[f.key] = null;
        results[f.key] = { ok: true, detail: 'usará o valor do ambiente' };
        continue;
      }
      const r = await f.test(raw);
      results[f.key] = r;
      if (r.ok) data[f.key] = encrypt(raw);
    }

    const anyFailed = Object.values(results).some((r) => !r.ok);
    if (anyFailed) {
      // Test-before-apply: if any value failed its connection test, persist
      // nothing and report per-field results so the user can fix them.
      return { ok: false, results };
    }

    if (Object.keys(data).length > 0) {
      await app.prisma.appSettings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', ...data },
        update: data,
      });
      await app.prisma.auditLog
        .create({
          data: {
            adminUserId: req.user.sub,
            action: 'system.connections.updated',
            entityType: 'app_settings',
            entityId: 'singleton',
          },
        })
        .catch(() => undefined);
    }

    return { ok: true, results };
  });

  // ── test a SINGLE connection URL without persisting ──
  // Powers the wizard's auto-test as the user edits fields (host/user/pass/
  // vhost). Body: { service: 'postgres'|'rabbitmq'|'redis', url }. Returns the
  // raw test result; nothing is saved.
  app.post('/api/system/connections/test', guard, async (req) => {
    const body = (req.body ?? {}) as { service?: string; url?: string };
    const url = String(body.url ?? '').trim();
    if (!url) return { ok: false, detail: 'informe a URL' };
    const tester =
      body.service === 'rabbitmq'
        ? testRabbitUrl
        : body.service === 'redis'
          ? testRedisUrl
          : body.service === 'postgres'
            ? testPgUrl
            : null;
    if (!tester) return { ok: false, detail: 'serviço inválido' };
    return tester(url);
  });

  // ── media library configuration ──
  // Returns the current settings; the S3 secret is NEVER returned (only whether
  // one is set). PII note: enabling this stores message media + numbers at rest.
  app.get('/api/system/media', guard, async () => {
    const s = await app.prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    let s3: Partial<S3Config> & { secretSet?: boolean } = { secretSet: false };
    if (s?.mediaS3Config) {
      try {
        const cfg = decryptJson<S3Config>(s.mediaS3Config);
        s3 = {
          endpoint: cfg.endpoint,
          region: cfg.region,
          bucket: cfg.bucket,
          accessKeyId: cfg.accessKeyId,
          forcePathStyle: cfg.forcePathStyle,
          secretSet: Boolean(cfg.secretAccessKey),
        };
      } catch {
        s3 = { secretSet: false };
      }
    }
    return {
      enabled: s?.mediaLibraryEnabled ?? true,
      driver: (s?.mediaStorageDriver as 'local' | 's3') ?? 'local',
      retentionDays: s?.mediaRetentionDays ?? null,
      s3,
    };
  });

  // Persist media settings. When driver=s3 the credentials are TESTED before
  // saving (test-before-apply); a missing secret reuses the stored one.
  app.put('/api/system/media', guard, async (req, reply) => {
    const parsed = MediaConfigSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    const d = parsed.data;

    const data: Record<string, unknown> = {
      mediaLibraryEnabled: d.enabled,
      mediaStorageDriver: d.driver,
      mediaRetentionDays: d.retentionDays,
    };

    if (d.driver === 's3') {
      const existing = await app.prisma.appSettings.findUnique({ where: { id: 'singleton' } });
      let prev: Partial<S3Config> = {};
      if (existing?.mediaS3Config) {
        try {
          prev = decryptJson<S3Config>(existing.mediaS3Config);
        } catch {
          prev = {};
        }
      }
      // Merge: a missing secret keeps the stored one.
      const merged = {
        endpoint: d.s3?.endpoint ?? prev.endpoint,
        region: d.s3?.region ?? prev.region,
        bucket: d.s3?.bucket ?? prev.bucket,
        accessKeyId: d.s3?.accessKeyId ?? prev.accessKeyId,
        secretAccessKey: d.s3?.secretAccessKey ?? prev.secretAccessKey,
        forcePathStyle: d.s3?.forcePathStyle ?? prev.forcePathStyle ?? false,
      };
      const full = S3ConfigSchema.safeParse(merged);
      if (!full.success)
        return reply.code(400).send({ error: 'validation', issues: full.error.issues });

      const test = await testS3(full.data);
      if (!test.ok) return reply.code(400).send({ error: 's3_test_failed', detail: test.detail });
      data.mediaS3Config = encryptJson(full.data);
    }

    await app.prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data,
    });
    await app.prisma.auditLog
      .create({
        data: {
          adminUserId: req.user.sub,
          action: 'media.config.updated',
          entityType: 'app_settings',
          entityId: 'singleton',
        },
      })
      .catch(() => undefined);
    return { ok: true };
  });

  // Test an S3 config without persisting (powers the wizard/System test button).
  app.post('/api/system/media/test', guard, async (req, reply) => {
    const parsed = S3ConfigSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    return testS3(parsed.data);
  });

  // ── system-log retention ──
  // How many days of system logs (messages/webhooks/admin actions) to keep.
  // null = keep forever. Drives the worker's createdAt-based cleanup sweep.
  app.get('/api/system/logs-config', guard, async () => {
    const s = await app.prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    return { retentionDays: s?.logRetentionDays ?? null };
  });

  app.put('/api/system/logs-config', guard, async (req, reply) => {
    const parsed = LogConfigSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    await app.prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', logRetentionDays: parsed.data.retentionDays },
      update: { logRetentionDays: parsed.data.retentionDays },
    });
    await app.prisma.auditLog
      .create({
        data: {
          adminUserId: req.user.sub,
          action: 'logs.config.updated',
          entityType: 'app_settings',
          entityId: 'singleton',
        },
      })
      .catch(() => undefined);
    return { ok: true };
  });

  // ── conversation-openers retention ──
  // How many days of captured conversation openers to keep. null = keep forever;
  // default 90. Drives the worker's startedAt-based cleanup sweep.
  app.get('/api/system/conversations-config', guard, async () => {
    const s = await app.prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    return { retentionDays: s?.conversationRetentionDays ?? null };
  });

  app.put('/api/system/conversations-config', guard, async (req, reply) => {
    const parsed = LogConfigSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    await app.prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', conversationRetentionDays: parsed.data.retentionDays },
      update: { conversationRetentionDays: parsed.data.retentionDays },
    });
    await app.prisma.auditLog
      .create({
        data: {
          adminUserId: req.user.sub,
          action: 'conversations.config.updated',
          entityType: 'app_settings',
          entityId: 'singleton',
        },
      })
      .catch(() => undefined);
    return { ok: true };
  });

  // ── system logs (console) ──
  // A unified, CONTENT-FREE feed of admin actions (audit_logs) and webhook
  // events (webhook_events). Never includes message bodies or media — only the
  // control/event metadata (action, source, outcome, reason).
  app.get('/api/system/logs', guard, async (req) => {
    const q = req.query as { limit?: string; before?: string; kind?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '120', 10) || 120, 1), 500);
    const before = q.before ? new Date(q.before) : undefined;
    const kind =
      q.kind === 'audit' || q.kind === 'webhook' || q.kind === 'message' ? q.kind : undefined;

    const wantAudit = kind === undefined || kind === 'audit';
    const wantWebhook = kind === undefined || kind === 'webhook';
    const wantMessage = kind === undefined || kind === 'message';

    const [audits, webhooks, messages] = await Promise.all([
      wantAudit
        ? app.prisma.auditLog.findMany({
            where: before ? { createdAt: { lt: before } } : undefined,
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: { adminUser: { select: { email: true } } },
          })
        : Promise.resolve([]),
      wantWebhook
        ? app.prisma.webhookEvent.findMany({
            where: before ? { receivedAt: { lt: before } } : undefined,
            orderBy: { receivedAt: 'desc' },
            take: limit,
            include: { integration: { select: { name: true } } },
          })
        : Promise.resolve([]),
      wantMessage
        ? app.prisma.messageLog.findMany({
            where: before ? { createdAt: { lt: before } } : undefined,
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: { integration: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ]);

    // Plain pt-BR titles so a non-technical user understands each event; the
    // technical string stays in `detail` (shown small + copiable).
    const auditTitle = (action: string): string => {
      const map: Record<string, string> = {
        'integration.created': 'Integração criada',
        'integration.updated': 'Integração atualizada',
        'integration.deleted': 'Integração removida',
        'system.restart': 'Aplicação reiniciada',
        'system.connections.updated': 'Conexões (banco/fila/cache) atualizadas',
        'media.deleted': 'Mídia removida da biblioteca',
        'media.config.updated': 'Biblioteca de mídias configurada',
        'auth.login': 'Login no painel',
        'admin.login': 'Login no painel',
        'license.updated': 'Licença atualizada',
      };
      return map[action] ?? action.replace(/[._]/g, ' ');
    };
    const reasonText = (reason: string | null): string | null => {
      if (!reason) return null;
      if (reason === 'integration_disabled') return 'integração desativada';
      if (reason.startsWith('license_')) return `licença ${reason.slice('license_'.length)}`;
      return reason;
    };
    const webhookTitle = (source: string, eventType: string | null): string => {
      if (source === 'chatwoot') {
        const map: Record<string, string> = {
          message_created: 'Nova mensagem no Chatwoot',
          message_updated: 'Mensagem editada ou removida no Chatwoot',
          conversation_created: 'Nova conversa aberta',
          conversation_updated: 'Conversa atualizada',
          conversation_status_changed: 'Status da conversa alterado',
          conversation_typing_on: 'Atendente começou a digitar',
          conversation_typing_off: 'Atendente parou de digitar',
        };
        return map[eventType ?? ''] ?? 'Evento do Chatwoot';
      }
      const map: Record<string, string> = {
        Message: 'Mensagem recebida do WhatsApp',
        message: 'Mensagem recebida do WhatsApp',
        messages: 'Mensagem recebida do WhatsApp',
        'messages.upsert': 'Mensagem recebida do WhatsApp',
        'message.edited': 'Mensagem editada no WhatsApp',
      };
      return map[eventType ?? ''] ?? 'Evento do WhatsApp';
    };

    // Rich, content-free description of a processed message.
    const TYPE_LABEL: Record<string, string> = {
      text: 'Mensagem de texto',
      image: 'Imagem',
      audio: 'Áudio',
      video: 'Vídeo',
      document: 'Documento',
    };
    const messageTitle = (m: {
      direction: string;
      messageType: string;
      kind: string;
      isReply: boolean;
      isGroup: boolean;
    }): string => {
      const noun = TYPE_LABEL[m.messageType] ?? 'Mensagem';
      const verb =
        m.kind === 'deleted'
          ? m.direction === 'incoming'
            ? 'apagada pelo contato'
            : 'apagada'
          : m.kind === 'edited'
            ? m.direction === 'incoming'
              ? 'editada pelo contato'
              : 'editada'
            : m.direction === 'incoming'
              ? 'recebida do WhatsApp'
              : 'enviada ao WhatsApp';
      const extras = [m.isReply ? 'resposta' : null, m.isGroup ? 'grupo' : null].filter(Boolean);
      return `${noun} ${verb}${extras.length ? ` (${extras.join(', ')})` : ''}`;
    };

    type Entry = {
      id: string;
      at: string;
      kind: 'audit' | 'webhook' | 'message';
      level: 'info' | 'warn';
      source: string;
      actor: string | null;
      title: string;
      detail: string;
    };
    const entries: Entry[] = [];
    for (const a of audits) {
      entries.push({
        id: `a_${a.id}`,
        at: a.createdAt.toISOString(),
        kind: 'audit',
        level: 'info',
        source: 'admin',
        actor: a.adminUser?.email ?? null,
        title: auditTitle(a.action),
        detail: `${a.action}${a.entityType ? ` · ${a.entityType}` : ''}${a.entityId ? ` #${a.entityId}` : ''}`,
      });
    }
    for (const w of webhooks) {
      const reason = reasonText(w.reason ?? null);
      const base = webhookTitle(w.source, w.eventType ?? null);
      entries.push({
        id: `w_${w.id}`,
        at: w.receivedAt.toISOString(),
        kind: 'webhook',
        level: w.accepted ? 'info' : 'warn',
        source: w.source,
        actor: w.integration?.name ?? null,
        title: w.accepted ? base : `${base} — ignorado${reason ? ` (${reason})` : ''}`,
        detail: `${[w.source, w.originDetected, w.eventType].filter(Boolean).join(' · ')} · ${
          w.accepted ? 'aceito' : 'descartado'
        }${reason ? ` (${reason})` : ''}`,
      });
    }
    const KIND_LABEL: Record<string, string> = {
      created: 'criada',
      edited: 'editada',
      deleted: 'apagada',
    };
    for (const m of messages) {
      entries.push({
        id: `m_${m.id}`,
        at: m.createdAt.toISOString(),
        kind: 'message',
        level: 'info',
        source: m.direction === 'incoming' ? 'provider' : 'chatwoot',
        actor: m.integration?.name ?? null,
        title: messageTitle(m),
        detail: [
          m.direction === 'incoming' ? 'recebida' : 'enviada',
          (TYPE_LABEL[m.messageType] ?? m.messageType).toLowerCase(),
          m.hasMedia ? 'com mídia' : null,
          m.isReply ? 'resposta' : null,
          m.isGroup ? 'grupo' : null,
          KIND_LABEL[m.kind] ?? m.kind,
          m.provider,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
    entries.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
    const sliced = entries.slice(0, limit);
    const last = sliced[sliced.length - 1];
    return {
      entries: sliced,
      nextBefore: sliced.length === limit && last ? last.at : null,
    };
  });

  // ── message-flow stats (dashboard charts) ──
  // Time-bucketed counts of webhook events, CONTENT-FREE: how many messages were
  // received from WhatsApp (source=provider) vs sent out via Chatwoot
  // (source=chatwoot, message_created), plus accepted/discarded totals and a
  // breakdown by event type. Powers the "Visão geral" charts.
  app.get('/api/system/stats', guard, async (req) => {
    const q = req.query as { range?: string; provider?: string };
    const range = q.range === '7d' ? '7d' : '24h';
    const unit = range === '7d' ? 'day' : 'hour';
    const stepMs = range === '7d' ? 86_400_000 : 3_600_000;
    const spanMs = range === '7d' ? 7 * 86_400_000 : 24 * 3_600_000;
    const since = new Date(Date.now() - spanMs);

    // Optional provider filter (evolution/uazapi/zapi) — joins webhook events
    // to their integration's provider type.
    const provider = ['evolution', 'uazapi', 'zapi'].includes(q.provider ?? '')
      ? q.provider
      : undefined;
    const provFilter = provider ? `AND i.provider_type::text = $2` : '';
    const params: unknown[] = provider ? [since, provider] : [since];

    // Truncate to UTC so DB buckets line up with the ones we generate in JS.
    const truncBuckets = await app.prisma.$queryRawUnsafe<
      Array<{ bucket: Date; received: number; sent: number }>
    >(
      `SELECT date_trunc('${unit}', we.received_at AT TIME ZONE 'UTC') AS bucket,
          count(*) FILTER (WHERE we.source = 'provider')::int AS received,
          count(*) FILTER (WHERE we.source = 'chatwoot' AND we.event_type = 'message_created')::int AS sent
       FROM webhook_events we
       LEFT JOIN integrations i ON i.id = we.integration_id
       WHERE we.received_at >= $1 ${provFilter}
       GROUP BY 1
       ORDER BY 1`,
      ...params,
    );

    const [totals] = await app.prisma.$queryRawUnsafe<
      Array<{
        events: number;
        received: number;
        sent: number;
        accepted: number;
        discarded: number;
      }>
    >(
      `SELECT count(*)::int AS events,
          count(*) FILTER (WHERE we.source = 'provider')::int AS received,
          count(*) FILTER (WHERE we.source = 'chatwoot' AND we.event_type = 'message_created')::int AS sent,
          count(*) FILTER (WHERE we.accepted)::int AS accepted,
          count(*) FILTER (WHERE NOT we.accepted)::int AS discarded
       FROM webhook_events we
       LEFT JOIN integrations i ON i.id = we.integration_id
       WHERE we.received_at >= $1 ${provFilter}`,
      ...params,
    );

    const byEventType = await app.prisma.$queryRawUnsafe<
      Array<{ source: string; eventType: string | null; n: number }>
    >(
      `SELECT we.source, we.event_type AS "eventType", count(*)::int AS n
       FROM webhook_events we
       LEFT JOIN integrations i ON i.id = we.integration_id
       WHERE we.received_at >= $1 ${provFilter}
       GROUP BY 1, 2
       ORDER BY n DESC
       LIMIT 8`,
      ...params,
    );

    // Always computed over the full window (ignores the provider filter) so the
    // UI can show the per-provider split: evolution / zapi / uazapi.
    const byProvider = await app.prisma.$queryRawUnsafe<
      Array<{ provider: string; received: number; sent: number }>
    >(
      `SELECT i.provider_type::text AS provider,
          count(*) FILTER (WHERE we.source = 'provider')::int AS received,
          count(*) FILTER (WHERE we.source = 'chatwoot' AND we.event_type = 'message_created')::int AS sent
       FROM webhook_events we
       JOIN integrations i ON i.id = we.integration_id
       WHERE we.received_at >= $1
       GROUP BY 1
       ORDER BY 2 DESC, 3 DESC`,
      since,
    );

    // Fill gaps: build the full bucket series so the chart has no holes.
    const counts = new Map<number, { received: number; sent: number }>();
    for (const r of truncBuckets) {
      counts.set(new Date(r.bucket).getTime(), { received: r.received, sent: r.sent });
    }
    const startTrunc = Math.floor(since.getTime() / stepMs) * stepMs;
    const endTrunc = Math.floor(Date.now() / stepMs) * stepMs;
    const buckets: Array<{ at: string; received: number; sent: number }> = [];
    for (let t = startTrunc; t <= endTrunc; t += stepMs) {
      const c = counts.get(t);
      buckets.push({ at: new Date(t).toISOString(), received: c?.received ?? 0, sent: c?.sent ?? 0 });
    }

    return {
      range,
      provider: provider ?? null,
      since: since.toISOString(),
      buckets,
      totals: totals ?? { events: 0, received: 0, sent: 0, accepted: 0, discarded: 0 },
      byEventType,
      byProvider,
    };
  });

  // ── restart: signal worker + self-exit so Swarm recreates with new settings ──
  app.post('/api/system/restart', guard, async (req) => {
    await app.prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', restartRequestedAt: new Date() },
      update: { restartRequestedAt: new Date() },
    });
    await app.prisma.auditLog
      .create({
        data: {
          adminUserId: req.user.sub,
          action: 'system.restart',
          entityType: 'app_settings',
          entityId: 'singleton',
        },
      })
      .catch(() => undefined);
    // Give the response time to flush, then exit; the Swarm restart_policy
    // recreates the container, re-reading the connection overrides at boot.
    setTimeout(() => process.exit(0), 800);
    return { ok: true };
  });
}
