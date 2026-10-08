-- AlterTable: license key owner identity + provisioning source
ALTER TABLE "license_keys" ADD COLUMN     "name" TEXT;
ALTER TABLE "license_keys" ADD COLUMN     "provisioned_by" TEXT NOT NULL DEFAULT 'admin';

-- AlterTable: record client IP per activation
ALTER TABLE "activations" ADD COLUMN     "first_ip" TEXT;
ALTER TABLE "activations" ADD COLUMN     "last_ip" TEXT;

-- CreateIndex
CREATE INDEX "activations_instance_id_idx" ON "activations"("instance_id");

-- CreateTable: unified LGPD-safe access/usage events
CREATE TABLE "license_events" (
    "id" TEXT NOT NULL,
    "license_key_id" TEXT,
    "instance_id" TEXT,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "app_version" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "license_events_license_key_id_created_at_idx" ON "license_events"("license_key_id", "created_at");

-- CreateIndex
CREATE INDEX "license_events_created_at_idx" ON "license_events"("created_at");
