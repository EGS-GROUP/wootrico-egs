-- Payment config editable from the admin panel (falls back to env when null):
-- the Hotmart checkout link, the webhook token (hottok) and an optional product
-- id filter.
ALTER TABLE "server_settings" ADD COLUMN "checkout_url" TEXT;
ALTER TABLE "server_settings" ADD COLUMN "hotmart_hottok" TEXT;
ALTER TABLE "server_settings" ADD COLUMN "hotmart_product_id" TEXT;
