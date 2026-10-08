-- Content-free semantic log of processed messages (type/media/reply), written
-- by the worker after parsing. Complements webhook_events (raw receipt audit).
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "provider" "ProviderType" NOT NULL,
    "direction" "MediaDirection" NOT NULL,
    "message_type" "MessageType" NOT NULL,
    "kind" TEXT NOT NULL,
    "has_media" BOOLEAN NOT NULL,
    "is_reply" BOOLEAN NOT NULL,
    "is_group" BOOLEAN NOT NULL,
    "provider_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_logs_integration_id_created_at_idx" ON "message_logs"("integration_id", "created_at");

-- CreateIndex
CREATE INDEX "message_logs_created_at_idx" ON "message_logs"("created_at");

-- CreateIndex
CREATE INDEX "message_logs_expires_at_idx" ON "message_logs"("expires_at");

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
