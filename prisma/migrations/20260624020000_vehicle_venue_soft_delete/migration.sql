-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Venue" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- Vehicle plate uniqueness: global -> per-organization
DROP INDEX IF EXISTS "Vehicle_vehicleNumber_key";
CREATE UNIQUE INDEX "Vehicle_organizationId_vehicleNumber_key" ON "Vehicle"("organizationId", "vehicleNumber");
