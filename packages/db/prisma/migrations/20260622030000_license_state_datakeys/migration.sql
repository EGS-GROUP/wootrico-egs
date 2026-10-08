-- All historical per-license secrets (encrypted JSON array). The seal secret
-- changes on reactivation, so integration credentials may be sealed with any of
-- them — we try all when decrypting. `data_key` remains the primary (for sealing
-- new data).
ALTER TABLE "license_state" ADD COLUMN "data_keys" TEXT;
