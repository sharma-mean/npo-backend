-- Restrict-after-unpaid-revert flag (client edge case). Additive.
ALTER TABLE "OrganizationSubscription" ADD COLUMN IF NOT EXISTS "autoUpgradeBlockedAt" BIGINT;
