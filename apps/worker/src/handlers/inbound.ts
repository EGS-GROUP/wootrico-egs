import { logger, hmac } from '@wootrico/config';
import { normalizePhone } from '@wootrico/providers';
import { assertLicenseActive } from '@wootrico/license-client';
import { withLock, cacheGet, cacheSet } from '@wootrico/cache';
import type { ChatwootMessageType, ChatwootConversationStatus } from '@wootrico/chatwoot-client';
import { storeMapping, getMappingByProviderId, removeByChatwootId } from '../engine/mapping.js';
import { resolveIdentity, ingestDirectoryHints } from '../engine/identity.js';
import { syncContactMeta } from '../engine/contact-sync.js';
import { loadIntegrationRuntime } from '../engine/runtime.js';
import { fileNameFor } from '../lib/message-type.js';
import { storeMediaAsset } from '../lib/media-store.js';
import { logMessage } from '../lib/message-log.js';
import { logConversationMessage } from '../lib/conversation-log.js';

const CONTACT_TTL = 3600; // seconds

/** Provider webhook → Chatwoot (inbound pipeline + dedup cases 1/3/4). */
export async function handleInbound(payload: unknown, integrationId: string): Promise<void> {
  const rt = await loadIntegrationRuntime(integrationId);
  if (!rt || !rt.integration) return;
  const { provider, chatwoot, inboxId, providerType, integration } = rt;

  const norm = provider.parseInbound(payload, {
    defaultCountry: integration.defaultCountry,
    ignoreGroups: integration.desconsiderarGrupo,
  });

  if (norm.kind === 'ignored' || norm.kind === 'unknown') {
    // 'ignored' is normal (receipts, presence, empty reactions). 'unknown' means
    // the provider parser didn't recognize the payload shape — usually a
    // provider/gateway mismatch. Surface it so this failure mode isn't invisible.
    if (norm.kind === 'unknown') {
      logger.warn(
        { integrationId, providerType, origin: norm.origin },
        'inbound: payload not recognized by provider parser — message dropped',
      );
    }
    return;
  }

  if (norm.kind === 'message_deleted') {
    for (const pid of norm.deletedProviderMessageIds ?? []) {
      const map = await getMappingByProviderId(integrationId, pid);
      if (map?.chatwootConversationId) {
        await chatwoot
          .deleteMessage(map.chatwootConversationId, map.chatwootMessageId)
          .catch(() => undefined);
        await removeByChatwootId(integrationId, map.chatwootMessageId);
      }
    }
    void logMessage({
      integrationId,
      provider: providerType,
      direction: norm.fromMe ? 'outgoing' : 'incoming',
      messageType: 'text',
      kind: 'deleted',
      isReply: false,
      isGroup: norm.isGroup,
      providerMessageId: norm.deletedProviderMessageIds?.[0] ?? null,
    });
    return;
  }

  const isGroup = norm.isGroup;
  // Pair the sender's PN↔LID onto a GLOBAL canonical id (shared across all
  // companies) for number discovery. For a DM this is the contact; for a group
  // it's just the participant who sent (the conversation is keyed by the group).
  const identity = await resolveIdentity({
    pn: norm.phone,
    lid: norm.lid,
    // In a group, `name` can be the GROUP/chat name (e.g. uazapi sets it to the
    // chat name) — the participant's own name is `senderName`. Use that so a group
    // member isn't saved (or overwritten) under the group's name. For DMs `name`
    // is the contact's own name.
    pushName: isGroup ? norm.senderName : (norm.name ?? norm.senderName),
    source: isGroup ? 'group' : 'dm',
    groupName: isGroup ? norm.groupName : null,
  });
  // Seed the directory with the whole group roster (throttled, best-effort).
  if (isGroup && norm.groupId && norm.directoryHints?.length) {
    const hintKey = `idir:group:${hmac(norm.groupId)}`;
    if ((await cacheGet(hintKey)) == null) {
      await cacheSet(hintKey, 1, 6 * 3600);
      await ingestDirectoryHints(norm.directoryHints, norm.groupName);
    }
  }
  // Canonical key — drives Chatwoot identifier, dedup and per-conversation lock.
  // Groups have no LID identity: they are keyed by the group id.
  const identifier = isGroup
    ? (norm.groupId ?? '')
    : (identity?.id ?? norm.phone ?? norm.jid ?? norm.lid ?? '');
  if (!identifier) return;
  // Actual address used to send/delete on the provider (phone, jid or group id).
  // We reply via what THIS company received, not the globally-discovered number.
  const sendTarget = isGroup
    ? (norm.groupId ?? identifier)
    : (norm.phone ?? norm.jid ?? (identity?.lid ? `${identity.lid}@lid` : identifier));
  // Phone shown in Chatwoot: prefer what arrived, else the number discovered in
  // the global directory (e.g. another company already paired this LID↔number).
  const discoveredPhone = !isGroup ? (norm.phone ?? identity?.pn ?? null) : null;
  // In groups, label each message with who sent it (Chatwoot has no groups, so
  // the whole group is one contact/conversation). Never fall back to `name` in a
  // group — it may be the group's name, not the speaker's.
  const senderLabel = norm.senderName ?? (isGroup ? null : norm.name) ?? null;

  const mirror = async (
    direction: ChatwootMessageType,
    opts?: { bodyOverride?: string; inReplyToOverride?: number; mappingProviderId?: string },
  ): Promise<void> => {
    const contactName = isGroup
      ? (norm.groupName ?? norm.groupId ?? identifier)
      : (norm.name ?? norm.senderName ?? (discoveredPhone ?? sendTarget));
    const phoneNumber =
      !isGroup && discoveredPhone
        ? normalizePhone(discoveredPhone, integration.defaultCountry).e164
        : undefined;
    // Prefix the participant name on group messages so it's clear who spoke.
    const body =
      opts?.bodyOverride ??
      (isGroup && senderLabel ? `*${senderLabel}:*\n${norm.text ?? ''}` : (norm.text ?? ''));

    // contact id is stable → cache it (keyed by pseudonymized identifier)
    const contactKey = `cw:contact:${integrationId}:${hmac(identifier)}`;
    let contactId = await cacheGet<string | number>(contactKey);
    if (!contactId) {
      const contact = await chatwoot.findOrCreateContact({ name: contactName, identifier, phoneNumber });
      contactId = contact?.id;
      if (contactId) await cacheSet(contactKey, contactId, CONTACT_TTL);
    }
    if (!contactId) return logger.warn({ integrationId }, 'inbound: missing contact id');

    // Complete the contact when data not present on the first (LID-only) message
    // arrives later: phone, name and avatar — keeping it the same contact. For a
    // group there's no phone and the name is the group's; the avatar is the
    // group photo (uazapi sends it in the payload; Evolution is fetched from the
    // group id, which is the avatarTarget here).
    await syncContactMeta({
      integrationId,
      identifier,
      // Only a DM has a contact_identities row; a group is keyed by its group id.
      identityId: isGroup ? null : (identity?.id ?? null),
      contactId,
      chatwoot,
      provider,
      name: isGroup ? (norm.groupName ?? null) : (norm.name ?? norm.senderName ?? null),
      phoneE164: phoneNumber,
      avatarUrl: norm.senderPhoto ?? null,
      avatarTarget: sendTarget,
    });

    const conversation = await chatwoot.findOrCreateConversation({
      contactId,
      inboxId,
      status: integration.conversationStatus as ChatwootConversationStatus,
      reopen: integration.reabrirConversa,
    });
    const conversationId = conversation?.id;
    if (!conversationId) return logger.warn({ integrationId }, 'inbound: missing conversation id');

    let inReplyTo: number | undefined = opts?.inReplyToOverride;
    if (inReplyTo == null && norm.replyToProviderMessageId) {
      const m = await getMappingByProviderId(integrationId, norm.replyToProviderMessageId);
      if (m) inReplyTo = Number(m.chatwootMessageId);
    }

    let created: any;
    let base64 = norm.media?.base64;
    let mime = norm.media?.mimeType;
    if (norm.media && !base64) {
      // A media download that fails must NOT cost us the whole message: throwing
      // here sent the job through the retry queue and finally to the dead-letter,
      // so the text/caption was lost too — and when it was the FIRST message of a
      // chat, the conversation never showed up in Chatwoot at all. Mirror a notice
      // instead, so the agent knows to open WhatsApp.
      try {
        const dl = await provider.downloadMedia({
          providerMessageId: norm.providerMessageId ?? undefined,
          url: norm.media.url,
          mimeType: norm.media.mimeType,
          raw: norm.raw,
        });
        base64 = dl.base64;
        mime = dl.mimeType ?? mime;
      } catch (err) {
        logger.warn(
          { err, integrationId, messageType: norm.media.type },
          'inbound: media download failed — mirroring as text',
        );
      }
    }
    if (norm.media && base64) {
      mime = mime ?? 'application/octet-stream';
      // Media library (best-effort, never blocks the mirror). Capture the
      // counterparty number/jid/lid + who sent it for later search/filter.
      if (base64 && norm.media.type !== 'text') {
        void storeMediaAsset({
          integrationId,
          direction,
          messageType: norm.media.type,
          mimeType: mime,
          fileName: norm.media.fileName,
          buffer: Buffer.from(base64, 'base64'),
          caption: norm.media.caption,
          providerType,
          providerMessageId: norm.providerMessageId,
          phone: discoveredPhone ?? norm.phone,
          jid: norm.jid,
          lid: norm.lid,
          senderName: senderLabel,
          isGroup,
          groupId: norm.groupId,
        });
      }
      created = await chatwoot.createMessageWithAttachment({
        conversationId,
        content: body,
        messageType: direction,
        attachment: {
          buffer: Buffer.from(base64, 'base64'),
          filename: norm.media.fileName ?? fileNameFor(mime, 'media'),
          contentType: mime,
        },
        inReplyTo,
        sourceId: norm.providerMessageId ?? undefined,
      });
    } else {
      // Chatwoot rejects a message with neither content nor attachment (422),
      // which the queue treats as permanent and dead-letters — silently losing
      // the message AND, for a first contact, the conversation. Anything we
      // couldn't render (unsupported WhatsApp type, undownloadable media) gets a
      // placeholder so the thread always exists in Chatwoot.
      const fallback = norm.media
        ? `📎 _${norm.media.type} recebido, mas não foi possível baixá-lo. Confira no WhatsApp._`
        : '_(mensagem sem conteúdo suportado — confira no WhatsApp)_';
      created = await chatwoot.createMessage({
        conversationId,
        content: body.trim() ? body : fallback,
        messageType: direction,
        inReplyTo,
        sourceId: norm.providerMessageId ?? undefined,
      });
    }

    // For an edit we store under a synthetic provider id (passed by the caller),
    // because a WhatsApp edit reuses the ORIGINAL message id and that id is already
    // mapped (unique constraint) — the synthetic key keeps the new Chatwoot message
    // mapped (so its echo is deduped by the callback) without colliding.
    const mappingProviderId = opts?.mappingProviderId ?? norm.providerMessageId;
    if (created?.id && mappingProviderId) {
      // Author JID of THIS message — needed later to render a reply quote (esp. in
      // groups, where the quoted author is a specific member). Only known for
      // inbound (incoming) messages; for our own echo (outgoing) the author is the
      // account owner, which we don't resolve here.
      const senderJid =
        direction === 'incoming'
          ? norm.jid
            ? `${norm.jid}@s.whatsapp.net`
            : norm.lid
              ? `${norm.lid}@lid`
              : !isGroup
                ? sendTarget.includes('@')
                  ? sendTarget
                  : `${sendTarget}@s.whatsapp.net`
                : null
          : null;
      await storeMapping({
        integrationId,
        chatwootMessageId: String(created.id),
        providerMessageId: mappingProviderId,
        chatwootConversationId: String(conversationId),
        chatwootInboxId: inboxId,
        recipient: sendTarget,
        senderJid,
        provider: providerType,
      });
    }
  };

  // Serialize per conversation so messages stay ordered (replaces the old delay).
  const lockKey = `lock:conv:${integrationId}:${hmac(identifier)}`;
  await withLock(lockKey, async () => {
    // Edited message — handle BEFORE the idempotency guard: a WhatsApp edit reuses
    // the ORIGINAL message id, so the guard below would see it as already-mirrored
    // and drop the edit. Chatwoot's API cannot change an existing message's content
    // (the `update` action only sets status), so post a NEW message carrying the
    // edited text, threaded under the original via in_reply_to.
    if (norm.kind === 'message_edited') {
      const edited = (norm.text ?? '').trim();
      // Dedup the edit on a synthetic key (original id + edited text) so a queue
      // retry / re-delivery of the same edit doesn't post it twice, while distinct
      // edits of the same message still go through.
      const editKey = `edit:${norm.providerMessageId ?? ''}:${hmac(edited)}`;
      if (await getMappingByProviderId(integrationId, editKey)) return;
      let origCwId: number | undefined;
      if (norm.editedProviderMessageId) {
        const orig = await getMappingByProviderId(integrationId, norm.editedProviderMessageId);
        if (orig) origCwId = Number(orig.chatwootMessageId);
      }
      // When the provider can't give us the new text (encrypted edit), post a notice
      // citing the original so the agent knows to re-check it on WhatsApp.
      const body = norm.editedContentUnavailable
        ? '✏️ _O contato editou esta mensagem — o novo texto não está disponível aqui. Confira no WhatsApp._'
        : edited
          ? `${edited}\n\n_(mensagem editada)_`
          : '_(mensagem editada)_';
      await mirror(norm.fromMe ? 'outgoing' : 'incoming', {
        bodyOverride: body,
        inReplyToOverride: origCwId,
        mappingProviderId: editKey,
      });
      void logMessage({
        integrationId,
        provider: providerType,
        direction: norm.fromMe ? 'outgoing' : 'incoming',
        messageType: norm.media?.type ?? 'text',
        kind: 'edited',
        isReply: Boolean(norm.replyToProviderMessageId || norm.editedProviderMessageId),
        isGroup: norm.isGroup,
        providerMessageId: norm.providerMessageId,
      });
      return;
    }

    // Capture to the conversation HISTORY (FULL text) BEFORE the license gate, so
    // the conversation is preserved even while processing is paused. Both
    // directions (incoming + our own/agent echoes); deduped by providerMessageId.
    await logConversationMessage({
      integrationId,
      peerKey: identifier,
      contactName: isGroup ? (norm.groupName ?? null) : (norm.name ?? norm.senderName ?? null),
      contactNumber: isGroup ? null : (discoveredPhone ?? norm.phone ?? norm.jid ?? null),
      senderName: senderLabel,
      isGroup,
      direction: norm.fromMe ? 'outgoing' : 'incoming',
      messageType: norm.media?.type ?? 'text',
      text: norm.text || norm.media?.caption || null,
      providerMessageId: norm.providerMessageId,
    });

    // License gate — when inactive, the history above is kept but nothing is
    // mirrored to Chatwoot (processing is paused).
    const gate = await assertLicenseActive();
    if (!gate.allowed) {
      logger.warn({ status: gate.status }, 'inbound: license inactive — history kept, chatwoot skipped');
      return;
    }

    // Idempotency guard — if this provider message was already mirrored (queue
    // retry after a transient failure, or a provider re-delivery), skip it so we
    // never create a duplicate in Chatwoot. Covers both directions.
    if (norm.providerMessageId) {
      const already = await getMappingByProviderId(integrationId, norm.providerMessageId);
      if (already) return;
    }
    const logCreated = (direction: 'incoming' | 'outgoing') =>
      void logMessage({
        integrationId,
        provider: providerType,
        direction,
        messageType: norm.media?.type ?? 'text',
        kind: 'created',
        isReply: Boolean(norm.replyToProviderMessageId),
        isGroup: norm.isGroup,
        providerMessageId: norm.providerMessageId,
      });

    // CASE 1 — customer message in
    if (!norm.fromMe) {
      await mirror('incoming');
      logCreated('incoming');
      return;
    }
    // fromMe — either our own API-send echoing back (already short-circuited by the
    // idempotency guard above, which matches it by providerMessageId), or the owner
    // typing on the phone, which we mirror into Chatwoot as an outgoing message.
    await mirror('outgoing');
    logCreated('outgoing');
  });
}
