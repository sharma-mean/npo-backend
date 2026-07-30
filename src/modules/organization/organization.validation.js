const {
  ORGANIZATION_STATUS
} = require("./organization.constants");

const validateEmail = (email) => {
  const regex = /^\S+@\S+\.\S+$/;

  if (!regex.test(email)) {
    throw new Error("Invalid email format");
  }
};

const validatePhone = (phone) => {
  if (!/^\d{10}$/.test(phone)) {
    throw new Error("Phone must be 10 digits");
  }
};

const validateCreateOrganization = (data) => {
  const requiredFields = [
    "name",
    "email",
    "phone",
    "adminName",
    "adminEmail",
    "password",
    "planId"
  ];

  for (const field of requiredFields) {
    if (!data[field]) {
      throw new Error(`${field} is required`);
    }
  }

  validateEmail(data.email);
  validateEmail(data.adminEmail);
  validatePhone(data.phone);

  if (data.password.length < 8) {
    throw new Error(
      "Password must be minimum 8 characters"
    );
  }
};

const validateUpdateOrganization = (data) => {
  if (data.email) validateEmail(data.email);

  if (data.phone) validatePhone(data.phone);

  if (
    data.status &&
    !Object.values(ORGANIZATION_STATUS).includes(
      data.status
    )
  ) {
    throw new Error("Invalid organization status");
  }
};

module.exports = { validateCreateOrganization, validateUpdateOrganization };