-- Account deletion requests, explicit location-sharing consent, and the
-- Recreation guardian-accompaniment check.
--
-- Written idempotently (IF NOT EXISTS / duplicate_object guards) so it is safe
-- to re-run against an environment that already has part of it applied.

-- 1. Explicit opt-in consent for sharing live position during a task.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "consentLocationSharing" BOOLEAN NOT NULL DEFAULT false;

-- 2. Per-service guardian accompaniment requirement + the booking's answer.
ALTER TABLE "Service"
  ADD COLUMN IF NOT EXISTS "requiresGuardianAccompaniment" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "guardianAccompanying" BOOLEAN;

-- 3. Account deletion requests.
DO $$
BEGIN
  CREATE TYPE "DeletionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "AccountDeletionRequest" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT,
  "userId"         TEXT NOT NULL,
  "status"         "DeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reason"         TEXT,
  "decisionNote"   TEXT,
  "handledById"    TEXT,
  "handledAt"      BIGINT,
  "createdAt"      BIGINT NOT NULL,
  "updatedAt"      BIGINT NOT NULL,
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_organizationId_status_idx"
  ON "AccountDeletionRequest" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_userId_status_idx"
  ON "AccountDeletionRequest" ("userId", "status");

DO $$
BEGIN
  ALTER TABLE "AccountDeletionRequest"
    ADD CONSTRAINT "AccountDeletionRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "AccountDeletionRequest"
    ADD CONSTRAINT "AccountDeletionRequest_handledById_fkey"
    FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
