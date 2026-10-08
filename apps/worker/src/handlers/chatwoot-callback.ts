import { hmac, logger } from '@wootrico/config';
import { urlToBase64 } from '@wootrico/providers';
import { withLock, throttle } from '@wootrico/cache';
import {
  storeMapping,
  getMappingByChatwootId,
  removeByChatwootId,
  decryptRecipient,
} from '../engine/mapping.js';
import { resolveIdentity, getIdentityById } from '../engine/identity.js';
import { loadIntegrationRuntime } from '../engine/runtime.js';
import { chatwootAttachmentType } from '../lib/message-type.js';
import { storeMediaAsset } from '../lib/media-store.js';
import { logMessage } from '../lib/message-log.js';

/**
 * Is this Chatwoot contact identifier a GROUP? The shape depends on the provider
 * that created it on the inbound path:
 *   evolution / uazapi → `120363…@g.us`   (full JID)
 *   z-api              → `120363…-group`  (new groups)
 *                      → `5511999…-1600694041` (legacy `creator-timestamp`)
 * A DM identifier is either a UUID or plain digits, so neither pattern matches.
 * Getting this wrong sent group replies down the DM path, which broke quoted
 * replies (the participant JID was built from the group id).
 */
function isGroupIdentifier(identifier: unknown): boolean {
  if (typeof identifier !== 'string' || !identifier) return false;
  return (
    identifier.endsWith('@g.us') || identifier.endsWith('-group') || /^\d+-\d+$/.test(identifier)
  );
}

/** Split a provider send target into the (phone, jid, lid) the library indexes. */
function splitTarget(target: string, isGroup: boolean) {
  if (isGroup) return { phone: null, jid: null, lid: null };
  if (target.endsWith('@lid')) return { phone: null, jid: target, lid: target.replace(/@lid$/, '') };
  if (target.includes('@')) return { phone: target.replace(/@.*$/, ''), jid: target, lid: null };
  return { phone: target, jid: `${target}@s.whatsapp.net`, lid: null };
}

const MEDIA_THROTTLE_MS = 1000;

/**
 * Best-effort file name for a Chatwoot attachment. Chatwoot often omits
 * `filename` on the webhook payload, so derive it from the storage URL's
 * basename (decoding %20 etc). Without a name WhatsApp shows documents as
 * "Sem título". Falls back to `arquivo.<ext>` when the URL has no usable name.
 */
function attachmentFileName(att: any): string | undefined {
  if (att.filename) return att.filename;
  try {
    const base = decodeURIComponent(new URL(att.data_url).pathname.split('/').pop() ?? '');
    if (base) return base.includes('.') || !att.extension ? base : `${base}.${att.extension}`;
  } catch {
    /* not a parseable URL — fall through */
  }
  return att.extension ? `arquivo.${att.extension}` : undefined;
}

