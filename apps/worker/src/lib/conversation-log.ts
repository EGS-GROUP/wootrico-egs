import { logger, type MessageType } from '@wootrico/config';
import { prisma } from '@wootrico/db';

const PREVIEW_MAX = 200; // panel "gist" preview — the FULL text is stored separately

export interface ConversationMessageInput {
  integrationId: string;
  peerKey: string; // canonical contact/group key (always available, even unlicensed)
  contactName?: string | null;
  contactNumber?: string | null;
  senderName?: string | null;
  isGroup: boolean;
  direction: 'incoming' | 'outgoing';
  messageType: MessageType;
  text?: string | null; // FULL text (stored complete; truncated only for display)
  providerMessageId?: string | null;
}

function gist(text: string, type: MessageType): string {
  const base = text || (type === 'text' ? '' : `[${type}]`);
  return base.length > PREVIEW_MAX ? `${base.slice(0, PREVIEW_MAX)}…` : base;
}

/**
 * Record a message into the conversation history. The FULL text is kept — the
 * panel only ever shows a truncated view, and export/full-view are gated by an
 * active license. Capture runs BEFORE the license gate, so history is preserved
 * even while processing is paused. Grouped by counterparty (peerKey). The caller
 * holds the per-conversation lock, so the header upsert + insert are race-free.
 * Deduped by providerMessageId. Best-effort: never throws into the pipeline.
 */
export async function logConversationMessage(input: ConversationMessageInput): Promise<void> {
  try {
    const text = (input.text ?? '').trim();
    const now = new Date();

    const conv = await prisma.conversation.upsert({
      where: {
        integrationId_peerKey: { integrationId: input.integrationId, peerKey: input.peerKey },
      },
      create: {
        integrationId: input.integrationId,
        peerKey: input.peerKey,
        contactName: input.contactName ?? null,
        contactNumber: input.contactNumber ?? null,
        isGroup: input.isGroup,
        preview: gist(text, input.messageType),
        startedAt: now,
        lastMessageAt: now,
      },
      update: {
        ...(input.contactName ? { contactName: input.contactName } : {}),
        ...(input.contactNumber ? { contactNumber: input.contactNumber } : {}),
        preview: gist(text, input.messageType),
        lastMessageAt: now,
      },
      select: { id: true },
    });

    await prisma.conversationMessage.createMany({
      data: [
        {
          conversationId: conv.id,
          at: now,
          direction: input.direction,
          sender: input.senderName ?? null,
          messageType: input.messageType,
          text, // FULL
          providerMessageId: input.providerMessageId ?? null,
        },
      ],
      skipDuplicates: true, // re-delivery with same providerMessageId → no dup
    });
  } catch (err) {
    logger.warn({ err, integrationId: input.integrationId }, 'conversation history log failed (ignored)');
  }
}
