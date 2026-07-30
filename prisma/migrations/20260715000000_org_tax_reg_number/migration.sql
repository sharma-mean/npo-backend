-- Per-org qualified-invoice registration number (client feedback #4).
-- Additive + idempotent: safe to re-run.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "taxRegistrationNumber" TEXT;
