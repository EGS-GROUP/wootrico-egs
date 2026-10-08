import type { Readable } from 'node:stream';

/** Content-disposition for a presigned/download response. */
export type Disposition = 'inline' | 'attachment';

export interface PresignOptions {
  expiresSeconds?: number;
  downloadName?: string;
  disposition?: Disposition;
  contentType?: string;
}

export interface PutOptions {
  contentType: string;
  contentLength?: number;
}

/**
 * Storage backend for the media library. The worker writes media binaries here;
 * the panel-api reads them back to serve view/download. Two implementations:
 * `local` (filesystem, requires a shared volume between containers) and `s3`
 * (any S3-compatible bucket — decouples the two services).
 */
export interface StorageDriver {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, opts: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /**
   * A short-lived direct URL to the object (S3 only). Local returns null — the
   * panel-api streams the file itself in that case.
   */
  presignedUrl(key: string, opts?: PresignOptions): Promise<string | null>;
}
