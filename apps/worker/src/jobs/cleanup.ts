import { prisma } from '@wootrico/db';
import { logger } from '@wootrico/config';
import { driverForStored, parseMediaConfig } from '@wootrico/storage';

/**
 * Delete media-library assets past their retention window. Done OUTSIDE the
 * main transaction because it involves storage I/O. The binary is shared
 * (deduped by sha256), so we delete the rows first, then garbage-collect any
 * binary no longer referenced by ANY row.
 */
async function sweepMedia(now: Date): Promise<{ rows: number; blobs: number }> {
  const expired = await prisma.mediaAsset.findMany({
    where: { expiresAt: { lt: now } },
    take: 2000,
    select: { id: true, storageKey: true, storageDriver: true },
  });
  if (expired.length === 0) return { rows: 0, blobs: 0 };

  const del = await prisma.mediaAsset.deleteMany({
    where: { id: { in: expired.map((e) => e.id) } },
  });

  const cfg = parseMediaConfig(await prisma.appSettings.findUnique({ where: { id: 'singleton' } }));
  const driverFor = (kind: string) => driverForStored(kind, cfg, prisma.mediaBlob);

  // Distinct keys among the deleted rows; drop the binary only if nothing else
  // still points at it (another occurrence with the same content).
  const seen = new Map<string, string>();
  for (const e of expired) if (!seen.has(e.storageKey)) seen.set(e.storageKey, e.storageDriver);

  let blobs = 0;
  for (const [key, kind] of seen) {
    const still = await prisma.mediaAsset.count({ where: { storageKey: key } });
    if (still > 0) continue;
    try {
      await driverFor(kind).delete(key);
      blobs++;
    } catch (err) {
      logger.warn({ err, key }, 'media blob delete failed');
    }
  }
  return { rows: del.count, blobs };
}

/**
 * Delete system logs older than the configured retention window. Unlike the
 * operational TTLs below, this is keyed on `createdAt` and driven by
 * `AppSettings.logRetentionDays`, so changing the setting applies retroactively.
 * `days == null` means "keep forever" — nothing is deleted.
 */
async function sweepLogs(
  now: Date,
  days: number | null,
): Promise<{ messageLogs: number; webhookEvents: number; auditLogs: number }> {
  if (days == null || days <= 0) return { messageLogs: 0, webhookEvents: 0, auditLogs: 0 };
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const [messageLogs, webhookEvents, auditLogs] = await prisma.$transaction([
    prisma.messageLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } }),
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  return {
    messageLogs: messageLogs.count,
    webhookEvents: webhookEvents.count,
    auditLogs: auditLogs.count,
  };
}

/**
 * Delete captured conversations whose last message is older than the configured
 * retention window (default 90 days, null = keep forever). Deleting a
 * conversation cascades to all its messages.
 */
async function sweepConversations(now: Date, days: number | null): Promise<number> {
  if (days == null || days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const del = await prisma.conversation.deleteMany({ where: { lastMessageAt: { lt: cutoff } } });
  return del.count;
}

/** Delete rows past their TTL. Scheduled hourly. */
export async function runCleanup(): Promise<void> {
  const now = new Date();
  // Operational TTLs (createdAt-independent) — unchanged.
  const [dedup, mappings, sessions] = await prisma.$transaction([
    prisma.dedupTicket.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.messageMapping.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);

  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  const logs = await sweepLogs(now, settings?.logRetentionDays ?? null).catch((err) => {
    logger.warn({ err }, 'log retention sweep failed');
    return { messageLogs: 0, webhookEvents: 0, auditLogs: 0 };
  });

  const conversations = await sweepConversations(
    now,
    settings?.conversationRetentionDays ?? null,
  ).catch((err) => {
    logger.warn({ err }, 'conversation retention sweep failed');
    return 0;
  });

  const media = await sweepMedia(now).catch((err) => {
    logger.warn({ err }, 'media retention sweep failed');
    return { rows: 0, blobs: 0 };
  });
  logger.info(
    {
      dedupTickets: dedup.count,
      messageMappings: mappings.count,
      sessions: sessions.count,
      messageLogs: logs.messageLogs,
      webhookEvents: logs.webhookEvents,
      auditLogs: logs.auditLogs,
      conversations,
      mediaAssets: media.rows,
      mediaBlobs: media.blobs,
    },
    'cleanup sweep complete',
  );
}
