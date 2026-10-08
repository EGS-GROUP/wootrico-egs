import { env, logger } from '@wootrico/config';
import { applyConnectionOverrides } from '@wootrico/db/conn';
import { buildApp } from './app.js';

async function main() {
  // Apply any stored RabbitMQ/Redis overrides before connections are opened.
  await applyConnectionOverrides().catch((err) =>
    logger.warn({ err }, 'failed to apply connection overrides; using env'),
  );

  const app = await buildApp();

  const close = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    logger.error(err, 'failed to start');
    process.exit(1);
  }
}

void main();
