import { Readable } from 'node:stream';
import type { StorageDriver, PutOptions } from './driver.js';

/**
 * Minimal shape of the Prisma `mediaBlob` delegate the DbDriver needs. Declared
 * here so the storage package stays decoupled from the generated DB client —
 * the caller passes `prisma.mediaBlob`.
 */
export interface MediaBlobStore {
  findUnique(args: {
    where: { storageKey: string };
    select?: { data?: boolean; size?: boolean };
  }): Promise<{ data: Buffer; size: number } | null>;
  upsert(args: {
    where: { storageKey: string };
    create: { storageKey: string; data: Buffer; size: number };
    update: Record<string, never>;
  }): Promise<unknown>;
  count(args: { where: { storageKey: string } }): Promise<number>;
  deleteMany(args: { where: { storageKey: string } }): Promise<{ count: number }>;
}

/**
 * "Local" storage backed by Postgres (the `media_blobs` table). Both the panel
 * and the worker already share the database, so this needs no shared volume —
 * it works on any container topology. For heavy media volume, use the S3 driver.
 */
export class DbDriver implements StorageDriver {
  readonly kind = 'local' as const;
  constructor(private readonly store: MediaBlobStore) {}

  async put(key: string, body: Buffer, _opts: PutOptions): Promise<void> {
    await this.store.upsert({
      where: { storageKey: key },
      create: { storageKey: key, data: body, size: body.length },
      update: {},
    });
  }

  async get(key: string): Promise<Buffer> {
    const row = await this.store.findUnique({
      where: { storageKey: key },
      select: { data: true, size: true },
    });
    if (!row) throw new Error(`blob not found: ${key}`);
    return Buffer.from(row.data);
  }

  async stream(key: string): Promise<Readable> {
    return Readable.from(await this.get(key));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.store.count({ where: { storageKey: key } })) > 0;
  }

  async delete(key: string): Promise<void> {
    await this.store.deleteMany({ where: { storageKey: key } });
  }

  async presignedUrl(): Promise<string | null> {
    return null;
  }
}
