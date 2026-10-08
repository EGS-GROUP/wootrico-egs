import axios, { type AxiosInstance } from 'axios';
import type {
  NormalizedInboundMessage,
  SendMessageInput,
  SendMessageResult,
  ZapiConfig,
} from '@wootrico/types';
import type {
  DownloadResult,
  MediaRef,
  ParseContext,
  TestResult,
  WhatsAppProvider,
} from '../provider.interface.js';
import { toDataUrl, urlToBase64 } from '../util/media.js';
import { parseZapiInbound } from './parse-inbound.js';

function extractMessageId(data: any): string | null {
  return data?.messageId ?? data?.id ?? data?.zaapId ?? data?.messageid ?? null;
}

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
};

function extOf(fileName?: string, mime?: string): string {
  if (fileName && fileName.includes('.')) return fileName.split('.').pop()!.toLowerCase();
  if (mime && MIME_EXT[mime]) return MIME_EXT[mime];
  return 'bin';
}

export class ZapiProvider implements WhatsAppProvider {
  readonly type = 'zapi' as const;
  private http: AxiosInstance;

  constructor(private config: ZapiConfig) {
    const host = (config.baseUrl ?? 'https://api.z-api.io').replace(/\/$/, '');
    this.http = axios.create({
      baseURL: `${host}/instances/${config.instance}/token/${config.token}`,
      headers: { 'Client-Token': config.clientToken, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const phone = input.recipient;
    const reply = input.replyToProviderMessageId
      ? { messageId: input.replyToProviderMessageId }
      : {};

    if (input.type === 'text') {
      const res = await this.http.post('/send-text', {
        phone,
        message: input.content ?? '',
        ...reply,
      });
      return { providerMessageIds: [extractMessageId(res.data)].filter(Boolean) as string[], raw: res.data };
    }

    const media = input.media?.url ?? (input.media?.base64 ? toDataUrl(input.media.base64, input.media.mimeType) : undefined);
    let path: string;
    let body: Record<string, unknown> = { phone, ...reply };
    switch (input.type) {
      case 'image':
        path = '/send-image';
        body = { ...body, image: media, caption: input.content ?? '' };
        break;
      case 'audio':
        // Voice note — z-api's send-audio has no caption/message field.
        path = '/send-audio';
        body = { ...body, audio: media };
        break;
      case 'video':
        path = '/send-video';
        body = { ...body, video: media, caption: input.content ?? '' };
        break;
      case 'document': {
        const ext = extOf(input.media?.fileName, input.media?.mimeType);
        path = `/send-document/${ext}`;
        body = {
          ...body,
          document: media,
          fileName: input.media?.fileName ?? `file.${ext}`,
          caption: input.content ?? '',
        };
        break;
      }
      default:
        path = '/send-text';
    }
    const res = await this.http.post(path, body);
    return { providerMessageIds: [extractMessageId(res.data)].filter(Boolean) as string[], raw: res.data };
  }

  async deleteMessage(providerMessageId: string, opts?: { recipient?: string }): Promise<void> {
    if (!opts?.recipient) return; // z-api delete requires the phone/owner
    await this.http.delete('/messages', {
      params: { messageId: providerMessageId, phone: opts.recipient, owner: true },
    });
  }

  async downloadMedia(ref: MediaRef): Promise<DownloadResult> {
    if (ref.url) return urlToBase64(ref.url);
    throw new Error('zapi downloadMedia requires url');
  }

  parseInbound(payload: unknown, ctx: ParseContext): NormalizedInboundMessage {
    return parseZapiInbound(payload, ctx);
  }

  async fetchProfilePictureUrl(recipient: string): Promise<string | null> {
    try {
      // GET /profile-picture?phone=... → { link: "https://..." } (valid ~48h).
      const res = await this.http.get('/profile-picture', {
        params: { phone: recipient },
        timeout: 10000,
      });
      const out = (res.data ?? {}) as Record<string, any>;
      return out.link ?? out.url ?? null;
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<TestResult> {
    try {
      const res = await this.http.get('/status', { timeout: 10000 });
      const connected = res.data?.connected ?? res.data?.smartphoneConnected;
      return { ok: true, detail: `connected: ${connected}` };
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? '?'}: ${err.message}`
        : (err as Error).message;
      return { ok: false, detail };
    }
  }
}
