-- SOW gap closure batch 1: staff types, assistant staffing, service cap, attendance tags.
-- Enum values (idempotent).
ALTER TYPE "StaffRoleType" ADD VALUE IF NOT EXISTS 'ASSISTANT';
ALTER TYPE "StaffRoleType" ADD VALUE IF NOT EXISTS 'HELPER';
ALTER TYPE "StaffRoleType" ADD VALUE IF NOT EXISTS 'CHEF';
ALTER TYPE "StaffRoleType" ADD VALUE IF NOT EXISTS 'MAID';
ALTER TYPE "StaffRoleType" ADD VALUE IF NOT EXISTS 'VOLUNTEER';
ALTER TYPE "StaffRoleType" ADD VALUE IF NOT EXISTS 'TEMPORARY';

-- Service: assistants staffing + per-service participant cap.
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "minAssistants" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "ratioAssistants" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "maxParticipants" INTEGER;

-- Attendance: structured operational remark tag.
ALTER TABLE "StaffAttendance" ADD COLUMN IF NOT EXISTS "operationalRemark" TEXT;
