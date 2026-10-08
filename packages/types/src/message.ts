import type { MessageType, ProviderType } from '@wootrico/config';

export type InboundKind =
  | 'message'
  | 'message_deleted'
  | 'message_edited'
  | 'ignored'
  | 'unknown';

export interface InboundMedia {
  type: MessageType;
  url?: string;
  base64?: string;
  mimeType?: string;
  fileName?: string;
  caption?: string;
}

/**
 * Provider-agnostic normalized inbound message. Every provider's parseInbound
 * returns this shape so the engine is provider-independent.
 */
export interface NormalizedInboundMessage {
  origin: ProviderType;
  kind: InboundKind;

  // identity
  phone: string | null;
  lid?: string | null;
  jid?: string | null;

  // content
  text: string;
  media?: InboundMedia | null;

  // names / avatar
  name: string | null;
  senderName?: string | null;
  senderPhoto?: string | null;

  // group
  isGroup: boolean;
  groupId?: string | null;
  groupName?: string | null;

  // direction
  fromMe: boolean;
  fromApi: boolean;

  // ids
  providerMessageId: string | null;
  replyToProviderMessageId?: string | null;
  editedProviderMessageId?: string | null;
  /**
   * True when we know a message was edited but the new text is NOT available
   * (e.g. Evolution GO forwards the edit as an undecrypted `secretEncryptedMessage`).
   * The handler then posts a "contact edited this message" note instead of content.
   */
  editedContentUnavailable?: boolean;
  deletedProviderMessageIds?: string[];

  status?: string | null;

  /**
   * Extra PN↔LID pairs discovered in this event (e.g. the full participant
   * roster of a group), to seed the global identity directory for number
   * discovery. Not the message's own contact.
   */
  directoryHints?: Array<{ pn?: string | null; lid?: string | null; pushName?: string | null }>;

  /** original payload, for debugging / replay */
  raw?: unknown;
}

export interface SendMessageInput {
  recipient: string; // phone (E.164 digits) | jid | group id
  type: MessageType;
  content?: string;
  media?: { url?: string; base64?: string; mimeType?: string; fileName?: string } | null;
  replyToProviderMessageId?: string | null;
  /**
   * JID of the AUTHOR of the quoted message. Required by Evolution GO (whatsmeow)
   * to render a reply quote — the StanzaID alone is not enough. Ignored by
   * providers that quote by message id only (uazapi/zapi).
   */
  replyToParticipant?: string | null;
}

export interface SendMessageResult {
  providerMessageIds: string[];
  raw?: unknown;
}
