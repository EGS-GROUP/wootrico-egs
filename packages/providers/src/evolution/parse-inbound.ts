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

function extractMedia(
  message: Record<string, any>,
  container?: Record<string, any>,
): { media: InboundMedia | null; caption: string } {
  // document-with-caption wraps the real documentMessage one level down
  const inner = message.documentWithCaptionMessage?.message ?? message;
  for (const [key, type] of MEDIA_KEYS) {
    const m = inner[key];
    if (!m) continue;
    const caption: string = m.caption ?? '';
    const base64 = container?.base64 ?? message.base64 ?? inner.base64 ?? undefined;
    const url =
      container?.mediaUrl ??
      container?.url ??
      message.mediaUrl ??
      inner.mediaUrl ??
      m.url ??
      undefined;
    const media: InboundMedia = {
      type,
      // Evolution GO gives a plain decrypted URL (image/video/doc) ...
      url,
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
    message.stickerMessage?.contextInfo ??
    message.contextInfo
  );
}

export function parseEvolutionInbound(
  payload: unknown,
  ctx: ParseContext,
): NormalizedInboundMessage {
  const body = (payload ?? {}) as Record<string, any>;
  const event = (body.event ?? body.type ?? '').toString();

  // Known non-message events to ignore immediately (receipts, presence, status, etc.)
  const eventLc = event.toLowerCase();
  const IGNORED_EVENTS = [
    'connection.update',
    'status.instance',
    'qrcode.updated',
    'presence.update',
    'chats.set',
    'contacts.set',
    'chats.upsert',
    'labels.edit',
    'labels.association',
    'call',
    'message.ack',
    'messages.receipt',
  ];
  if (IGNORED_EVENTS.some((ev) => eventLc === ev || eventLc.startsWith(ev))) {
    return {
      origin: 'evolution',
      kind: 'ignored',
      phone: null,
      text: '',
      name: null,
      isGroup: false,
      fromMe: false,
      fromApi: false,
      providerMessageId: null,
      raw: payload,
    };
  }

  // Find the message item: can be body.data, body.data.messages[0], body.data[0], or body itself
  const rawData = body.data ?? body;
  const item: Record<string, any> =
    (Array.isArray(rawData) ? rawData[0] : (Array.isArray(rawData?.messages) ? rawData.messages[0] : rawData)) ?? {};

  // Support both whatsmeow (Evolution Go: Info / Message) and Baileys (Evolution API: key / message)
  const info = (item.Info ?? item.info ?? {}) as Record<string, any>;
  const key = (item.key ?? item.Key ?? {}) as Record<string, any>;
  const message = (item.Message ?? item.message ?? {}) as Record<string, any>;

  const chatJid: string = (info.Chat ?? key.remoteJid ?? item.remoteJid ?? '').toString();
  const isGroup = Boolean(info.IsGroup || chatJid.endsWith('@g.us') || key.participant || item.participant);
  const fromMe = Boolean(info.IsFromMe ?? key.fromMe ?? item.fromMe);
  const providerMessageId = (info.ID ?? key.id ?? key.ID ?? item.id ?? item.ID ?? null)
    ? String(info.ID ?? key.id ?? key.ID ?? item.id ?? item.ID)
    : null;
  // PushName is always the SENDER's name. On a fromMe message the sender is the
  // WhatsApp account owner — never the contact — so it must NOT be used to name
  // the Chatwoot contact (it would label the contact with our own name).
  const pushName = !fromMe ? (info.PushName ?? item.pushName ?? item.pushname ?? null) : null;

  const base: NormalizedInboundMessage = {
    origin: 'evolution',
    kind: 'message',
    phone: null,
    text: '',
    name: pushName,
    isGroup,
    fromMe,
    fromApi: false, // Evolution GO has no API-source flag; echo handled via mapping
    providerMessageId,
    raw: payload,
  };

  // If there is no chat, no message id and empty message, ignore non-message noise
  if (!chatJid && !providerMessageId && Object.keys(message).length === 0) {
    return { ...base, kind: 'ignored' };
  }

  // Revoke (delete-for-everyone) arrives as a protocolMessage.
  const proto = (message.protocolMessage ?? message.ProtocolMessage) as Record<string, any> | undefined;
  const protoType = (proto?.type ?? '').toString().toUpperCase();
  if (proto && (protoType === 'REVOKE' || protoType === '0' || protoType === '1' || item.messageType === 'protocolMessage')) {
    const delId = proto.key?.ID ?? proto.key?.id ?? proto.key?.Id;
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
    !!item.IsEdit ||
    !!item.isEdit ||
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

  const { media, caption } = reaction ? { media: null, caption: '' } : extractMedia(effective, item);
  const text = reaction
    ? `reagiu com ${reactionText}`
    : (
        effective.conversation ??
        effective.extendedTextMessage?.text ??
        effective.text ??
        effective.buttonsResponseMessage?.selectedDisplayText ??
        effective.buttonsResponseMessage?.selectedButtonId ??
        effective.templateButtonReplyMessage?.selectedDisplayText ??
        effective.templateButtonReplyMessage?.selectedId ??
        effective.listResponseMessage?.title ??
        effective.listResponseMessage?.singleSelectReply?.selectedRowId ??
        caption ??
        ''
      );

  // The contact is always the OTHER party. For an outgoing (fromMe) DM the Sender
  // is OUR own number, so the contact must come from Chat (the recipient).
  // For an incoming DM the Sender IS the contact and SenderAlt gives its PN↔LID
  // pair. Classify candidates by suffix (@s.whatsapp.net vs @lid) so a LID is
  // never mis-read as a phone number once Meta switches a chat to LID addressing.
  const senderJid = (info.Sender ?? key.participant ?? (fromMe ? '' : chatJid) ?? '').toString();
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
    else if (j.endsWith('@s.whatsapp.net') || j.endsWith('@c.us') || (!j.includes('@') && /^\d+$/.test(j))) {
      pnJid ||= j;
    }
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
  const groupData = (item.groupData ?? item.groupMetadata ?? body.data?.groupData ?? {}) as Record<string, any>;
  const groupName = isGroup ? (groupData.Name ?? groupData.subject ?? item.groupName ?? null) : null;
  const directoryHints =
    isGroup && Array.isArray(groupData.Participants ?? groupData.participants)
      ? ((groupData.Participants ?? groupData.participants) as any[])
          .map((p) => ({
            pn: p?.PhoneNumber?.endsWith?.('@s.whatsapp.net')
              ? normalizePhone(stripJid(p.PhoneNumber), ctx.defaultCountry).digits
              : p?.id?.endsWith?.('@s.whatsapp.net')
                ? normalizePhone(stripJid(p.id), ctx.defaultCountry).digits
                : null,
            lid: (p?.LID ?? p?.JID ?? p?.lid ?? p?.id)?.endsWith?.('@lid')
              ? stripJid(p.LID ?? p.JID ?? p.lid ?? p.id)
              : null,
            // whatsmeow serializes the participant's name as DisplayName.
            pushName: p?.DisplayName ?? p?.PushName ?? p?.Name ?? p?.name ?? null,
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
        providerMessageId ??
        undefined)
      : undefined,
    editedContentUnavailable,
  };

  if (isGroup && ctx.ignoreGroups) result.kind = 'ignored';
  return result;
}
