import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { pino, multistream } from 'pino';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { cfg } from './env.js';
import { prisma } from './db.js';
import { generateKey, generateSecret, generateWebhookKey, hashKey } from './crypto.js';
import {
  adminLoginConfigured,
  checkAdminCredentials,
  signAdminToken,
  verifyAdminToken,
} from './admin-auth.js';
import { logStream, recentLogs } from './log-buffer.js';

// Log to stdout AND an in-memory ring buffer (exposed at /admin/server-logs).
// (Dropping pino-pretty in dev — the vendor server logs JSON.)
const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  multistream([{ stream: process.stdout }, { stream: logStream }]),
);

const app = Fastify({ loggerInstance: logger as never, trustProxy: true });

// Tolerate bodyless POSTs (e.g. /admin/keys/:id/revoke) and empty JSON bodies.
const jsonParser = (
  _req: unknown,
  payload: NodeJS.ReadableStream,
  done: (e: Error | null, body?: unknown) => void,
) => {
  let data = '';
  payload.on('data', (c) => (data += c));
  payload.on('end', () => {
    try {
      done(null, data ? JSON.parse(data) : {});
    } catch {
      done(null, {});
    }
  });
};
app.removeContentTypeParser('application/json');
app.addContentTypeParser('*', jsonParser as never);

/** Client IP, honoring X-Forwarded-For (trustProxy is enabled). LGPD-safe metadata. */
function clientIp(req: FastifyRequest): string | undefined {
  return req.ip || undefined;
}

