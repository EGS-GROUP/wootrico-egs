-- Consecutive failed (unreachable) license checks, used to back off the next
-- attempt (6h → 12h → 24h). An unreachable server NEVER blocks the license; it
-- only spaces out retries. Resets to 0 on any answered validation.
ALTER TABLE "license_state" ADD COLUMN "heartbeat_failures" INTEGER NOT NULL DEFAULT 0;
