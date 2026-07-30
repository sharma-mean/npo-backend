-- AlterTable: user avatar + org brand logo (small data-URLs)
ALTER TABLE "User" ADD COLUMN "profileImage" TEXT;
ALTER TABLE "Organization" ADD COLUMN "brandLogo" TEXT;
