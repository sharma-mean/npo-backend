const prisma = require("../../config/db");
const { validateCreateIncident } = require("./incident.validation");
const {
  INCIDENT_TYPES,
  INCIDENT_SEVERITIES,
} = require("./incident.constants");
const { logAudit } = require("../../utils/auditLogger");
const notificationService = require("../notification/notification.service");

const REPORTER_ROLES = ["NPO_ADMIN", "COORDINATOR", "STAFF"];
const MANAGER_ROLES = ["NPO_ADMIN", "COORDINATOR"];

// Enum values shout in an email body — humanize them for the detail rows.
const INCIDENT_LABEL = {
  DELAY: "Delay",
  MEDICAL: "Medical",
  VEHICLE_BREAKDOWN: "Vehicle breakdown",
  NO_SHOW: "No show",
  OTHER: "Other",
};
const SEVERITY_LABEL = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

// Rich booking context for the incident detail view — safe selects only
// (participant/guardian/staff are User rows; never bare-include, would leak
// password + tokens). Gives the admin the full picture: who, which vehicle/
// venue, assigned staff, pickup, times, status and booking notes.
const INCIDENT_BOOKING_DETAIL = {
  select: {
    id: true,
    bookingCode: true,
    serviceType: true,
    status: true,
    bookingDate: true,
    startTime: true,
    endTime: true,
    requiredSeats: true,
    participantCount: true,
    pickupAddress: true,
    notes: true,
    operationalNotes: true,
    participant: { select: { id: true, fullName: true, profileImage: true, phone: true, medicalNotes: true, allergyNotes: true, emergencyInstructions: true } },
    guardian: { select: { id: true, fullName: true, profileImage: true, phone: true, email: true } },
    vehicle: { select: { id: true, vehicleName: true, vehicleNumber: true, capacity: true } },
    venue: { select: { id: true, name: true, address: true } },
    staffAssignments: {
      where: { status: { not: "CANCELLED" } },
      select: {
        id: true,
        assignmentRole: true,
        status: true,
        user: { select: { id: true, fullName: true, profileImage: true, phone: true } },
      },
    },
  },
};

const createIncident = async (data, authData) => {
  if (!REPORTER_ROLES.includes(authData.role)) {
    throw new Error("Not authorized to report incidents");
  }
  validateCreateIncident(data);
  const now = BigInt(Date.now());

  if (data.bookingId) {
    const booking = await prisma.booking.findFirst({
      where: { id: data.bookingId, organizationId: authData.organizationId },
    });
    if (!booking) throw new Error("Booking not found");
  }

  const incident = await prisma.incident.create({
    data: {
      organizationId: authData.organizationId,
      bookingId: data.bookingId || null,
      reportedBy: authData.id,
      type: data.type,
      severity: data.severity || "MEDIUM",
      status: "OPEN",
      title: data.title.trim(),
      description: data.description || null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await logAudit({
    authData,
    action: "CREATE",
    entity: "Incident",
    entityId: incident.id,
    after: incident,
  });

  // Notify org admins + coordinators
  const managers = await prisma.user.findMany({
    where: {
      organizationId: authData.organizationId,
      role: { in: ["NPO_ADMIN", "COORDINATOR"] },
      status: true,
      isDeleted: false,
    },
    select: { id: true, email: true },
  });
  // Notify best-effort — the incident is already persisted; a notify failure
  // must not turn into a 500 (the client would think the report failed).
  try {
    await notificationService.notifyMany(
      managers.map((m) => m.id),
      {
        organizationId: authData.organizationId,
        type: "INCIDENT_REPORTED",
        title: `New ${data.severity || "MEDIUM"} incident: ${incident.title}`,
        message: incident.description || incident.type,
        relatedBookingId: incident.bookingId,
      },
    );
  } catch (err) {
    console.error("[incident] manager notify failed:", err.message);
  }

  // If the incident is tied to a booking, also notify that booking's guardian
  // (in-app + email) so they hear about a delay / issue on their booking.
  if (incident.bookingId) {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: incident.bookingId },
        select: { guardianId: true },
      });
      if (booking?.guardianId) {
        const guardian = await prisma.user.findUnique({
          where: { id: booking.guardianId },
          select: { id: true, email: true },
        });
        if (guardian) {
          await notificationService.notify({
            userId: guardian.id,
            organizationId: authData.organizationId,
            type: "INCIDENT_REPORTED",
            title: `Update on your booking: ${incident.title}`,
            message:
              incident.description ||
              `An incident (${incident.type}) was reported on your booking.`,
            relatedBookingId: incident.bookingId,
            email: guardian.email,
            emailSubject: "An update about your booking",
            emailData: {
              details: [
                ["Incident", incident.title],
                ["Type", INCIDENT_LABEL[incident.type] || incident.type],
                ["Severity", SEVERITY_LABEL[incident.severity] || incident.severity],
              ],
            },
          });
        }
      }
    } catch (err) {
      console.error("[incident] guardian notify failed:", err.message);
    }
  }

  return incident;
};

