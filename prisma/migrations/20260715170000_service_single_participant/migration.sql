-- One-participant (taxi) transport flag on Service (client #6). Additive.
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "singleParticipant" BOOLEAN NOT NULL DEFAULT false;
