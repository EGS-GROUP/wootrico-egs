import type { MessageType } from '@wootrico/config';
import type { InboundMedia, NormalizedInboundMessage } from '@wootrico/types';
import type { ParseContext } from '../provider.interface.js';
import { normalizePhone } from '../util/phone.js';

/**
 * Parser for **Evolution GO** (whatsmeow) webhooks.
 *
 * Payload shape:
 *   { event: "Message", instanceId, instanceName, instanceToken,
 *     data: { Info: {...}, Message: {...}, IsEdit, ... } }
 *
 * - `data.Info` carries metadata (Chat, Sender, ID, IsGroup, IsFromMe, PushName, Type, MediaType).
 * - `data.Message` is the whatsmeow proto. Evolution GO additionally injects:
 *     - `mediaUrl`: a plain (already-decrypted) URL for image/video/document;
 *     - `base64`:   inline base64 for audio/ptt.
 */

function stripJid(v: string | undefined | null): string {
  return (v ?? '').split('@')[0] ?? '';
}

const MEDIA_KEYS: [string, MessageType][] = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'image'],
];

/** Sniff the real image mime from the start of a base64 blob (Evolution GO
 *  converts stickers to PNG but still reports image/webp, so trust the bytes). */
function mimeFromBase64(b64?: string | null): string | null {
  const s = (b64 ?? '').replace(/^data:[^;]+;base64,/, '');
  if (s.startsWith('iVBORw0KGgo')) return 'image/png';
  if (s.startsWith('/9j/')) return 'image/jpeg';
  if (s.startsWith('R0lGOD')) return 'image/gif';
  if (s.startsWith('UklGR')) return 'image/webp';
  return null;
}

function extractMedia(message: Record<string, any>): { media: InboundMedia | null; caption: string } {
  // document-with-caption wraps the real documentMessage one level down
  const inner = message.documentWithCaptionMessage?.message ?? message;
  for (const [key, type] of MEDIA_KEYS) {
    const m = inner[key];
    if (!m) continue;
    const caption: string = m.caption ?? '';
    const base64 = message.base64 ?? inner.base64 ?? undefined;
    const media: InboundMedia = {
      type,
      // Evolution GO gives a plain decrypted URL (image/video/doc) ...
      url: message.mediaUrl ?? inner.mediaUrl ?? undefined,
      // ... or inline base64 (audio/ptt/sticker).
      base64,
      // Prefer the sniffed mime when we have the bytes (fixes sticker webp→png).
      mimeType: (base64 ? mimeFromBase64(base64) : null) ?? m.mimetype ?? message.mimetype ?? inner.mimetype,
      fileName: m.fileName ?? m.title ?? undefined,
      caption,
    };
    return { media, caption };
  }
  return { media: null, caption: '' };
}

function getContextInfo(message: Record<string, any>): Record<string, any> | undefined {
  return (
    message.extendedTextMessage?.contextInfo ??
    message.imageMessage?.contextInfo ??
    message.videoMessage?.contextInfo ??
    message.audioMessage?.contextInfo ??
    message.documentMessage?.contextInfo ??
    message.stickerMessage?.contextInfo
  );
}

