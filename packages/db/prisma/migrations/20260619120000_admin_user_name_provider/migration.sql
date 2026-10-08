-- AlterTable: add user identity + auth provider fields, allow null password (for future Google login)
ALTER TABLE "admin_users" ADD COLUMN     "name" TEXT;
ALTER TABLE "admin_users" ADD COLUMN     "auth_provider" TEXT NOT NULL DEFAULT 'password';
ALTER TABLE "admin_users" ADD COLUMN     "google_sub" TEXT;
ALTER TABLE "admin_users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_google_sub_key" ON "admin_users"("google_sub");
