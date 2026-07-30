const validateCreateVehicle = (data) => {
  // if (!data.organizationId) {
  //   throw new Error("Organization ID is required");
  // }

  if (!data.vehicleName?.trim()) {
    throw new Error("Vehicle name is required");
  }

  if (!data.vehicleNumber?.trim()) {
    throw new Error("Vehicle number is required");
  }

  if (!data.vehicleType?.trim()) {
    throw new Error("Vehicle type is required");
  }

  if (!data.capacity || data.capacity <= 0) {
    throw new Error("Valid vehicle capacity is required");
  }
};

const validateUpdateVehicle = (data) => {
  if (!Object.keys(data).length) {
    throw new Error("Update data is required");
  }
};

module.exports = {
  validateCreateVehicle,
  validateUpdateVehicle,
};
