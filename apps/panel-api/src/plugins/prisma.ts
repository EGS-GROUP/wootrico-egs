import fp from 'fastify-plugin';
import { prisma, type PrismaClient } from '@wootrico/db';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/** Exposes the shared Prisma client on the Fastify instance. */
export default fp(async (app) => {
  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