/** Chatwoot webhook → provider (the outbound pipeline + dedup case 2). */
export async function handleChatwootCallback(
  rawPayload: unknown,
  integrationId: string,
): Promise<void> {
  const payload = rawPayload as any;

  const rt = await loadIntegrationRuntime(integrationId);
  if (!rt || !rt.integration) return;
  const { provider, integration, providerType, inboxId } = rt;

  const eventType = payload?.event;

  // Deletion in Chatwoot → delete on WhatsApp
  if (eventType === 'message_updated') {
    if (payload?.content_attributes?.deleted === true) {
      const cwId = String(payload.id);
      const map = await getMappingByChatwootId(integrationId, cwId);
      if (map?.providerMessageId) {
        await provider
          .deleteMessage(map.providerMessageId, { recipient: decryptRecipient(map.recipient) })
          .catch(() => undefined);
        await removeByChatwootId(integrationId, cwId);
      }
      const delSender = payload?.conversation?.meta?.sender ?? {};
      void logMessage({
        integrationId,
        provider: providerType,
        direction: 'outgoing',
        messageType: 'text',
        kind: 'deleted',
        isReply: false,
        isGroup: isGroupIdentifier(delSender.identifier),
        providerMessageId: map?.providerMessageId ?? null,
      });
    }
    return;
  }

  if (eventType !== 'message_created') return;

  const isOutgoing =
    payload.message_type === 'outgoing' ||
    payload.message_type === 1 ||
    payload.message_type === '1';
  if (!isOutgoing || payload.private === true) return;

  const conversation = payload.conversation ?? {};
  const sender = conversation.meta?.sender ?? {};
  const isGroup = isGroupIdentifier(sender.identifier);

  // canonicalKey: stable id for dedup/lock (same domain as inbound).
  // sendTarget: the actual phone/jid/group we send to on the provider.
  let canonicalKey: string;
  let sendTarget: string;
  if (isGroup) {
    canonicalKey = sender.identifier;
    sendTarget = sender.identifier;
  } else {
    const pn = sender.phone_number ? String(sender.phone_number).replace(/\D/g, '') : null;
    // Chatwoot's contact identifier is our canonical id (set on inbound); fall
    // back to resolving by phone so both paths agree on the same canonical key.
    const identity = pn
      ? await resolveIdentity({ pn })
      : await getIdentityById(sender.identifier);
    canonicalKey = identity?.id ?? pn ?? sender.identifier;
    // Prefer the contact's phone; else the number we discovered for it; else the
    // LID; never fall back to the canonical UUID as a send target.
    sendTarget =
      pn ?? identity?.pn ?? (identity?.lid ? `${identity.lid}@lid` : sender.identifier);
  }
  if (!canonicalKey || !sendTarget) return;

  const attachments: any[] = payload.attachments ?? [];

  // Serialize per conversation (ordering) — same lock domain as inbound.
  await withLock(`lock:conv:${integrationId}:${hmac(canonicalKey)}`, async () => {
    // Idempotency / echo guard — a Chatwoot message that already has a mapping was
    // either already sent to the provider (webhook re-delivery / queue retry) or is
    // the echo of a phone-origin message we mirrored in (inbound stored the mapping
    // keyed by this Chatwoot id). Either way it must NOT be re-sent to WhatsApp.
    const alreadySent = await getMappingByChatwootId(integrationId, String(payload.id));
    if (alreadySent) return;

    // signature
    let content: string = payload.content ?? '';
    if (integration.assinarMensagem && payload.sender?.name) {
      content = `*${payload.sender.name}:*\n\n${content}`;
    }

    // reply mapping (Chatwoot reply → provider quoted message)
    let replyToProviderMessageId: string | null = null;
    let replyToParticipant: string | null = null;
    const inReplyTo = payload.content_attributes?.in_reply_to;
    if (inReplyTo) {
      const quotedMap = await getMappingByChatwootId(integrationId, String(inReplyTo));
      replyToProviderMessageId = quotedMap?.providerMessageId ?? null;
      if (replyToProviderMessageId) {
        // Evolution GO needs the quoted message author's JID to render the quote.
        // Prefer the author stored with the quoted message (works for groups);
        // fall back to the chat partner for DMs (covers older mappings).
        replyToParticipant =
          decryptRecipient(quotedMap?.senderJid ?? null) ??
          (isGroup
            ? null
            : sendTarget.includes('@')
              ? sendTarget
              : `${sendTarget}@s.whatsapp.net`);
      }
    }

    const providerMessageIds: string[] = [];
    if (attachments.length > 0) {
      for (const att of attachments) {
        await throttle(`throttle:media:${integrationId}`, MEDIA_THROTTLE_MS);
        // Download the attachment here (retry/backoff, follows the Chatwoot
        // ActiveStorage→S3 redirect) and send it inline as base64, so the provider
        // doesn't have to reach Chatwoot's storage — that fetch is the slow/flaky
        // step. Fall back to handing over the URL if the download fails, so a
        // misbehaving storage never blocks the send entirely.
        let media: { url?: string; base64?: string; mimeType?: string; fileName?: string };
        try {
          const fetched = await urlToBase64(att.data_url);
          media = {
            base64: fetched.base64,
            mimeType: fetched.mimeType ?? att.content_type ?? undefined,
            fileName: attachmentFileName(att),
          };
        } catch (err) {
          logger.warn({ integrationId, err }, 'callback: media download failed, falling back to URL');
          media = { url: att.data_url, fileName: attachmentFileName(att) };
        }
        const r = await provider.sendMessage({
          recipient: sendTarget,
          type: chatwootAttachmentType(att.file_type),
          content: content || undefined,
          media,
          replyToProviderMessageId,
          replyToParticipant,
        });
        providerMessageIds.push(...r.providerMessageIds);

        // Media library (best-effort). Only when we actually fetched the bytes
        // (the URL fallback above carries no buffer to store).
        if (media.base64) {
          const t = splitTarget(sendTarget, isGroup);
          void storeMediaAsset({
            integrationId,
            direction: 'outgoing',
            messageType: chatwootAttachmentType(att.file_type),
            mimeType: media.mimeType ?? att.content_type ?? 'application/octet-stream',
            fileName: media.fileName,
            buffer: Buffer.from(media.base64, 'base64'),
            caption: payload.content || undefined,
            providerType,
            providerMessageId: r.providerMessageIds[0],
            phone: t.phone,
            jid: t.jid,
            lid: t.lid,
            senderName: sender?.name ?? null,
            isGroup,
            groupId: isGroup ? sendTarget : null,
          });
        }

        content = ''; // caption only on the first attachment
      }
    } else {
      const r = await provider.sendMessage({
        recipient: sendTarget,
        type: 'text',
        content,
        replyToProviderMessageId,
        replyToParticipant,
      });
      providerMessageIds.push(...r.providerMessageIds);
    }

    // Our send echoes back via the provider webhook; inbound dedups it by
    // providerMessageId against the mapping stored just below — no ticket needed.
    if (providerMessageIds[0]) {
      await storeMapping({
        integrationId,
        chatwootMessageId: String(payload.id),
        providerMessageId: providerMessageIds[0],
        chatwootConversationId: String(conversation.id ?? ''),
        chatwootInboxId: inboxId,
        recipient: sendTarget,
        provider: providerType,
      });
    }

    void logMessage({
      integrationId,
      provider: providerType,
      direction: 'outgoing',
      messageType: attachments.length > 0 ? chatwootAttachmentType(attachments[0].file_type) : 'text',
      kind: 'created',
      isReply: Boolean(inReplyTo),
      isGroup,
      providerMessageId: providerMessageIds[0] ?? null,
    });
  });
}
