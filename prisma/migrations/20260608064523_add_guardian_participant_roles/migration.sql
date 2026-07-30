-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'GUARDIAN';
ALTER TYPE "UserRole" ADD VALUE 'PARTICIPANT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "allergyNotes" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "guardianUserId" TEXT,
ADD COLUMN     "medicalNotes" TEXT,
ADD COLUMN     "mobilitySupport" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "relationshipType" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
