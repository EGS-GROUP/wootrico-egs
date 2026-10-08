-- Singleton row for vendor-configurable server settings (edited from the admin
-- panel). `log_retention_days` drives the periodic purge of license_events and
-- heartbeat_log; null = keep forever (default).
CREATE TABLE "server_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "log_retention_days" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_settings_pkey" PRIMARY KEY ("id")
);
