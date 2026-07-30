-- Replace emailVerified boolean with emailVerifiedAt timestamp (null = unverified)
ALTER TABLE "User" DROP COLUMN IF EXISTS "emailVerified";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" BIGINT;