/** Record an LGPD-safe access/usage event (metadata only — never message content). */
async function recordEvent(opts: {
  type: string;
  licenseKeyId?: string | null;
  instanceId?: string | null;
  ip?: string | null;
  appVersion?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.licenseEvent.create({
      data: {
        type: opts.type,
        licenseKeyId: opts.licenseKeyId ?? null,
        instanceId: opts.instanceId ?? null,
        ip: opts.ip ?? null,
        appVersion: opts.appVersion ?? null,
        meta: (opts.meta ?? undefined) as never,
      },
    });
  } catch (err) {
    logger.warn({ err }, 'failed to record license event');
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

type KeyLike = { revokedAt: Date | null; plan: string; expiresAt: Date | null };

/** Whether a license key is currently valid, and if not, why. Online source of truth. */
function keyStatus(lk: KeyLike, now: Date): { active: boolean; reason: string | null } {
  if (lk.revokedAt) return { active: false, reason: 'revoked' };
  // Every key has an expiry — trial (14d) and paid (1y). There is NO lifetime key:
  // a missing/null expiry is treated as expired (never grants infinite access).
  if (!lk.expiresAt || lk.expiresAt <= now) return { active: false, reason: 'expired' };
  return { active: true, reason: null };
}

/**
 * Return the per-license secret, generating + persisting one for legacy keys
 * that predate this column. Delivered only over the validated channel.
 */
async function ensureSecret(lk: { id: string; secret: string | null }): Promise<string> {
  if (lk.secret) return lk.secret;
  const secret = generateSecret();
  await prisma.licenseKey.update({ where: { id: lk.id }, data: { secret } });
  return secret;
}

/**
 * All distinct per-license secrets ever bound to this instance (most recent
 * first). Integration credentials may be sealed with any of them (the secret
 * rotates on reactivation), so the client tries all when decrypting.
 */
async function instanceSecrets(instanceId: string): Promise<string[]> {
  const acts = await prisma.activation.findMany({
    where: { instanceId },
    include: { licenseKey: { select: { secret: true } } },
    orderBy: { boundAt: 'desc' },
  });
  const out: string[] = [];
  for (const a of acts) {
    const s = a.licenseKey.secret;
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Prisma filter: keys that are still valid (not revoked, expiry in the future).
 * Every key has an expiry — trial (14d) and paid (1y); no lifetime keys. */
function liveKeyFilter(
  now: Date,
): import('../generated/client/index.js').Prisma.LicenseKeyWhereInput {
  return {
    revokedAt: null,
    expiresAt: { gt: now },
  };
}

/**
 * Record IP activity for a key after its activation row has been updated with
 * the latest IP. Emits `ip_changed` when a single instance moves IP, and a
 * persistent `ip_alert` whenever the KEY as a whole spans more than one IP
 * (possible key-sharing / multi-machine use) — escalating, deduped by level so
 * the admin sees one alert per new distinct IP rather than a flood.
 */
async function recordIpActivity(opts: {
  licenseKeyId: string;
  instanceId: string;
  ip?: string;
  previousIp?: string | null;
  appVersion?: string;
}): Promise<void> {
  const { licenseKeyId, instanceId, ip, previousIp, appVersion } = opts;
  if (!ip) return;

  if (previousIp && previousIp !== ip) {
    await recordEvent({
      type: 'ip_changed',
      licenseKeyId,
      instanceId,
      ip,
      appVersion,
      meta: { previousIp },
    });
  }

  const rows = await prisma.activation.findMany({
    where: { licenseKeyId },
    select: { firstIp: true, lastIp: true },
  });
  const ips = new Set<string>();
  for (const r of rows) {
    if (r.firstIp) ips.add(r.firstIp);
    if (r.lastIp) ips.add(r.lastIp);
  }
  ips.add(ip);
  if (ips.size <= 1) return;

  // Escalation dedupe: skip if we already alerted at this distinct-IP level.
  const last = await prisma.licenseEvent.findFirst({
    where: { licenseKeyId, type: 'ip_alert' },
    orderBy: { createdAt: 'desc' },
  });
  const lastLevel =
    last && typeof (last.meta as { distinctIps?: number } | null)?.distinctIps === 'number'
      ? (last.meta as { distinctIps: number }).distinctIps
      : 0;
  if (lastLevel >= ips.size) return;

  await recordEvent({
    type: 'ip_alert',
    licenseKeyId,
    instanceId,
    ip,
    appVersion,
    meta: { previousIp: previousIp ?? null, distinctIps: ips.size },
  });
}

const ProvisionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().optional(),
  instanceId: z.string().min(1),
  appVersion: z.string().optional(),
  publicBaseUrl: z.string().optional(),
});
const ActivateSchema = z.object({
  key: z.string().min(1),
  instanceId: z.string().min(1),
  appVersion: z.string().optional(),
  publicBaseUrl: z.string().optional(),
});
const ValidateSchema = z.object({
  key: z.string().min(1),
  instanceId: z.string().min(1),
  token: z.string().optional(),
  telemetry: z.record(z.unknown()).optional(),
});
const DeactivateSchema = z.object({ key: z.string().min(1), instanceId: z.string().min(1) });
const PurchaseIntentSchema = z.object({
  key: z.string().min(1),
  instanceId: z.string().min(1),
  email: z.string().email().optional(),
});

app.get('/health', async () => ({ status: 'ok' }));

// ── provision (self-service: create + bind a key in one online call) ──
app.post('/provision', async (req, reply) => {
  const p = ProvisionSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { name, email, instanceId, appVersion, publicBaseUrl } = p.data;
  const ip = clientIp(req);
  const now = new Date();

  // One live key per instanceId. If this instance already has a live activation
  // (paid, or a still-valid trial), reuse it instead of minting a second key.
  const existing = await prisma.activation.findFirst({
    where: { instanceId, revokedAt: null, licenseKey: liveKeyFilter(now) },
    include: { licenseKey: true },
    orderBy: { boundAt: 'desc' },
  });
  if (existing) {
    await prisma.activation.update({
      where: { id: existing.id },
      data: { lastHeartbeatAt: now, lastIp: ip, appVersion, publicBaseUrl },
    });
    await recordIpActivity({
      licenseKeyId: existing.licenseKeyId,
      instanceId,
      ip,
      previousIp: existing.lastIp,
      appVersion,
    });
    await recordEvent({
      type: 'provision_reused',
      licenseKeyId: existing.licenseKeyId,
      instanceId,
      ip,
      appVersion,
    });
    return {
      active: true,
      plan: existing.licenseKey.plan,
      expiresAt: existing.licenseKey.expiresAt,
      features: existing.licenseKey.features ?? {},
      secret: await ensureSecret(existing.licenseKey),
      secrets: await instanceSecrets(instanceId),
      reused: true,
    };
  }

  // Admin-granted pickup. If the admin made a license live for this e-mail that's
  // still valid and not claimed by a DIFFERENT instance, bind it and hand the key
  // over — the customer never sees or types it. A PAID license wins over a trial.
  // Checked before the regular trial logic so a user the admin granted (or
  // re-activated, or "Liberou como paga") picks THAT up instead of being refused
  // or minting a fresh trial.
  //
  // PAID keys are claimable by e-mail even WITHOUT a parked raw key: the admin
  // "Liberar como paga" (/upgrade) converts an existing trial in place and parks
  // no `issuedKey`, so we mint & park one at claim time (see below). A TRIAL, by
  // contrast, must carry a parked `issuedKey` to be claimed by e-mail — otherwise
  // a plain self-service trial could be handed to anyone sharing the e-mail.
  if (email) {
    const emailEq = { equals: email, mode: 'insensitive' as const };
    // Unclaimed, or already bound to THIS instance (re-provision after data loss).
    const notBoundElsewhere = { none: { revokedAt: null, instanceId: { not: instanceId } } };
    const paidGrant = await prisma.licenseKey.findFirst({
      where: { plan: 'paid', revokedAt: null, email: emailEq, activations: notBoundElsewhere, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    const granted =
      paidGrant ??
      (await prisma.licenseKey.findFirst({
        where: {
          plan: 'trial',
          revokedAt: null,
          issuedKey: { not: null }, // self-service trials don't park a raw key
          email: emailEq,
          activations: notBoundElsewhere,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      }));
    if (granted) {
      // Ensure a raw key exists to deliver. An admin-upgraded paid key has none —
      // mint & park one now. Rotating the keyHash is safe here: the `notBoundElsewhere`
      // filter guarantees no OTHER live instance is presenting this key, and this
      // instance reached step 2 only because it has no live binding of its own.
      let deliverKey = granted.issuedKey ?? undefined;
      if (!deliverKey) {
        const raw = generateKey();
        await prisma.licenseKey.update({
          where: { id: granted.id },
          data: { keyHash: hashKey(raw), issuedKey: raw },
        });
        deliverKey = raw;
      }
      const prevAct = await prisma.activation.findUnique({
        where: { licenseKeyId_instanceId: { licenseKeyId: granted.id, instanceId } },
      });
      await prisma.activation.upsert({
        where: { licenseKeyId_instanceId: { licenseKeyId: granted.id, instanceId } },
        create: {
          licenseKeyId: granted.id,
          instanceId,
          appVersion,
          publicBaseUrl,
          firstIp: ip,
          lastIp: ip,
          lastHeartbeatAt: now,
        },
        update: { appVersion, publicBaseUrl, lastIp: ip, revokedAt: null, lastHeartbeatAt: now },
      });
      await recordIpActivity({
        licenseKeyId: granted.id,
        instanceId,
        ip,
        previousIp: prevAct?.lastIp,
        appVersion,
      });
      await recordEvent({
        type: granted.plan === 'paid' ? 'paid_claimed' : 'trial_claimed',
        licenseKeyId: granted.id,
        instanceId,
        ip,
        appVersion,
      });
      return {
        key: deliverKey,
        active: true,
        plan: granted.plan,
        expiresAt: granted.expiresAt,
        features: granted.features ?? {},
        secret: await ensureSecret(granted),
        secrets: await instanceSecrets(instanceId),
      };
    }
  }

  // No free renewal: a trial is granted ONCE per instance. If this instance has
  // ever bound a key before (its trial expired or was revoked, and no live key
  // remains), refuse to mint a fresh trial — the only way forward is to buy a
  // definitive license. Brand-new instances (no prior activation) fall through
  // and get their single initial trial.
  const prior = await prisma.activation.findFirst({
    where: { instanceId },
    include: { licenseKey: true },
    orderBy: { boundAt: 'desc' },
  });
  if (prior) {
    await recordEvent({
      type: 'provision_denied',
      licenseKeyId: prior.licenseKeyId,
      instanceId,
      ip,
      appVersion,
    });
    return reply.code(403).send({
      active: false,
      plan: prior.licenseKey.plan,
      expiresAt: prior.licenseKey.expiresAt,
      reason: 'trial_expired',
    });
  }

  const raw = generateKey();
  const expiresAt = new Date(now.getTime() + cfg.trialDays * DAY_MS);
  const lk = await prisma.licenseKey.create({
    data: {
      keyHash: hashKey(raw),
      plan: 'trial',
      expiresAt,
      email,
      name,
      provisionedBy: 'self-service',
      features: {} as never,
      maxActivations: 1,
      secret: generateSecret(),
    },
  });
  await prisma.activation.create({
    data: {
      licenseKeyId: lk.id,
      instanceId,
      appVersion,
      publicBaseUrl,
      firstIp: ip,
      lastIp: ip,
      lastHeartbeatAt: now,
    },
  });
  await recordEvent({ type: 'provision', licenseKeyId: lk.id, instanceId, ip, appVersion });
  return {
    key: raw,
    active: true,
    plan: lk.plan,
    expiresAt: lk.expiresAt,
    features: lk.features ?? {},
    secret: lk.secret,
    secrets: await instanceSecrets(instanceId),
  };
});

// ── activate ──
app.post('/activate', async (req, reply) => {
  const p = ActivateSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { key, instanceId, appVersion, publicBaseUrl } = p.data;
  const ip = clientIp(req);
  const now = new Date();

  const lk = await prisma.licenseKey.findUnique({ where: { keyHash: hashKey(key) } });
  if (!lk) return reply.code(404).send({ error: 'invalid_key' });
  const st = keyStatus(lk, now);
  if (!st.active) {
    await recordEvent({
      type: st.reason === 'expired' ? 'activate_expired' : 'activate_revoked',
      licenseKeyId: lk.id,
      instanceId,
      ip,
      appVersion,
    });
    return reply.code(403).send({ active: false, plan: lk.plan, expiresAt: lk.expiresAt, reason: st.reason });
  }

  // No activation limit: a user may run as many instances as they want on any
  // machine. We only record usage (and flag IP changes) for visibility.
  const prev = await prisma.activation.findUnique({
    where: { licenseKeyId_instanceId: { licenseKeyId: lk.id, instanceId } },
  });

  await prisma.activation.upsert({
    where: { licenseKeyId_instanceId: { licenseKeyId: lk.id, instanceId } },
    create: {
      licenseKeyId: lk.id,
      instanceId,
      appVersion,
      publicBaseUrl,
      firstIp: ip,
      lastIp: ip,
      lastHeartbeatAt: now,
    },
    update: { appVersion, publicBaseUrl, lastIp: ip, revokedAt: null, lastHeartbeatAt: now },
  });

  await recordIpActivity({ licenseKeyId: lk.id, instanceId, ip, previousIp: prev?.lastIp, appVersion });

  await recordEvent({ type: 'activate', licenseKeyId: lk.id, instanceId, ip, appVersion });
  return {
    active: true,
    plan: lk.plan,
    expiresAt: lk.expiresAt,
    features: lk.features ?? {},
    secret: await ensureSecret(lk),
    secrets: await instanceSecrets(instanceId),
  };
});

// ── validate (online source of truth; replaces token heartbeat) ──
// Returns {active, plan, expiresAt, reason} and, when a newer paid key has been
// minted for this instance (payment webhook), delivers it as `key` so the client
// updates itself. `/heartbeat` is kept as a back-compat alias during rollout.
const validateHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const p = ValidateSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { key, instanceId, telemetry } = p.data;
  const ip = clientIp(req);
  const appVersion = typeof telemetry?.appVersion === 'string' ? telemetry.appVersion : undefined;
  const now = new Date();

  const presented = await prisma.licenseKey.findUnique({
    where: { keyHash: hashKey(key) },
    include: { activations: { where: { instanceId }, select: { id: true } } },
  });
  // The presented key must belong to this instance — proves the caller owns the install.
  const ownsInstance = !!presented && presented.activations.length > 0;

  // Best live license currently bound to this instance (may be a freshly minted
  // paid key the client doesn't know about yet).
  const activeBinding = await prisma.activation.findFirst({
    where: { instanceId, revokedAt: null, licenseKey: liveKeyFilter(now) },
    include: { licenseKey: true },
    orderBy: { licenseKey: { createdAt: 'desc' } },
  });

  if (!ownsInstance || !activeBinding) {
    const reason = presented ? keyStatus(presented, now).reason ?? 'revoked' : 'invalid_key';
    return reply.send({
      active: false,
      plan: presented?.plan ?? null,
      expiresAt: presented?.expiresAt ?? null,
      reason,
    });
  }

  const lk = activeBinding.licenseKey;

  await prisma.activation.update({
    where: { id: activeBinding.id },
    data: { lastHeartbeatAt: now, lastIp: ip, lastTelemetry: (telemetry ?? {}) as never },
  });
  await recordIpActivity({
    licenseKeyId: lk.id,
    instanceId,
    ip,
    previousIp: activeBinding.lastIp,
    appVersion,
  });
  await recordEvent({ type: 'validate', licenseKeyId: lk.id, instanceId, ip, appVersion });

  // Key delivery: hand over the new raw key parked on the paid PurchaseIntent
  // when the client is still on an older key; clear it once receipt is proven.
  let deliveredKey: string | undefined;
  if (lk.keyHash !== hashKey(key)) {
    const intent = await prisma.purchaseIntent.findFirst({
      where: { instanceId, licenseKeyId: lk.id, issuedKey: { not: null } },
      orderBy: { paidAt: 'desc' },
    });
    deliveredKey = intent?.issuedKey ?? undefined;
  } else {
    await prisma.purchaseIntent.updateMany({
      where: { instanceId, licenseKeyId: lk.id, issuedKey: { not: null } },
      data: { issuedKey: null },
    });
  }

  return {
    active: true,
    plan: lk.plan,
    expiresAt: lk.expiresAt,
    features: lk.features ?? {},
    secret: await ensureSecret(lk),
    secrets: await instanceSecrets(instanceId),
    // Global support WhatsApp — refreshed on every validate (same cadence as the
    // heartbeat), so changing it in the panel reflects on all clients.
    supportWhatsapp: await supportWhatsapp(),
    ...(deliveredKey ? { key: deliveredKey } : {}),
  };
};
app.post('/validate', validateHandler);
app.post('/heartbeat', validateHandler);

// ── purchase intent (customer clicked "buy" for this installation) ──
app.post('/purchase-intent', async (req, reply) => {
  const p = PurchaseIntentSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { key, instanceId, email } = p.data;
  const ip = clientIp(req);

  const lk = await prisma.licenseKey.findUnique({
    where: { keyHash: hashKey(key) },
    include: { activations: { where: { instanceId }, select: { id: true } } },
  });
  if (!lk || lk.activations.length === 0) return reply.code(404).send({ error: 'unknown_instance' });

  // Supersede any earlier pending intent for this instance so the webhook always
  // settles the latest request.
  await prisma.purchaseIntent.updateMany({
    where: { instanceId, status: 'pending' },
    data: { status: 'cancelled' },
  });
  const intent = await prisma.purchaseIntent.create({
    data: { instanceId, email: email ?? lk.email, status: 'pending' },
  });
  await recordEvent({
    type: 'purchase_intent',
    licenseKeyId: lk.id,
    instanceId,
    ip,
    meta: { intentId: intent.id, email: intent.email },
  });
  // Send the buyer to checkout, carrying the intent id as Hotmart `sck` so the
  // payment maps back to this instance even if the buyer pays with another email.
  const base = (await paymentConfig()).checkoutUrl;
  const sep = base.includes('?') ? '&' : '?';
  const checkoutUrl = `${base}${sep}sck=${encodeURIComponent(intent.id)}`;
  return { ok: true, intentId: intent.id, checkoutUrl };
});

// ── support ticket (customer opened a support request from their panel) ──
// Registered regardless of license status (the vendor sees trial/expired users
// too). The client only redirects PAID-active users to the support WhatsApp.
const SupportTicketSchema = z.object({
  key: z.string().min(1),
  instanceId: z.string().min(1),
  email: z.string().email().optional(),
  message: z.string().trim().min(1).max(5000),
});
app.post('/support-ticket', async (req, reply) => {
  const p = SupportTicketSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { key, instanceId, email, message } = p.data;
  const lk = await prisma.licenseKey.findUnique({ where: { keyHash: hashKey(key) } });
  const ticket = await prisma.supportTicket.create({
    data: {
      instanceId,
      licenseKeyId: lk?.id ?? null,
      email: email ?? lk?.email ?? null,
      plan: lk?.plan ?? null,
      message,
    },
  });
  await recordEvent({
    type: 'support_ticket',
    licenseKeyId: lk?.id,
    instanceId,
    meta: { ticketId: ticket.id },
  });
  return { ok: true, ticketId: ticket.id, supportWhatsapp: await supportWhatsapp() };
});

// ── admin: support tickets ──
const TicketsQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['open', 'resolved']).optional(),
  before: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
app.get('/admin/support-tickets', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const q = TicketsQuerySchema.safeParse(req.query ?? {});
  if (!q.success) return reply.code(400).send({ error: 'validation' });
  const take = q.data.limit ?? 50;
  const rows = await prisma.supportTicket.findMany({
    where: {
      ...(q.data.status ? { status: q.data.status } : {}),
      ...(q.data.q ? { email: { contains: q.data.q, mode: 'insensitive' } } : {}),
      ...(q.data.before ? { createdAt: { lt: new Date(q.data.before) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const tickets = hasMore ? rows.slice(0, take) : rows;
  const nextBefore = hasMore ? tickets[tickets.length - 1]!.createdAt.toISOString() : null;
  return { tickets, nextBefore };
});

app.post('/admin/support-tickets/:id/resolve', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  await prisma.supportTicket.update({
    where: { id },
    data: { status: 'resolved', resolvedAt: new Date() },
  });
  return { ok: true };
});

app.post('/admin/support-tickets/:id/reopen', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  await prisma.supportTicket.update({ where: { id }, data: { status: 'open', resolvedAt: null } });
  return { ok: true };
});

// ── payment webhook (external provider → license server) ──
const WebhookPaymentSchema = z.object({
  email: z.string().email(),
  paymentRef: z.string().optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

/** Authenticate a payment webhook call via a `Bearer WHK-...` key. */
async function requireWebhookKey(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const auth = req.headers.authorization;
  const raw = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!raw) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  const wk = await prisma.webhookKey.findUnique({ where: { keyHash: hashKey(raw) } });
  if (!wk || wk.revokedAt) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  await prisma.webhookKey.update({ where: { id: wk.id }, data: { lastUsedAt: new Date() } });
  return true;
}

/**
 * Effective payment config: admin-panel settings (DB) take precedence, falling
 * back to env. Lets the vendor set the Hotmart checkout link, webhook token and
 * product id from the panel without redeploying.
 */
async function paymentConfig(): Promise<{
  checkoutUrl: string;
  hotmartHottok: string | undefined;
  hotmartProductId: string | undefined;
}> {
  const s = await prisma.serverSettings.findUnique({ where: { id: 'singleton' } });
  return {
    checkoutUrl: s?.checkoutUrl || cfg.checkoutUrl,
    hotmartHottok: s?.hotmartHottok || cfg.hotmartHottok,
    hotmartProductId: s?.hotmartProductId || cfg.hotmartProductId,
  };
}

/** Support WhatsApp number — admin-panel setting takes precedence over env. */
async function supportWhatsapp(): Promise<string | null> {
  const s = await prisma.serverSettings.findUnique({ where: { id: 'singleton' } });
  return s?.supportWhatsapp || cfg.supportWhatsapp || null;
}

/**
 * Grant or RENEW a paid license for a buyer. Renewals STACK: +paidDays from the
 * current expiry when it's still in the future, otherwise from now. Reactivates a
 * revoked/expired key. With no instance (paid via a direct link), the key is
 * created with `issuedKey` parked so the customer claims it by e-mail on
 * provision. `deliverKey` is the raw key to park on the intent for delivery to a
 * bound instance (null when the client already holds it / a legacy key).
 */
async function grantOrRenewPaid(opts: {
  email: string;
  name?: string | null;
  instanceId?: string | null;
}): Promise<{ licenseKeyId: string; deliverKey: string | null; expiresAt: Date; renewed: boolean }> {
  const now = new Date();
  const span = cfg.paidDays * DAY_MS;

  // Prefer an existing paid key bound to the instance; else the buyer's by e-mail.
  let lk = null as Awaited<ReturnType<typeof prisma.licenseKey.findFirst>> | null;
  if (opts.instanceId) {
    const act = await prisma.activation.findFirst({
      where: { instanceId: opts.instanceId, licenseKey: { plan: 'paid' } },
      include: { licenseKey: true },
      orderBy: { licenseKey: { createdAt: 'desc' } },
    });
    lk = act?.licenseKey ?? null;
  }
  if (!lk) {
    lk = await prisma.licenseKey.findFirst({
      where: { plan: 'paid', email: { equals: opts.email, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (lk) {
    const base = lk.expiresAt && lk.expiresAt > now ? lk.expiresAt : now;
    const expiresAt = new Date(base.getTime() + span);
    // A payment ALWAYS makes the key paid — a trial that gets paid becomes 'paid'
    // (não fica trial). Renewals of an already-paid key just push the expiry.
    await prisma.licenseKey.update({
      where: { id: lk.id },
      data: { plan: 'paid', expiresAt, revokedAt: null },
    });
    if (opts.instanceId) {
      await prisma.activation.upsert({
        where: { licenseKeyId_instanceId: { licenseKeyId: lk.id, instanceId: opts.instanceId } },
        create: { licenseKeyId: lk.id, instanceId: opts.instanceId, lastHeartbeatAt: now },
        update: { revokedAt: null, lastHeartbeatAt: now },
      });
    }
    return { licenseKeyId: lk.id, deliverKey: lk.issuedKey ?? null, expiresAt, renewed: true };
  }

  // Mint a new paid key — carry the seal secret forward so sealed integration
  // credentials stay decryptable.
  const prev = opts.instanceId
    ? await prisma.activation.findFirst({
        where: { instanceId: opts.instanceId, revokedAt: null },
        include: { licenseKey: true },
        orderBy: { boundAt: 'desc' },
      })
    : null;
  const carrySecret = prev?.licenseKey?.secret ?? generateSecret();
  const raw = generateKey();
  const expiresAt = new Date(now.getTime() + span);
  const created = await prisma.licenseKey.create({
    data: {
      keyHash: hashKey(raw),
      plan: 'paid',
      expiresAt,
      email: opts.email,
      name: opts.name ?? undefined,
      provisionedBy: 'payment',
      features: {} as never,
      maxActivations: 1,
      secret: carrySecret,
      issuedKey: raw, // claim-by-email pickup + delivery to the bound instance
    },
  });
  if (opts.instanceId) {
    await prisma.activation.upsert({
      where: { licenseKeyId_instanceId: { licenseKeyId: created.id, instanceId: opts.instanceId } },
      create: { licenseKeyId: created.id, instanceId: opts.instanceId, lastHeartbeatAt: now },
      update: { revokedAt: null, lastHeartbeatAt: now },
    });
  }
  return { licenseKeyId: created.id, deliverKey: raw, expiresAt, renewed: false };
}

/** Revoke a buyer's paid key on refund/chargeback/cancel. */
async function revokePaidForBuyer(opts: {
  email?: string | null;
  licenseKeyId?: string | null;
}): Promise<string | null> {
  let id = opts.licenseKeyId ?? null;
  if (!id && opts.email) {
    const lk = await prisma.licenseKey.findFirst({
      where: { plan: 'paid', email: { equals: opts.email, mode: 'insensitive' }, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    id = lk?.id ?? null;
  }
  if (!id) return null;
  await prisma.licenseKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return id;
}

app.post('/webhook/payment', async (req, reply) => {
  if (!(await requireWebhookKey(req, reply))) return;
  const p = WebhookPaymentSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const { email, paymentRef, name } = p.data;
  const now = new Date();

  // Idempotency: a retried webhook with the same (transaction, event) is a no-op.
  if (paymentRef) {
    const done = await prisma.payment.findFirst({ where: { transaction: paymentRef, event: 'PAYMENT' } });
    if (done) return { ok: true, alreadyProcessed: true };
  }

  const intent = await prisma.purchaseIntent.findFirst({
    where: { email, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
  const instanceId = intent?.instanceId ?? null;
  const res = await grantOrRenewPaid({ email, name, instanceId });
  if (intent) {
    await prisma.purchaseIntent.update({
      where: { id: intent.id },
      data: {
        status: 'paid',
        licenseKeyId: res.licenseKeyId,
        issuedKey: res.deliverKey,
        paymentRef: paymentRef ?? null,
        paidAt: now,
      },
    });
  }
  await prisma.payment.create({
    data: {
      transaction: paymentRef ?? null,
      provider: 'manual',
      event: 'PAYMENT',
      kind: res.renewed ? 'renewal' : 'purchase',
      status: 'applied',
      email,
      instanceId,
      licenseKeyId: res.licenseKeyId,
      expiresAt: res.expiresAt,
    },
  });
  await recordEvent({
    type: res.renewed ? 'payment_renewed' : 'payment_confirmed',
    licenseKeyId: res.licenseKeyId,
    instanceId: instanceId ?? undefined,
    meta: { intentId: intent?.id ?? null, email, paymentRef: paymentRef ?? null },
  });
  return { ok: true, intentId: intent?.id ?? null };
});

// ── Hotmart webhook (Postback 2.0) ──
// Configure in Hotmart pointing to this endpoint; the token (hottok) goes in
// HOTMART_HOTTOK. PURCHASE_APPROVED/COMPLETE → grant/renew +1y; refund/chargeback/
// cancel → revoke. The intent id rides back as `sck` so we map to the instance.
const APPROVE_EVENTS = new Set(['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'PURCHASE_COMPLETED']);
const REVOKE_EVENTS = new Set([
  'PURCHASE_REFUNDED',
  'PURCHASE_CHARGEBACK',
  'PURCHASE_CANCELED',
  'PURCHASE_CANCELLED',
  'PURCHASE_PROTEST',
]);

function hotmartAuthorized(req: FastifyRequest, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = (req.headers['x-hotmart-hottok'] as string | undefined) ?? '';
  const body = req.body as { hottok?: unknown } | undefined;
  const bodyTok = typeof body?.hottok === 'string' ? body.hottok : '';
  const query = req.query as { hottok?: unknown } | undefined;
  const queryTok = typeof query?.hottok === 'string' ? query.hottok : '';
  return [header, bodyTok, queryTok].some((t) => t.length > 0 && t === expected);
}

app.post('/webhook/hotmart', async (req, reply) => {
  const pc = await paymentConfig();
  if (!hotmartAuthorized(req, pc.hotmartHottok)) return reply.code(401).send({ error: 'unauthorized' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  const buyer = (data.buyer ?? {}) as Record<string, unknown>;
  const purchase = (data.purchase ?? {}) as Record<string, unknown>;
  const product = (data.product ?? {}) as Record<string, unknown>;
  const tracking = (purchase.tracking ?? {}) as Record<string, unknown>;
  const price = (purchase.price ?? {}) as Record<string, unknown>;

  const event = String(body.event ?? '').toUpperCase();
  const email = typeof buyer.email === 'string' ? buyer.email : undefined;
  const name = typeof buyer.name === 'string' ? buyer.name : undefined;
  const transaction = typeof purchase.transaction === 'string' ? purchase.transaction : undefined;
  const amount = typeof price.value === 'number' ? price.value : undefined;
  const currency = typeof price.currency_value === 'string' ? price.currency_value : undefined;
  const sck =
    (typeof tracking.source_sck === 'string' && tracking.source_sck) ||
    (typeof purchase.sck === 'string' && purchase.sck) ||
    undefined;
  const productId = product.id != null ? String(product.id) : undefined;

  // Optional product filter.
  if (pc.hotmartProductId && productId && productId !== pc.hotmartProductId) {
    return { ok: true, ignored: 'other_product' };
  }

  // Idempotency per (transaction, event).
  if (transaction) {
    const done = await prisma.payment.findFirst({ where: { transaction, event } });
    if (done) return { ok: true, alreadyProcessed: true };
  }

  // Resolve the intent: by sck (intent id), else the buyer's most recent pending.
  let intent = sck
    ? await prisma.purchaseIntent.findUnique({ where: { id: String(sck) } }).catch(() => null)
    : null;
  if (!intent && email) {
    intent = await prisma.purchaseIntent.findFirst({
      where: { email, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }
  const targetEmail = email ?? intent?.email ?? undefined;
  const instanceId = intent?.instanceId ?? null;

  if (APPROVE_EVENTS.has(event)) {
    if (!targetEmail) {
      await prisma.payment.create({
        data: { transaction: transaction ?? null, provider: 'hotmart', event, kind: 'purchase', status: 'rejected', amount, currency, raw: body as never },
      });
      return reply.code(202).send({ ok: false, reason: 'no_email' });
    }
    const res = await grantOrRenewPaid({ email: targetEmail, name, instanceId });
    if (intent) {
      await prisma.purchaseIntent.update({
        where: { id: intent.id },
        data: {
          status: 'paid',
          licenseKeyId: res.licenseKeyId,
          issuedKey: res.deliverKey,
          paymentRef: transaction ?? null,
          paidAt: new Date(),
        },
      });
    }
    await prisma.payment.create({
      data: {
        transaction: transaction ?? null,
        provider: 'hotmart',
        event,
        kind: res.renewed ? 'renewal' : 'purchase',
        status: 'applied',
        email: targetEmail,
        instanceId,
        licenseKeyId: res.licenseKeyId,
        amount,
        currency,
        expiresAt: res.expiresAt,
        raw: body as never,
      },
    });
    await recordEvent({
      type: res.renewed ? 'payment_renewed' : 'payment_confirmed',
      licenseKeyId: res.licenseKeyId,
      instanceId: instanceId ?? undefined,
      meta: { intentId: intent?.id ?? null, email: targetEmail, transaction: transaction ?? null },
    });
    return { ok: true, renewed: res.renewed, intentId: intent?.id ?? null };
  }

  if (REVOKE_EVENTS.has(event)) {
    const revokedKeyId = await revokePaidForBuyer({ email: targetEmail, licenseKeyId: intent?.licenseKeyId });
    const kind = event.includes('CHARGEBACK')
      ? 'chargeback'
      : event.includes('CANCEL')
        ? 'cancel'
        : 'refund';
    await prisma.payment.create({
      data: {
        transaction: transaction ?? null,
        provider: 'hotmart',
        event,
        kind,
        status: revokedKeyId ? 'applied' : 'ignored',
        email: targetEmail,
        instanceId,
        licenseKeyId: revokedKeyId,
        amount,
        currency,
        raw: body as never,
      },
    });
    if (revokedKeyId) {
      await recordEvent({
        type: 'payment_refunded',
        licenseKeyId: revokedKeyId,
        meta: { event, email: targetEmail, transaction: transaction ?? null },
      });
    }
    return { ok: true, revoked: !!revokedKeyId };
  }

  // Any other event (billet printed, delayed, etc.) — log and ack.
  await prisma.payment.create({
    data: { transaction: transaction ?? null, provider: 'hotmart', event, kind: 'purchase', status: 'ignored', email: targetEmail, amount, currency, raw: body as never },
  });
  return { ok: true, ignored: event };
});

// ── deactivate (release binding) ──
app.post('/deactivate', async (req, reply) => {
  const p = DeactivateSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const ip = clientIp(req);
  const lk = await prisma.licenseKey.findUnique({ where: { keyHash: hashKey(p.data.key) } });
  if (lk) {
    await prisma.activation.updateMany({
      where: { licenseKeyId: lk.id, instanceId: p.data.instanceId },
      data: { revokedAt: new Date() },
    });
    await recordEvent({
      type: 'deactivate',
      licenseKeyId: lk.id,
      instanceId: p.data.instanceId,
      ip,
    });
  }
  return { ok: true };
});

// ── admin ──
/** Accept either the static ADMIN_TOKEN (scripts/CLI) or a panel JWT session. */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (token && token === cfg.adminToken) return true;
  if (token && (await verifyAdminToken(token))) return true;
  reply.code(401).send({ error: 'unauthorized' });
  return false;
}

const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post('/admin/login', async (req, reply) => {
  if (!adminLoginConfigured()) return reply.code(503).send({ error: 'login_not_configured' });
  const p = AdminLoginSchema.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  if (!checkAdminCredentials(p.data.email, p.data.password)) {
    return reply.code(401).send({ error: 'invalid_credentials' });
  }
  const token = await signAdminToken(p.data.email);
  return { token, user: { email: p.data.email } };
});

app.get('/admin/me', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return { ok: true };
});

// Standalone key creation (which exposed a raw WTR-… key to copy/paste) was
// removed: a customer must NEVER see or type a key. All licenses are delivered
// transparently — self-service trial at signup, admin grant-by-e-mail below,
// payment webhook, or trial→paid upgrade.

// ── admin: granted licenses (trial OR paid, handed to a specific user by e-mail) ──
// Create a license for a specific user; their instance picks it up automatically
// on provision (matched by e-mail) — they never see a key. A trial expires after
// the standard window (reactivate with /admin/keys/:id/reactivate-trial); a paid
// grant gets the standard paid window (1 year). Revoke via /admin/keys/:id/revoke,
// un-revoke via /admin/keys/:id/activate.
const GrantSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120).optional(),
  plan: z.enum(['trial', 'paid']).optional(), // default trial
  features: z.record(z.unknown()).optional(),
});
app.post('/admin/free-licenses', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const p = GrantSchema.safeParse(req.body ?? {});
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const plan = p.data.plan ?? 'trial';
  const raw = generateKey();
  const created = await prisma.licenseKey.create({
    data: {
      keyHash: hashKey(raw),
      plan,
      expiresAt: new Date(Date.now() + (plan === 'trial' ? cfg.trialDays : cfg.paidDays) * DAY_MS),
      email: p.data.email,
      name: p.data.name,
      provisionedBy: plan === 'paid' ? 'admin-paid' : 'admin-trial',
      features: (p.data.features ?? {}) as never,
      maxActivations: 1,
      secret: generateSecret(),
      issuedKey: raw, // delivered to the matching instance on provision (never shown)
    },
  });
  await recordEvent({
    type: plan === 'paid' ? 'admin_paid_grant' : 'admin_trial_grant',
    licenseKeyId: created.id,
  });
  return reply.code(201).send({ id: created.id, email: created.email });
});

app.get('/admin/free-licenses', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const now = new Date();
  const rows = await prisma.licenseKey.findMany({
    where: { provisionedBy: { in: ['admin-trial', 'admin-paid'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      activations: {
        where: { revokedAt: null },
        orderBy: { lastHeartbeatAt: 'desc' },
        select: { instanceId: true, lastIp: true, lastHeartbeatAt: true, appVersion: true },
      },
    },
  });
  return {
    licenses: rows.map((k) => ({
      id: k.id,
      plan: k.plan,
      email: k.email,
      name: k.name,
      revoked: !!k.revokedAt,
      expired: !k.revokedAt && !!k.expiresAt && k.expiresAt <= now,
      expiresAt: k.expiresAt,
      claimed: k.activations.length > 0,
      activeInstances: k.activations.length,
      lastHeartbeatAt: k.activations[0]?.lastHeartbeatAt ?? null,
      lastIp: k.activations[0]?.lastIp ?? null,
      createdAt: k.createdAt,
    })),
  };
});

const KeysQuerySchema = z.object({
  q: z.string().trim().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  plan: z.enum(['trial', 'paid']).optional(),
  status: z.enum(['active', 'expired', 'revoked']).optional(),
});

/** Prisma filter for a key status bucket (active | expired | revoked). */
function statusFilter(
  status: 'active' | 'expired' | 'revoked' | undefined,
  now: Date,
): import('../generated/client/index.js').Prisma.LicenseKeyWhereInput {
  if (status === 'revoked') return { revokedAt: { not: null } };
  if (status === 'expired') {
    // Any non-revoked key at/past its expiry (trial or paid); a missing expiry
    // counts as expired too (there are no lifetime keys).
    return { revokedAt: null, OR: [{ expiresAt: { lte: now } }, { expiresAt: null }] };
  }
  if (status === 'active') return liveKeyFilter(now);
  return {};
}

app.get('/admin/keys', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const query = KeysQuerySchema.safeParse(req.query ?? {});
  if (!query.success) return reply.code(400).send({ error: 'validation' });
  const { q, from, to, plan, status } = query.data;
  const filterNow = new Date();

  // Date range on createdAt.
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) createdAt.gte = new Date(from);
  if (to) createdAt.lte = new Date(to);

  // Search by name/email (contains) OR by license id OR by the raw key (hashed).
  const or: import('../generated/client/index.js').Prisma.LicenseKeyWhereInput[] = [];
  if (q) {
    or.push({ name: { contains: q, mode: 'insensitive' } });
    or.push({ email: { contains: q, mode: 'insensitive' } });
    or.push({ id: q });
    if (q.startsWith('WTR-')) or.push({ keyHash: hashKey(q) });
  }

  const keys = await prisma.licenseKey.findMany({
    where: {
      ...(from || to ? { createdAt } : {}),
      ...(plan ? { plan } : {}),
      ...statusFilter(status, filterNow),
      ...(or.length ? { OR: or } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { activations: true } },
      activations: {
        orderBy: { lastHeartbeatAt: 'desc' },
        select: {
          id: true,
          instanceId: true,
          appVersion: true,
          publicBaseUrl: true,
          firstIp: true,
          lastIp: true,
          boundAt: true,
          lastHeartbeatAt: true,
          revokedAt: true,
        },
      },
    },
  });

  // IP-sharing alerts per key (persistent count of ip_alert events).
  const alertCounts = keys.length
    ? await prisma.licenseEvent.groupBy({
        by: ['licenseKeyId'],
        where: { type: 'ip_alert', licenseKeyId: { in: keys.map((k) => k.id) } },
        _count: { _all: true },
      })
    : [];
  const alertsByKey = new Map(alertCounts.map((a) => [a.licenseKeyId, a._count._all]));
  const now = new Date();

  return {
    keys: keys.map((k) => {
      const liveBindings = k.activations.filter((a) => !a.revokedAt);
      const live = liveBindings[0] ?? k.activations[0];
      const distinctIps = new Set(
        k.activations.map((a) => a.lastIp ?? a.firstIp).filter(Boolean) as string[],
      );
      const activeInstances = liveBindings.length;
      const expired = !!k.expiresAt && k.expiresAt <= now;
      const statusReason = k.revokedAt
        ? 'revogada'
        : expired
          ? k.plan === 'paid'
            ? 'licença vencida'
            : 'teste expirado'
          : null;
      return {
        id: k.id,
        plan: k.plan,
        expiresAt: k.expiresAt,
        expired,
        statusReason,
        email: k.email,
        name: k.name,
        provisionedBy: k.provisionedBy,
        revoked: !!k.revokedAt,
        activations: k._count.activations,
        activeInstances,
        distinctIps: distinctIps.size,
        alerts: alertsByKey.get(k.id) ?? 0,
        // Informational warning only — never an automatic block.
        warning: distinctIps.size > 1 || activeInstances > 1,
        lastIp: live?.lastIp ?? null,
        lastHeartbeatAt: live?.lastHeartbeatAt ?? null,
        createdAt: k.createdAt,
        bindings: k.activations,
      };
    }),
  };
});

// ── admin: users (registrations grouped by email) ──
interface UserRow {
  email: string;
  name: string | null;
  keysTotal: number;
  trial: number;
  paid: number;
  active: number;
  expired: number;
  revoked: number;
  alerts: number;
  firstSeen: Date;
  lastRequestAt: Date | null;
}

/** Aggregate license keys (with email) into per-user registration rows. */
async function buildUsers(opts: { q?: string; from?: string; to?: string }): Promise<UserRow[]> {
  const now = new Date();
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (opts.from) createdAt.gte = new Date(opts.from);
  if (opts.to) createdAt.lte = new Date(opts.to);
  const keys = await prisma.licenseKey.findMany({
    where: {
      email: { not: null },
      ...(opts.from || opts.to ? { createdAt } : {}),
      ...(opts.q
        ? {
            OR: [
              { email: { contains: opts.q, mode: 'insensitive' } },
              { name: { contains: opts.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      plan: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      activations: { select: { lastHeartbeatAt: true } },
    },
  });

  const alertGroups = keys.length
    ? await prisma.licenseEvent.groupBy({
        by: ['licenseKeyId'],
        where: { type: 'ip_alert', licenseKeyId: { in: keys.map((k) => k.id) } },
        _count: { _all: true },
      })
    : [];
  const alertsByKey = new Map(alertGroups.map((g) => [g.licenseKeyId, g._count._all]));

  const byEmail = new Map<string, UserRow>();
  for (const k of keys) {
    const email = (k.email as string).toLowerCase();
    let u = byEmail.get(email);
    if (!u) {
      u = {
        email: k.email as string,
        name: k.name,
        keysTotal: 0,
        trial: 0,
        paid: 0,
        active: 0,
        expired: 0,
        revoked: 0,
        alerts: 0,
        firstSeen: k.createdAt,
        lastRequestAt: null,
      };
      byEmail.set(email, u);
    }
    if (!u.name && k.name) u.name = k.name;
    u.keysTotal += 1;
    if (k.plan === 'paid') u.paid += 1;
    else u.trial += 1;
    const expired = !!k.expiresAt && k.expiresAt <= now;
    if (k.revokedAt) u.revoked += 1;
    else if (expired) u.expired += 1;
    else u.active += 1;
    u.alerts += alertsByKey.get(k.id) ?? 0;
    if (k.createdAt < u.firstSeen) u.firstSeen = k.createdAt;
    for (const a of k.activations) {
      if (a.lastHeartbeatAt && (!u.lastRequestAt || a.lastHeartbeatAt > u.lastRequestAt)) {
        u.lastRequestAt = a.lastHeartbeatAt;
      }
    }
  }
  return [...byEmail.values()].sort(
    (a, b) => (b.lastRequestAt?.getTime() ?? 0) - (a.lastRequestAt?.getTime() ?? 0),
  );
}

const UsersQuerySchema = z.object({
  q: z.string().trim().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

app.get('/admin/users', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const query = UsersQuerySchema.safeParse(req.query ?? {});
  if (!query.success) return reply.code(400).send({ error: 'validation' });
  return { users: await buildUsers(query.data) };
});

app.get('/admin/users/export.csv', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const query = UsersQuerySchema.safeParse(req.query ?? {});
  if (!query.success) return reply.code(400).send({ error: 'validation' });
  const users = await buildUsers(query.data);
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [
    'nome,email,data_cadastro,data_ultima_requisicao',
    ...users.map((u) =>
      [
        esc(u.name ?? ''),
        esc(u.email),
        esc(u.firstSeen.toISOString()),
        esc(u.lastRequestAt ? u.lastRequestAt.toISOString() : ''),
      ].join(','),
    ),
  ].join('\n');
  reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', 'attachment; filename="usuarios-wootrico.csv"')
    .send(rows);
});

// One user's registration summary + their keys (license history).
app.get('/admin/users/:email', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const email = decodeURIComponent((req.params as { email: string }).email);
  const now = new Date();
  const keys = await prisma.licenseKey.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { activations: true } },
      activations: {
        orderBy: { lastHeartbeatAt: 'desc' },
        select: { lastHeartbeatAt: true, lastIp: true, firstIp: true, revokedAt: true },
      },
    },
  });
  if (keys.length === 0) return reply.code(404).send({ error: 'not_found' });
  const alertGroups = await prisma.licenseEvent.groupBy({
    by: ['licenseKeyId'],
    where: { type: 'ip_alert', licenseKeyId: { in: keys.map((k) => k.id) } },
    _count: { _all: true },
  });
  const alertsByKey = new Map(alertGroups.map((g) => [g.licenseKeyId, g._count._all]));
  const name = keys.find((k) => k.name)?.name ?? null;
  let firstSeen = keys[0]!.createdAt;
  let lastRequestAt: Date | null = null;
  const keyRows = keys.map((k) => {
    if (k.createdAt < firstSeen) firstSeen = k.createdAt;
    const live = k.activations.filter((a) => !a.revokedAt);
    for (const a of k.activations) {
      if (a.lastHeartbeatAt && (!lastRequestAt || a.lastHeartbeatAt > lastRequestAt)) {
        lastRequestAt = a.lastHeartbeatAt;
      }
    }
    const expired = !!k.expiresAt && k.expiresAt <= now;
    return {
      id: k.id,
      plan: k.plan,
      status: k.revokedAt ? 'revoked' : expired ? 'expired' : 'active',
      statusReason: k.revokedAt
        ? 'revogada'
        : expired
          ? k.plan === 'paid'
            ? 'licença vencida'
            : 'teste expirado'
          : null,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      activeInstances: live.length,
      lastHeartbeatAt: live[0]?.lastHeartbeatAt ?? k.activations[0]?.lastHeartbeatAt ?? null,
      alerts: alertsByKey.get(k.id) ?? 0,
    };
  });
  return {
    user: {
      email: keys.find((k) => k.email)?.email ?? email,
      name,
      keysTotal: keys.length,
      firstSeen,
      lastRequestAt,
    },
    keys: keyRows,
  };
});

app.post('/admin/keys/:id/revoke', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  await prisma.licenseKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await recordEvent({ type: 'admin_revoke', licenseKeyId: id });
  return { ok: true };
});

app.post('/admin/keys/:id/activate', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  await prisma.licenseKey.update({ where: { id }, data: { revokedAt: null } });
  await recordEvent({ type: 'admin_activate', licenseKeyId: id });
  return { ok: true };
});

// Convert a key to PAID — e.g. after an offline/manual sale. Gets the standard
// paid window (1 year by default; the admin can then adjust via set-expiry).
// Clears any revocation. There is NO lifetime option.
app.post('/admin/keys/:id/upgrade', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  const expiresAt = new Date(Date.now() + cfg.paidDays * DAY_MS);
  await prisma.licenseKey.update({
    where: { id },
    data: { plan: 'paid', expiresAt, revokedAt: null },
  });
  await recordEvent({
    type: 'admin_upgrade',
    licenseKeyId: id,
    meta: { expiresAt: expiresAt.toISOString() },
  });
  return { ok: true };
});

// Reactivate an expired/revoked TRIAL: give it a fresh window (+trialDays) and
// clear any revocation. The customer's instance (polling faster while blocked)
// picks the renewed trial back up on its next validation. Stays a trial — only
// `/upgrade` (or a payment) turns it into a paid key.
app.post('/admin/keys/:id/reactivate-trial', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  const lk = await prisma.licenseKey.findUnique({ where: { id } });
  if (!lk) return reply.code(404).send({ error: 'not_found' });
  if (lk.plan !== 'trial') return reply.code(400).send({ error: 'not_trial' });
  await prisma.licenseKey.update({
    where: { id },
    data: { expiresAt: new Date(Date.now() + cfg.trialDays * DAY_MS), revokedAt: null },
  });
  await recordEvent({ type: 'admin_reactivate_trial', licenseKeyId: id });
  return { ok: true };
});

// Set/override a PAID key's expiry date — the admin can push it out or shorten it.
// A date is REQUIRED (no lifetime/null): every key always has an expiry.
const SetExpirySchema = z.object({ expiresAt: z.string().datetime() });
app.post('/admin/keys/:id/set-expiry', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  const p = SetExpirySchema.safeParse(req.body ?? {});
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const expiresAt = new Date(p.data.expiresAt);
  await prisma.licenseKey.update({ where: { id }, data: { expiresAt } });
  await recordEvent({
    type: 'admin_set_expiry',
    licenseKeyId: id,
    meta: { expiresAt: expiresAt.toISOString() },
  });
  return { ok: true };
});

// Delete a key permanently — only when it's NOT active (expired or revoked), so an
// in-use customer key can't be removed by accident. Activations cascade; payments
// and events are kept for audit.
app.delete('/admin/keys/:id', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  const lk = await prisma.licenseKey.findUnique({ where: { id } });
  if (!lk) return reply.code(404).send({ error: 'not_found' });
  if (keyStatus(lk, new Date()).active) return reply.code(400).send({ error: 'key_active' });
  await recordEvent({ type: 'admin_delete', licenseKeyId: id, meta: { email: lk.email, plan: lk.plan } });
  await prisma.licenseKey.delete({ where: { id } });
  return { ok: true };
});

// ── admin: payments history (per-user via ?q, per-key via ?keyId, or all) ──
const PaymentsQuerySchema = z.object({
  q: z.string().trim().optional(),
  keyId: z.string().optional(),
  kind: z.enum(['purchase', 'renewal', 'refund', 'chargeback', 'cancel']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  before: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
app.get('/admin/payments', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const q = PaymentsQuerySchema.safeParse(req.query ?? {});
  if (!q.success) return reply.code(400).send({ error: 'validation' });
  const { q: email, keyId, kind, from, to, before, limit } = q.data;
  const take = limit ?? 50;

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) createdAt.gte = new Date(from);
  if (to) createdAt.lte = new Date(to);
  if (before) createdAt.lte = new Date(before);

  const rows = await prisma.payment.findMany({
    where: {
      ...(email ? { email: { contains: email, mode: 'insensitive' } } : {}),
      ...(keyId ? { licenseKeyId: keyId } : {}),
      ...(kind ? { kind } : {}),
      ...(from || to || before ? { createdAt } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    select: {
      id: true,
      transaction: true,
      provider: true,
      event: true,
      kind: true,
      status: true,
      email: true,
      instanceId: true,
      licenseKeyId: true,
      amount: true,
      currency: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  const hasMore = rows.length > take;
  const payments = hasMore ? rows.slice(0, take) : rows;
  const nextBefore = hasMore ? payments[payments.length - 1]!.createdAt.toISOString() : null;
  return { payments, nextBefore };
});

// ── admin: payments dashboard (totals + 30-day revenue/volume series) ──
app.get('/admin/payments/summary', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const now = new Date();
  const since = new Date(now.getTime() - 29 * DAY_MS);
  const soon = new Date(now.getTime() + 30 * DAY_MS);
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);

  const [purchases, renewals, refunds, paidActive, expiringSoon, revenueAgg, applied] = await Promise.all([
    prisma.payment.count({ where: { kind: 'purchase', status: 'applied' } }),
    prisma.payment.count({ where: { kind: 'renewal', status: 'applied' } }),
    prisma.payment.count({ where: { kind: { in: ['refund', 'chargeback', 'cancel'] }, status: 'applied' } }),
    prisma.licenseKey.count({ where: { plan: 'paid', ...liveKeyFilter(now) } }),
    prisma.licenseKey.count({ where: { plan: 'paid', revokedAt: null, expiresAt: { gt: now, lte: soon } } }),
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { status: 'applied', kind: { in: ['purchase', 'renewal'] } },
    }),
    prisma.payment.findMany({
      where: { status: 'applied', kind: { in: ['purchase', 'renewal'] }, createdAt: { gte: since } },
      select: { amount: true, kind: true, createdAt: true },
    }),
  ]);

  // 30-day series: count + revenue per day.
  const blank = (): { day: string; count: number; revenue: number }[] => {
    const out: { day: string; count: number; revenue: number }[] = [];
    for (let i = 0; i < 30; i++)
      out.push({ day: dayKey(new Date(since.getTime() + i * DAY_MS)), count: 0, revenue: 0 });
    return out;
  };
  const series = blank();
  const idx = new Map(series.map((b, i) => [b.day, i]));
  for (const r of applied) {
    const i = idx.get(dayKey(r.createdAt));
    if (i !== undefined) {
      series[i]!.count += 1;
      series[i]!.revenue += r.amount ?? 0;
    }
  }

  return {
    totals: {
      revenue: revenueAgg._sum.amount ?? 0,
      payments: purchases + renewals,
      purchases,
      renewals,
      refunds,
      paidActive,
      expiringSoon,
    },
    series,
  };
});

// Manually expire a key NOW (trial OR paid) — forces the client to revalidate
// (trial → buy; paid → renew). Sets the expiry to now.
const ExpireKeySchema = z.object({ reason: z.string().trim().max(300).optional() });
app.post('/admin/keys/:id/expire', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  const p = ExpireKeySchema.safeParse(req.body ?? {});
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const lk = await prisma.licenseKey.findUnique({ where: { id } });
  if (!lk) return reply.code(404).send({ error: 'not_found' });
  await prisma.licenseKey.update({ where: { id }, data: { expiresAt: new Date() } });
  await recordEvent({ type: 'admin_expire', licenseKeyId: id, meta: { reason: p.data.reason ?? null } });
  return { ok: true };
});

// Full detail for one key: data + bindings (IP history). Events via /admin/keys/:id/events.
app.get('/admin/keys/:id', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  const now = new Date();
  const k = await prisma.licenseKey.findUnique({
    where: { id },
    include: {
      _count: { select: { activations: true } },
      activations: {
        orderBy: { lastHeartbeatAt: 'desc' },
        select: {
          id: true,
          instanceId: true,
          appVersion: true,
          publicBaseUrl: true,
          firstIp: true,
          lastIp: true,
          boundAt: true,
          lastHeartbeatAt: true,
          revokedAt: true,
        },
      },
    },
  });
  if (!k) return reply.code(404).send({ error: 'not_found' });
  const liveBindings = k.activations.filter((a) => !a.revokedAt);
  const distinctIps = new Set(
    k.activations.map((a) => a.lastIp ?? a.firstIp).filter(Boolean) as string[],
  );
  const expired = !!k.expiresAt && k.expiresAt <= now;
  const reasonText = k.plan === 'paid' ? 'licença vencida' : 'teste expirado';
  const alerts = await prisma.licenseEvent.count({ where: { type: 'ip_alert', licenseKeyId: id } });
  const status = k.revokedAt ? 'revoked' : expired ? 'expired' : 'active';
  return {
    key: {
      id: k.id,
      plan: k.plan,
      status,
      statusReason: k.revokedAt ? 'revogada' : expired ? reasonText : null,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      email: k.email,
      name: k.name,
      provisionedBy: k.provisionedBy,
      createdAt: k.createdAt,
      activations: k._count.activations,
      activeInstances: liveBindings.length,
      distinctIps: distinctIps.size,
      alerts,
    },
    bindings: k.activations,
  };
});

// ── admin: webhook keys (payment provider authentication) ──
const CreateWebhookKeySchema = z.object({ name: z.string().trim().min(1).max(120).optional() });

app.post('/admin/webhook-keys', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const p = CreateWebhookKeySchema.safeParse(req.body ?? {});
  if (!p.success) return reply.code(400).send({ error: 'validation' });
  const raw = generateWebhookKey();
  const created = await prisma.webhookKey.create({
    data: { keyHash: hashKey(raw), name: p.data.name },
  });
  return reply.code(201).send({ id: created.id, key: raw });
});

app.get('/admin/webhook-keys', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const rows = await prisma.webhookKey.findMany({ orderBy: { createdAt: 'desc' } });
  return {
    keys: rows.map((w) => ({
      id: w.id,
      name: w.name,
      revoked: !!w.revokedAt,
      lastUsedAt: w.lastUsedAt,
      createdAt: w.createdAt,
    })),
  };
});

app.post('/admin/webhook-keys/:id/revoke', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  await prisma.webhookKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return { ok: true };
});

const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  before: z.string().optional(),
  keyId: z.string().optional(),
  type: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

app.get('/admin/events', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const q = EventsQuerySchema.safeParse(req.query ?? {});
  if (!q.success) return reply.code(400).send({ error: 'validation' });
  const limit = q.data.limit ?? 50;
  const before = q.data.before ? new Date(q.data.before) : undefined;
  const createdAt: { lt?: Date; gte?: Date; lte?: Date } = {};
  if (before) createdAt.lt = before;
  if (q.data.from) createdAt.gte = new Date(q.data.from);
  if (q.data.to) createdAt.lte = new Date(q.data.to);
  const events = await prisma.licenseEvent.findMany({
    where: {
      ...(q.data.keyId ? { licenseKeyId: q.data.keyId } : {}),
      ...(q.data.type ? { type: q.data.type } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });
  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  return {
    events: page,
    nextBefore: hasMore ? page[page.length - 1]?.createdAt.toISOString() : null,
  };
});

// ── admin: server settings (singleton) ──
// Vendor-configurable settings edited from the admin panel. Currently holds the
// log-retention window that drives the periodic purge (null = keep forever).
const SettingsSchema = z.object({
  logRetentionDays: z.number().int().positive().nullable(),
  checkoutUrl: z.string().url().nullable().optional(),
  hotmartHottok: z.string().trim().max(200).nullable().optional(),
  hotmartProductId: z.string().trim().max(100).nullable().optional(),
  supportWhatsapp: z.string().trim().max(30).nullable().optional(),
});

app.get('/admin/settings', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const s = await prisma.serverSettings.findUnique({ where: { id: 'singleton' } });
  return {
    logRetentionDays: s?.logRetentionDays ?? null,
    checkoutUrl: s?.checkoutUrl ?? null,
    hotmartHottok: s?.hotmartHottok ?? null,
    hotmartProductId: s?.hotmartProductId ?? null,
    supportWhatsapp: s?.supportWhatsapp ?? null,
    // Defaults coming from env, shown as placeholders / "active fallback" hints.
    envDefaults: {
      checkoutUrl: cfg.checkoutUrl,
      hotmartHottokSet: !!cfg.hotmartHottok,
      hotmartProductId: cfg.hotmartProductId ?? null,
      supportWhatsapp: cfg.supportWhatsapp ?? null,
    },
  };
});

app.put('/admin/settings', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const body = SettingsSchema.safeParse(req.body ?? {});
  if (!body.success) return reply.code(400).send({ error: 'validation' });
  // Normalize empty strings to null (so they fall back to env).
  const norm = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const data = {
    logRetentionDays: body.data.logRetentionDays,
    checkoutUrl: norm(body.data.checkoutUrl),
    hotmartHottok: norm(body.data.hotmartHottok),
    hotmartProductId: norm(body.data.hotmartProductId),
    supportWhatsapp: norm(body.data.supportWhatsapp),
  };
  await prisma.serverSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...data },
    update: data,
  });
  return { ok: true };
});

app.get('/admin/keys/:id/events', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const { id } = req.params as { id: string };
  const events = await prisma.licenseEvent.findMany({
    where: { licenseKeyId: id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { events };
});

// ── admin: health/detection (license abuse signals) ──
// Surfaces (a) live instances that STOPPED validating (possible tampered client
// that no longer phones home, or just offline) and (b) keys seen from multiple
// IPs (possible sharing). Detection, not prevention — for the vendor to act on.
const HealthQuerySchema = z.object({ staleHours: z.coerce.number().int().positive().max(720).optional() });
app.get('/admin/health', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const q = HealthQuerySchema.safeParse(req.query ?? {});
  if (!q.success) return reply.code(400).send({ error: 'validation' });
  const now = new Date();
  const staleHours = q.data.staleHours ?? 24;
  const cutoff = new Date(now.getTime() - staleHours * 60 * 60 * 1000);

  // Live bindings (active key, not revoked) that haven't validated since cutoff.
  const staleRows = await prisma.activation.findMany({
    where: {
      revokedAt: null,
      licenseKey: liveKeyFilter(now),
      OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null }],
    },
    include: { licenseKey: true },
    orderBy: { lastHeartbeatAt: 'asc' },
    take: 200,
  });
  const stale = staleRows.map((a) => ({
    licenseKeyId: a.licenseKeyId,
    instanceId: a.instanceId,
    email: a.licenseKey.email,
    name: a.licenseKey.name,
    plan: a.licenseKey.plan,
    appVersion: a.appVersion,
    lastIp: a.lastIp,
    lastHeartbeatAt: a.lastHeartbeatAt,
    boundAt: a.boundAt,
  }));

  // Keys with IP-sharing alerts (grouped, with last occurrence + count).
  const alertGroups = await prisma.licenseEvent.groupBy({
    by: ['licenseKeyId'],
    where: { type: 'ip_alert' },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const alertKeyIds = alertGroups.map((g) => g.licenseKeyId).filter(Boolean) as string[];
  const alertKeys = alertKeyIds.length
    ? await prisma.licenseKey.findMany({ where: { id: { in: alertKeyIds } } })
    : [];
  const alertKeyById = new Map(alertKeys.map((k) => [k.id, k]));
  const ipAlerts = alertGroups
    .filter((g) => g.licenseKeyId)
    .map((g) => {
      const k = alertKeyById.get(g.licenseKeyId as string);
      return {
        licenseKeyId: g.licenseKeyId,
        email: k?.email ?? null,
        name: k?.name ?? null,
        alerts: g._count._all,
        lastAlertAt: g._max.createdAt,
      };
    })
    .sort((a, b) => (b.lastAlertAt?.getTime() ?? 0) - (a.lastAlertAt?.getTime() ?? 0));

  // Active-key counts (live = not revoked, paid or trial-not-expired).
  const [activeKeys, trialActive, paidActive] = await Promise.all([
    prisma.licenseKey.count({ where: liveKeyFilter(now) }),
    prisma.licenseKey.count({ where: { ...liveKeyFilter(now), plan: 'trial' } }),
    prisma.licenseKey.count({ where: { plan: 'paid', revokedAt: null } }),
  ]);

  return {
    staleHours,
    summary: {
      staleInstances: stale.length,
      keysWithIpAlerts: ipAlerts.length,
      activeKeys,
      trialActive,
      paidActive,
    },
    stale,
    ipAlerts,
  };
});

// ── admin: dashboard stats (totals + 30-day series) ──
app.get('/admin/stats', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;
  const since = new Date(now.getTime() - 29 * DAY); // 30 buckets incl. today
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);

  const [keys, paid, revoked, activeInstances, distinctUsers, ipAlertCount] = await Promise.all([
    prisma.licenseKey.count(),
    prisma.licenseKey.count({ where: { plan: 'paid' } }),
    prisma.licenseKey.count({ where: { revokedAt: { not: null } } }),
    prisma.activation.count({ where: { revokedAt: null } }),
    prisma.licenseKey.findMany({ where: { email: { not: null } }, distinct: ['email'], select: { id: true } }),
    prisma.licenseEvent.count({ where: { type: 'ip_alert' } }),
  ]);
  const [activeKeys, expired] = await Promise.all([
    prisma.licenseKey.count({ where: liveKeyFilter(now) }),
    prisma.licenseKey.count({ where: { revokedAt: null, expiresAt: { lte: now } } }),
  ]);
  const trial = keys - paid;

  // Empty 30-day buckets.
  const blank = (): { day: string; count: number }[] => {
    const out: { day: string; count: number }[] = [];
    for (let i = 0; i < 30; i++) out.push({ day: dayKey(new Date(since.getTime() + i * DAY)), count: 0 });
    return out;
  };
  const tally = (series: { day: string; count: number }[], rows: { createdAt: Date }[]) => {
    const idx = new Map(series.map((b, i) => [b.day, i]));
    for (const r of rows) {
      const i = idx.get(dayKey(r.createdAt));
      if (i !== undefined) series[i]!.count += 1;
    }
    return series;
  };

  const [keyRows, validateRows, paymentRows] = await Promise.all([
    prisma.licenseKey.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.licenseEvent.findMany({
      where: { type: 'validate', createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.licenseEvent.findMany({
      where: { type: 'payment_confirmed', createdAt: { gte: since } },
      select: { createdAt: true },
    }),
  ]);

  return {
    totals: {
      keys,
      active: activeKeys,
      trial,
      paid,
      expired,
      revoked,
      users: distinctUsers.length,
      activeInstances,
      ipAlerts: ipAlertCount,
    },
    series: {
      keysPerDay: tally(blank(), keyRows),
      validationsPerDay: tally(blank(), validateRows),
      paymentsPerDay: tally(blank(), paymentRows),
    },
  };
});

// ── admin: server process logs (in-memory ring buffer) ──
const ServerLogsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  level: z.coerce.number().int().optional(),
});
app.get('/admin/server-logs', async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const q = ServerLogsQuerySchema.safeParse(req.query ?? {});
  if (!q.success) return reply.code(400).send({ error: 'validation' });
  return { entries: recentLogs(q.data.limit ?? 200, q.data.level) };
});

// ── Google identity broker (optional) ──
// A single OAuth client lives here (vendor domain). Customer instances open a
// popup to /auth/google; after consent we store the verified email+name keyed by
// an unguessable nonce, and the instance POLLS /auth/google/result?nonce to pick
// it up (robust against COOP severing window.opener after the OAuth redirect).
const googleEnabled = (): boolean => !!(cfg.googleClientId && cfg.googleClientSecret);
const htmlPage = (body: string) =>
  `<!doctype html><meta charset="utf-8"><body style="background:#0a0a0a;color:#aaa;font-family:system-ui,sans-serif;padding:40px">${body}</body>`;

const GOOGLE_RESULT_TTL = 5 * 60 * 1000;
const googleResults = new Map<string, { email: string; name: string; at: number }>();
function pruneGoogleResults(): void {
  const now = Date.now();
  for (const [k, v] of googleResults) if (now - v.at > GOOGLE_RESULT_TTL) googleResults.delete(k);
}

app.get('/auth/google/config', async (_req, reply) => {
  // Public boolean — readable cross-origin so customer panels can feature-detect.
  reply.header('access-control-allow-origin', '*');
  return { enabled: googleEnabled() };
});

app.get('/auth/google', async (req, reply) => {
  if (!googleEnabled()) {
    return reply.type('text/html').send(htmlPage('Login com Google não está configurado neste servidor.'));
  }
  const { origin = '', nonce = '' } = req.query as { origin?: string; nonce?: string };
  const redirectUri = `https://${req.headers.host}/auth/google/callback`;
  const state = Buffer.from(JSON.stringify({ origin, nonce })).toString('base64url');
  const params = new URLSearchParams({
    client_id: cfg.googleClientId as string,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Customer instance polls this (cross-origin) to pick up the Google identity.
app.get('/auth/google/result', async (req, reply) => {
  reply.header('access-control-allow-origin', '*');
  pruneGoogleResults();
  const nonce = (req.query as { nonce?: string }).nonce ?? '';
  const r = nonce ? googleResults.get(nonce) : undefined;
  if (!r) return { pending: true };
  googleResults.delete(nonce);
  return { email: r.email, name: r.name };
});

app.get('/auth/google/callback', async (req, reply) => {
  reply.type('text/html');
  if (!googleEnabled()) return reply.send(htmlPage('Login com Google não está configurado.'));
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code) return reply.send(htmlPage('Login cancelado. Pode fechar esta janela.'));
  let origin = '';
  let nonce = '';
  try {
    const s = JSON.parse(Buffer.from(state ?? '', 'base64url').toString()) as { origin?: string; nonce?: string };
    origin = s.origin ?? '';
    nonce = s.nonce ?? '';
  } catch {
    /* ignore */
  }
  const redirectUri = `https://${req.headers.host}/auth/google/callback`;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.googleClientId as string,
        client_secret: cfg.googleClientSecret as string,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tok = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!tok.access_token) {
      logger.warn({ err: tok.error, desc: tok.error_description }, 'google token exchange failed');
      return reply.send(htmlPage('Falha na autenticação com o Google. Pode fechar esta janela.'));
    }
    const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    const ui = (await uiRes.json()) as { email?: string; name?: string; email_verified?: boolean };
    if (!ui.email) {
      logger.warn('google userinfo returned no email');
      return reply.send(htmlPage('Não foi possível obter o e-mail da conta Google.'));
    }
    if (nonce) {
      pruneGoogleResults();
      googleResults.set(nonce, { email: ui.email, name: ui.name ?? '', at: Date.now() });
    }
    logger.info({ email: ui.email }, 'google login ok');
    // postMessage is best-effort (often blocked by COOP); polling is the reliable path.
    const payload = JSON.stringify({ source: 'wootrico-google', email: ui.email, name: ui.name ?? '' });
    const target = JSON.stringify(origin || '*');
    return reply.send(
      htmlPage(
        `Autenticado com sucesso. Pode fechar esta janela.<script>try{window.opener&&window.opener.postMessage(${payload},${target});}catch(e){}setTimeout(function(){window.close();},1200);</script>`,
      ),
    );
  } catch (err) {
    logger.warn({ err }, 'google callback error');
    return reply.send(htmlPage('Erro ao autenticar com o Google.'));
  }
});

// ── admin SPA (license-admin-web build) ──
// Registered LAST so API routes take precedence. No-op in dev (the admin SPA
// runs on its own Vite dev server). Resolved from process.cwd() to work in both
// dev (cwd=apps/license-server) and prod (cwd=/app, the Docker workdir).
async function registerAdminSpa(): Promise<void> {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, 'apps/license-admin-web/dist'),
    resolve(cwd, '../license-admin-web/dist'),
    resolve(cwd, 'license-admin-web/dist'),
  ];
  const root = candidates.find((p) => existsSync(join(p, 'index.html')));
  if (!root) {
    logger.warn('license-admin-web build not found; admin SPA will not be served (dev mode).');
    return;
  }
  await app.register(fastifyStatic, { root, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (
      req.url.startsWith('/admin/') ||
      req.url.startsWith('/activate') ||
      req.url.startsWith('/heartbeat') ||
      req.url.startsWith('/validate') ||
      req.url.startsWith('/deactivate') ||
      req.url.startsWith('/provision') ||
      req.url.startsWith('/purchase-intent') ||
      req.url.startsWith('/webhook/') ||
      req.url.startsWith('/health')
    ) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });
}

// ── periodic log purge ──
// Deletes license_events and heartbeat_log older than the configured retention
// window. null = keep forever (no deletion). Runs hourly and once at startup.
const LOG_PURGE_MS = 60 * 60 * 1000;

async function runLogPurge(): Promise<void> {
  const s = await prisma.serverSettings.findUnique({ where: { id: 'singleton' } });
  const days = s?.logRetentionDays ?? null;
  if (days == null || days <= 0) return;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const [events, heartbeats] = await prisma.$transaction([
    prisma.licenseEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.heartbeatLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  if (events.count || heartbeats.count)
    logger.info(
      { licenseEvents: events.count, heartbeats: heartbeats.count, days },
      'log retention purge complete',
    );
}

async function main() {
  try {
    await registerAdminSpa();
    await app.listen({ port: cfg.port, host: cfg.host });
    void runLogPurge().catch((err) => logger.warn(err, 'log purge failed'));
    const purgeTimer = setInterval(
      () => void runLogPurge().catch((err) => logger.warn(err, 'log purge failed')),
      LOG_PURGE_MS,
    );
    purgeTimer.unref?.();
  } catch (err) {
    logger.error(err, 'license-server failed to start');
    process.exit(1);
  }
}
void main();
