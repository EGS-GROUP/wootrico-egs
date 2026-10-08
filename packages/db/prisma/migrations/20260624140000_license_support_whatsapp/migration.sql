-- Global support WhatsApp number, delivered by the license server on each
-- validate (same cadence as the heartbeat) and shown on the panel's Support page.
ALTER TABLE "license_state" ADD COLUMN "support_whatsapp" TEXT;
