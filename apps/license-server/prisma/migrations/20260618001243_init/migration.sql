-- CreateTable
CREATE TABLE "license_keys" (
    "id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'pro',
    "email" TEXT,
    "features" JSONB,
    "max_activations" INTEGER NOT NULL DEFAULT 1,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activations" (
    "id" TEXT NOT NULL,
    "license_key_id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "app_version" TEXT,
    "public_base_url" TEXT,
    "bound_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_heartbeat_at" TIMESTAMP(3),
    "last_telemetry" JSONB,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heartbeat_log" (
    "id" TEXT NOT NULL,
    "license_key_id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "telemetry" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heartbeat_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "license_keys_key_hash_key" ON "license_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "activations_license_key_id_instance_id_key" ON "activations"("license_key_id", "instance_id");

-- CreateIndex
CREATE INDEX "heartbeat_log_license_key_id_created_at_idx" ON "heartbeat_log"("license_key_id", "created_at");

-- AddForeignKey
ALTER TABLE "activations" ADD CONSTRAINT "activations_license_key_id_fkey" FOREIGN KEY ("license_key_id") REFERENCES "license_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
