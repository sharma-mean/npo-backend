/*
  Warnings:

  - You are about to drop the `Guardian` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Participant` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "StaffRoleType" AS ENUM ('DRIVER', 'SUPPORT_WORKER', 'COORDINATOR', 'NURSE', 'ACTIVITY_LEADER', 'OTHER');

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_guardianId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_participantId_fkey";

-- DropForeignKey
ALTER TABLE "Guardian" DROP CONSTRAINT "Guardian_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_guardianId_fkey";

-- DropForeignKey
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_organizationId_fkey";

-- AlterTable
ALTER TABLE "StaffRole" ADD COLUMN     "roleType" "StaffRoleType" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "emergencyInstructions" TEXT,
ADD COLUMN     "participantStatus" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT;

-- DropTable
DROP TABLE "Guardian";

-- DropTable
DROP TABLE "Participant";

-- DropEnum
DROP TYPE "Gender";

-- DropEnum
DROP TYPE "GuardianStatus";

-- DropEnum
DROP TYPE "ParticipantStatus";

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
