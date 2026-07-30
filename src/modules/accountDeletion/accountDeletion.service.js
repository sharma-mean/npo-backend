const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/db");
const notificationService = require("../notification/notification.service");
const { logAudit } = require("../../utils/auditLogger");
const storage = require("../../utils/storage");

/**
 * Self-service account deletion.
 *
 * Google Play requires any app offering account creation to provide an in-app
 * deletion path plus a public URL. It is deliberately a REQUEST rather than an
 * immediate wipe: welfare organizations are legally obliged to retain records
 * of the care and transport they delivered, so approval ANONYMISES the person
 * (identifiers removed, login destroyed) instead of deleting the row that every
 * booking, incident and daily report hangs off.
 */

const MANAGER_ROLES = ["NPO_ADMIN", "COORDINATOR"];

const REQUEST_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  status: true,
  reason: true,
  decisionNote: true,
  handledById: true,
  handledAt: true,
  createdAt: true,
  updatedAt: true,
  // `user` is a User row — never bare-include (leaks password + tokens).
  user: {
    select: { id: true, fullName: true, email: true, role: true, profileImage: true },
  },
  handledBy: { select: { id: true, fullName: true } },
};

const now = () => BigInt(Date.now());

/**
 * Refuse to remove the last administrator of an organization.
 *
 * Checked at request time AND again at approval: the org's admin count can fall
 * between the two (two admins each filing, then approving each other in turn
 * would otherwise leave zero admins and no in-app way to recover).
 */
const assertNotSoleAdmin = async (organizationId, targetUserId) => {
  if (!organizationId) return;
  const others = await prisma.user.count({
    where: {
      organizationId,
      role: "NPO_ADMIN",
      isDeleted: false,
      status: true,
      id: { not: targetUserId },
    },
  });
  if (others === 0) {
    throw new Error(
      "This is the only administrator of the organization. Appoint another administrator first, or contact support to close the organization."
    );
  }
};

/** Managers review their own org's requests; an NPO_ADMIN's own goes upward. */
const isManager = (role) => MANAGER_ROLES.includes(role);

/**
 * Create a deletion request for the caller. Idempotent: an existing PENDING
 * request is returned instead of stacking duplicates.
 */
const requestDeletion = async (authUser, { reason } = {}) => {
  const existing = await prisma.accountDeletionRequest.findFirst({
    where: { userId: authUser.id, status: "PENDING" },
    select: REQUEST_SELECT,
  });
  if (existing) return existing;

  // A SUPER_ADMIN has no organization, so no manager could ever list or action
  // their request — it would sit PENDING forever. Refuse it with a real answer
  // instead of accepting a request that goes nowhere.
  if (authUser.role === "SUPER_ADMIN") {
    throw new Error(
      "Platform administrator accounts cannot be deleted from the app. Contact support."
    );
  }

  // A sole remaining administrator cannot delete themselves — approving it
  // would leave the organization with nobody able to manage billing or staff.
  if (authUser.role === "NPO_ADMIN" && authUser.organizationId) {
    await assertNotSoleAdmin(authUser.organizationId, authUser.id);
  }

  const ts = now();
  const request = await prisma.accountDeletionRequest.create({
    data: {
      organizationId: authUser.organizationId || null,
      userId: authUser.id,
      reason: reason ? String(reason).slice(0, 1000) : null,
      status: "PENDING",
      createdAt: ts,
      updatedAt: ts,
    },
    select: REQUEST_SELECT,
  });

  await notifyManagers(authUser, request);
  logAudit({
    actorId: authUser.id,
    organizationId: authUser.organizationId,
    entity: "AccountDeletionRequest",
    entityId: request.id,
    action: "CREATE",
  });

  return request;
};

