-- Separate "needs wheelchair" from "needs transport" (mobilitySupport).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "needsWheelchair" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: until now the system treated mobilitySupport as "needs wheelchair",
-- so carry that over to preserve vehicle-matching behavior for existing data.
UPDATE "User" SET "needsWheelchair" = true WHERE "mobilitySupport" = true AND "role" = 'PARTICIPANT';
