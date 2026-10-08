-- Per-license secret delivered to active instances. Used by the customer image
-- to derive the integration-credential encryption key (license-sealed crypto).
-- Existing keys backfill a secret lazily on their next activate/validate.
ALTER TABLE "license_keys" ADD COLUMN "secret" TEXT;
