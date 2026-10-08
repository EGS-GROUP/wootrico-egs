-- App-level system-log retention (null = keep forever; default 14 days).
ALTER TABLE "app_settings" ADD COLUMN "log_retention_days" INTEGER DEFAULT 14;

-- Retention is now driven by AppSettings.logRetentionDays (createdAt-based sweep),
-- so per-row TTLs on logs become optional and the expires_at indexes are dropped.
DROP INDEX "message_logs_expires_at_idx";
ALTER TABLE "message_logs" ALTER COLUMN "expires_at" DROP NOT NULL;

DROP INDEX "webhook_events_expires_at_idx";
ALTER TABLE "webhook_events" ALTER COLUMN "expires_at" DROP NOT NULL;

-- Support the receivedAt-based webhook log sweep.
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events"("received_at");
