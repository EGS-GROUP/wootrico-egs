-- Store avatar bytes so the panel shows contact photos reliably (WhatsApp URLs
-- expire). + a marker/cache-bust timestamp on the identity.
ALTER TABLE "contact_identities" ADD COLUMN "avatar_stored_at" TIMESTAMP(3);

CREATE TABLE "contact_avatars" (
    "identity_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_avatars_pkey" PRIMARY KEY ("identity_id")
);

ALTER TABLE "contact_avatars" ADD CONSTRAINT "contact_avatars_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "contact_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
