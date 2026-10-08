import { hmac, logger } from '@wootrico/config';
import { cacheGet, cacheSet } from '@wootrico/cache';
import { prisma } from '@wootrico/db';
import type { AttachmentInput, ChatwootClient } from '@wootrico/chatwoot-client';
import type { WhatsAppProvider } from '@wootrico/providers';

const SYNC_TTL = 7 * 24 * 3600; // a week
const MAX_AVATAR_ATTEMPTS = 5; // bound retries when there's no pic / persistent failure
const AVATAR_RECHECK_MS = 24 * 3600 * 1000; // re-check an existing avatar at most daily (catch changes)
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

interface SyncedMeta {
  name?: string;
  phone?: string;
  avatarOk?: boolean; // avatar successfully UPLOADED to Chatwoot
  avatarUrl?: string; // last avatar URL applied (to detect changes)
  avatarTried?: string; // last target we fetched the avatar for
  avatarAttempts?: number; // fetch attempts so far (caps retries)
  avatarCheckedAt?: number; // epoch ms of the last provider avatar fetch (re-check cadence)
}

/**
 * Download an image to upload to Chatwoot. WhatsApp avatar URLs are fetched while
 * still fresh and the bytes are pushed to Chatwoot directly, so Chatwoot never
 * has to reach the (short-lived, often-unreachable) WhatsApp CDN itself.
 */
async function downloadImage(url: string): Promise<AttachmentInput | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? 'image/jpeg';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_AVATAR_BYTES) return null;
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    return { buffer: buf, filename: `avatar.${ext}`, contentType: ct };
  } catch {
    return null;
  }
}

/**
 * Keep a Chatwoot contact's data fresh. WhatsApp/Meta often omits the phone
 * number and profile info on the FIRST message (LID-only), so the contact is
 * created without them. When that data arrives later — number, display name,
 * avatar — we push it to the SAME contact (resolved via the canonical id) so the
 * conversation never splits and the contact card is completed.
 *
 * Cheap and idempotent: a Redis hash per contact avoids redundant updates, and
 * the avatar is fetched at most once per addressing target (LID, then number).
 */
export async function syncContactMeta(opts: {
  integrationId: string;
  identifier: string; // canonical key, for cache namespacing
  /**
   * ContactIdentity row id, when this contact IS one. Null for groups (keyed by
   * the group id) and for DMs whose identity couldn't be resolved — neither has
   * a row in contact_identities, and writing the avatar/identity against those
   * keys only produced foreign-key errors on every message.
   */
  identityId?: string | null;
  contactId: string | number;
  chatwoot: ChatwootClient;
  provider: WhatsAppProvider;
  name: string | null;
  phoneE164?: string;
  avatarUrl?: string | null; // avatar already present in the payload (e.g. uazapi)
  avatarTarget?: string | null; // phone/jid used to fetch the avatar (e.g. evolution)
}): Promise<void> {
  const key = `cw:meta:${opts.integrationId}:${hmac(opts.identifier)}`;
  const prev = (await cacheGet<SyncedMeta>(key)) ?? {};

  const update: { name?: string; phoneNumber?: string } = {};
  if (opts.name && opts.name !== prev.name) update.name = opts.name;
  if (opts.phoneE164 && opts.phoneE164 !== prev.phone) update.phoneNumber = opts.phoneE164;

  if (Object.keys(update).length) {
    await opts.chatwoot
      .updateContact(opts.contactId, update)
      .catch((err) => logger.debug({ err, integrationId: opts.integrationId }, 'updateContact failed'));
  }

  // Avatar: prefer one already in the payload (uazapi sends senderPhoto). When it
  // isn't there (Evolution), fetch it from the provider. We retry — bounded by
  // MAX_AVATAR_ATTEMPTS — until the image is actually UPLOADED to Chatwoot, since
  // a fresh URL handed to Chatwoot often fails to download server-side.
  const now = Date.now();
  let avatarOk = prev.avatarOk === true;
  let avatarUrl: string | undefined;
  let avatarTried = prev.avatarTried;
  let avatarAttempts = prev.avatarAttempts ?? 0;
  let avatarCheckedAt = prev.avatarCheckedAt ?? 0;

  if (opts.avatarUrl && opts.avatarUrl !== prev.avatarUrl) {
    // Provider sent a (new/changed) avatar in the payload (e.g. uazapi).
    avatarUrl = opts.avatarUrl;
  } else if (
    !opts.avatarUrl &&
    opts.avatarTarget &&
    typeof opts.provider.fetchProfilePictureUrl === 'function' &&
    // Fetch while we don't have one yet (bounded by attempts), OR periodically
    // re-check an existing one so a CHANGED photo is picked up without waiting
    // for the whole cache to expire (e.g. Evolution).
    ((!avatarOk && avatarAttempts < MAX_AVATAR_ATTEMPTS) ||
      (avatarOk && now - avatarCheckedAt > AVATAR_RECHECK_MS))
  ) {
    avatarTried = opts.avatarTarget;
    if (!avatarOk) avatarAttempts += 1; // only count toward the give-up cap while not yet ok
    avatarCheckedAt = now;
    const url = await opts.provider.fetchProfilePictureUrl(opts.avatarTarget).catch(() => null);
    // (Re)apply only when the URL actually changed — avoids redundant re-uploads.
    if (url && url !== prev.avatarUrl) avatarUrl = url;
  }

  if (avatarUrl) {
    // Download while the URL is fresh and push the BYTES to Chatwoot (reliable).
    const img = await downloadImage(avatarUrl);
    if (img) {
      try {
        await opts.chatwoot.setContactAvatar(opts.contactId, img);
        avatarOk = true;
      } catch (err) {
        logger.debug({ err, integrationId: opts.integrationId }, 'setContactAvatar failed');
      }
      // Store the BYTES for the panel (WhatsApp URLs expire) — independent of the
      // media-library config. The panel serves these instead of the volatile URL.
      // Only for a real identity: a group has no contact_identities row.
      if (opts.identityId) {
        await prisma.contactAvatar
          .upsert({
            where: { identityId: opts.identityId },
            create: { identityId: opts.identityId, contentType: img.contentType, data: img.buffer },
            update: { contentType: img.contentType, data: img.buffer },
          })
          .catch((err) => logger.debug({ err }, 'contactAvatar upsert failed'));
      }
    }
    // Mirror onto the GLOBAL identity row so the panel's contacts list shows it.
    if (opts.identityId) {
      await prisma.contactIdentity
        .update({
          where: { id: opts.identityId },
          data: { avatarUrl, ...(img ? { avatarStoredAt: new Date() } : {}) },
        })
        .catch((err) => logger.debug({ err }, 'contactIdentity avatar update failed'));
    }
  }

  await cacheSet(
    key,
    {
      name: opts.name ?? prev.name,
      phone: opts.phoneE164 ?? prev.phone,
      avatarOk,
      avatarUrl: avatarUrl ?? prev.avatarUrl,
      avatarTried,
      avatarAttempts,
      avatarCheckedAt,
    } satisfies SyncedMeta,
    SYNC_TTL,
  );
}
