import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  activateLicense,
  provisionLicense,
  deactivateLicense,
  requestPurchase,
  evaluateLicense,
  getLicenseState,
  runHeartbeat,
  submitSupportTicket,
  LicenseError,
} from '@wootrico/license-client';

const ActivateSchema = z.object({ licenseKey: z.string().min(1) });

export default async function licenseRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  app.get('/api/license/status', guard, async () => {
    const status = await evaluateLicense();
    const state = await getLicenseState();
    // The license is valid but the last check couldn't reach the server. We
    // surface this so the panel can reassure the user (the key stays active) —
    // an unreachable server never blocks. Not "offline" when the server gave an
    // explicit answer (blocked) or the instance was never activated.
    const offline = (status === 'active' || status === 'warning') && !!state.lastError;
    // When blocked, WHY — so the panel shows the right message and CTA. An
    // explicit server reason (expired/revoked/inactive) means the customer should
    // buy/renew; anything else (network error / 48h stale) is a connectivity
    // "offline" block that recovers on its own.
    const REASONS: Record<string, 'expired' | 'revoked' | 'inactive'> = {
      expired: 'expired',
      trial_expired: 'expired',
      revoked: 'revoked',
      invalid_key: 'inactive',
      inactive: 'inactive',
    };
    const blockedReason =
      status === 'blocked' ? (REASONS[state.lastError ?? ''] ?? 'offline') : null;
    return {
      status,
      instanceId: state.instanceId,
      plan: state.plan,
      expiresAt: state.expiresAt,
      features: state.features ?? {},
      lastValidatedAt: state.lastValidatedAt,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastError: state.lastError,
      offline,
      blockedReason,
      supportWhatsapp: state.supportWhatsapp ?? null,
      serverUrl: process.env.LICENSE_SERVER_URL,
    };
  });

  // Open a support ticket on the license server. Always registers; the panel
  // decides whether to redirect to WhatsApp based on the license status.
  const SupportSchema = z.object({ message: z.string().trim().min(1).max(5000) });
  app.post('/api/support/ticket', guard, async (req, reply) => {
    const p = SupportSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'validation' });
    const user = await app.prisma.adminUser.findUnique({ where: { id: req.user.sub } });
    try {
      const res = await submitSupportTicket(p.data.message, user?.email ?? req.user.email ?? null);
      return res;
    } catch (err) {
      if (err instanceof LicenseError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/api/license/activate', guard, async (req, reply) => {
    const p = ActivateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'validation' });
    try {
      const result = await activateLicense(p.data.licenseKey);
      await app.prisma.auditLog.create({
        data: { adminUserId: req.user.sub, action: 'license.activated', entityType: 'license' },
      });
      return result;
    } catch (err) {
      if (err instanceof LicenseError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // Self-service: provision + bind a key. Name + e-mail are REQUIRED for the
  // initial registration of an instance — taken from the request, falling back
  // to the logged-in admin's identity. Reject when neither is available.
  const ProvisionSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email().optional(),
  });
  app.post('/api/license/provision', guard, async (req, reply) => {
    const p = ProvisionSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: 'validation' });
    const user = await app.prisma.adminUser.findUnique({ where: { id: req.user.sub } });
    const name = p.data.name ?? user?.name ?? null;
    const email = p.data.email ?? user?.email ?? req.user.email ?? null;
    if (!name || !email) {
      return reply.code(400).send({ error: 'name_email_required' });
    }
    try {
      const result = await provisionLicense({ name, email });
      await app.prisma.auditLog.create({
        data: { adminUserId: req.user.sub, action: 'license.provisioned', entityType: 'license' },
      });
      return result;
    } catch (err) {
      if (err instanceof LicenseError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // Register a purchase intent for this installation and return the checkout URL.
  app.post('/api/license/purchase', guard, async (req, reply) => {
    const user = await app.prisma.adminUser.findUnique({ where: { id: req.user.sub } });
    try {
      const result = await requestPurchase(user?.email ?? req.user.email ?? null);
      await app.prisma.auditLog.create({
        data: { adminUserId: req.user.sub, action: 'license.purchase_requested', entityType: 'license' },
      });
      return result;
    } catch (err) {
      if (err instanceof LicenseError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/api/license/heartbeat', guard, async () => {
    return runHeartbeat();
  });

  app.post('/api/license/deactivate', guard, async (req, reply) => {
    await deactivateLicense();
    await app.prisma.auditLog.create({
      data: { adminUserId: req.user.sub, action: 'license.deactivated', entityType: 'license' },
    });
    return reply.code(204).send();
  });
}
