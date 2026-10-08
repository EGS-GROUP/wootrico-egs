-- Conversation openers, grouped by Chatwoot conversation (one "window" each).
-- LGPD: stores only the BEGINNING of the opening message (truncated preview).
CREATE TABLE "conversation_logs" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "chatwoot_conversation_id" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_number" TEXT,
    "sender_name" TEXT,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "direction" "MediaDirection" NOT NULL,
    "message_type" "MessageType" NOT NULL,
    "preview" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_logs_integration_id_chatwoot_conversation_id_key" ON "conversation_logs"("integration_id", "chatwoot_conversation_id");
CREATE INDEX "conversation_logs_integration_id_started_at_idx" ON "conversation_logs"("integration_id", "started_at");
CREATE INDEX "conversation_logs_started_at_idx" ON "conversation_logs"("started_at");

ALTER TABLE "conversation_logs" ADD CONSTRAINT "conversation_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conversation-openers retention (default 90 days).
ALTER TABLE "app_settings" ADD COLUMN "conversation_retention_days" INTEGER DEFAULT 90;
