-- Optional, encrypted connection-string overrides + restart signal.
ALTER TABLE "app_settings" ADD COLUMN     "rabbitmq_url" TEXT;
ALTER TABLE "app_settings" ADD COLUMN     "redis_url" TEXT;
ALTER TABLE "app_settings" ADD COLUMN     "database_url" TEXT;
ALTER TABLE "app_settings" ADD COLUMN     "restart_requested_at" TIMESTAMP(3);
