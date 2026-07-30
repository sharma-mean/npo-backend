-- Staff accept/decline gate on booking assignments.
-- Soft acknowledgement: a new assignment starts PENDING_ACCEPTANCE; the staff
-- member must accept before they can START, or decline (with a reason).

ALTER TABLE "BookingStaffAssignment"
  ADD COLUMN IF NOT EXISTS "acceptedAt" BIGINT,
  ADD COLUMN IF NOT EXISTS "declinedAt" BIGINT,
  ADD COLUMN IF NOT EXISTS "declineReason" TEXT;

-- Default for NEW rows only. Existing assignments were auto-accepted under the
-- old model, so leave their status untouched (they stay ASSIGNED/START/…).
ALTER TABLE "BookingStaffAssignment"
  ALTER COLUMN "status" SET DEFAULT 'PENDING_ACCEPTANCE';
