-- Payment ledger: every payment event (Hotmart or other), for history per-key,
-- per-user and overall, and to drive the payments dashboard. Idempotent by
-- transaction. Paid keys are now time-limited (default 1 year) — the expiry is
-- already stored on license_keys.expires_at (previously null for paid).
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "transaction" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'hotmart',
    "event" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'purchase',
    "status" TEXT,
    "email" TEXT,
    "instance_id" TEXT,
    "license_key_id" TEXT,
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "expires_at" TIMESTAMP(3),
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_transaction_event_idx" ON "payments"("transaction", "event");
CREATE INDEX "payments_email_created_at_idx" ON "payments"("email", "created_at");
CREATE INDEX "payments_license_key_id_created_at_idx" ON "payments"("license_key_id", "created_at");
CREATE INDEX "payments_kind_created_at_idx" ON "payments"("kind", "created_at");
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");
