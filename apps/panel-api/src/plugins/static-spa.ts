import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Serves the built React SPA (apps/panel-web/dist) with SPA fallback.
 * No-op in dev (the SPA runs on the Vite dev server). API and webhook
 * routes are registered before this and take precedence.
 *
 * Resolved from process.cwd() so it works in both dev (cwd=apps/panel-api)
 * and prod (cwd=/app, the Docker workdir).
 */
export default fp(async (app) => {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, 'apps/panel-web/dist'), // prod: run from repo root
    resolve(cwd, '../panel-web/dist'), // dev: run from apps/panel-api
    resolve(cwd, 'panel-web/dist'),
  ];
  const root = candidates.find((p) => existsSync(join(p, 'index.html')));

  if (!root) {
    app.log.warn('panel-web build not found; SPA will not be served (dev mode).');
    return;
  }

  await app.register(fastifyStatic, { root, prefix: '/' });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/webhook')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });
});
