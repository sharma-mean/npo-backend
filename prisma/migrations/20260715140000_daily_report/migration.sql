-- Per-participant daily contact-book report (連絡帳). Additive + idempotent.
DO $$ BEGIN
  CREATE TYPE "DailyReportStatus" AS ENUM ('DRAFT', 'FINALIZED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "DailyReport" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "bookingId"      TEXT,
  "participantId"  TEXT NOT NULL,
  "guardianId"     TEXT,
  "staffId"        TEXT NOT NULL,
  "reportDate"     BIGINT NOT NULL,
  "vigorLevel"     INTEGER,
  "states"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "bodyTemp"       DOUBLE PRECISION,
  "bedtime"        TEXT,
  "wakeTime"       TEXT,
  "nightWakings"   TEXT,
  "belongings"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "pickup"         TEXT,
  "dropoff"        TEXT,
  "notes"          TEXT,
  "status"         "DailyReportStatus" NOT NULL DEFAULT 'DRAFT',
  "finalizedAt"    BIGINT,
  "isDeleted"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      BIGINT NOT NULL,
  "updatedAt"      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS "DailyReport_organizationId_status_isDeleted_idx" ON "DailyReport" ("organizationId", "status", "isDeleted");
CREATE INDEX IF NOT EXISTS "DailyReport_participantId_idx" ON "DailyReport" ("participantId");
CREATE INDEX IF NOT EXISTS "DailyReport_guardianId_idx" ON "DailyReport" ("guardianId");
CREATE INDEX IF NOT EXISTS "DailyReport_staffId_idx" ON "DailyReport" ("staffId");
CREATE INDEX IF NOT EXISTS "DailyReport_bookingId_idx" ON "DailyReport" ("bookingId");

DO $$ BEGIN
  ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
