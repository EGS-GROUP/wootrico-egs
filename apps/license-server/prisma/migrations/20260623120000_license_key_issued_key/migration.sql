-- Raw key parked for an ADMIN-GRANTED trial, so the server can hand it to the
-- matching customer on provision (matched by e-mail) — the customer never types
-- a key. Null for self-service trials and paid keys (which store only the hash).
ALTER TABLE "license_keys" ADD COLUMN "issued_key" TEXT;
