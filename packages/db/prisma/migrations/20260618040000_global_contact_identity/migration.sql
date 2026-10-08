-- Make the contact-identity directory GLOBAL (instance-wide) instead of
-- per-integration. It is a derived cache rebuilt from inbound events, so it is
-- safe to recreate. PN/LID become globally unique.
DROP TABLE IF EXISTS "contact_identities";

CREATE TABLE "contact_identities" (
    "id" TEXT NOT NULL,
    "lid" TEXT,
    "pn" TEXT,
    "push_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "contact_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_identities_lid_key" ON "contact_identities"("lid");

-- CreateIndex
CREATE UNIQUE INDEX "contact_identities_pn_key" ON "contact_identities"("pn");
