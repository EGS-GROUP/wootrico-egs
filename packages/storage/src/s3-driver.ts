import type { Readable } from 'node:stream';
import type { StorageDriver, PutOptions, PresignOptions } from './driver.js';

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing (required by MinIO and some S3-compatibles). */
  forcePathStyle?: boolean;
}

/**
 * S3-compatible storage (AWS S3, MinIO, Cloudflare R2, …). The `@aws-sdk`
 * packages are imported lazily so installs that never enable S3 don't pay the
 * load cost and the bundler keeps them out of the hot path.
 */
export class S3Driver implements StorageDriver {
  readonly kind = 's3' as const;
  private readonly cfg: S3Config;
  // Cached lazily-loaded SDK module + client instance.
  private clientPromise?: Promise<{
    client: import('@aws-sdk/client-s3').S3Client;
    sdk: typeof import('@aws-sdk/client-s3');
  }>;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
  }

  private async lib() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const sdk = await import('@aws-sdk/client-s3');
        const client = new sdk.S3Client({
          region: this.cfg.region,
          endpoint: this.cfg.endpoint || undefined,
          forcePathStyle: this.cfg.forcePathStyle ?? false,
          credentials: {
            accessKeyId: this.cfg.accessKeyId,
            secretAccessKey: this.cfg.secretAccessKey,
          },
        });
        return { client, sdk };
      })();
    }
    return this.clientPromise;
  }

  async put(key: string, body: Buffer, opts: PutOptions): Promise<void> {
    const { client, sdk } = await this.lib();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ContentLength: opts.contentLength ?? body.length,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const { client, sdk } = await this.lib();
    const res = await client.send(
      new sdk.GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async stream(key: string): Promise<Readable> {
    const { client, sdk } = await this.lib();
    const res = await client.send(
      new sdk.GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
    );
    return res.Body as Readable;
  }

  async exists(key: string): Promise<boolean> {
    const { client, sdk } = await this.lib();
    try {
      await client.send(new sdk.HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const { client, sdk } = await this.lib();
    await client
      .send(new sdk.DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }))
      .catch(() => undefined);
  }

  async presignedUrl(key: string, opts: PresignOptions = {}): Promise<string | null> {
    const { client, sdk } = await this.lib();
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const disposition = opts.disposition ?? 'inline';
    const name = opts.downloadName ? `; filename="${opts.downloadName.replace(/"/g, '')}"` : '';
    const cmd = new sdk.GetObjectCommand({
      Bucket: this.cfg.bucket,
      Key: key,
      ResponseContentDisposition: `${disposition}${name}`,
      ResponseContentType: opts.contentType,
    });
    return getSignedUrl(client, cmd, { expiresIn: opts.expiresSeconds ?? 300 });
  }
}
