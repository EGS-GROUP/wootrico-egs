-- Track where a contact identity was observed (DM vs. group participant).
-- Not mutually exclusive: a person can be seen both ways under the same row.
ALTER TABLE "contact_identities" ADD COLUMN "seen_in_dm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contact_identities" ADD COLUMN "seen_in_group" BOOLEAN NOT NULL DEFAULT false;
