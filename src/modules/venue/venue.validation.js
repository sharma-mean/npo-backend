const validateCreateVenue = (data) => {
  if (!data.name?.trim()) {
    throw new Error("Venue name is required");
  }

  if (!data.address?.trim()) {
    throw new Error("Venue address is required");
  }

  if (!data.capacity || Number(data.capacity) <= 0) {
    throw new Error("Valid venue capacity is required");
  }

  if (data.lat !== undefined && data.lat !== null && (typeof data.lat !== 'number' || Math.abs(data.lat) > 90)) {
    throw new Error("Latitude must be a number between -90 and 90");
  }

  if (data.lng !== undefined && data.lng !== null && (typeof data.lng !== 'number' || Math.abs(data.lng) > 180)) {
    throw new Error("Longitude must be a number between -180 and 180");
  }
};

const validateUpdateVenue = (data) => {
  if (!Object.keys(data).length) {
    throw new Error("Update data is required");
  }

  if (data.capacity !== undefined && Number(data.capacity) <= 0) {
    throw new Error("Valid venue capacity is required");
  }

  if (data.lat !== undefined && data.lat !== null && (typeof data.lat !== 'number' || Math.abs(data.lat) > 90)) {
    throw new Error("Latitude must be a number between -90 and 90");
  }

  if (data.lng !== undefined && data.lng !== null && (typeof data.lng !== 'number' || Math.abs(data.lng) > 180)) {
    throw new Error("Longitude must be a number between -180 and 180");
  }
};

module.exports = {
  validateCreateVenue,
  validateUpdateVenue,
};
