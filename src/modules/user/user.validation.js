const { USER_ROLES } = require("./user.constants");

const userValidation = {
  validateEmail: (email) => {
    const emailRegex = /^\S+@\S+\.\S+$/;

    if (!emailRegex.test(email)) {
      throw new Error("Invalid email format");
    }
  },

  validatePassword: (password) => {
    if (!password || password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
  },

  validateCreateUser: (data) => {
    const requiredFields = ["fullName", "email", "password", "role"];

    for (const field of requiredFields) {
      if (!data[field]) {
        throw new Error(`${field} is required`);
      }
    }

    userValidation.validateEmail(data.email);
    userValidation.validatePassword(data.password);

    if (!USER_ROLES.includes(data.role)) {
      throw new Error("Invalid user role");
    }
  },

  validateUpdateUser: (data) => {
    if (data.email) userValidation.validateEmail(data.email);

    if (data.password) userValidation.validatePassword(data.password);

    if (data.role && !USER_ROLES.includes(data.role)) {
      throw new Error("Invalid user role");
    }
  },
  staffRoleAssign: (data) => {
    if (["STAFF", "COORDINATOR"].includes(data.role)) {
      if (!data.designationId) {
        throw new Error("Designation is required");
      }
      if (!data.serviceType) {
        throw new Error("Service type is required");
      }
    }
    if (!["STAFF", "COORDINATOR"].includes(data.role)) {
      return (data.designationId = null);
    }
  },
};

module.exports = userValidation;