/** Tell the org's managers a request is waiting. Best-effort. */
const notifyManagers = async (authUser, request) => {
  if (!authUser.organizationId) return;
  try {
    const managers = await prisma.user.findMany({
      where: {
        organizationId: authUser.organizationId,
        role: { in: MANAGER_ROLES },
        isDeleted: false,
        status: true,
      },
      select: { id: true, email: true },
    });
    await Promise.allSettled(
      managers.map((m) =>
        notificationService.notify({
          userId: m.id,
          organizationId: authUser.organizationId,
          title: "Account deletion requested",
          message: `${authUser.fullName || "A user"} has requested deletion of their account. Review it in Staff Management.`,
          type: "ACCOUNT_DELETION_REQUEST",
          email: m.email,
        })
      )
    );
  } catch (err) {
    console.error("[accountDeletion] manager notify failed:", err.message);
  }
};

/** The caller's own current request (null when none is pending). */
const getMyRequest = async (authUser) =>
  prisma.accountDeletionRequest.findFirst({
    where: { userId: authUser.id, status: "PENDING" },
    select: REQUEST_SELECT,
  });

/** The caller withdraws their own pending request. */
const cancelMyRequest = async (authUser) => {
  const existing = await prisma.accountDeletionRequest.findFirst({
    where: { userId: authUser.id, status: "PENDING" },
    select: { id: true },
  });
  if (!existing) throw new Error("No pending deletion request found");

  const updated = await prisma.accountDeletionRequest.update({
    where: { id: existing.id },
    data: { status: "CANCELLED", updatedAt: now() },
    select: REQUEST_SELECT,
  });

  logAudit({
    actorId: authUser.id,
    organizationId: authUser.organizationId,
    entity: "AccountDeletionRequest",
    entityId: existing.id,
    action: "STATUS_CHANGE",
  });
  return updated;
};

/** Manager view: every request in the caller's organization. */
const listRequests = async (authUser, { status } = {}) => {
  if (!isManager(authUser.role)) throw new Error("Not authorized");
  return prisma.accountDeletionRequest.findMany({
    where: {
      organizationId: authUser.organizationId,
      ...(status ? { status } : {}),
    },
    select: REQUEST_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
};

/**
 * Strip every personal identifier from a user row while leaving the row itself
 * in place, so the care records that reference it stay intact but can no longer
 * be traced back to a person.
 */
const anonymiseUser = async (user) => {
  // Free the unique email so the person could sign up again later.
  const tombstone = `deleted-${user.id}@deleted.invalid`;
  const unusable = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: "Deleted user",
        nameKana: null,
        email: tombstone,
        password: unusable,
        phone: null,
        alternatePhone: null,
        emergencyContactPhone: null,
        emergencyInstructions: null,
        address: null,
        city: null,
        state: null,
        country: null,
        postalCode: null,
        dateOfBirth: null,
        gender: null,
        medicalNotes: null,
        allergyNotes: null,
        relationshipType: null,
        userCode: null,
        profileImage: null,
        resetToken: null,
        resetTokenExpiry: null,
        verifyToken: null,
        verifyTokenExpiry: null,
        consentLocationSharing: false,
        isLoggedIn: false,
        status: false,
        isDeleted: true,
        updatedAt: now(),
      },
    }),
    // Stop every push notification to this person's devices.
    prisma.deviceToken.deleteMany({ where: { userId: user.id } }),
    // Drop the last-known position on any assignment they still hold.
    prisma.bookingStaffAssignment.updateMany({
      where: { userId: user.id },
      data: { lastLat: null, lastLng: null, lastLocationAt: null },
    }),
  ]);

  // Only AFTER the row is committed as anonymised. Deleting the B2 object first
  // would, on a transaction failure, leave a live user row pointing at a key
  // that no longer exists — a broken avatar with no rollback. The DB is the
  // source of truth; this is best-effort cleanup of the orphaned object.
  if (user.profileImage && storage.isValidKey?.(user.profileImage)) {
    try {
      await storage.deleteFile(user.profileImage);
    } catch (err) {
      console.error("[accountDeletion] avatar delete failed:", err.message);
    }
  }
};

