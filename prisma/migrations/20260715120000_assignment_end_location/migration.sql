-- Persist the FINAL position where a staff task ended (single point, not a trail).
-- Additive + idempotent.
ALTER TABLE "BookingStaffAssignment" ADD COLUMN IF NOT EXISTS "endLat" DOUBLE PRECISION;
ALTER TABLE "BookingStaffAssignment" ADD COLUMN IF NOT EXISTS "endLng" DOUBLE PRECISION;
ALTER TABLE "BookingStaffAssignment" ADD COLUMN IF NOT EXISTS "endLocationAt" BIGINT;
