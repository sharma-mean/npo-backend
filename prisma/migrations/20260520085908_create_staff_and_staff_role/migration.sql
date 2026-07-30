/*
  Warnings:

  - You are about to drop the column `isDeleted` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `lastLoginAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `profileImage` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Staff` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Staff" DROP CONSTRAINT "Staff_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Staff" DROP CONSTRAINT "Staff_roleId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isDeleted",
DROP COLUMN "lastLoginAt",
DROP COLUMN "profileImage",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "dateOfBirth" BIGINT,
ADD COLUMN     "dateOfJoining" BIGINT,
ADD COLUMN     "designationId" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "isLoggedIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastActivityAt" BIGINT,
ADD COLUMN     "loginAt" BIGINT,
ADD COLUMN     "logoutAt" BIGINT;

-- DropTable
DROP TABLE "Staff";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "StaffRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
