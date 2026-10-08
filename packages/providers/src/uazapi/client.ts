import axios, { type AxiosInstance } from 'axios';
import type { UazapiConfig } from '@wootrico/types';
import type {
  SendMessageInput,
  SendMessageResult,
  NormalizedInboundMessage,
} from '@wootrico/types';
import type {
  DownloadResult,
  MediaRef,
  ParseContext,
  TestResult,
  WhatsAppProvider,
} from '../provider.interface.js';
import { toDataUrl, urlToBase64 } from '../util/media.js';
import { parseUazapiInbound } from './parse-inbound.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractMessageId(data: any): string | null {
  return (
    data?.messageid ??
    data?.id ??
    data?.message?.messageid ??
    data?.message?.id ??
    data?.key?.id ??
    null
  );
}

export class UazapiProvider implements WhatsAppProvider {
  readonly type = 'uazapi' as const;
  private http: AxiosInstance;

  constructor(private config: UazapiConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ''),
      headers: { token: config.token, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const number = input.recipient;
    if (input.type === 'text') {
      const body: Record<string, unknown> = { number, text: input.content ?? '' };
      if (input.replyToProviderMessageId) body.replyid = input.replyToProviderMessageId;
      const res = await this.http.post('/send/text', body);
      return { providerMessageIds: [extractMessageId(res.data)].filter(Boolean) as string[], raw: res.data };
    }

    // media
    const uazType = input.type === 'audio' ? 'ptt' : input.type;
    let file = input.media?.url;
    if (!file && input.media?.base64) {
      file = toDataUrl(input.media.base64, input.media.mimeType);
    }
    const body: Record<string, unknown> = { number, type: uazType, file };
    if (input.content) body.text = input.content;
    if (input.replyToProviderMessageId) body.replyid = input.replyToProviderMessageId;
    if (input.type === 'document' && input.media?.fileName) body.docName = input.media.fileName;

    const res = await this.http.post('/send/media', body);
    return { providerMessageIds: [extractMessageId(res.data)].filter(Boolean) as string[], raw: res.data };
  }

  async deleteMessage(providerMessageId: string): Promise<void> {
    await this.http.post('/message/delete', { id: providerMessageId });
  }

  async downloadMedia(ref: MediaRef): Promise<DownloadResult> {
    if (ref.providerMessageId) {
      const attempts = 5;
      let lastErr: unknown;
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await this.http.post('/message/download', {
            id: ref.providerMessageId,
            return_base64: true,
            return_link: false,
          });
          const base64 = res.data?.base64Data ?? res.data?.base64 ?? '';
          if (!base64) throw new Error('empty download');
          return { base64, mimeType: res.data?.mimetype ?? ref.mimeType };
        } catch (err) {
          lastErr = err;
          const status = axios.isAxiosError(err) ? err.response?.status : undefined;
          const retriable = status === undefined || [404, 502, 503].includes(status);
          if (i === attempts - 1 || !retriable) break;
          await sleep(2000);
        }
      }
      // fall through to URL if available
      if (ref.url) return urlToBase64(ref.url);
      throw lastErr instanceof Error ? lastErr : new Error('uazapi download failed');
    }
    if (ref.url) return urlToBase64(ref.url);
    throw new Error('downloadMedia requires providerMessageId or url');
  }

  parseInbound(payload: unknown, ctx: ParseContext): NormalizedInboundMessage {
    return parseUazapiInbound(payload, ctx);
  }

  async testConnection(): Promise<TestResult> {
    try {
      const res = await this.http.get('/instance/status', { timeout: 10000 });
      const status = res.data?.instance?.status ?? res.data?.status ?? 'unknown';
      return { ok: true, detail: `status: ${status}` };
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? '?'}: ${err.message}`
        : (err as Error).message;
      return { ok: false, detail };
    }
  }
}
