-- Patch: nameKana was appended to the round2 migration after it had already
-- been applied on the shared DB, so it never ran there. Idempotent re-add.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "nameKana" TEXT;
