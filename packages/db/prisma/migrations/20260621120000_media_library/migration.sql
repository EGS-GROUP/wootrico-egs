-- CreateEnum
CREATE TYPE "MediaDirection" AS ENUM ('incoming', 'outgoing');

-- AlterTable: media library settings on the singleton.
ALTER TABLE "app_settings" ADD COLUMN     "media_library_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "app_settings" ADD COLUMN     "media_storage_driver" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "app_settings" ADD COLUMN     "media_retention_days" INTEGER;
ALTER TABLE "app_settings" ADD COLUMN     "media_s3_config" TEXT;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "direction" "MediaDirection" NOT NULL,
    "message_type" "MessageType" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_name" TEXT,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_driver" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "phone" TEXT,
    "jid" TEXT,
    "lid" TEXT,
    "sender_name" TEXT,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "group_id" TEXT,
    "provider_type" "ProviderType" NOT NULL,
    "provider_message_id" TEXT,
    "caption" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_assets_integration_id_created_at_idx" ON "media_assets"("integration_id", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_message_type_idx" ON "media_assets"("message_type");

-- CreateIndex
CREATE INDEX "media_assets_direction_idx" ON "media_assets"("direction");

-- CreateIndex
CREATE INDEX "media_assets_phone_idx" ON "media_assets"("phone");

-- CreateIndex
CREATE INDEX "media_assets_jid_idx" ON "media_assets"("jid");

-- CreateIndex
CREATE INDEX "media_assets_expires_at_idx" ON "media_assets"("expires_at");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
