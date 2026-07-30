const prisma = require("../../config/db");

const service = {
  createService: async (organizationId, payload) => {
    const existingService = await prisma.service.findFirst({
      where: {
        organizationId,
        serviceName: payload.serviceName,
        isDeleted: false,
      },
    });

    if (existingService) {
      throw new Error("Service already exists");
    }

    return prisma.service.create({
      data: {
        organizationId,

        category: payload.category,

        serviceName: payload.serviceName,

        serviceNameJa: payload.serviceNameJa || null,

        defaultCapacity: payload.defaultCapacity,

        durationMinutes: payload.durationMinutes,

        description: payload.description,

        requiresTransport: payload.requiresTransport,

        requiresStaff: payload.requiresStaff,

        singleParticipant: !!payload.singleParticipant,
        requiresGuardianAccompaniment: !!payload.requiresGuardianAccompaniment,

        slotTemplates: payload.slotTemplates,

        minSupportStaff: Number(payload.minSupportStaff) || 0,
        minDrivers: Number(payload.minDrivers) || 0,
        minAssistants: Number(payload.minAssistants) || 0,
        ratioParticipantsPer: payload.ratioParticipantsPer ? Number(payload.ratioParticipantsPer) : null,
        ratioSupportStaff: Number(payload.ratioSupportStaff) || 0,
        ratioDrivers: Number(payload.ratioDrivers) || 0,
        ratioAssistants: Number(payload.ratioAssistants) || 0,
        maxParticipants: payload.maxParticipants ? Number(payload.maxParticipants) : null,

        createdAt: BigInt(Date.now()),
        updatedAt: BigInt(Date.now()),
      },
    });
  },

  getServices: async (organizationId) => {
    return prisma.service.findMany({
      where: {
        organizationId,
        isDeleted: false,
      },
      take: 200,

      orderBy: {
        createdAt: "desc",
      },
    });
  },

  getServiceById: async (id, organizationId) => {
    return prisma.service.findFirst({
      where: {
        id,
        organizationId,
        isDeleted: false,
      },
    });
  },

  updateService: async (id, organizationId, payload) => {
    const existing = await prisma.service.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!existing) {
      throw new Error("Service not found");
    }

    if (payload.serviceName && payload.serviceName !== existing.serviceName) {
      const duplicate = await prisma.service.findFirst({
        where: {
          organizationId,
          serviceName: payload.serviceName,
          isDeleted: false,
          id: { not: id },
        },
      });
      if (duplicate) throw new Error("Service with this name already exists");
    }

    const data = {
      ...(payload.serviceName !== undefined && { serviceName: payload.serviceName }),
      ...(payload.serviceNameJa !== undefined && { serviceNameJa: payload.serviceNameJa || null }),
      ...(payload.category !== undefined && { category: payload.category }),
      ...(payload.defaultCapacity !== undefined && {
        defaultCapacity: Number(payload.defaultCapacity),
      }),
      ...(payload.durationMinutes !== undefined && {
        durationMinutes: Number(payload.durationMinutes),
      }),
      ...(payload.description !== undefined && { description: payload.description }),
      ...(payload.requiresTransport !== undefined && {
        requiresTransport: payload.requiresTransport,
      }),
      ...(payload.requiresStaff !== undefined && {
        requiresStaff: payload.requiresStaff,
      }),
      ...(payload.requiresGuardianAccompaniment !== undefined && {
        requiresGuardianAccompaniment: !!payload.requiresGuardianAccompaniment,
      }),
      ...(payload.singleParticipant !== undefined && {
        singleParticipant: !!payload.singleParticipant,
      }),
      ...(payload.slotTemplates !== undefined && {
        slotTemplates: payload.slotTemplates,
      }),
      ...(payload.minSupportStaff !== undefined && { minSupportStaff: Number(payload.minSupportStaff) || 0 }),
      ...(payload.minDrivers !== undefined && { minDrivers: Number(payload.minDrivers) || 0 }),
      ...(payload.minAssistants !== undefined && { minAssistants: Number(payload.minAssistants) || 0 }),
      ...(payload.ratioParticipantsPer !== undefined && {
        ratioParticipantsPer: payload.ratioParticipantsPer ? Number(payload.ratioParticipantsPer) : null,
      }),
      ...(payload.ratioSupportStaff !== undefined && { ratioSupportStaff: Number(payload.ratioSupportStaff) || 0 }),
      ...(payload.ratioDrivers !== undefined && { ratioDrivers: Number(payload.ratioDrivers) || 0 }),
      ...(payload.ratioAssistants !== undefined && { ratioAssistants: Number(payload.ratioAssistants) || 0 }),
      ...(payload.maxParticipants !== undefined && {
        maxParticipants: payload.maxParticipants ? Number(payload.maxParticipants) : null,
      }),
      updatedAt: BigInt(Date.now()),
    };

    return prisma.service.update({
      where: { id },
      data,
    });
  },

  toggleStatus: async (id, organizationId) => {
    const service = await prisma.service.findFirst({
      where: {
        id,
        organizationId,
        isDeleted: false,
      },
    });

    if (!service) {
      throw new Error("Service not found");
    }

    return prisma.service.update({
      where: { id },

      data: {
        status: !service.status,
        updatedAt: BigInt(Date.now()),
      },
    });
  },

  deleteService: async (id, organizationId) => {
    const existing = await prisma.service.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!existing) {
      throw new Error("Service not found");
    }

    return prisma.service.update({
      where: { id },

      data: {
        isDeleted: true,
        updatedAt: BigInt(Date.now()),
      },
    });
  },
};
module.exports = service;
