import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@wootrico/db';
import { requireActiveLicense } from '../lib/license-guard.js';

const DISPLAY_MAX = 200; // panel shows a TRUNCATED view; export keeps the full text

/** Search across the contact name, number and the latest-message preview. */
function buildWhere(search: string, from?: string, to?: string): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = {};
  if (search) {
    where.OR = [
      { contactName: { contains: search, mode: 'insensitive' } },
      { contactNumber: { contains: search, mode: 'insensitive' } },
      { preview: { contains: search, mode: 'insensitive' } },
    ];
  }
  const lastMessageAt: { gte?: Date; lte?: Date } = {};
  if (from) lastMessageAt.gte = new Date(from);
  if (to) lastMessageAt.lte = new Date(to);
  if (from || to) where.lastMessageAt = lastMessageAt;
  return where;
}

function trunc(s: string): string {
  return s.length > DISPLAY_MAX ? `${s.slice(0, DISPLAY_MAX)}…` : s;
}
function clean(v: string | null): string {
  return (v ?? '').replace(/[\r\n]+/g, ' ').trim();
}

const MSG_ORDER = { at: 'asc' } as const;

/**
 * Captured conversations — grouped by counterparty. The FULL message text is
 * stored; the panel only ever shows a TRUNCATED view (detail) and the export
 * carries the full text. All endpoints require an ACTIVE license; without it the
 * feature is blocked (settings stay editable). Capture itself happens in the
 * worker regardless of license, so history is preserved while paused.
 */
export default async function conversationRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] };

  app.get('/api/conversations', guard, async (req, reply) => {
    const lic = await requireActiveLicense();
    if (!lic.allowed) return reply.code(403).send({ error: 'license_inactive', status: lic.status });

    const q = req.query as { search?: string; from?: string; to?: string; page?: string; pageSize?: string };
    const search = (q.search ?? '').trim();
    const page = Math.max(parseInt(q.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(q.pageSize ?? '50', 10) || 50, 1), 200);
    const where = buildWhere(search, q.from, q.to);

    const [total, rows] = await Promise.all([
      app.prisma.conversation.count({ where }),
      app.prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          contactName: true,
          contactNumber: true,
          isGroup: true,
          preview: true,
          startedAt: true,
          lastMessageAt: true,
          integration: { select: { name: true } },
          _count: { select: { messages: true } },
        },
      }),
    ]);

    const conversations = rows.map((c) => ({
      id: c.id,
      name: c.contactName,
      number: c.contactNumber,
      isGroup: c.isGroup,
      preview: c.preview,
      integration: c.integration?.name ?? null,
      messageCount: c._count.messages,
      startedAt: c.startedAt.toISOString(),
      lastMessageAt: c.lastMessageAt.toISOString(),
    }));
    return { conversations, total, page, pageSize };
  });

  // Conversation detail — messages TRUNCATED for display.
  app.get('/api/conversations/:id', guard, async (req, reply) => {
    const lic = await requireActiveLicense();
    if (!lic.allowed) return reply.code(403).send({ error: 'license_inactive', status: lic.status });
    const { id } = req.params as { id: string };
    const c = await app.prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        contactName: true,
        contactNumber: true,
        isGroup: true,
        integration: { select: { name: true } },
        startedAt: true,
        messages: { orderBy: MSG_ORDER, select: { at: true, direction: true, sender: true, messageType: true, text: true } },
      },
    });
    if (!c) return reply.code(404).send({ error: 'not_found' });
    return {
      id: c.id,
      name: c.contactName,
      number: c.contactNumber,
      isGroup: c.isGroup,
      integration: c.integration?.name ?? null,
      startedAt: c.startedAt.toISOString(),
      messages: c.messages.map((m) => ({
        at: m.at.toISOString(),
        direction: m.direction,
        sender: m.sender,
        type: m.messageType,
        text: trunc(m.text), // TRUNCATED for display
      })),
    };
  });

  // Export selected (ids) or all matching — JSON or TXT, with the FULL text.
  app.get('/api/conversations/export', guard, async (req, reply) => {
    const lic = await requireActiveLicense();
    if (!lic.allowed) return reply.code(403).send({ error: 'license_inactive', status: lic.status });

    const q = req.query as { format?: string; ids?: string; search?: string; from?: string; to?: string };
    const format = q.format === 'json' ? 'json' : 'txt';
    const ids = (q.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const where = ids.length ? { id: { in: ids } } : buildWhere((q.search ?? '').trim(), q.from, q.to);

    const rows = await app.prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'asc' },
      take: 50_000, // safety cap
      select: {
        contactName: true,
        contactNumber: true,
        isGroup: true,
        integration: { select: { name: true } },
        startedAt: true,
        messages: { orderBy: MSG_ORDER, select: { at: true, direction: true, sender: true, text: true } },
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      const data = rows.map((c) => ({
        nome: c.contactName,
        numero: c.contactNumber,
        grupo: c.isGroup,
        integracao: c.integration?.name ?? null,
        inicio: c.startedAt.toISOString(),
        mensagens: c.messages.map((m) => ({
          data: m.at.toISOString().slice(0, 10),
          hora: m.at.toISOString().slice(11, 19),
          remetente: m.sender,
          direcao: m.direction,
          frase: m.text, // FULL
        })),
      }));
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="conversas-${stamp}.json"`)
        .send(JSON.stringify(data, null, 2));
    }

    const blocks = rows.map((c) => {
      const who = clean(c.contactName) || clean(c.contactNumber) || 'sem nome';
      const num = c.contactNumber ? ` (${clean(c.contactNumber)})` : '';
      const header = `=== ${who}${num} ===`;
      const lines = c.messages.map((m) => {
        const when = `${m.at.toISOString().slice(0, 10)} ${m.at.toISOString().slice(11, 19)}`;
        const sender = m.sender ? `${clean(m.sender)}: ` : m.direction === 'outgoing' ? 'Eu: ' : '';
        return `${when} ${sender}${clean(m.text)}`;
      });
      return [header, ...lines].join('\r\n');
    });
    const txt = '﻿' + blocks.join('\r\n\r\n') + '\r\n';
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="conversas-${stamp}.txt"`)
      .send(txt);
  });
}
