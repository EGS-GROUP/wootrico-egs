import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@wootrico/db';

/** Case-insensitive substring search across number, LID and push name. */
function buildWhere(search: string): Prisma.ContactIdentityWhereInput {
  return search
    ? {
        OR: [
          { pn: { contains: search, mode: 'insensitive' } },
          { lid: { contains: search, mode: 'insensitive' } },
          { pushName: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};
}

/** Derived WhatsApp JID: phone-based when known, else the LID address. */
function toJid(pn: string | null, lid: string | null): string | null {
  return pn ? `${pn}@s.whatsapp.net` : lid ? `${lid}@lid` : null;
}

/** Human label for where the contact was observed (CSV). */
function originLabel(seenInDm: boolean, seenInGroup: boolean, groupName: string | null): string {
  const group = groupName ? `Grupo: ${groupName}` : 'Grupo';
  if (seenInDm && seenInGroup) return `Direto e ${group.toLowerCase()}`;
  if (seenInDm) return 'Direto';
  if (seenInGroup) return group;
  return 'Desconhecida';
}

/** Escape one CSV cell (RFC 4180). */
function csvCell(v: string | null): string {
  const s = v ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Read-only view of the GLOBAL contact-identity directory for the panel.
 *
 * We expose the WhatsApp identifiers a non-technical admin cares about — the
 * phone number, the LID and the derived JID — plus the push name, when the
 * contact was first seen and last updated. The internal canonical UUID is
 * deliberately NOT returned: it's an implementation detail of the PN↔LID
 * pairing and never shown in the UI.
 */
export default async function contactRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  app.get('/api/contacts', guard, async (req) => {
    const q = req.query as { search?: string; page?: string; pageSize?: string };

    const search = (q.search ?? '').trim();
    const page = Math.max(parseInt(q.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(q.pageSize ?? '50', 10) || 50, 1), 200);

    const where = buildWhere(search);

    const [total, rows] = await Promise.all([
      app.prisma.contactIdentity.count({ where }),
      app.prisma.contactIdentity.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          lid: true,
          pn: true,
          pushName: true,
          avatarUrl: true,
          avatarStoredAt: true,
          seenInDm: true,
          seenInGroup: true,
          lastGroupName: true,
          createdAt: true,
          updatedAt: true,
          lastSeenAt: true,
        },
      }),
    ]);

    const contacts = rows.map((c) => ({
      jid: toJid(c.pn, c.lid),
      lid: c.lid,
      pn: c.pn,
      pushName: c.pushName,
      // Bytes-backed photo served by the panel (WhatsApp URLs expire). The version
      // (stored-at ms) lets the client cache-bust when the photo changes.
      hasAvatar: !!c.avatarStoredAt,
      avatarVersion: c.avatarStoredAt ? c.avatarStoredAt.getTime() : null,
      // Raw WhatsApp URL — fallback for contacts not re-synced yet (may expire).
      avatarUrl: c.avatarUrl,
      seenInDm: c.seenInDm,
      seenInGroup: c.seenInGroup,
      groupName: c.lastGroupName,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
    }));

    return { contacts, total, page, pageSize };
  });

  // Serve a contact's avatar BYTES (stored when fresh). Keyed by lid/pn (already
  // shown in the table) — the canonical UUID stays hidden.
  app.get('/api/contacts/avatar', guard, async (req, reply) => {
    const { lid, pn } = req.query as { lid?: string; pn?: string };
    const where = lid ? { lid } : pn ? { pn } : null;
    if (!where) return reply.code(400).send({ error: 'bad_request' });
    const ident = await app.prisma.contactIdentity.findFirst({ where, select: { id: true } });
    if (!ident) return reply.code(404).send({ error: 'not_found' });
    const av = await app.prisma.contactAvatar.findUnique({
      where: { identityId: ident.id },
      select: { contentType: true, data: true },
    });
    if (!av) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('Content-Type', av.contentType)
      .header('Cache-Control', 'private, max-age=3600')
      .send(av.data);
  });

  // Full CSV export of the directory (honours the same search filter). Returns
  // the whole filtered set, not just the current page. The UUID stays hidden.
  app.get('/api/contacts/export', guard, async (req, reply) => {
    const q = req.query as { search?: string };
    const where = buildWhere((q.search ?? '').trim());

    const rows = await app.prisma.contactIdentity.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100_000, // safety cap
      select: {
        lid: true,
        pn: true,
        pushName: true,
        seenInDm: true,
        seenInGroup: true,
        lastGroupName: true,
        createdAt: true,
        updatedAt: true,
        lastSeenAt: true,
      },
    });

    const header = ['Nome', 'Numero', 'LID', 'JID', 'Origem', 'Cadastro', 'Atualizacao', 'Ultimo visto'];
    const lines = [header.join(',')];
    for (const c of rows) {
      lines.push(
        [
          csvCell(c.pushName),
          csvCell(c.pn),
          csvCell(c.lid),
          csvCell(toJid(c.pn, c.lid)),
          csvCell(originLabel(c.seenInDm, c.seenInGroup, c.lastGroupName)),
          csvCell(c.createdAt.toISOString()),
          csvCell(c.updatedAt.toISOString()),
          csvCell(c.lastSeenAt ? c.lastSeenAt.toISOString() : null),
        ].join(','),
      );
    }
    // BOM so Excel opens the UTF-8 file with the right encoding.
    const csv = '﻿' + lines.join('\r\n') + '\r\n';

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="contatos.csv"')
      .send(csv);
  });
}
