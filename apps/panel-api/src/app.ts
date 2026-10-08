import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { logger } from '@wootrico/config';

import prismaPlugin from './plugins/prisma.js';
import authJwtPlugin from './plugins/auth-jwt.js';
import staticSpaPlugin from './plugins/static-spa.js';

import healthRoutes from './routes/health.js';
import setupRoutes from './routes/setup.js';
import authRoutes from './routes/auth.js';
import integrationRoutes from './routes/integrations.js';
import contactRoutes from './routes/contacts.js';
import conversationRoutes from './routes/conversations.js';
import licenseRoutes from './routes/license.js';
import systemRoutes from './routes/system.js';
import mediaRoutes from './routes/media.js';
import webhookRoutes from './routes/webhooks.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 25 * 1024 * 1024, // 25MB for media-bearing webhooks
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: true });

  // API responses are dynamic — never let the browser/proxy cache them.
  // (Cached GET /api/setup/status caused the setup wizard to loop.)
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  // Tolerate bodyless POSTs and any content-type (best-effort JSON). Replaces the
  // strict default JSON parser that rejects empty bodies. Buffers the raw BYTES
  // and decodes UTF-8 only at the end — concatenating chunks as strings would
  // corrupt multi-byte chars (e.g. "ú") split across chunk boundaries (→ "��").
  const jsonParser = (_req: unknown, payload: NodeJS.ReadableStream, done: (e: Error | null, body?: unknown) => void) => {
    const chunks: Buffer[] = [];
    payload.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    payload.on('error', () => done(null, {}));
    payload.on('end', () => {
      try {
        const data = Buffer.concat(chunks).toString('utf8');
        done(null, data ? JSON.parse(data) : {});
      } catch {
        done(null, {});
      }
    });
  };
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('*', jsonParser as never);

  // Core plugins
  await app.register(prismaPlugin);
  await app.register(authJwtPlugin);

  // API routes
  await app.register(healthRoutes);
  await app.register(setupRoutes);
  await app.register(authRoutes);
  await app.register(integrationRoutes);
  await app.register(contactRoutes);
  await app.register(conversationRoutes);
  await app.register(licenseRoutes);
  await app.register(systemRoutes);
  await app.register(mediaRoutes);
  await app.register(webhookRoutes);

  // SPA (must be last; owns the not-found fallback)
  await app.register(staticSpaPlugin);

  return app;
}
