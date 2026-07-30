-- AlterTable: per-org monotonic counter for booking codes
ALTER TABLE "Organization" ADD COLUMN "bookingSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: human-friendly sequential booking code (nullable for legacy rows)
ALTER TABLE "Booking" ADD COLUMN "bookingCode" TEXT;

-- Backfill existing bookings with BK#### codes, sequential per org by creation order
WITH numbered AS (
  SELECT
    id,
    'BK' || lpad(
      (ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt" ASC, id ASC))::text,
      4, '0'
    ) AS code
  FROM "Booking"
)
UPDATE "Booking" b
SET "bookingCode" = n.code
FROM numbered n
WHERE b.id = n.id;

-- Sync each org's counter to its current booking count so new codes continue the run
UPDATE "Organization" o
SET "bookingSeq" = sub.cnt
FROM (
  SELECT "organizationId", COUNT(*) AS cnt FROM "Booking" GROUP BY "organizationId"
) sub
WHERE o.id = sub."organizationId";

-- CreateIndex: booking code unique within an org
CREATE UNIQUE INDEX "Booking_organizationId_bookingCode_key" ON "Booking"("organizationId", "bookingCode");
