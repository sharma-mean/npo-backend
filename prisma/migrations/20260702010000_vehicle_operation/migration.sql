-- CreateTable
CREATE TABLE "VehicleOperation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "totalTrips" INTEGER NOT NULL DEFAULT 0,
    "totalKm" INTEGER NOT NULL DEFAULT 0,
    "fuelCost" INTEGER NOT NULL DEFAULT 0,
    "maintenanceCost" INTEGER NOT NULL DEFAULT 0,
    "insuranceCost" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,

    CONSTRAINT "VehicleOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleOperation_vehicleId_month_year_key" ON "VehicleOperation"("vehicleId", "month", "year");

-- CreateIndex
CREATE INDEX "VehicleOperation_organizationId_year_month_idx" ON "VehicleOperation"("organizationId", "year", "month");

-- AddForeignKey
ALTER TABLE "VehicleOperation" ADD CONSTRAINT "VehicleOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOperation" ADD CONSTRAINT "VehicleOperation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
