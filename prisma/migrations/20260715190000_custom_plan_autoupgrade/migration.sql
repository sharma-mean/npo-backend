-- Custom plan (per-participant) + provisional auto-upgrade state (UC 35–37). Additive.
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "isCustom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "pricePerParticipant" DOUBLE PRECISION;

ALTER TABLE "OrganizationSubscription" ADD COLUMN IF NOT EXISTS "provisionalPlanId" TEXT;
ALTER TABLE "OrganizationSubscription" ADD COLUMN IF NOT EXISTS "previousPlanId" TEXT;
ALTER TABLE "OrganizationSubscription" ADD COLUMN IF NOT EXISTS "provisionalUntil" BIGINT;
ALTER TABLE "OrganizationSubscription" ADD COLUMN IF NOT EXISTS "provisionalInvoiceRef" TEXT;
