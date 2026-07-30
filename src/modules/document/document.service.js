const prisma = require("../../config/db");
const storage = require("../../utils/storage");
const { logAudit } = require("../../utils/auditLogger");

const DOCUMENT_TYPES = [
  "WAIVER",
  "CONSENT",
  "CARE_PLAN",
  "MEDICAL",
  "DRIVING_LICENCE",
  "CERTIFICATION",
  "VEHICLE_INSPECTION",
  "INSURANCE",
  "REGISTRATION",
  "PHOTO",
  "FLOOR_PLAN",
  "ATTACHMENT",
  "OTHER",
];

// Compliance documents carry an expiry and gate an operation when they lapse.
const COMPLIANCE_TYPES = [
  "DRIVING_LICENCE",
  "CERTIFICATION",
  "VEHICLE_INSPECTION",
  "INSURANCE",
  "REGISTRATION",
];

const MANAGER_ROLES = ["NPO_ADMIN", "COORDINATOR"];

// Never expose the raw B2 object key to clients — it's an internal handle.
const DOCUMENT_SELECT = {
  id: true,
  organizationId: true,
  participantId: true,
  userId: true,
  vehicleId: true,
  expiresAt: true,
  type: true,
  fileName: true,
  mimeType: true,
  size: true,
  consentRequired: true,
  consentGivenAt: true,
  consentBy: true,
  uploadedBy: true,
  createdAt: true,
  updatedAt: true,
  participant: { select: { id: true, fullName: true } },
  owner: { select: { id: true, fullName: true } },
  vehicle: { select: { id: true, vehicleName: true, vehicleNumber: true } },
  uploader: { select: { id: true, fullName: true } },
  consenter: { select: { id: true, fullName: true } },
};

const isManager = (user) => MANAGER_ROLES.includes(user.role);

/**
 * Guardians may only ever touch documents belonging to THEIR participants.
 * Returns a `where` fragment enforcing that; managers get the org-wide view.
 */
const scopeForUser = async (authUser) => {
  const where = { organizationId: authUser.organizationId, isDeleted: false };
  if (isManager(authUser)) return where;

  if (authUser.role === "GUARDIAN") {
    const mine = await prisma.user.findMany({
      where: {
        organizationId: authUser.organizationId,
        role: "PARTICIPANT",
        guardianUserId: authUser.id,
        isDeleted: false,
      },
      select: { id: true },
    });
    where.participantId = { in: mine.map((p) => p.id) };
    return where;
  }

  if (authUser.role === "PARTICIPANT") {
    where.participantId = authUser.id;
    return where;
  }

  // STAFF and anyone else: no document access.
  where.id = "__none__";
  return where;
};

// A participant referenced on a document must belong to the same org (and, for
// a guardian, to that guardian) — blocks cross-tenant / cross-guardian writes.
const assertParticipantAllowed = async (authUser, participantId) => {
  if (!participantId) return;
  const where = {
    id: participantId,
    organizationId: authUser.organizationId,
    role: "PARTICIPANT",
    isDeleted: false,
  };
  if (authUser.role === "GUARDIAN") where.guardianUserId = authUser.id;
  const participant = await prisma.user.findFirst({ where, select: { id: true } });
  if (!participant) throw new Error("Participant not found");
};

/**
 * Every owner a document can hang off must live in the caller's org (no
 * cross-tenant attachment), and only one owner may be set.
 *
 * Incidents and bookings loosen the manager-only upload rule: the STAFF member
 * who reported an incident attaches the evidence photos, and the GUARDIAN who
 * owns a booking attaches its paperwork. Those are the people actually holding
 * the file. Returns the roles allowed to upload for this owner.
 */
const assertOwnerAllowed = async (authUser, { participantId, userId, vehicleId, incidentId, venueId, bookingId }) => {
  const owners = [participantId, userId, vehicleId, incidentId, venueId, bookingId].filter(Boolean);
  if (owners.length > 1) {
    throw new Error("A document can belong to only one owner");
  }

  await assertParticipantAllowed(authUser, participantId);

  if (userId) {
    const staff = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: authUser.organizationId,
        role: { in: ["STAFF", "COORDINATOR", "NPO_ADMIN"] },
        isDeleted: false,
      },
      select: { id: true },
    });
    if (!staff) throw new Error("Staff member not found");
  }

  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, organizationId: authUser.organizationId, isDeleted: false },
      select: { id: true },
    });
    if (!vehicle) throw new Error("Vehicle not found");
  }

  if (venueId) {
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, organizationId: authUser.organizationId, isDeleted: false },
      select: { id: true },
    });
    if (!venue) throw new Error("Venue not found");
  }

  if (incidentId) {
    const where = { id: incidentId, organizationId: authUser.organizationId, isDeleted: false };
    // Staff only ever touch incidents they reported themselves.
    if (authUser.role === "STAFF") where.reportedBy = authUser.id;
    const incident = await prisma.incident.findFirst({ where, select: { id: true } });
    if (!incident) throw new Error("Incident not found");
  }

  if (bookingId) {
    const where = { id: bookingId, organizationId: authUser.organizationId };
    // Guardians only ever touch their own bookings.
    if (authUser.role === "GUARDIAN") where.guardianId = authUser.id;
    const booking = await prisma.booking.findFirst({ where, select: { id: true } });
    if (!booking) throw new Error("Booking not found");
  }
};

