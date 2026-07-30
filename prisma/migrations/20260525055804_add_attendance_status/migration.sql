-- AlterTable
ALTER TABLE "StaffAttendance" ADD COLUMN     "attendanceStatus" TEXT NOT NULL DEFAULT 'CHECKED_IN',
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leaveReason" TEXT;
