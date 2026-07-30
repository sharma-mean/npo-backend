const { GUARDIAN_STATUS } = require("./guardian.constants");

const validateEmail = (email) => {
  const emailRegex = /^\S+@\S+\.\S+$/;

  if (!emailRegex.test(email)) {
    throw new Error("Invalid email format");
  }
};

const validatePhone = (phone) => {
  if (!/^\d{10}$/.test(phone)) {
    throw new Error("Phone must be 10 digits");
  }
};

const validateCreateGuardian = (data) => {
  const requiredFields = [
    "fullName",
    "email",
    "phone",
    "relationshipType",
    "address",
    "city",
    "state",
    "country",
    "postalCode",
    "organizationId"
  ];

  for (const field of requiredFields) {
    if (!data[field]) {
      throw new Error(`${field} is required`);
    }
  }

  validateEmail(data.email);
  validatePhone(data.phone);
};

const validateUpdateGuardian = (data) => {
  if (data.email) validateEmail(data.email);

  if (data.phone) validatePhone(data.phone);

  if (data.status && !GUARDIAN_STATUS.includes(data.status)) {
    throw new Error("Invalid guardian status");
  }
};

module.exports = {
  validateCreateGuardian,
  validateUpdateGuardian
};