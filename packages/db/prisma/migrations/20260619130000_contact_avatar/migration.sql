-- AlterTable: store the last WhatsApp profile picture URL seen for a contact identity
ALTER TABLE "contact_identities" ADD COLUMN     "avatar_url" TEXT;
