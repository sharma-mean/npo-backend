// Validation for vehicle operations & cost entries. Costs are integer yen (¥).
const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

const validateOperationInput = (raw = {}) => {
  const month = toInt(raw.month);
  const year = toInt(raw.year);

  if (!raw.vehicleId || typeof raw.vehicleId !== "string") {
    throw new Error("vehicleId is required");
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error("month must be between 1 and 12");
  }
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error("year must be a valid year");
  }

  const nonNeg = (label, v) => {
    const n = toInt(v ?? 0);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number`);
    return n;
  };

  return {
    vehicleId: raw.vehicleId,
    month,
    year,
    totalTrips: nonNeg("totalTrips", raw.totalTrips),
    totalKm: nonNeg("totalKm", raw.totalKm),
    fuelCost: nonNeg("fuelCost", raw.fuelCost),
    maintenanceCost: nonNeg("maintenanceCost", raw.maintenanceCost),
    insuranceCost: nonNeg("insuranceCost", raw.insuranceCost),
    notes: raw.notes ? String(raw.notes).slice(0, 500) : null,
  };
};

module.exports = { validateOperationInput };
