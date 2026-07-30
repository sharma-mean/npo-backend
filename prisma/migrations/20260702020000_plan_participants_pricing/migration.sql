-- AlterTable: participant-based ¥ pricing fields on SubscriptionPlan
ALTER TABLE "SubscriptionPlan" ADD COLUMN "nameJa" TEXT;
ALTER TABLE "SubscriptionPlan" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'JPY';
ALTER TABLE "SubscriptionPlan" ADD COLUMN "maxParticipants" INTEGER;
ALTER TABLE "SubscriptionPlan" ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SubscriptionPlan" ADD COLUMN "isRecommended" BOOLEAN NOT NULL DEFAULT false;

-- Existing (pre-restructure) plans were seeded in USD; keep them labeled correctly.
UPDATE "SubscriptionPlan" SET "currency" = 'USD' WHERE "createdAt" < (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
