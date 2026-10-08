import { decryptJson } from '@wootrico/config';
import type { S3Config } from './s3-driver.js';

/** Subset of AppSettings the media library cares about. Passed in by the caller
 *  (worker/panel-api read the singleton) so this package never imports the DB. */
export interface MediaSettingsRow {
  mediaLibraryEnabled?: boolean;
  mediaStorageDriver?: string | null;
  mediaRetentionDays?: number | null;
  mediaS3Config?: string | null;
}

export interface ResolvedMediaConfig {
  enabled: boolean;
  driver: 'local' | 's3';
  retentionDays: number | null;
  s3: S3Config | null;
}

/** Decrypt + normalize the media settings. A corrupt S3 blob disables S3 (falls
 *  back to local) rather than throwing, mirroring conn.ts's defensive decrypt. */
export function parseMediaConfig(row: MediaSettingsRow | null | undefined): ResolvedMediaConfig {
  const enabled = row?.mediaLibraryEnabled ?? true;
  let driver: 'local' | 's3' = row?.mediaStorageDriver === 's3' ? 's3' : 'local';
  const retentionDays =
    typeof row?.mediaRetentionDays === 'number' && row.mediaRetentionDays > 0
      ? row.mediaRetentionDays
      : null;

  let s3: S3Config | null = null;
  if (driver === 's3' && row?.mediaS3Config) {
    try {
      const parsed = decryptJson<S3Config>(row.mediaS3Config);
      if (parsed?.bucket && parsed?.region && parsed?.accessKeyId && parsed?.secretAccessKey) {
        s3 = parsed;
      }
    } catch {
      s3 = null;
    }
    if (!s3) driver = 'local'; // misconfigured S3 → never silently drop media
  }

  return { enabled, driver, retentionDays, s3 };
}
