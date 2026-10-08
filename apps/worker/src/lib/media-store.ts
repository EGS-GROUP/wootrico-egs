import { createHash } from 'node:crypto';
import { logger, type MessageType, type ProviderType } from '@wootrico/config';
import { prisma } from '@wootrico/db';
import { getStorageDriver, parseMediaConfig, type ResolvedMediaConfig } from '@wootrico/storage';

/** A media item to persist in the library. */
export interface StoreMediaInput {
  integrationId: string;
  direction: 'incoming' | 'outgoing';
  messageType: MessageType; // image | audio | video | document
  mimeType: string;
  fileName?: string | null;
  buffer: Buffer;
  caption?: string | null;
  providerType: ProviderType;
  providerMessageId?: string | null;
  phone?: string | null;
  jid?: string | null;
  lid?: string | null;
  senderName?: string | null;
  isGroup?: boolean;
  groupId?: string | null;
  sentAt?: Date | null;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
};

function extFor(mime: string, fileName?: string | null): string {
  if (EXT[mime]) return EXT[mime];
  const m = fileName?.match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1]!.toLowerCase() : 'bin';
}

// Settings rarely change; cache them briefly so we don't hit Postgres on every
// single media message that flows through the worker.
const CONFIG_TTL_MS = 30_000;
let configCache: { at: number; cfg: ResolvedMediaConfig } | undefined;

async function getConfig(): Promise<ResolvedMediaConfig> {
  const now = Date.now();
  if (configCache && now - configCache.at < CONFIG_TTL_MS) return configCache.cfg;
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  const cfg = parseMediaConfig(settings);
  configCache = { at: now, cfg };
  return cfg;
}

/**
 * Persist one media occurrence into the library. Best-effort: any failure is
 * logged and swallowed — capturing media must NEVER block or break the message
 * pipeline. Returns void; callers should `void storeMediaAsset(...)`.
 */
export async function storeMediaAsset(input: StoreMediaInput): Promise<void> {
  try {
    const cfg = await getConfig();
    if (!cfg.enabled) return;

    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `${input.integrationId}/${yyyy}/${mm}/${sha256}.${extFor(input.mimeType, input.fileName)}`;

    const driver = getStorageDriver(cfg, prisma.mediaBlob);
    // Dedup the binary: identical content (same sha256) is written once.
    if (!(await driver.exists(key))) {
      await driver.put(key, input.buffer, {
        contentType: input.mimeType,
        contentLength: input.buffer.length,
      });
    }

    const expiresAt = cfg.retentionDays
      ? new Date(now.getTime() + cfg.retentionDays * 86_400_000)
      : null;

    await prisma.mediaAsset.create({
      data: {
        integrationId: input.integrationId,
        direction: input.direction,
        messageType: input.messageType,
        mimeType: input.mimeType,
        fileName: input.fileName ?? null,
        size: input.buffer.length,
        sha256,
        storageDriver: driver.kind,
        storageKey: key,
        phone: input.phone ?? null,
        jid: input.jid ?? null,
        lid: input.lid ?? null,
        senderName: input.senderName ?? null,
        isGroup: input.isGroup ?? false,
        groupId: input.groupId ?? null,
        providerType: input.providerType,
        providerMessageId: input.providerMessageId ?? null,
        caption: input.caption ?? null,
        sentAt: input.sentAt ?? null,
        expiresAt,
      },
    });
  } catch (err) {
    logger.warn({ err, integrationId: input.integrationId }, 'media store failed (ignored)');
  }
}
