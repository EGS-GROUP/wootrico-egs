-- Privacy-by-design: webhook_events no longer stores message content.
ALTER TABLE "webhook_events"
  DROP COLUMN IF EXISTS "headers",
  DROP COLUMN IF EXISTS "payload",
  DROP COLUMN IF EXISTS "enqueued",
  DROP COLUMN IF EXISTS "job_id",
  ADD COLUMN "event_type" TEXT,
  ADD COLUMN "accepted" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reason" TEXT;