// Who may upload for a given owner. Managers always may; a staff member may
// attach photos to an incident THEY reported; a guardian may attach files to
// THEIR booking (both verified above).
const canUploadFor = (authUser, { incidentId, bookingId }) => {
  if (isManager(authUser)) return true;
  if (incidentId && authUser.role === "STAFF") return true;
  if (bookingId && authUser.role === "GUARDIAN") return true;
  return false;
};

// Compliance paperwork is only useful if we know when it lapses.
const parseExpiry = (type, expiresAt) => {
  if (expiresAt === undefined || expiresAt === null || expiresAt === "") {
    if (COMPLIANCE_TYPES.includes(type)) {
      throw new Error("An expiry date is required for this document type");
    }
    return null;
  }
  const ms = typeof expiresAt === "number" ? expiresAt : new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) throw new Error("Invalid expiry date");
  return BigInt(Math.trunc(ms));
};

const documentService = {
  /**
   * Step 1 of upload — validate, then hand back a short-lived presigned PUT so
   * the browser uploads straight to B2 (the file never passes through us).
   */
  createUploadUrl: async (authUser, { fileName, mimeType, size, ...owner }) => {
    if (!storage.isConfigured()) throw new Error("File storage is not configured");
    if (!canUploadFor(authUser, owner)) {
      throw new Error("You are not allowed to upload documents here");
    }
    if (!fileName) throw new Error("fileName is required");
    if (!mimeType || !storage.ALLOWED_MIME.includes(mimeType)) {
      throw new Error("Unsupported file type (allowed: PDF, JPG, PNG, WEBP, DOC, DOCX)");
    }
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("Invalid file size");
    if (bytes > storage.MAX_SIZE_BYTES) {
      throw new Error(`File is too large (max ${storage.MAX_SIZE_BYTES / (1024 * 1024)} MB)`);
    }

    await assertOwnerAllowed(authUser, owner);

    return storage.getUploadUrl({ fileName, mimeType });
  },

  /**
   * Step 2 of upload — the browser finished the PUT; persist the metadata row.
   *
   * Objects live flat at the bucket root, so the key carries no tenant marker.
   * Isolation is enforced here instead:
   *   1. the key must match exactly the shape we issue (unguessable 16-hex id), and
   *   2. it must not already be registered by ANY document row — which stops one
   *      org from claiming an object that belongs to another.
   */
  confirmUpload: async (authUser, data) => {
    const { fileKey, fileName, mimeType, size } = data;
    const owner = {
      participantId: data.participantId || null,
      userId: data.userId || null,
      vehicleId: data.vehicleId || null,
      incidentId: data.incidentId || null,
      venueId: data.venueId || null,
      bookingId: data.bookingId || null,
    };

    if (!canUploadFor(authUser, owner)) {
      throw new Error("You are not allowed to upload documents here");
    }
    if (!fileKey || !fileName) throw new Error("fileKey and fileName are required");

    if (!storage.isValidKey(fileKey)) {
      throw new Error("Invalid file reference");
    }
    const alreadyUsed = await prisma.document.findFirst({
      where: { fileKey },
      select: { id: true },
    });
    if (alreadyUsed) throw new Error("Invalid file reference");

    const type = DOCUMENT_TYPES.includes(data.type) ? data.type : "OTHER";
    await assertOwnerAllowed(authUser, owner);
    const expiresAt = parseExpiry(type, data.expiresAt);

    const now = BigInt(Date.now());
    const document = await prisma.document.create({
      data: {
        organizationId: authUser.organizationId,
        ...owner,
        expiresAt,
        type,
        fileKey,
        fileName,
        mimeType: mimeType || "application/octet-stream",
        size: Number.isFinite(Number(size)) ? Math.trunc(Number(size)) : 0,
        consentRequired: data.consentRequired === true,
        uploadedBy: authUser.id,
        createdAt: now,
        updatedAt: now,
      },
      select: DOCUMENT_SELECT,
    });

    await logAudit({
      authData: authUser,
      action: "CREATE",
      entity: "Document",
      entityId: document.id,
      after: document,
    });

    return document;
  },

  list: async (authUser, { participantId, userId, vehicleId, incidentId, venueId, bookingId, type, take = 50, skip = 0 } = {}) => {
    const where = await scopeForUser(authUser);

    if (participantId) {
      // A guardian asking for a specific participant must own that participant.
      await assertParticipantAllowed(authUser, participantId);
      where.participantId = participantId;
    }

    if (userId) {
      // A non-manager may only ever read their OWN compliance paperwork.
      if (!isManager(authUser) && userId !== authUser.id) {
        throw new Error("Not authorized to view these documents");
      }
      delete where.id; // clear the "staff sees nothing" default set by scopeForUser
      where.userId = userId;
    }

    if (vehicleId) {
      if (!isManager(authUser)) throw new Error("Not authorized to view these documents");
      delete where.id;
      where.vehicleId = vehicleId;
    }

    // Incident / venue / booking documents. assertOwnerAllowed re-checks
    // ownership (staff → own incident, guardian → own booking), so a caller can
    // never list files hanging off someone else's record.
    if (incidentId) {
      await assertOwnerAllowed(authUser, { incidentId });
      delete where.id;
      where.incidentId = incidentId;
    }

    if (venueId) {
      // Venue photos are operational, not personal — any org member may see them.
      if (authUser.role === "GUARDIAN" || authUser.role === "PARTICIPANT") {
        throw new Error("Not authorized to view these documents");
      }
      delete where.id;
      where.venueId = venueId;
    }

    if (bookingId) {
      await assertOwnerAllowed(authUser, { bookingId });
      delete where.id;
      where.bookingId = bookingId;
    }

    if (type && DOCUMENT_TYPES.includes(type)) where.type = type;

    const limit = Math.min(Math.max(Number(take) || 50, 1), 200);
    const offset = Math.max(Number(skip) || 0, 0);

    return prisma.document.findMany({
      where,
      select: DOCUMENT_SELECT,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  },

  /** Short-lived signed download link. Scoped exactly like `list`. */
  getDownloadUrl: async (authUser, id) => {
    const scope = await scopeForUser(authUser);
    const document = await prisma.document.findFirst({
      where: { ...scope, id },
      select: { id: true, fileKey: true, fileName: true },
    });
    if (!document) throw new Error("Document not found");

    const url = await storage.getDownloadUrl(document.fileKey, document.fileName);
    return { url, fileName: document.fileName };
  },

  /** Guardian (or a manager on their behalf) records consent. Idempotent. */
  giveConsent: async (authUser, id) => {
    const scope = await scopeForUser(authUser);
    const document = await prisma.document.findFirst({
      where: { ...scope, id },
      select: { id: true, consentRequired: true, consentGivenAt: true },
    });
    if (!document) throw new Error("Document not found");
    if (!document.consentRequired) throw new Error("This document does not require consent");
    if (document.consentGivenAt) throw new Error("Consent has already been given");

    const updated = await prisma.document.update({
      where: { id: document.id },
      data: {
        consentGivenAt: BigInt(Date.now()),
        consentBy: authUser.id,
        updatedAt: BigInt(Date.now()),
      },
      select: DOCUMENT_SELECT,
    });

    await logAudit({
      authData: authUser,
      action: "UPDATE",
      entity: "Document",
      entityId: updated.id,
      after: { consentGivenAt: Number(updated.consentGivenAt), consentBy: updated.consentBy },
    });

    return updated;
  },

  /** Soft-delete the row, then best-effort remove the object from B2. */
  remove: async (authUser, id) => {
    const document = await prisma.document.findFirst({
      where: { id, organizationId: authUser.organizationId, isDeleted: false },
      select: { id: true, fileKey: true, uploadedBy: true },
    });
    if (!document) throw new Error("Document not found");

    // Managers delete anything in the org; everyone else may only remove a file
    // they uploaded themselves (staff incident photo, guardian attachment).
    if (!isManager(authUser) && document.uploadedBy !== authUser.id) {
      throw new Error("You are not allowed to delete this document");
    }

    await prisma.document.update({
      where: { id: document.id },
      data: { isDeleted: true, updatedAt: BigInt(Date.now()) },
    });

    // Storage cleanup is best-effort — never fail the request on a B2 hiccup.
    await storage.deleteFile(document.fileKey);

    await logAudit({
      authData: authUser,
      action: "DELETE",
      entity: "Document",
      entityId: document.id,
    });

    return { id: document.id };
  },
};

module.exports = documentService;
module.exports.DOCUMENT_TYPES = DOCUMENT_TYPES;
