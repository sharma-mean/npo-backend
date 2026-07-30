const prisma = require("../../config/db");
const {
  validateCreateVehicle,
  validateUpdateVehicle,
} = require("./vehicle.validation");
const { logAudit } = require("../../utils/auditLogger");

const vehicleService = {
  createVehicle: async (data, authUser) => {
    validateCreateVehicle(data);
    const existingVehicle = await prisma.vehicle.findFirst({
      where: {
        vehicleNumber: data.vehicleNumber,
        organizationId: authUser.organizationId,
        isDeleted: false,
      },
    });

    if (existingVehicle) {
      throw new Error("Vehicle number already exists");
    }

    const now = BigInt(Date.now());
    const vehicle = await prisma.vehicle.create({
      data: {
        organizationId: authUser.organizationId,
        vehicleName: data.vehicleName,
        vehicleNumber: data.vehicleNumber,
        vehicleType: data.vehicleType,
        serviceType: data.serviceType,
        capacity: data.capacity,
        wheelchairAccessible: data.wheelchairAccessible || false,
        wheelchairCapacity: data.wheelchairCapacity || 0,
        GPSId: data.gpsId,
        Notes: data.notes,
        equipmentDetails: data.equipmentDetails || [],
        createdBy: authUser.id,
        createdAt: now,
        updatedAt: now,
      },
    });

    await logAudit({
      authData: authUser,
      action: "CREATE",
      entity: "Vehicle",
      entityId: vehicle.id,
      after: vehicle,
    });
    return vehicle;
  },

  getAllVehicles: async (organizationId) => {
    return await prisma.vehicle.findMany({
      where: { organizationId, isDeleted: false },
      orderBy: { createdAt: "desc" },
    });
  },

  getVehicleById: async (id, organizationId) => {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    return vehicle;
  },

  updateVehicle: async (id, data, organizationId) => {
    validateUpdateVehicle(data);

    const vehicle = await prisma.vehicle.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    if (data.vehicleNumber && data.vehicleNumber !== vehicle.vehicleNumber) {
      const duplicate = await prisma.vehicle.findFirst({
        where: { vehicleNumber: data.vehicleNumber, organizationId, isDeleted: false },
      });
      if (duplicate) throw new Error("Vehicle number already exists");
    }

    const updateData = {
      ...(data.vehicleName !== undefined && { vehicleName: data.vehicleName }),
      ...(data.vehicleNumber !== undefined && { vehicleNumber: data.vehicleNumber }),
      ...(data.vehicleType !== undefined && { vehicleType: data.vehicleType }),
      ...(data.serviceType !== undefined && { serviceType: data.serviceType || null }),
      ...(data.capacity !== undefined && { capacity: Number(data.capacity) }),
      ...(data.wheelchairCapacity !== undefined && {
        wheelchairCapacity: Number(data.wheelchairCapacity) || 0,
      }),
      ...(data.wheelchairAccessible !== undefined && {
        wheelchairAccessible: data.wheelchairAccessible,
      }),
      ...(data.gpsId !== undefined && { GPSId: data.gpsId }),
      ...(data.notes !== undefined && { Notes: data.notes }),
      ...(data.equipmentDetails !== undefined && {
        equipmentDetails: data.equipmentDetails,
      }),
      updatedAt: BigInt(Date.now()),
    };

    const updated = await prisma.vehicle.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      authData: { organizationId: updated.organizationId },
      action: "UPDATE",
      entity: "Vehicle",
      entityId: id,
      after: updated,
    });
    return updated;
  },

  toggleVehicleStatus: async (id, organizationId) => {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    // Deactivating: block if active bookings still reference this vehicle —
    // otherwise those bookings silently keep a dead (inactive) vehicle.
    if (vehicle.status) {
      const inUse = await prisma.booking.count({
        where: { vehicleId: id, status: { in: ["PENDING", "APPROVED"] } },
      });
      if (inUse > 0) {
        throw new Error(
          `Cannot deactivate: ${inUse} active booking(s) use this vehicle. Reassign or cancel them first.`,
        );
      }
    }

    return await prisma.vehicle.update({
      where: { id },
      data: {
        status: !vehicle.status,
        updatedAt: BigInt(Date.now()),
      },
    });
  },

  deleteVehicle: async (id, organizationId) => {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: {
        bookings: { where: { status: { in: ["PENDING", "APPROVED"] } } },
      },
    });

    if (!vehicle) {
      throw new Error("Vehicle not found");
    }
    if (vehicle.bookings.length > 0) {
      throw new Error(
        `Cannot delete: ${vehicle.bookings.length} active booking(s) use this vehicle`,
      );
    }

    // Soft delete (convention: never hard-delete + preserves FK history).
    const deleted = await prisma.vehicle.update({
      where: { id },
      data: { isDeleted: true, status: false, updatedAt: BigInt(Date.now()) },
    });

    await logAudit({
      authData: { organizationId },
      action: "DELETE",
      entity: "Vehicle",
      entityId: id,
      before: vehicle,
    });
    return deleted;
  },
};

module.exports = vehicleService;
