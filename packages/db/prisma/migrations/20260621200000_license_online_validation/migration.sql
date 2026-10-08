-- License state moves to fully-online validation: drop the signed-token / grace
-- columns, add plan/expiry/last-validated. The singleton row repopulates on the
-- next online validation, so this is lossless for the stored key.

-- Drop the 'grace' status value (recreate the enum without it).
UPDATE "license_state" SET "status" = 'blocked' WHERE "status" = 'grace';
ALTER TYPE "LicenseStatus" RENAME TO "LicenseStatus_old";
CREATE TYPE "LicenseStatus" AS ENUM ('unactivated', 'active', 'warning', 'blocked');
ALTER TABLE "license_state" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "license_state" ALTER COLUMN "status" TYPE "LicenseStatus" USING ("status"::text::"LicenseStatus");
ALTER TABLE "license_state" ALTER COLUMN "status" SET DEFAULT 'unactivated';
DROP TYPE "LicenseStatus_old";

-- Replace token/grace columns with online-validation fields.
ALTER TABLE "license_state" DROP COLUMN "signed_token";
ALTER TABLE "license_state" DROP COLUMN "token_expires_at";
ALTER TABLE "license_state" DROP COLUMN "grace_until";
ALTER TABLE "license_state" ADD COLUMN "plan" TEXT;
ALTER TABLE "license_state" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "license_state" ADD COLUMN "last_validated_at" TIMESTAMP(3);
