const prisma = require("../../config/db");
const notificationService = require("../notification/notification.service");

const DAY_MS = 24 * 60 * 60 * 1000;
// A document inside this window is "expiring" — still valid, but we warn.
const EXPIRING_WINDOW_DAYS = 30;

// Paperwork that gates an operation when it lapses.
const DRIVER_TYPES = ["DRIVING_LICENCE"];
const VEHICLE_TYPES = ["VEHICLE_INSPECTION"]; // 車検証 — legally required in Japan

// Readable names for the compliance-sweep email rows.
const DOC_TYPE_LABEL = {
  DRIVING_LICENCE: "Driving licence",
  CERTIFICATION: "Certification",
  VEHICLE_INSPECTION: "Vehicle inspection (車検証)",
  INSURANCE: "Insurance",
  REGISTRATION: "Registration",
};

/** VALID | EXPIRING | EXPIRED for a BigInt/number expiry (null → VALID). */
const statusOf = (expiresAt, now = Date.now()) => {
  if (expiresAt == null) return "VALID";
  const ms = Number(expiresAt);
  if (!Number.isFinite(ms)) return "VALID";
  if (ms < now) return "EXPIRED";
  if (ms - now <= EXPIRING_WINDOW_DAYS * DAY_MS) return "EXPIRING";
  return "VALID";
};

/**
 * The gate is deliberately conservative: we only block when a document of the
 * required type EXISTS and has lapsed. If the org has never uploaded a licence
 * we don't block — the feature must not brick an org that hasn't filed its
 * paperwork yet. Once they upload one, keeping it current becomes enforced.
 */
const findExpired = async ({ organizationId, types, userId, vehicleId }) => {
  const docs = await prisma.document.findMany({
    where: {
      organizationId,
      isDeleted: false,
      type: { in: types },
      ...(userId ? { userId } : {}),
      ...(vehicleId ? { vehicleId } : {}),
      expiresAt: { not: null },
    },
    select: { id: true, type: true, expiresAt: true, fileName: true },
    orderBy: { expiresAt: "desc" },
  });
  if (docs.length === 0) return null; // nothing filed → nothing to enforce

  // The newest expiry wins — a renewed licence supersedes the old scan.
  const newest = docs[0];
  return statusOf(newest.expiresAt) === "EXPIRED" ? newest : null;
};

const complianceService = {
  statusOf,
  EXPIRING_WINDOW_DAYS,

  /** Throws if this staff member's driving licence is on file but expired. */
  assertStaffCanDrive: async (organizationId, userId) => {
    const expired = await findExpired({ organizationId, types: DRIVER_TYPES, userId });
    if (expired) {
      throw new Error(
        "This staff member's driving licence has expired — upload a valid licence before assigning them as a driver",
      );
    }
  },

  /** Throws if this vehicle's inspection (車検) is on file but expired. */
  assertVehicleRoadworthy: async (organizationId, vehicleId) => {
    const expired = await findExpired({ organizationId, types: VEHICLE_TYPES, vehicleId });
    if (expired) {
      throw new Error(
        "This vehicle's inspection certificate (車検) has expired — it cannot be dispatched until it is renewed",
      );
    }
  },

  /** Compliance documents that are expired or lapse within the window. */
  getExpiring: async (organizationId, days = EXPIRING_WINDOW_DAYS) => {
    const cutoff = BigInt(Date.now() + days * DAY_MS);
    const docs = await prisma.document.findMany({
      where: {
        organizationId,
        isDeleted: false,
        expiresAt: { not: null, lte: cutoff },
      },
      select: {
        id: true,
        type: true,
        fileName: true,
        expiresAt: true,
        owner: { select: { id: true, fullName: true } },
        vehicle: { select: { id: true, vehicleName: true, vehicleNumber: true } },
      },
      orderBy: { expiresAt: "asc" },
    });
    return docs.map((d) => ({ ...d, status: statusOf(d.expiresAt) }));
  },

  /**
   * Daily sweep — warn each org's managers about compliance paperwork that has
   * expired or is about to. Per-org isolation so one failure never aborts the
   * batch. Notification is best-effort.
   */
  runComplianceSweep: async () => {
    const orgs = await prisma.organization.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });

    let notified = 0;
    const results = await Promise.allSettled(
      orgs.map(async (org) => {
        const docs = await complianceService.getExpiring(org.id);
        if (docs.length === 0) return;

        const expired = docs.filter((d) => d.status === "EXPIRED");
        const expiring = docs.filter((d) => d.status === "EXPIRING");

        // One email row per document beats a single "|"-joined wall of text.
        // Cap the list so a badly-lapsed org doesn't get a 60-row email.
        const MAX_ROWS = 10;
        const ordered = [...expired, ...expiring];
        const rows = ordered.slice(0, MAX_ROWS).map((d) => {
          const who =
            d.owner?.fullName ||
            (d.vehicle ? `${d.vehicle.vehicleName} (${d.vehicle.vehicleNumber})` : "—");
          const on = new Date(Number(d.expiresAt)).toLocaleDateString("en-GB", {
            timeZone: "Asia/Tokyo",
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
          const label = DOC_TYPE_LABEL[d.type] || d.type;
          const verb = d.status === "EXPIRED" ? "expired" : "expires";
          return [`${label} — ${who}`, `${verb} ${on}`];
        });
        if (ordered.length > MAX_ROWS) {
          rows.push(["…and more", `${ordered.length - MAX_ROWS} further document(s)`]);
        }

        const summary = [
          expired.length ? `${expired.length} expired` : null,
          expiring.length ? `${expiring.length} expiring within 30 days` : null,
        ]
          .filter(Boolean)
          .join(", ");

        const managers = await prisma.user.findMany({
          where: {
            organizationId: org.id,
            role: { in: ["NPO_ADMIN", "COORDINATOR"] },
            isDeleted: false,
            status: true,
          },
          select: { id: true, email: true },
        });
        if (managers.length === 0) return;

        await Promise.allSettled(
          managers.map((m) =>
            notificationService.notify({
              userId: m.id,
              organizationId: org.id,
              title: expired.length ? "Compliance documents have expired" : "Compliance documents expiring soon",
              // In-app keeps the compact one-liner; the email gets real rows.
              message: expired.length
                ? `${summary}. Expired paperwork blocks driver assignment and vehicle dispatch — please upload the renewals.`
                : `${summary}. Please upload the renewals before they lapse.`,
              type: "COMPLIANCE",
              email: m.email,
              emailData: { details: rows },
            }),
          ),
        );
        notified += 1;
      }),
    );

    return {
      orgs: orgs.length,
      notified,
      failed: results.filter((r) => r.status === "rejected").length,
    };
  },
};

module.exports = complianceService;
