import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyPassword } from '../lib/password.js';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    }
    const { email, password } = parsed.data;

    const user = await app.prisma.adminUser.findUnique({ where: { email } });
    if (!user || !user.isActive || !user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    await app.prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  app.get('/api/auth/me', { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = req.user;
    const user = await app.prisma.adminUser.findUnique({ where: { id: sub } });
    if (!user) return { user: { id: sub, email: req.user.email, name: null, role: req.user.role } };
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });
}
