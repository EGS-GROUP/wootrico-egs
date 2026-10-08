import { prisma } from '@wootrico/db';
import { logger } from '@wootrico/config';

/**
 * GLOBAL contact-identity directory (instance-wide, independent of company).
 *
 * WhatsApp is migrating from phone numbers (PN, `@s.whatsapp.net`) to a
 * privacy-preserving LID (`@lid`). The same person can arrive as a PN, a LID,
 * or both, and which one shows up may change over time and differ per company.
 * We pair them onto one canonical UUID shared across every integration, so a
 * number discovered by one company is also resolvable from another company that
 * only ever saw the LID. This is, in effect, our own copy of whatsmeow's PN↔LID
 * map, fed by what the providers give us.
 *
 * Each company still replies using the JID it received and keeps its own
 * Chatwoot contacts/conversations — only this mapping is shared.
 */

export interface ResolvedIdentity {
  /** Canonical key — used as the Chatwoot identifier and for dedup/lock. */
  id: string;
  pn: string | null;
  lid: string | null;
}

export interface IdentityInput {
  pn?: string | null; // phone digits, no @s.whatsapp.net
  lid?: string | null; // LID number, no @lid
  pushName?: string | null;
  source?: 'dm' | 'group'; // where this sender was observed (sets the origin flags)
  groupName?: string | null; // when source==='group', the group's name (for the panel)
}

function clean(v?: string | null): string | null {
  const s = (v ?? '').trim();
  return s ? s : null;
}

function toResolved(row: { id: string; pn: string | null; lid: string | null }): ResolvedIdentity {
  return { id: row.id, pn: row.pn, lid: row.lid };
}

/**
 * Resolve a sender (phone and/or LID) to its canonical identity, pairing the two
 * as they are observed and merging rows that turn out to be the same person.
 * Returns null when neither identifier is present (e.g. group chats).
 */
export async function resolveIdentity(input: IdentityInput): Promise<ResolvedIdentity | null> {
  const pn = clean(input.pn);
  const lid = clean(input.lid);
  const pushName = clean(input.pushName);
  const source = input.source;
  const groupName = source === 'group' ? clean(input.groupName) : null;
  if (!pn && !lid) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const byLid = lid ? await tx.contactIdentity.findUnique({ where: { lid } }) : null;
        const byPn = pn ? await tx.contactIdentity.findUnique({ where: { pn } }) : null;

        // Same person seen under two separate rows → merge (LID is the stable id).
        if (byLid && byPn && byLid.id !== byPn.id) {
          // ...unless the two rows already carry a DIFFERENT counterpart. Then this
          // event contradicts an established pairing and merging would fuse two
          // distinct people into one identity — irreversibly, dragging their
          // Chatwoot contact and conversation with it. A single bad pairing (e.g. a
          // parser handing us the ACCOUNT OWNER's LID on an outgoing message) used
          // to cascade from here until every contact shared one identity.
          // Trust what is already paired, resolve by the LID (the address the
          // message actually arrived on), and make the conflict visible.
          if ((byLid.pn && byLid.pn !== pn) || (byPn.lid && byPn.lid !== lid)) {
            logger.warn(
              { pairedPn: !!byLid.pn, pairedLid: !!byPn.lid },
              'identity: conflicting PN↔LID pairing — refusing to merge',
            );
            return toResolved(byLid);
          }
          await tx.contactIdentity.delete({ where: { id: byPn.id } });
          const merged = await tx.contactIdentity.update({
            where: { id: byLid.id },
            data: {
              pn: byLid.pn ?? byPn.pn ?? pn,
              lid: byLid.lid ?? lid,
              pushName: pushName ?? byLid.pushName ?? byPn.pushName,
              seenInDm: byLid.seenInDm || byPn.seenInDm || source === 'dm',
              seenInGroup: byLid.seenInGroup || byPn.seenInGroup || source === 'group',
              lastGroupName: groupName ?? byLid.lastGroupName ?? byPn.lastGroupName,
              lastSeenAt: new Date(),
            },
          });
          return toResolved(merged);
        }

        const existing = byLid ?? byPn;
        if (existing) {
          const data: Record<string, unknown> = { lastSeenAt: new Date() };
          if (pn && !existing.pn) data.pn = pn;
          if (lid && !existing.lid) data.lid = lid;
          if (pushName && pushName !== existing.pushName) data.pushName = pushName;
          if (source === 'dm' && !existing.seenInDm) data.seenInDm = true;
          if (source === 'group' && !existing.seenInGroup) data.seenInGroup = true;
          if (groupName && groupName !== existing.lastGroupName) data.lastGroupName = groupName;
          const row =
            Object.keys(data).length > 1
              ? await tx.contactIdentity.update({ where: { id: existing.id }, data })
              : existing;
          return toResolved(row);
        }

        const created = await tx.contactIdentity.create({
          data: {
            pn,
            lid,
            pushName,
            seenInDm: source === 'dm',
            seenInGroup: source === 'group',
            lastGroupName: groupName,
            lastSeenAt: new Date(),
          },
        });
        return toResolved(created);
      });
    } catch (err: unknown) {
      // Unique race (two events for the same brand-new contact): retry once.
      if ((err as { code?: string })?.code === 'P2002' && attempt === 0) continue;
      throw err;
    }
  }
  return null;
}

/**
 * Best-effort bulk seed of the directory from a batch of PN↔LID pairs (e.g. a
 * group's participant roster). One INSERT, skipping any that already exist — it
 * fills brand-new entries cheaply; real DM events still do the precise merge.
 */
export async function ingestDirectoryHints(
  hints: Array<{ pn?: string | null; lid?: string | null; pushName?: string | null }>,
  groupName?: string | null,
): Promise<void> {
  // New rows are tagged seen_in_group and carry the roster display name when the
  // provider gives one — so a participant who never sent a DM still shows up
  // named, with the group they came from. skipDuplicates means existing rows are
  // left untouched (the member who actually speaks gets the precise update via
  // resolveIdentity).
  const gname = clean(groupName);
  const rows = hints
    .map((h) => ({
      pn: clean(h.pn),
      lid: clean(h.lid),
      pushName: clean(h.pushName),
      seenInGroup: true,
      lastGroupName: gname,
    }))
    .filter((h) => h.pn || h.lid);
  if (!rows.length) return;
  await prisma.contactIdentity
    .createMany({ data: rows, skipDuplicates: true })
    .catch((err) => logger.debug({ err }, 'ingestDirectoryHints failed'));
}

/** Look up an identity by its canonical id (used on the outbound path). */
export async function getIdentityById(id?: string | null): Promise<ResolvedIdentity | null> {
  if (!id) return null;
  const row = await prisma.contactIdentity.findUnique({ where: { id } });
  return row ? toResolved(row) : null;
}
