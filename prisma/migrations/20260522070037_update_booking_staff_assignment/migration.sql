/*
  Warnings:

  - Added the required column `organizationId` to the `BookingStaffAssignment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BookingStaffAssignment" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "organizationId" TEXT NOT NULL,
ADD COLUMN     "remarks" TEXT,
ALTER COLUMN "assignedAt" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "BookingStaffAssignment" ADD CONSTRAINT "BookingStaffAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