const getAllIncidents = async (authData, filters = {}) => {
  const where = {
    organizationId: authData.organizationId,
    isDeleted: false,
  };
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.severity) where.severity = filters.severity;
  if (filters.bookingId) where.bookingId = filters.bookingId;

  // Staff see only what they reported; managers see all org incidents
  if (!["NPO_ADMIN", "COORDINATOR"].includes(authData.role)) {
    where.reportedBy = authData.id;
  }

  return prisma.incident.findMany({
    where,
    include: {
      reporter: { select: { id: true, fullName: true, profileImage: true } },
      resolver: { select: { id: true, fullName: true, profileImage: true } },
      booking: {
        select: {
          id: true,
          bookingCode: true,
          serviceType: true,
          bookingDate: true,
          status: true,
          participant: { select: { id: true, fullName: true, profileImage: true } },
          vehicle: { select: { id: true, vehicleNumber: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

const getIncidentById = async (id, authData) => {
  const where = { id, organizationId: authData.organizationId, isDeleted: false };
  // Staff (non-managers) may only view incidents they reported — same scoping
  // as the list endpoint, so an id can't be used to read others' incidents.
  if (!MANAGER_ROLES.includes(authData.role)) {
    where.reportedBy = authData.id;
  }
  const incident = await prisma.incident.findFirst({
    where,
    include: {
      reporter: { select: { id: true, fullName: true, profileImage: true, role: true } },
      resolver: { select: { id: true, fullName: true, profileImage: true } },
      booking: INCIDENT_BOOKING_DETAIL,
    },
  });
  if (!incident) throw new Error("Incident not found");
  return incident;
};

const updateIncident = async (id, data, authData) => {
  const existing = await prisma.incident.findFirst({
    where: { id, organizationId: authData.organizationId, isDeleted: false },
  });
  if (!existing) throw new Error("Incident not found");

  // Authz: only a manager or the original reporter may edit an incident.
  const isManager = MANAGER_ROLES.includes(authData.role);
  const isOwner = existing.reportedBy === authData.id;
  if (!isManager && !isOwner) {
    throw new Error("Not authorized to update this incident");
  }
  if (existing.status === "RESOLVED") {
    throw new Error("A resolved incident can no longer be edited");
  }

  // Validate provided enum fields.
  if (data.type && !INCIDENT_TYPES.includes(data.type)) {
    throw new Error(`type must be one of: ${INCIDENT_TYPES.join(", ")}`);
  }
  if (data.severity && !INCIDENT_SEVERITIES.includes(data.severity)) {
    throw new Error(`severity must be one of: ${INCIDENT_SEVERITIES.join(", ")}`);
  }

  // Status transition: OPEN ↔ IN_PROGRESS only (managers); RESOLVED goes
  // through resolveIncident so resolver/resolvedAt/notify are set correctly.
  let statusUpdate = {};
  if (data.status) {
    if (!["OPEN", "IN_PROGRESS"].includes(data.status)) {
      throw new Error("status must be OPEN or IN_PROGRESS (use resolve to close)");
    }
    if (!isManager) {
      throw new Error("Only managers can change incident status");
    }
    statusUpdate = { status: data.status };
  }

  const updated = await prisma.incident.update({
    where: { id },
    data: {
      ...(data.type ? { type: data.type } : {}),
      ...(data.severity ? { severity: data.severity } : {}),
      ...(data.title ? { title: data.title.trim() } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...statusUpdate,
      updatedAt: BigInt(Date.now()),
    },
  });

  await logAudit({
    authData,
    action: "UPDATE",
    entity: "Incident",
    entityId: id,
    before: existing,
    after: updated,
  });
  return updated;
};

const resolveIncident = async (id, resolutionNotes, authData) => {
  if (!["NPO_ADMIN", "COORDINATOR"].includes(authData.role)) {
    throw new Error("Not authorized to resolve incidents");
  }
  const existing = await prisma.incident.findFirst({
    where: { id, organizationId: authData.organizationId, isDeleted: false },
  });
  if (!existing) throw new Error("Incident not found");
  if (existing.status === "RESOLVED") {
    throw new Error("Incident already resolved");
  }

  const updated = await prisma.incident.update({
    where: { id },
    data: {
      status: "RESOLVED",
      resolutionNotes: resolutionNotes || null,
      resolvedBy: authData.id,
      resolvedAt: BigInt(Date.now()),
      updatedAt: BigInt(Date.now()),
    },
  });

  await logAudit({
    authData,
    action: "STATUS_CHANGE",
    entity: "Incident",
    entityId: id,
    before: { status: existing.status },
    after: { status: "RESOLVED" },
    metadata: { resolutionNotes },
  });

  // Notify reporter
  const reporter = await prisma.user.findUnique({
    where: { id: existing.reportedBy },
    select: { id: true, email: true },
  });
  if (reporter) {
    await notificationService.notify({
      userId: reporter.id,
      organizationId: authData.organizationId,
      type: "INCIDENT_RESOLVED",
      title: `Incident resolved: ${existing.title}`,
      message: resolutionNotes || "Your reported incident has been resolved.",
      relatedBookingId: existing.bookingId,
    });
  }

  return updated;
};

module.exports = {
  createIncident,
  getAllIncidents,
  getIncidentById,
  updateIncident,
  resolveIncident,
};
