import axios, { type AxiosInstance } from 'axios';
import type {
  EvolutionConfig,
  NormalizedInboundMessage,
  SendMessageInput,
  SendMessageResult,
} from '@wootrico/types';
import type {
  DownloadResult,
  MediaRef,
  ParseContext,
  TestResult,
  WhatsAppProvider,
} from '../provider.interface.js';
import { urlToBase64 } from '../util/media.js';
import { parseEvolutionInbound } from './parse-inbound.js';

/**
 * Provider for **Evolution GO** (github.com/EvolutionAPI/evolution-go, whatsmeow).
 *
 * NOTE: Evolution GO's HTTP API differs from the classic Evolution API:
 *  - the `apikey` header identifies the instance (no `/{instance}` path segment);
 *  - send routes are `/send/text` and `/send/media` (with `type` in the body);
 *  - connection state is `GET /instance/status`.
 * Responses are wrapped as `{ data: <payload>, message: "success" }`.
 */

/** Strip a data: URL prefix — keep only the raw base64. */
function pureBase64(value: string): string {
  const idx = value.indexOf('base64,');
  return idx >= 0 ? value.slice(idx + 'base64,'.length) : value;
}

function toRemoteJid(recipient: string): string {
  if (recipient.includes('@')) return recipient;
  return `${recipient}@s.whatsapp.net`;
}

/** Best-effort extraction of the sent message id from Evolution GO's response. */
function extractSentId(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, any>;
  const payload = (d.data ?? d) as Record<string, any>;
  return (
    payload?.id ??
    payload?.ID ??
    payload?.messageId ??
    payload?.key?.id ??
    payload?.Info?.ID ??
    payload?.message?.ID ??
    null
  );
}

export class EvolutionProvider implements WhatsAppProvider {
  readonly type = 'evolution' as const;
  private http: AxiosInstance;

  constructor(private config: EvolutionConfig) {
    // Evolution GO identifies the instance by the apikey header — no instance
    // name is used in any route.
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ''),
      headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const number = input.recipient;
    // Evolution GO's `quoted` needs BOTH the message id and the author JID
    // (participant) to render the reply quote — it builds the whatsmeow
    // ContextInfo{ StanzaID, Participant } from these.
    const quoted = input.replyToProviderMessageId
      ? {
          quoted: {
            messageId: input.replyToProviderMessageId,
            ...(input.replyToParticipant ? { participant: input.replyToParticipant } : {}),
          },
        }
      : {};

    let path: string;
    let body: Record<string, unknown>;

    if (input.type === 'text') {
      path = '/send/text';
      body = { number, text: input.content ?? '', ...quoted };
    } else {
      // image | video | audio | document → /send/media (type in the body).
      // Evolution GO's send/media treats the `url` field as base64 whenever it
      // does NOT start with http(s) — it decodes the *entire* string. So we must
      // send raw base64 here, never a `data:...;base64,` URL (the `data:` prefix
      // is not valid base64 and Evolution rejects it with "invalid base64
      // encoding"). The `type`/`filename` fields tell Evolution how to handle it.
      path = '/send/media';
      const url = input.media?.url
        ? input.media.url
        : input.media?.base64
          ? pureBase64(input.media.base64)
          : '';
      body = {
        number,
        type: input.type,
        url,
        caption: input.content ?? '',
        filename: input.media?.fileName,
        ...quoted,
      };
    }

    const res = await this.http.post(path, body);
    const id = extractSentId(res.data);
    return { providerMessageIds: id ? [id] : [], raw: res.data };
  }

  async deleteMessage(providerMessageId: string, opts?: { recipient?: string }): Promise<void> {
    if (!opts?.recipient) return; // need the chat jid
    const chat = toRemoteJid(opts.recipient);
    await this.http.post('/message/delete', { chat, messageId: providerMessageId });
  }

  async downloadMedia(ref: MediaRef): Promise<DownloadResult> {
    // Evolution GO already hands us a plain (decrypted) URL for image/video/doc
    // (the inline base64 case for audio/video is consumed by the worker before
    // we get here). Download it directly.
    if (ref.url) return urlToBase64(ref.url);

    // Fallback: ask Evolution GO to decrypt the media from the original whatsmeow
    // message proto carried in the inbound payload.
    const raw = ref.raw as Record<string, any> | undefined;
    const message = raw?.message ?? raw?.data?.message ?? raw?.Message ?? raw?.data?.Message;
    if (message) {
      const res = await this.http.post('/message/downloadimage', { message });
      const out = (res.data?.data ?? res.data) as Record<string, any>;
      const base64 = out?.base64 ?? out?.Base64 ?? (typeof out === 'string' ? out : undefined);
      if (base64) return { base64: pureBase64(base64), mimeType: out?.mimetype ?? ref.mimeType };
    }
    throw new Error('evolution downloadMedia requires payload or url');
  }

  parseInbound(payload: unknown, ctx: ParseContext): NormalizedInboundMessage {
    return parseEvolutionInbound(payload, ctx);
  }

  async fetchProfilePictureUrl(recipient: string): Promise<string | null> {
    try {
      const res = await this.http.post(
        '/user/avatar',
        { number: recipient, preview: false },
        { timeout: 10000 },
      );
      const out = (res.data?.data ?? res.data) as Record<string, any> | string | undefined;
      if (typeof out === 'string') return out || null;
      return out?.url ?? out?.URL ?? out?.imgUrl ?? null;
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<TestResult> {
    try {
      const res = await this.http.get('/instance/status', { timeout: 10000 });
      const data = (res.data?.data ?? res.data ?? {}) as Record<string, any>;
      const connected = data.Connected ?? data.connected ?? false;
      const loggedIn = data.LoggedIn ?? data.loggedIn ?? false;
      const ok = Boolean(connected && loggedIn);
      const name = data.Name ?? data.name;
      const detail = ok
        ? `conectado${name ? `: ${name}` : ''}`
        : `Connected=${connected} LoggedIn=${loggedIn}`;
      return { ok, detail };
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? '?'}: ${err.message}`
        : (err as Error).message;
      return { ok: false, detail };
    }
  }
}
