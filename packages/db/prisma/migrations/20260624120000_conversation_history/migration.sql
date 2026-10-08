-- Replace the opener-only conversation_logs with a FULL-history model: a
-- conversation grouped by counterparty (peer_key) per integration + one row per
-- message (full text). The old table held only throwaway openers.
DROP TABLE IF EXISTS "conversation_logs";

CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "peer_key" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_number" TEXT,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "preview" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversations_integration_id_peer_key_key" ON "conversations"("integration_id", "peer_key");
CREATE INDEX "conversations_integration_id_last_message_at_idx" ON "conversations"("integration_id", "last_message_at");
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at");

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "MediaDirection" NOT NULL,
    "sender" TEXT,
    "message_type" "MessageType" NOT NULL,
    "text" TEXT NOT NULL,
    "provider_message_id" TEXT,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_messages_conversation_id_provider_message_id_key" ON "conversation_messages"("conversation_id", "provider_message_id");
CREATE INDEX "conversation_messages_conversation_id_at_idx" ON "conversation_messages"("conversation_id", "at");

ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
