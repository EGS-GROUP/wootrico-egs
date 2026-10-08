import axios from 'axios';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchedMedia {
  base64: string;
  mimeType?: string;
}

/** Download a URL and return base64 + mime, with retry/backoff (ported logic). */
export async function urlToBase64(
  url: string,
  { attempts = 5, delayMs = 2000, timeoutMs = 30000 } = {},
): Promise<FetchedMedia> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: timeoutMs,
      });
      const base64 = Buffer.from(res.data).toString('base64');
      const mimeType = res.headers['content-type'] as string | undefined;
      if (!base64) throw new Error('empty media');
      return { base64, mimeType };
    } catch (err) {
      lastErr = err;
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const retriable =
        status === undefined || status === 404 || status === 502 || status === 503;
      if (i === attempts - 1 || !retriable) break;
      await sleep(delayMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('media download failed');
}

/** Build a data: URL from base64 + mime (for providers that accept data URLs). */
export function toDataUrl(base64: string, mimeType = 'application/octet-stream'): string {
  return `data:${mimeType};base64,${base64}`;
}
