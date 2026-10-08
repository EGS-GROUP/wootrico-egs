import { logger, AMQP, LICENSE } from '@wootrico/config';
import { prisma } from '@wootrico/db';
import { applyConnectionOverrides } from '@wootrico/db/conn';
import { consume, closeQueue } from '@wootrico/queue';
import { closeRedis } from '@wootrico/cache';
import { assertLicenseActive, maybeRunHeartbeat } from '@wootrico/license-client';
import { handleInbound } from './handlers/inbound.js';
import { handleChatwootCallback } from './handlers/chatwoot-callback.js';
import { runCleanup } from './jobs/cleanup.js';

// Cheap tick: check whether an online validation is due. The actual /validate
// call (every ~6h, backed off on failure) only fires when nextHeartbeatAt has
// passed, so restarts and outages don't hammer the vendor server.
const HEARTBEAT_TICK_MS = LICENSE.heartbeatTickMs; // 30 min
const CLEANUP_MS = 60 * 60 * 1000; // 1h
const RESTART_POLL_MS = 15 * 1000; // 15s — watch for a panel-triggered restart

async function main() {
  // Apply stored RabbitMQ/Redis overrides before opening any connection.
  await applyConnectionOverrides().catch((err) =>
    logger.warn({ err }, 'failed to apply connection overrides; using env'),
  );
  const bootAt = Date.now();

  await consume(
    AMQP.queues.inbound,
    async (job) => {
      // The license gate now lives INSIDE handleInbound: the conversation history
      // is captured first (kept even when the license is inactive), then the gate
      // decides whether to mirror to Chatwoot.
      await handleInbound(job.payload, job.integrationId);
    },
    { prefetch: 16 },
  );

  await consume(
    AMQP.queues.callback,
    async (job) => {
      const gate = await assertLicenseActive();
      if (!gate.allowed) {
        logger.warn({ status: gate.status }, 'callback dropped: license not active');
        return;
      }
      await handleChatwootCallback(job.payload, job.integrationId);
    },
    { prefetch: 16 },
  );

  // Periodic jobs (no broker needed): license heartbeat + TTL cleanup.
  const heartbeatTimer = setInterval(() => {
    void maybeRunHeartbeat().catch((err) => logger.warn({ err }, 'heartbeat failed'));
  }, HEARTBEAT_TICK_MS);
  const cleanupTimer = setInterval(() => {
    void runCleanup().catch((err) => logger.warn({ err }, 'cleanup failed'));
  }, CLEANUP_MS);
  // On boot, only validate if one is actually due (avoids a re-check storm when
  // Swarm recreates the container repeatedly).
  await maybeRunHeartbeat().catch((err) => logger.warn({ err }, 'initial heartbeat failed'));
  await runCleanup().catch((err) => logger.warn({ err }, 'initial cleanup failed'));

  // Restart watcher: when the panel requests a restart (to apply new connection
  // settings), self-exit so Swarm's restart_policy recreates us with the
  // overrides re-read at boot. We only act on requests made AFTER our own boot.
  const restartTimer = setInterval(() => {
    void prisma.appSettings
      .findUnique({ where: { id: 'singleton' }, select: { restartRequestedAt: true } })
      .then((s) => {
        if (s?.restartRequestedAt && s.restartRequestedAt.getTime() > bootAt) {
          logger.info('restart requested via panel — exiting for Swarm to recreate');
          process.exit(0);
        }
      })
      .catch((err) => logger.warn({ err }, 'restart poll failed'));
  }, RESTART_POLL_MS);

  logger.info('worker started; consuming inbound + callback (RabbitMQ) + heartbeat/cleanup timers');

  const close = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    clearInterval(heartbeatTimer);
    clearInterval(cleanupTimer);
    clearInterval(restartTimer);
    await closeQueue();
    await closeRedis();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));
}

void main().catch((err) => {
  logger.error(err, 'worker failed to start');
  process.exit(1);
});
