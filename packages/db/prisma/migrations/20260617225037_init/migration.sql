-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('owner', 'admin');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('evolution', 'uazapi', 'zapi');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('open', 'resolved', 'pending');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('unconfigured', 'ok', 'error');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('unactivated', 'active', 'warning', 'grace', 'blocked');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'image', 'audio', 'video', 'document');

-- CreateEnum
CREATE TYPE "DedupDirection" AS ENUM ('phone_origin', 'api_origin');

-- CreateEnum
CREATE TYPE "WebhookSource" AS ENUM ('provider', 'chatwoot');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'owner',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "webhook_token" TEXT NOT NULL,
    "chatwoot_base_url" TEXT NOT NULL,
    "chatwoot_api_token" TEXT NOT NULL,
    "chatwoot_account_id" TEXT NOT NULL,
    "chatwoot_inbox_name" TEXT NOT NULL,
    "chatwoot_inbox_id" TEXT,
    "conversation_status" "ConversationStatus" NOT NULL DEFAULT 'open',
    "reabrir_conversa" BOOLEAN NOT NULL DEFAULT true,
    "desconsiderar_grupo" BOOLEAN NOT NULL DEFAULT true,
    "assinar_mensagem" BOOLEAN NOT NULL DEFAULT true,
    "default_country" TEXT NOT NULL DEFAULT 'BR',
    "provider_type" "ProviderType" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'unconfigured',
    "last_test_chatwoot_at" TIMESTAMP(3),
    "last_test_provider_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "provider_type" "ProviderType" NOT NULL,
    "config" TEXT NOT NULL,
    "provider_identifier" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_mappings" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "chatwoot_message_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "chatwoot_conversation_id" TEXT,
    "chatwoot_inbox_id" TEXT,
    "provider" "ProviderType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dedup_tickets" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "message_type" "MessageType" NOT NULL,
    "direction" "DedupDirection" NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dedup_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT,
    "source" "WebhookSource" NOT NULL,
    "webhook_token" TEXT,
    "origin_detected" TEXT,
    "headers" JSONB,
    "payload" JSONB NOT NULL,
    "enqueued" BOOLEAN NOT NULL DEFAULT false,
    "job_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_state" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "license_key" TEXT,
    "instance_id" TEXT,
    "signed_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "status" "LicenseStatus" NOT NULL DEFAULT 'unactivated',
    "last_heartbeat_at" TIMESTAMP(3),
    "next_heartbeat_at" TIMESTAMP(3),
    "grace_until" TIMESTAMP(3),
    "features" JSONB,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "public_base_url" TEXT,
    "license_server_url" TEXT,
    "setup_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "sessions_admin_user_id_idx" ON "sessions"("admin_user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_webhook_token_key" ON "integrations"("webhook_token");

-- CreateIndex
CREATE UNIQUE INDEX "provider_configs_integration_id_key" ON "provider_configs"("integration_id");

-- CreateIndex
CREATE INDEX "provider_configs_provider_type_provider_identifier_idx" ON "provider_configs"("provider_type", "provider_identifier");

-- CreateIndex
CREATE INDEX "message_mappings_expires_at_idx" ON "message_mappings"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_mappings_integration_id_chatwoot_message_id_key" ON "message_mappings"("integration_id", "chatwoot_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_mappings_integration_id_provider_message_id_key" ON "message_mappings"("integration_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "dedup_tickets_integration_id_recipient_message_type_directi_idx" ON "dedup_tickets"("integration_id", "recipient", "message_type", "direction", "consumed_at");

-- CreateIndex
CREATE INDEX "dedup_tickets_expires_at_idx" ON "dedup_tickets"("expires_at");

-- CreateIndex
CREATE INDEX "webhook_events_integration_id_received_at_idx" ON "webhook_events"("integration_id", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_expires_at_idx" ON "webhook_events"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mappings" ADD CONSTRAINT "message_mappings_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dedup_tickets" ADD CONSTRAINT "dedup_tickets_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