/** Manager approves: anonymise the account and close the request. */
const approveRequest = async (authUser, id, { decisionNote } = {}) => {
  if (!isManager(authUser.role)) throw new Error("Not authorized");

  const request = await prisma.accountDeletionRequest.findFirst({
    where: { id, organizationId: authUser.organizationId, status: "PENDING" },
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, role: true, profileImage: true, email: true } },
    },
  });
  if (!request) throw new Error("Pending deletion request not found");

  // Approval is the second pair of eyes the whole request model exists for —
  // approving your own request collapses it back into a self-service wipe.
  if (request.userId === authUser.id) {
    throw new Error(
      "You cannot approve your own deletion request. Another administrator must review it."
    );
  }

  // A COORDINATOR must not be able to erase an administrator.
  if (request.user.role === "NPO_ADMIN" && authUser.role !== "NPO_ADMIN") {
    throw new Error("Only an administrator can approve an administrator's deletion");
  }

  // Re-checked here, not just at request time: the org's admin count can fall
  // between filing and approval, and the org must never reach zero admins.
  if (request.user.role === "NPO_ADMIN") {
    await assertNotSoleAdmin(authUser.organizationId, request.userId);
  }

  // Tell them before the address is overwritten — afterwards we cannot reach them.
  try {
    await notificationService.notify({
      userId: request.userId,
      organizationId: null, // email only; the in-app row would outlive the account
      title: "Your account has been deleted",
      message:
        "Your account has been deleted and your personal details removed. Service records required by law are retained in anonymised form.",
      type: "ACCOUNT_DELETED",
      email: request.user.email,
    });
  } catch (err) {
    console.error("[accountDeletion] farewell email failed:", err.message);
  }

  await anonymiseUser(request.user);

  const updated = await prisma.accountDeletionRequest.update({
    where: { id: request.id },
    data: {
      status: "APPROVED",
      decisionNote: decisionNote ? String(decisionNote).slice(0, 1000) : null,
      handledById: authUser.id,
      handledAt: now(),
      updatedAt: now(),
    },
    select: REQUEST_SELECT,
  });

  logAudit({
    actorId: authUser.id,
    organizationId: authUser.organizationId,
    entity: "AccountDeletionRequest",
    entityId: request.id,
    action: "DELETE",
  });
  return updated;
};

/** Manager rejects, with a reason the requester is told. */
const rejectRequest = async (authUser, id, { decisionNote } = {}) => {
  if (!isManager(authUser.role)) throw new Error("Not authorized");

  const request = await prisma.accountDeletionRequest.findFirst({
    where: { id, organizationId: authUser.organizationId, status: "PENDING" },
    select: { id: true, userId: true, user: { select: { email: true } } },
  });
  if (!request) throw new Error("Pending deletion request not found");

  const updated = await prisma.accountDeletionRequest.update({
    where: { id: request.id },
    data: {
      status: "REJECTED",
      decisionNote: decisionNote ? String(decisionNote).slice(0, 1000) : null,
      handledById: authUser.id,
      handledAt: now(),
      updatedAt: now(),
    },
    select: REQUEST_SELECT,
  });

  await notificationService
    .notify({
      userId: request.userId,
      organizationId: authUser.organizationId,
      title: "Account deletion request declined",
      message: decisionNote
        ? `Your account deletion request was declined: ${decisionNote}`
        : "Your account deletion request was declined. Contact your organization's administrator for details.",
      type: "ACCOUNT_DELETION_REJECTED",
      email: request.user.email,
    })
    .catch(() => {});

  logAudit({
    actorId: authUser.id,
    organizationId: authUser.organizationId,
    entity: "AccountDeletionRequest",
    entityId: request.id,
    action: "STATUS_CHANGE",
  });
  return updated;
};

module.exports = {
  requestDeletion,
  getMyRequest,
  cancelMyRequest,
  listRequests,
  approveRequest,
  rejectRequest,
};
