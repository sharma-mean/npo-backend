-- Venue coordinates, geocoded on demand and cached (same pattern as Booking.pickupLat).
ALTER TABLE "Venue" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "Venue" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
