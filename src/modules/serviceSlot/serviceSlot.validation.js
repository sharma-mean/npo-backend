const validateCreateSlot = (data) => {
  if (!data.serviceId) throw new Error("serviceId is required");
  if (!data.serviceType) throw new Error("serviceType is required");
  if (!data.slotDate) throw new Error("slotDate is required");
  if (!data.startTime || !data.endTime) {
    throw new Error("startTime and endTime are required");
  }
  if (Number(data.endTime) <= Number(data.startTime)) {
    throw new Error("endTime must be after startTime");
  }
  if (data.capacity == null || Number(data.capacity) < 1) {
    throw new Error("capacity must be at least 1");
  }
};

module.exports = { validateCreateSlot };
