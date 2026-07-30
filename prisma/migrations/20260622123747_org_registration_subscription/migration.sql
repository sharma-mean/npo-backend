-- AlterTable
ALTER TABLE "OrganizationSubscription" ADD COLUMN     "amount" DOUBLE PRECISION,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "isTrial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentRef" TEXT,
ADD COLUMN     "planName" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "verifyToken" TEXT,
ADD COLUMN     "verifyTokenExpiry" BIGINT;
