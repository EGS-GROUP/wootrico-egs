-- Support: a WhatsApp number configured by the vendor (delivered to all clients
-- via the validate response) + customer-opened support tickets.
ALTER TABLE "server_settings" ADD COLUMN "support_whatsapp" TEXT;

CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT,
    "license_key_id" TEXT,
    "email" TEXT,
    "plan" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_status_created_at_idx" ON "support_tickets"("status", "created_at");
CREATE INDEX "support_tickets_email_created_at_idx" ON "support_tickets"("email", "created_at");
