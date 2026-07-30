const prisma = require("../../config/db");
const { logAudit } = require("../../utils/auditLogger");
const { validateOperationInput } = require("./vehicleOperation.validation");

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Shape a raw row into the report row with derived cost fields.
const decorate = (row) => {
  const totalCost = row.fuelCost + row.maintenanceCost + row.insuranceCost;
  const costPerTrip = row.totalTrips > 0 ? Math.round(totalCost / row.totalTrips) : 0;
  const costPerKm = row.totalKm > 0 ? Math.round((totalCost / row.totalKm) * 10) / 10 : 0;
  return {
    ...row,
    vehicleName: row.vehicle?.vehicleName || "",
    vehicleNumber: row.vehicle?.vehicleNumber || "",
    monthName: MONTH_NAMES[row.month - 1] || String(row.month),
    totalCost,
    costPerTrip,
    costPerKm,
  };
};

/**
 * Create or update the monthly operations record for a vehicle (upsert on the
 * unique [vehicleId, month, year]). Vehicle must belong to the actor's org.
 */
const upsertOperation = async (raw, authData) => {
  const data = validateOperationInput(raw);
  const now = BigInt(Date.now());

  // Org-scope the vehicle — a manager can only log costs for their own vehicles.
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: data.vehicleId, organizationId: authData.organizationId, isDeleted: false },
    select: { id: true },
  });
  if (!vehicle) throw new Error("Vehicle not found");

  const record = await prisma.vehicleOperation.upsert({
    where: {
      vehicleId_month_year: { vehicleId: data.vehicleId, month: data.month, year: data.year },
    },
    create: {
      organizationId: authData.organizationId,
      vehicleId: data.vehicleId,
      month: data.month,
      year: data.year,
      totalTrips: data.totalTrips,
      totalKm: data.totalKm,
      fuelCost: data.fuelCost,
      maintenanceCost: data.maintenanceCost,
      insuranceCost: data.insuranceCost,
      notes: data.notes,
      createdBy: authData.id || null,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      totalTrips: data.totalTrips,
      totalKm: data.totalKm,
      fuelCost: data.fuelCost,
      maintenanceCost: data.maintenanceCost,
      insuranceCost: data.insuranceCost,
      notes: data.notes,
      updatedAt: now,
    },
  });

  await logAudit({
    authData,
    action: "UPDATE",
    entity: "VehicleOperation",
    entityId: record.id,
    after: record,
    metadata: { vehicleId: data.vehicleId, month: data.month, year: data.year },
  });

  return record;
};

/**
 * Vehicle operations & cost report. Optional filters: year, vehicleId.
 * Returns decorated rows + org-wide summary + cost breakdown by category.
 */
const getReport = async (organizationId, query = {}) => {
  const where = { organizationId };
  const year = Number(query.year);
  if (Number.isFinite(year)) where.year = year;
  if (query.vehicleId) where.vehicleId = String(query.vehicleId);

  const raw = await prisma.vehicleOperation.findMany({
    where,
    include: { vehicle: { select: { vehicleName: true, vehicleNumber: true } } },
    orderBy: [{ vehicleId: "asc" }, { year: "asc" }, { month: "asc" }],
    take: 1000,
  });

  const rows = raw.map(decorate);
  const summary = rows.reduce(
    (acc, r) => {
      acc.totalTrips += r.totalTrips;
      acc.totalKm += r.totalKm;
      acc.fuelCost += r.fuelCost;
      acc.maintenanceCost += r.maintenanceCost;
      acc.insuranceCost += r.insuranceCost;
      acc.totalCost += r.totalCost;
      return acc;
    },
    { totalTrips: 0, totalKm: 0, fuelCost: 0, maintenanceCost: 0, insuranceCost: 0, totalCost: 0 },
  );

  return {
    rows,
    summary,
    breakdown: {
      fuel: summary.fuelCost,
      maintenance: summary.maintenanceCost,
      insurance: summary.insuranceCost,
    },
  };
};

const listOperations = (organizationId, query = {}) => getReport(organizationId, query);

const deleteOperation = async (id, authData) => {
  const existing = await prisma.vehicleOperation.findFirst({
    where: { id, organizationId: authData.organizationId },
  });
  if (!existing) throw new Error("Record not found");
  await prisma.vehicleOperation.delete({ where: { id } });
  await logAudit({ authData, action: "DELETE", entity: "VehicleOperation", entityId: id, before: existing });
  return { id };
};

module.exports = { upsertOperation, getReport, listOperations, deleteOperation };
