import type { StorageDriver } from './driver.js';
import type { ResolvedMediaConfig } from './config.js';
import { DbDriver, type MediaBlobStore } from './db-driver.js';
import { S3Driver, type S3Config } from './s3-driver.js';

// Cache one S3 driver instance per process, keyed by a signature of its config
// so a reconfiguration rebuilds it. The local (DB) driver is cheap to build.
let cachedS3: { sig: string; driver: S3Driver } | undefined;

function s3Signature(s: S3Config): string {
  return `s3:${s.endpoint ?? ''}:${s.region}:${s.bucket}:${s.accessKeyId}:${s.forcePathStyle ? 1 : 0}`;
}

function s3Driver(s: S3Config): S3Driver {
  const sig = s3Signature(s);
  if (cachedS3?.sig === sig) return cachedS3.driver;
  const driver = new S3Driver(s);
  cachedS3 = { sig, driver };
  return driver;
}

/** Driver for WRITING new media (chooses by the configured driver). */
export function getStorageDriver(cfg: ResolvedMediaConfig, blobStore: MediaBlobStore): StorageDriver {
  return cfg.driver === 's3' && cfg.s3 ? s3Driver(cfg.s3) : new DbDriver(blobStore);
}

/** Driver for READING/deleting an already-stored asset (chooses by where it
 *  was stored). Falls back to the DB driver for local/legacy values. */
export function driverForStored(
  storageDriver: string,
  cfg: ResolvedMediaConfig,
  blobStore: MediaBlobStore,
): StorageDriver {
  return storageDriver === 's3' && cfg.s3 ? s3Driver(cfg.s3) : new DbDriver(blobStore);
}

/** Validate an S3 config (HeadBucket) before persisting it. */
export async function testS3(cfg: S3Config): Promise<{ ok: boolean; detail?: string }> {
  try {
    const sdk = await import('@aws-sdk/client-s3');
    const client = new sdk.S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: cfg.forcePathStyle ?? false,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    await client.send(new sdk.HeadBucketCommand({ Bucket: cfg.bucket }));
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
