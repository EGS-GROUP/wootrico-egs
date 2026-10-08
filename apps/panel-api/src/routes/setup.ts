import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../lib/password.js';

const CreateAdminSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export default async function setupRoutes(app: FastifyInstance) {
  // Onboarding status — drives the first-run wizard gate.
  app.get('/api/setup/status', async () => {
    const [adminCount, settings] = await Promise.all([
      app.prisma.adminUser.count(),
      app.prisma.appSettings.findUnique({ where: { id: 'singleton' } }),
    ]);
    return {
      hasAdmin: adminCount > 0,
      setupCompleted: settings?.setupCompleted ?? false,
    };
  });

  // Create the FIRST admin (only allowed when none exists).
  app.post('/api/setup/admin', async (req, reply) => {
    const parsed = CreateAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    }

    const existing = await app.prisma.adminUser.count();
    if (existing > 0) {
      return reply.code(409).send({ error: 'admin_already_exists' });
    }

    const { name, email, password } = parsed.data;
    const user = await app.prisma.adminUser.create({
      data: { name, email, passwordHash: await hashPassword(password), role: 'owner' },
    });

    // Ensure singletons exist.
    await app.prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
    await app.prisma.licenseState.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });

    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return reply.code(201).send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  // Wizard: set the public base URL (used to build webhook URLs).
  const BaseUrlSchema = z.object({ publicBaseUrl: z.string().url() });
  app.post('/api/setup/base-url', { onRequest: [app.authenticate] }, async (req, reply) => {
    const p = BaseUrlSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'validation' });
    const publicBaseUrl = p.data.publicBaseUrl.replace(/\/$/, '');
    await app.prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', publicBaseUrl },
      update: { publicBaseUrl },
    });
    return { publicBaseUrl };
  });

  // Wizard: mark onboarding complete.
  app.post('/api/setup/complete', { onRequest: [app.authenticate] }, async () => {
    await app.prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', setupCompleted: true },
      update: { setupCompleted: true },
    });
    return { setupCompleted: true };
  });
}
