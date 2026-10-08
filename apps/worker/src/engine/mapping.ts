import { prisma, type ProviderType } from '@wootrico/db';
import { TTL, encrypt, decrypt } from '@wootrico/config';

const ttlMs = TTL.messageMappingDays * 24 * 60 * 60 * 1000;

/** Recipient is stored encrypted (it's a phone/jid, needed only for deletes). */
export function decryptRecipient(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return decrypt(value);
  } catch {
    return undefined;
  }
}

export async function storeMapping(input: {
  integrationId: string;
  chatwootMessageId: string;
  providerMessageId: string;
  chatwootConversationId?: string | null;
  chatwootInboxId?: string | null;
  recipient?: string | null;
  /** JID of the message author (plaintext) — stored encrypted, used for reply quotes. */
  senderJid?: string | null;
  provider: ProviderType;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const data = {
    ...input,
    recipient: input.recipient ? encrypt(input.recipient) : null,
    senderJid: input.senderJid ? encrypt(input.senderJid) : null,
    expiresAt,
  };
  await prisma.messageMapping.upsert({
    where: {
      integrationId_chatwootMessageId: {
        integrationId: input.integrationId,
        chatwootMessageId: input.chatwootMessageId,
      },
    },
    create: data,
    update: {
      providerMessageId: input.providerMessageId,
      recipient: data.recipient,
      senderJid: data.senderJid,
      expiresAt,
    },
  });
}

export async function getProviderMessageId(
  integrationId: string,
  chatwootMessageId: string,
): Promise<string | null> {
  const row = await prisma.messageMapping.findUnique({
    where: { integrationId_chatwootMessageId: { integrationId, chatwootMessageId } },
  });
  return row?.providerMessageId ?? null;
}

export async function getMappingByChatwootId(integrationId: string, chatwootMessageId: string) {
  return prisma.messageMapping.findUnique({
    where: { integrationId_chatwootMessageId: { integrationId, chatwootMessageId } },
  });
}

export async function getMappingByProviderId(integrationId: string, providerMessageId: string) {
  return prisma.messageMapping.findUnique({
    where: { integrationId_providerMessageId: { integrationId, providerMessageId } },
  });
}

export async function removeByChatwootId(
  integrationId: string,
  chatwootMessageId: string,
): Promise<void> {
  await prisma.messageMapping
    .delete({
      where: { integrationId_chatwootMessageId: { integrationId, chatwootMessageId } },
    })
    .catch(() => undefined);
}
