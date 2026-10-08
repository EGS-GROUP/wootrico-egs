-- Name of the most recent group a contact was seen in, so the panel can signal
-- which group a group-origin contact came from (besides the person's own name).
ALTER TABLE "contact_identities" ADD COLUMN "last_group_name" TEXT;
