import { logger, type MessageType } from '@wootrico/config';
import type { InboundMedia, NormalizedInboundMessage } from '@wootrico/types';
import type { ParseContext } from '../provider.interface.js';
import { normalizePhone } from '../util/phone.js';

function stripJid(v: string | undefined | null): string {
  return (v ?? '').split('@')[0] ?? '';
}

/**
 * Classify a list of JID candidates into (phone, LID) by their SUFFIX.
 *
 * A LID (`123456@lid`) is not a phone number: taken as one it becomes a bogus
 * 15+ digit contact number in Chatwoot and a duplicate of the same person. So
 * candidates are routed by suffix and a bare (suffix-less) value is only
 * accepted as a phone number.
 */
function classifyJids(...candidates: Array<unknown>): { pn: string | null; lid: string | null } {
  let pn: string | null = null;
  let lid: string | null = null;
  for (const raw of candidates) {
    const j = typeof raw === 'string' ? raw.trim() : '';
    if (!j || j.endsWith('@g.us')) continue;
    if (j.endsWith('@lid')) lid ||= stripJid(j);
    else if (j.endsWith('@s.whatsapp.net') || j.endsWith('@c.us') || !j.includes('@'))
      pn ||= stripJid(j);
  }
  return { pn, lid };
}

function mapMediaType(m: Record<string, any>): MessageType | null {
  const raw = (m.mediaType || '').toString().toLowerCase();
  const typeName = (m.messageType || '').toString().toLowerCase();
  if (raw === 'image' || typeName === 'imagemessage') return 'image';
  if (raw === 'ptt' || raw === 'audio' || typeName === 'audiomessage') return 'audio';
  if (raw === 'video' || typeName === 'videomessage') return 'video';
  if (raw === 'document' || typeName === 'documentmessage') return 'document';
  if (raw === 'sticker' || typeName === 'stickermessage') return 'image';
  return null;
}

/** Parse a uazapi webhook payload into the normalized shape. */
export function parseUazapiInbound(
  payload: unknown,
  ctx: ParseContext,
): NormalizedInboundMessage {
  const body = (payload ?? {}) as Record<string, any>;
  const m = (body.message ?? {}) as Record<string, any>;
  const chat = (body.chat ?? {}) as Record<string, any>;
  const content = (m.content ?? {}) as Record<string, any>;

  const base: NormalizedInboundMessage = {
    origin: 'uazapi',
    kind: 'message',
    phone: null,
    text: '',
    name: null,
    isGroup: false,
    fromMe: !!m.fromMe,
    fromApi: !!m.wasSentByApi,
    providerMessageId: m.messageid ?? m.id ?? null,
    status: m.status ?? null,
    raw: payload,
  };

  if (!body.message) {
    return { ...base, kind: 'unknown' };
  }

  // deletion (revoke)
  const messageTypeLc = (m.messageType || '').toString().toLowerCase();
  if (m.wasDeleted === true || messageTypeLc === 'revoked' || messageTypeLc === 'protocolmessage') {
    return {
      ...base,
      kind: 'message_deleted',
      deletedProviderMessageIds: [m.messageid ?? m.id].filter(Boolean) as string[],
    };
  }

  const isGroup =
    m.isGroup === true ||
    (typeof m.chatid === 'string' && m.chatid.endsWith('@g.us')) ||
    (typeof chat.wa_chatid === 'string' && chat.wa_chatid.endsWith('@g.us'));

  // uazapi exposes the sender's phone (sender_pn) and LID (sender_lid) directly,
  // but EVERY `sender*` field describes whoever SENT the message. On a fromMe DM
  // that is the account owner, not the contact — so an outgoing DM must take both
  // identifiers from the CHAT (the recipient). Reading `sender_lid` there paired
  // the contact's phone with the OWNER's LID, and resolveIdentity then merged the
  // two rows: every contact answered from the phone collapsed onto one canonical
  // identity, scrambling names, avatars and conversations.
  //
  // In a group the chat id is the group, never a person, so only the sender
  // fields are used (classifyJids drops @g.us anyway).
  const fromMe = !!m.fromMe;
  const { pn: pnRaw, lid: lidRaw } = isGroup
    ? classifyJids(m.sender_pn, m.sender, m.sender_lid, m.lid)
    : fromMe
      ? classifyJids(m.chatid, chat.wa_chatid, m.chat_lid, m.chatid_lid)
      : classifyJids(m.sender_pn, m.sender, m.sender_lid, m.lid, m.chatid, chat.wa_chatid);
  const { digits } = pnRaw ? normalizePhone(pnRaw, ctx.defaultCountry) : { digits: null };

  // Reaction: uazapi puts the *reacted message id* in m.reaction (a WhatsApp id
  // string) and the emoji in the text field. Chatwoot has no reaction type, so we
  // mirror it as a short text threaded under the reacted message. If we can't find
  // the emoji, ignore it rather than echo the raw id. Empty emoji = reaction removed.
  const isReaction = messageTypeLc === 'reactionmessage' || !!m.reaction;
  const reactedMessageId = typeof m.reaction === 'string' && m.reaction ? m.reaction : null;
  const reactionEmoji = isReaction ? (content.text ?? m.text ?? '').toString().trim() : '';
  if (isReaction) {
    // TEMP debug: confirm where uazapi carries the reaction emoji (keys only, no
    // message content). Remove once reactions are verified working.
    logger.info(
      { msgKeys: Object.keys(m), contentKeys: Object.keys(content), foundEmoji: !!reactionEmoji },
      'uazapi reaction payload shape',
    );
  }
  if (isReaction && !reactionEmoji) {
    return { ...base, kind: 'ignored' };
  }

  const text = isReaction
    ? `reagiu com ${reactionEmoji}`
    : (content.text ?? m.text ?? content.caption ?? '');

  let media: InboundMedia | null = null;
  const mediaType = isReaction ? null : mapMediaType(m);
  if (mediaType) {
    media = {
      type: mediaType,
      url: content.URL ?? content.url,
      mimeType: content.mimetype,
      fileName: content.fileName ?? content.title,
      caption: content.caption ?? '',
    };
  }

  const result: NormalizedInboundMessage = {
    ...base,
    phone: digits,
    lid: lidRaw || null,
    jid: pnRaw || null,
    text,
    media,
    // Chat-scoped fields describe the CONTACT and are safe in both directions.
    // `m.senderName` / `m.senderProfilePic` describe the SENDER, so on a fromMe
    // message they are the account owner's — using them renamed the contact after
    // ourselves and overwrote its avatar with our own profile picture.
    name: chat.name ?? chat.wa_name ?? chat.wa_contactName ?? null,
    senderName: fromMe ? null : (m.senderName ?? null),
    senderPhoto:
      chat.imagePreview ??
      chat.image ??
      chat.thumbnail ??
      (fromMe ? null : (m.senderProfilePic ?? null)),
    isGroup: !!isGroup,
    groupId: isGroup ? (chat.wa_chatid ?? m.chatid ?? null) : null,
    groupName: isGroup ? (m.groupName ?? chat.name ?? null) : null,
    replyToProviderMessageId:
      reactedMessageId ??
      m.quoted ??
      content.contextInfo?.stanzaID ??
      content.contextInfo?.stanzaId ??
      null,
    editedProviderMessageId: m.edited ?? m.editMessageId ?? null,
  };

  if (result.editedProviderMessageId) result.kind = 'message_edited';
  if (isGroup && ctx.ignoreGroups) result.kind = 'ignored';

  return result;
}
