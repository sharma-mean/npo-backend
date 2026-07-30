
const validateCreateStaff = (data) => {
  if (!data.fullName) throw new Error("fullName is required");
  if (!data.email) throw new Error("email is required");
  if (!data.phone) throw new Error("phone is required");
};

const validateUpdateStaff = (data) => {
  if (data.status !== undefined && typeof data.status !== "boolean") {
    throw new Error("status must be a boolean");
  }
};

module.exports = {
  validateCreateStaff,
  validateUpdateStaff,
};