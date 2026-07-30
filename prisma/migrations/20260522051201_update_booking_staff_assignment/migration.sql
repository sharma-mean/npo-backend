/*
  Warnings:

  - Added the required column `assignedAt` to the `BookingStaffAssignment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `assignmentRole` to the `BookingStaffAssignment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `BookingStaffAssignment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "operationalNotes" TEXT;

-- AlterTable
ALTER TABLE "BookingStaffAssignment" ADD COLUMN     "assignedAt" BIGINT NOT NULL,
ADD COLUMN     "assignedBy" TEXT,
ADD COLUMN     "assignmentRole" TEXT NOT NULL,
ADD COLUMN     "completedAt" BIGINT,
ADD COLUMN     "endedAt" BIGINT,
ADD COLUMN     "startedAt" BIGINT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
ADD COLUMN     "updatedAt" BIGINT NOT NULL;
