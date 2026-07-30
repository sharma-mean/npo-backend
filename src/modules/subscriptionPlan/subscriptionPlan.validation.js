const num = (v) => Number(v);
const isPos = (v) => Number.isFinite(num(v)) && num(v) > 0;
const isNonNeg = (v) => Number.isFinite(num(v)) && num(v) >= 0;

const validateCreatePlan = (data) => {
  const requiredFields = ["name", "durationDays", "price", "maxUsers"];
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === "") {
      throw new Error(`${field} is required`);
    }
  }
  if (!isPos(data.durationDays)) {
    throw new Error("durationDays must be a positive number");
  }
  if (!isPos(data.maxUsers)) {
    throw new Error("maxUsers must be a positive number");
  }
  if (!isNonNeg(data.price)) {
    throw new Error("price must be a non-negative number");
  }
  if (data.maxParticipants !== undefined && data.maxParticipants !== null && !isPos(data.maxParticipants)) {
    throw new Error("maxParticipants must be a positive number");
  }
};

const validateUpdatePlan = (data) => {
  if (data.durationDays !== undefined && !isPos(data.durationDays)) {
    throw new Error("durationDays must be a positive number");
  }
  if (data.maxUsers !== undefined && !isPos(data.maxUsers)) {
    throw new Error("maxUsers must be a positive number");
  }
  if (data.price !== undefined && !isNonNeg(data.price)) {
    throw new Error("price must be a non-negative number");
  }
  if (data.maxParticipants !== undefined && data.maxParticipants !== null && !isPos(data.maxParticipants)) {
    throw new Error("maxParticipants must be a positive number");
  }
};

module.exports = {
  validateCreatePlan,
  validateUpdatePlan
};