export function parseEvolutionInbound(
  payload: unknown,
  ctx: ParseContext,
): NormalizedInboundMessage {
  const body = (payload ?? {}) as Record<string, any>;
  const event = (body.event ?? '').toString();
  const data = (body.data ?? {}) as Record<string, any>;
  const info = (data.Info ?? {}) as Record<string, any>;
  const message = (data.Message ?? {}) as Record<string, any>;

  const isGroup = !!info.IsGroup;
  // PushName is always the SENDER's name. On a fromMe message the sender is the
  // WhatsApp account owner — never the contact — so it must NOT be used to name
  // the Chatwoot contact (it would label the contact with our own name).
  const pushName = !info.IsFromMe ? (info.PushName ?? null) : null;

  const base: NormalizedInboundMessage = {
    origin: 'evolution',
    kind: 'message',
    phone: null,
    text: '',
    name: pushName,
    isGroup,
    fromMe: !!info.IsFromMe,
    fromApi: false, // Evolution GO has no API-source flag; echo handled via mapping
    providerMessageId: info.ID ?? null,
    raw: payload,
  };

  // Only "Message" events carry chat content; ignore the rest (receipts, presence…).
  if (event && event !== 'Message') {
    return { ...base, kind: 'ignored' };
  }

  // Revoke (delete-for-everyone) arrives as a protocolMessage.
  const proto = message.protocolMessage as Record<string, any> | undefined;
  const protoType = (proto?.type ?? '').toString().toUpperCase();
  if (proto && protoType === 'REVOKE') {
    const delId = proto.key?.ID ?? proto.key?.id;
    return {
      ...base,
      kind: 'message_deleted',
      deletedProviderMessageIds: delId ? [delId] : [],
    };
  }

  // Edit detection — Evolution GO serializes the whatsmeow proto with encoding/json,
  // so `protocolMessage.type` is the NUMERIC enum value (MESSAGE_EDIT = 14), not the
  // string "MESSAGE_EDIT". Detect it by the numeric/string type, the IsEdit flag, OR
  // simply the presence of an editedMessage payload.
  // Newer WhatsApp clients deliver edits as a `secretEncryptedMessage` (the same
  // envelope used for poll votes): an ENCRYPTED payload that whatsmeow/Evolution GO
  // does not decrypt. There's no `protocolMessage`/`editedMessage` and `data.IsEdit`
  // is false — the only edit signal is `Info.Edit` and the secret envelope itself.
  // We can't recover the new text, but we can tell which message was edited via
  // `targetMessageKey.ID` and flag it so the handler posts a notice.
  const secretEnc = message.secretEncryptedMessage as Record<string, any> | undefined;
  const editedContentUnavailable = !!secretEnc && (info.Edit ?? '') !== '';
  const isEdit =
    !!data.IsEdit ||
    (info.Edit ?? '') !== '' ||
    protoType === 'MESSAGE_EDIT' ||
    protoType === '14' ||
    !!proto?.editedMessage ||
    editedContentUnavailable;
  // Edited content lives under protocolMessage.editedMessage
  const effective = isEdit && proto?.editedMessage ? { ...message, ...proto.editedMessage } : message;

  // Reaction: an emoji reacting to a message. Chatwoot has no reaction type, so
  // we mirror it as a short text threaded under the reacted message. An empty
  // text means the reaction was removed → ignore.
  const reaction = effective.reactionMessage as Record<string, any> | undefined;
  const reactionText = (reaction?.text ?? '').toString().trim();
  if (reaction && !reactionText) {
    return { ...base, kind: 'ignored' };
  }

  const { media, caption } = reaction ? { media: null, caption: '' } : extractMedia(effective);
  const text = reaction
    ? `reagiu com ${reactionText}`
    : (effective.conversation ?? effective.extendedTextMessage?.text ?? caption ?? '');

  const chatJid: string = info.Chat ?? '';
  const fromMe = !!info.IsFromMe;
  // The contact is always the OTHER party. For an outgoing (fromMe) DM the Sender
  // is OUR own number, so the contact must come from Chat (the recipient).
  // For an incoming DM the Sender IS the contact and SenderAlt gives its PN↔LID
  // pair. Classify candidates by suffix (@s.whatsapp.net vs @lid) so a LID is
  // never mis-read as a phone number once Meta switches a chat to LID addressing.
  const senderJid = (info.Sender ?? '').toString();
  const senderAlt = (info.SenderAlt ?? '').toString();
  const candidates = (
    isGroup
      ? [senderJid, senderAlt] // the participant who sent
      : fromMe
        ? [chatJid] // outgoing DM → contact = recipient
        : [senderJid, senderAlt, chatJid] // incoming DM → contact = sender
  ).filter(Boolean);
  let pnJid = '';
  let lidJid = '';
  for (const j of candidates) {
    if (j.endsWith('@lid')) lidJid ||= j;
    else if (j.endsWith('@s.whatsapp.net') || j.endsWith('@c.us')) pnJid ||= j;
  }
  const phoneDigits = pnJid
    ? normalizePhone(stripJid(pnJid), ctx.defaultCountry).digits
    : null;
  const lid = lidJid ? stripJid(lidJid) : null;

  // A reaction threads under the message it reacted to; otherwise use the quoted
  // message id from the context info.
  const replyTo = reaction
    ? (reaction.key?.ID ?? reaction.key?.id ?? null)
    : (getContextInfo(effective)?.stanzaId ?? getContextInfo(effective)?.stanzaID ?? null);

  // Group metadata: name + the full participant roster (a PN↔LID directory we
  // can use to seed number discovery).
  const groupData = (data.groupData ?? {}) as Record<string, any>;
  const groupName = isGroup ? (groupData.Name ?? null) : null;
  const directoryHints =
    isGroup && Array.isArray(groupData.Participants)
      ? (groupData.Participants as any[])
          .map((p) => ({
            pn: p?.PhoneNumber?.endsWith?.('@s.whatsapp.net')
              ? normalizePhone(stripJid(p.PhoneNumber), ctx.defaultCountry).digits
              : null,
            lid: (p?.LID ?? p?.JID)?.endsWith?.('@lid') ? stripJid(p.LID ?? p.JID) : null,
            // whatsmeow serializes the participant's name as DisplayName.
            pushName: p?.DisplayName ?? p?.PushName ?? p?.Name ?? null,
          }))
          .filter((h) => h.pn || h.lid)
      : undefined;

  const result: NormalizedInboundMessage = {
    ...base,
    phone: phoneDigits,
    jid: pnJid ? stripJid(pnJid) : null,
    lid,
    text,
    media,
    senderName: pushName,
    isGroup,
    groupId: isGroup ? chatJid : null,
    groupName,
    directoryHints,
    replyToProviderMessageId: replyTo,
    kind: isEdit ? 'message_edited' : 'message',
    // Which message was edited: the protocolMessage key (standard edits) or the
    // secret envelope's targetMessageKey (encrypted edits).
    editedProviderMessageId: isEdit
      ? (proto?.key?.ID ??
        proto?.key?.id ??
        secretEnc?.targetMessageKey?.ID ??
        secretEnc?.targetMessageKey?.id ??
        info.ID ??
        undefined)
      : undefined,
    editedContentUnavailable,
  };

  if (isGroup && ctx.ignoreGroups) result.kind = 'ignored';
  return result;
}
