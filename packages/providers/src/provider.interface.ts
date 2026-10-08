import type { ProviderType } from '@wootrico/config';
import type {
  NormalizedInboundMessage,
  SendMessageInput,
  SendMessageResult,
} from '@wootrico/types';

export interface ParseContext {
  defaultCountry: string;
  ignoreGroups: boolean;
}

export interface TestResult {
  ok: boolean;
  detail?: string;
}

export interface DownloadResult {
  base64: string;
  mimeType?: string;
}

export interface MediaRef {
  providerMessageId?: string;
  url?: string;
  mimeType?: string;
  /** original inbound payload, for providers that need it to fetch media (evolution) */
  raw?: unknown;
}

/** Provider-agnostic contract. Each unofficial WhatsApp API implements this. */
export interface WhatsAppProvider {
  readonly type: ProviderType;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  deleteMessage(providerMessageId: string, opts?: { recipient?: string }): Promise<void>;
  downloadMedia(ref: MediaRef): Promise<DownloadResult>;
  parseInbound(payload: unknown, ctx: ParseContext): NormalizedInboundMessage;
  testConnection(): Promise<TestResult>;
  /** Fetch the contact's WhatsApp profile-picture URL, if the provider exposes it. */
  fetchProfilePictureUrl?(recipient: string): Promise<string | null>;
}
