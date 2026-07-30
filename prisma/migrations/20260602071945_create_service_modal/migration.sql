-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" "ServiceType",
    "serviceName" TEXT NOT NULL,
    "defaultCapacity" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "description" TEXT,
    "requiresTransport" BOOLEAN NOT NULL DEFAULT false,
    "requiresStaff" BOOLEAN NOT NULL DEFAULT true,
    "slotTemplates" JSONB,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
