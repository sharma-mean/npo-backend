-- Live location on an in-progress assignment. LAST KNOWN ONLY: these columns are
-- overwritten by each ping, only written while status = 'START', and NULLed the
-- moment the task ends. No ping history table on purpose — a staff member's
-- movement trail is surveillance data we don't want to hold.

ALTER TABLE "BookingStaffAssignment" ADD COLUMN IF NOT EXISTS "lastLat" DOUBLE PRECISION;
ALTER TABLE "BookingStaffAssignment" ADD COLUMN IF NOT EXISTS "lastLng" DOUBLE PRECISION;
ALTER TABLE "BookingStaffAssignment" ADD COLUMN IF NOT EXISTS "lastLocationAt" BIGINT;
