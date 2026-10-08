import { api, getToken } from './api-client';

export type MediaDirection = 'incoming' | 'outgoing';
export type MediaType = 'image' | 'audio' | 'video' | 'document';

export interface MediaAssetDTO {
  id: string;
  integrationId: string;
  integrationName: string | null;
  direction: MediaDirection;
  messageType: MediaType;
  mimeType: string;
  fileName: string | null;
  size: number;
  phone: string | null;
  jid: string | null;
  lid: string | null;
  senderName: string | null;
  isGroup: boolean;
  groupId: string | null;
  providerType: 'evolution' | 'uazapi' | 'zapi';
  caption: string | null;
  sentAt: string | null;
  createdAt: string;
  /** Onde o binário está guardado: 'local' (banco) ou 's3'. */
  storageDriver: 'local' | 's3';
}

export interface MediaPage {
  items: MediaAssetDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MediaFilters {
  search?: string;
  integrationId?: string;
  direction?: MediaDirection;
  messageType?: MediaType;
  mimeType?: string;
  phone?: string;
  jid?: string;
  lid?: string;
  senderName?: string;
  isGroup?: boolean;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const listMedia = (f: MediaFilters = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === '' || v === null) continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return api<MediaPage>(`/api/media${qs ? `?${qs}` : ''}`);
};

export interface MediaStats {
  total: number;
  types: Record<string, number>;
  directions: Record<string, number>;
}
export const getMediaStats = () => api<MediaStats>('/api/media/stats');

export const deleteMedia = (id: string) => api<void>(`/api/media/${id}`, { method: 'DELETE' });

/** The raw endpoint URL (needs a Bearer token → fetch as a blob, not <img src>). */
export const mediaRawPath = (id: string, download = false) =>
  `/api/media/${id}/raw${download ? '?download=1' : ''}`;

/**
 * Fetch the binary with auth and return an object URL for preview/download.
 * Works for both local (streamed) and S3 (302 → presigned URL). The caller is
 * responsible for URL.revokeObjectURL once done.
 */
export async function fetchMediaBlobUrl(id: string, download = false): Promise<string> {
  const token = getToken();
  const res = await fetch(mediaRawPath(id, download), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('media_fetch_failed');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Download the binary to disk (auth-aware). */
export async function downloadMedia(id: string, fileName: string): Promise<void> {
  const url = await fetchMediaBlobUrl(id, true);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── storage configuration ──
export interface MediaS3DTO {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  forcePathStyle?: boolean;
  secretSet?: boolean;
}
export interface MediaConfigDTO {
  enabled: boolean;
  driver: 'local' | 's3';
  retentionDays: number | null;
  s3: MediaS3DTO;
}

export const getMediaConfig = () => api<MediaConfigDTO>('/api/system/media');

export interface MediaConfigInput {
  enabled: boolean;
  driver: 'local' | 's3';
  retentionDays: number | null;
  s3?: {
    endpoint?: string;
    region?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
  };
}
export const updateMediaConfig = (body: MediaConfigInput) =>
  api<{ ok: boolean }>('/api/system/media', { method: 'PUT', body: JSON.stringify(body) });

export const testMediaS3 = (body: {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}) =>
  api<{ ok: boolean; detail?: string }>('/api/system/media/test', {
    method: 'POST',
    body: JSON.stringify(body),
  });
