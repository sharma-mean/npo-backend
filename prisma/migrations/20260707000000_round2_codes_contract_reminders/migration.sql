-- AlterTable Organization: code counters + reminder settings
ALTER TABLE "Organization" ADD COLUMN "staffSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Organization" ADD COLUMN "participantSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Organization" ADD COLUMN "reminderHours" INTEGER[] NOT NULL DEFAULT ARRAY[24]::INTEGER[];

-- AlterTable User: report codes + staff contract settings + kana name
ALTER TABLE "User" ADD COLUMN "nameKana" TEXT;
ALTER TABLE "User" ADD COLUMN "userCode" TEXT;
ALTER TABLE "User" ADD COLUMN "contractedHoursPerDay" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "workingDays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::INTEGER[];

-- AlterTable Service: Japanese display name
ALTER TABLE "Service" ADD COLUMN "serviceNameJa" TEXT;

-- AlterTable Booking: per-interval reminder dedupe
ALTER TABLE "Booking" ADD COLUMN "remindersSent" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- Backfill staff codes (S001…) per org by creation order
WITH numbered AS (
  SELECT id,
    'S' || lpad((ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt" ASC, id ASC))::text, 3, '0') AS code
  FROM "User"
  WHERE role = 'STAFF' AND "organizationId" IS NOT NULL
)
UPDATE "User" u SET "userCode" = n.code FROM numbered n WHERE u.id = n.id;

-- Backfill participant codes (P001…) per org by creation order
WITH numbered AS (
  SELECT id,
    'P' || lpad((ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt" ASC, id ASC))::text, 3, '0') AS code
  FROM "User"
  WHERE role = 'PARTICIPANT' AND "organizationId" IS NOT NULL
)
UPDATE "User" u SET "userCode" = n.code FROM numbered n WHERE u.id = n.id;

-- Defensive: ensure every existing participant has a (dummy) login email.
-- New participants require a real email; old rows keep their @npo.local
-- placeholder until an admin/guardian sets a real one (which sends the link).
UPDATE "User"
SET "email" = 'participant.' || id || '@npo.local'
WHERE role = 'PARTICIPANT' AND (email IS NULL OR email = '');

-- Sync org counters to current counts
UPDATE "Organization" o SET "staffSeq" = sub.cnt
FROM (SELECT "organizationId", COUNT(*) AS cnt FROM "User" WHERE role = 'STAFF' AND "organizationId" IS NOT NULL GROUP BY "organizationId") sub
WHERE o.id = sub."organizationId";

UPDATE "Organization" o SET "participantSeq" = sub.cnt
FROM (SELECT "organizationId", COUNT(*) AS cnt FROM "User" WHERE role = 'PARTICIPANT' AND "organizationId" IS NOT NULL GROUP BY "organizationId") sub
WHERE o.id = sub."organizationId";
