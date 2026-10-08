-- Per-license secret cached on the instance (encrypted at rest with the local
-- APP_ENCRYPTION_KEY). Used to derive the integration-credential seal key.
ALTER TABLE "license_state" ADD COLUMN "data_key" TEXT;
