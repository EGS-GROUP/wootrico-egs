import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@wootrico/db';
import { MediaQuerySchema } from '@wootrico/types';
import { driverForStored, parseMediaConfig, type StorageDriver } from '@wootrico/storage';

/** Build the Prisma filter from the validated query. */
function buildWhere(q: ReturnType<typeof MediaQuerySchema.parse>): Prisma.MediaAssetWhereInput {
  const where: Prisma.MediaAssetWhereInput = {};
  if (q.integrationId) where.integrationId = q.integrationId;
  if (q.direction) where.direction = q.direction;
  if (q.messageType) where.messageType = q.messageType;
  if (q.mimeType) where.mimeType = { contains: q.mimeType, mode: 'insensitive' };
  if (q.phone) where.phone = { contains: q.phone, mode: 'insensitive' };
  if (q.jid) where.jid = { contains: q.jid, mode: 'insensitive' };
  if (q.lid) where.lid = { contains: q.lid, mode: 'insensitive' };
  if (q.senderName) where.senderName = { contains: q.senderName, mode: 'insensitive' };
  if (q.isGroup) where.isGroup = q.isGroup === 'true';

  const created: Prisma.DateTimeFilter = {};
  if (q.from) created.gte = new Date(q.from);
  if (q.to) created.lte = new Date(q.to);
  if (created.gte || created.lte) where.createdAt = created;

  if (q.search) {
    where.OR = [
      { phone: { contains: q.search, mode: 'insensitive' } },
      { jid: { contains: q.search, mode: 'insensitive' } },
      { lid: { contains: q.search, mode: 'insensitive' } },
      { senderName: { contains: q.search, mode: 'insensitive' } },
      { fileName: { contains: q.search, mode: 'insensitive' } },
      { caption: { contains: q.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

/** Sanitize a filename for a Content-Disposition header. */
function safeName(name: string | null | undefined, fallback: string): string {
  const n = (name ?? '').replace(/[\r\n"]/g, '').trim();
  return n || fallback;
}

/**
 * Media library — a cross-integration index of every image/audio/video/document
 * that flowed through a provider (sent or received), searchable by who/number/
 * jid/lid/integration/type/date, with view + download of the binary.
 */
export default async function mediaRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  /** Resolve the storage driver matching where an asset was stored. */
  async function driverFor(storageDriver: string): Promise<StorageDriver> {
    const settings = await app.prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    const cfg = parseMediaConfig(settings);
    return driverForStored(storageDriver, cfg, app.prisma.mediaBlob);
  }

  // ── listing with filters + pagination ──
  app.get('/api/media', guard, async (req, reply) => {
    const parsed = MediaQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    const q = parsed.data;
    const where = buildWhere(q);

    const [total, rows] = await Promise.all([
      app.prisma.mediaAsset.count({ where }),
      app.prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          integrationId: true,
          direction: true,
          messageType: true,
          mimeType: true,
          fileName: true,
          size: true,
          phone: true,
          jid: true,
          lid: true,
          senderName: true,
          isGroup: true,
          groupId: true,
          providerType: true,
          caption: true,
          sentAt: true,
          createdAt: true,
          storageDriver: true,
          integration: { select: { name: true } },
        },
      }),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      integrationId: r.integrationId,
      integrationName: r.integration?.name ?? null,
      direction: r.direction,
      messageType: r.messageType,
      mimeType: r.mimeType,
      fileName: r.fileName,
      size: r.size,
      phone: r.phone,
      jid: r.jid,
      lid: r.lid,
      senderName: r.senderName,
      isGroup: r.isGroup,
      groupId: r.groupId,
      providerType: r.providerType,
      caption: r.caption,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      storageDriver: r.storageDriver,
    }));

    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  // ── aggregate counts (cards) ──
  app.get('/api/media/stats', guard, async () => {
    const [byType, byDirection, total] = await Promise.all([
      app.prisma.mediaAsset.groupBy({ by: ['messageType'], _count: true }),
      app.prisma.mediaAsset.groupBy({ by: ['direction'], _count: true }),
      app.prisma.mediaAsset.count(),
    ]);
    const types: Record<string, number> = {};
    for (const r of byType) types[r.messageType] = r._count;
    const directions: Record<string, number> = {};
    for (const r of byDirection) directions[r.direction] = r._count;
    return { total, types, directions };
  });

  // ── serve the binary (view inline or download) ──
  app.get('/api/media/:id/raw', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const download = (req.query as { download?: string }).download === '1';
    const asset = await app.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return reply.code(404).send({ error: 'not_found' });

    const driver = await driverFor(asset.storageDriver);
    const disposition = download ? 'attachment' : 'inline';
    const name = safeName(asset.fileName, `${asset.messageType}-${asset.id}`);

    // Always PROXY the bytes through the panel (same-origin). We deliberately do
    // NOT redirect to a presigned S3 URL: the panel loads media via fetch()+blob
    // (it needs the Bearer token), and a cross-origin fetch to S3 fails CORS — and
    // self-hosted S3/MinIO endpoints are often internal and unreachable from the
    // browser. Streaming here works for S3, MinIO and the embedded DB driver.
    let stream;
    try {
      stream = await driver.stream(asset.storageKey);
    } catch (err) {
      app.log.warn({ err, id, driver: asset.storageDriver }, 'media stream failed');
      return reply.code(404).send({ error: 'gone' });
    }
    return reply
      .header('Content-Type', asset.mimeType)
      .header('Content-Length', String(asset.size))
      .header('Content-Disposition', `${disposition}; filename="${name}"`)
      .header('Cache-Control', 'private, max-age=3600')
      .send(stream);
  });

  // ── delete one asset (and its binary if no longer referenced) ──
  app.delete('/api/media/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await app.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return reply.code(404).send({ error: 'not_found' });

    await app.prisma.mediaAsset.delete({ where: { id } });
    const still = await app.prisma.mediaAsset.count({ where: { storageKey: asset.storageKey } });
    if (still === 0) {
      const driver = await driverFor(asset.storageDriver);
      await driver.delete(asset.storageKey).catch(() => undefined);
    }
    await app.prisma.auditLog
      .create({
        data: {
          adminUserId: req.user.sub,
          action: 'media.deleted',
          entityType: 'media_asset',
          entityId: id,
        },
      })
      .catch(() => undefined);
    return reply.code(204).send();
  });
}
