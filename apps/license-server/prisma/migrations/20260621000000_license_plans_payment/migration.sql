-- AlterTable: trial/paid plans with expiry. Default flips to 'trial'; legacy
-- rows (any plan other than trial/paid, e.g. 'pro') are migrated to 'paid' so
-- existing customers never expire.
ALTER TABLE "license_keys" ADD COLUMN     "expires_at" TIMESTAMP(3);
ALTER TABLE "license_keys" ALTER COLUMN "plan" SET DEFAULT 'trial';
UPDATE "license_keys" SET "plan" = 'paid' WHERE "plan" NOT IN ('trial', 'paid');

-- CreateTable: webhook authentication keys (payment provider -> license server)
CREATE TABLE "webhook_keys" (
    "id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "name" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_keys_key_hash_key" ON "webhook_keys"("key_hash");

-- CreateTable: purchase intents (which installation is buying), settled by webhook
CREATE TABLE "purchase_intents" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "license_key_id" TEXT,
    "issued_key" TEXT,
    "payment_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "purchase_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_intents_email_status_created_at_idx" ON "purchase_intents"("email", "status", "created_at");

-- CreateIndex
CREATE INDEX "purchase_intents_instance_id_idx" ON "purchase_intents"("instance_id");
