-- CreateTable
CREATE TABLE "contact_identities" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "lid" TEXT,
    "pn" TEXT,
    "push_name" TEXT,
    "chatwoot_contact_id" TEXT,
    "chatwoot_conversation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "contact_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_identities_integration_id_idx" ON "contact_identities"("integration_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_identities_integration_id_lid_key" ON "contact_identities"("integration_id", "lid");

-- CreateIndex
CREATE UNIQUE INDEX "contact_identities_integration_id_pn_key" ON "contact_identities"("integration_id", "pn");

-- AddForeignKey
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
