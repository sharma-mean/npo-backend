const prisma = require("../../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { logAudit } = require("../../utils/auditLogger");
const subscriptionService = require("../organizationSubscription/organizationSubscription.service");
const normalizeEmail = require("../../utils/normalizeEmail");
const { verifyGoogleKey } = require("../../utils/geocode");
const storage = require("../../utils/storage");
const { ORGANIZATION_STATUS } = require("./organization.constants");

// Fields a super admin may set when updating an org (whitelist — avoids
// mass-assignment of isDeleted/code/createdAt/etc. via `...data`).
const ORG_UPDATABLE = [
  "name", "email", "phone", "address", "city", "state", "country",
  "postalCode", "status",
];
const {
  validateId,
  validateCreateOrganization,
  validateUpdateOrganization,
  validateDeleteOrganization,
} = require("./organization.validation");

const originationServices = {
  createOrganization: async (data) => {
    validateCreateOrganization(data);
    const now = BigInt(Date.now());
    const orgEmail = normalizeEmail(data.email);
    const adminEmail = normalizeEmail(data.adminEmail);

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: data.planId },
    });
    if (!plan) {
      throw new Error("Subscription plan not found");
    }

    // Reject collisions up front (admin email is the login identity).
    const [orgExists, userExists] = await Promise.all([
      prisma.organization.findUnique({ where: { email: orgEmail } }),
      prisma.user.findUnique({ where: { email: adminEmail } }),
    ]);
    if (orgExists) throw new Error("An organization with this email already exists");
    if (userExists) throw new Error("A user with this admin email already exists");

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const organization = await prisma.organization.create({
      data: {
        name: data.name,
        code: data.code,
        email: orgEmail,
        phone: data.phone,
        address: data.address,
        city: data.city,
        state: data.state,
        country: data.country,
        postalCode: data.postalCode,
        status: ORGANIZATION_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now,
      },
    });

    await prisma.user.create({
      data: {
        fullName: data.adminName,
        email: adminEmail,
        password: hashedPassword,
        role: "NPO_ADMIN",
        phone: data.adminPhone,
        organizationId: organization.id,
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Provision the subscription through the subscription service so the row
    // carries a full billing snapshot + an invoice (consistent with checkout).
    await subscriptionService.createSubscription({
      organizationId: organization.id,
      planId: plan.id,
      createdBy: null,
    });

    return organization;
  },

  getAllOrganizations: async () => {
    return await prisma.organization.findMany({
      where: {
        isDeleted: false,
      },
      include: {
        subscriptions: true,
        users: { select: { id: true, fullName: true, email: true, phone: true, role: true, serviceType: true, status: true, organizationId: true, designationId: true } },
      },
    });
  },

  getOrganizationById: async (id) => {
    const organization = await prisma.organization.findFirst({
      where: { id, isDeleted: false },
    });

    if (!organization) {
      throw new Error("Organization not found");
    }

    return organization;
  },

  updateOrganization: async (id, data) => {
    validateUpdateOrganization(data);

    const updateData = { updatedAt: BigInt(Date.now()) };
    for (const k of ORG_UPDATABLE) {
      if (data[k] !== undefined) {
        updateData[k] = k === "email" ? normalizeEmail(data[k]) : data[k];
      }
    }

    return await prisma.organization.update({
      where: { id },
      data: updateData,
    });
  },

  deleteOrganization: async (id) => {
    return await prisma.organization.update({
      where: { id },
      data: {
        isDeleted: true,
        status: ORGANIZATION_STATUS.INACTIVE,
        updatedAt: BigInt(Date.now()),
      },
    });
  },

  // Subscription history for one org (super admin view)
  getOrgSubscriptions: async (id) => {
    return subscriptionService.getOrgSubscriptions(id);
  },

  // NPO admin: read own organization
  getMyOrganization: async (orgId) => {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new Error("Organization not found");
    return org;
  },

  // Lightweight, secret-free branding for any org member (drives the org logo +
  // name on reports/receipts). The response middleware turns `brandLogo` (B2 key)
  // into a signed `brandLogoUrl`.
  getBranding: async (orgId) => {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, brandLogo: true, taxRegistrationNumber: true },
    });
    if (!org) throw new Error("Organization not found");
    return org;
  },

  /**
   * Org brand logo. Same two-step B2 flow as avatars — the browser PUTs straight
   * to storage and we persist only the key; the response middleware turns it
   * into a signed `brandLogoUrl`. Used on invoices/receipts and the app header.
   */
  createLogoUploadUrl: async (authUser, { fileName, mimeType, size }) => {
    if (!storage.isConfigured()) throw new Error("File storage is not configured");
    if (!fileName) throw new Error("fileName is required");
    if (!mimeType || !storage.AVATAR_MIME.includes(mimeType)) {
      throw new Error("Logo must be a PNG, JPEG or WebP image");
    }
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("Invalid file size");
    if (bytes > storage.AVATAR_MAX_BYTES) {
      throw new Error(`Logo is too large (max ${storage.AVATAR_MAX_BYTES / (1024 * 1024)} MB)`);
    }
    return storage.getUploadUrl({ fileName, mimeType });
  },

  /** Persist the uploaded logo key (or null to remove). Deletes the old object. */
  updateBrandLogo: async (orgId, image) => {
    const isDataUrl = typeof image === "string" && image.startsWith("data:");
    if (image !== null && !isDataUrl && !storage.isValidKey(image)) {
      throw new Error("Invalid image reference");
    }

    const before = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { brandLogo: true },
    });

    const org = await prisma.organization.update({
      where: { id: orgId },
      data: { brandLogo: image, updatedAt: BigInt(Date.now()) },
    });

    const old = before?.brandLogo;
    if (old && !String(old).startsWith("data:") && old !== image) {
      await storage.deleteFile(old); // best-effort; never fails the update
    }

    return org;
  },

  /**
   * Map settings for the caller's org — read by EVERY role, because anyone who
   * can see a booking map needs the provider (and, for Google, the key).
   *
   * Exposing the Google key to the org's own users is expected: a Maps JS key
   * is a browser credential by design, which is exactly why Google wants it
   * locked down with an HTTP-referrer restriction (we say so in the UI). It is
   * never returned to another tenant, and never when the provider is OSM.
   */
  getMapConfig: async (orgId) => {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { mapProvider: true, googleMapsApiKey: true },
    });
    if (!org) throw new Error("Organization not found");

    const usingGoogle = org.mapProvider === "GOOGLE" && !!org.googleMapsApiKey;
    return {
      // A half-configured org (GOOGLE selected, key removed) silently falls back
      // to OSM rather than rendering a dead map.
      provider: usingGoogle ? "GOOGLE" : "OSM",
      googleMapsApiKey: usingGoogle ? org.googleMapsApiKey : null,
    };
  },

  /**
   * NPO admin sets their org's map provider. Choosing GOOGLE requires their OWN
   * key — the usage then bills that org, not us across every tenant. The key is
   * verified against Google before we save it, so a bad key fails here instead
   * of silently breaking every pin later.
   */
  updateMapConfig: async (orgId, { mapProvider, googleMapsApiKey }) => {
    const provider = String(mapProvider || "OSM").toUpperCase();
    if (!["OSM", "GOOGLE"].includes(provider)) {
      throw new Error("mapProvider must be OSM or GOOGLE");
    }

    const data = { mapProvider: provider, updatedAt: BigInt(Date.now()) };

    if (provider === "OSM") {
      // Switching back to free maps drops the stored key — don't sit on a
      // customer's Google credential we no longer use.
      data.googleMapsApiKey = null;
    } else {
      // Empty/undefined key on an org already using Google = "keep the existing
      // key" (the UI never round-trips the secret back to us).
      if (googleMapsApiKey) {
        const check = await verifyGoogleKey(googleMapsApiKey);
        if (!check.ok) throw new Error(check.message);
        data.googleMapsApiKey = googleMapsApiKey;
      } else {
        const current = await prisma.organization.findUnique({
          where: { id: orgId },
          select: { googleMapsApiKey: true },
        });
        if (!current?.googleMapsApiKey) {
          throw new Error("A Google Maps API key is required to use Google Maps");
        }
      }
    }

    await prisma.organization.update({ where: { id: orgId }, data });
    return organizationService.getMapConfig(orgId);
  },

  // NPO admin: update own organization (whitelisted fields only)
  updateMyOrganization: async (orgId, data) => {
    const allowed = ["name", "phone", "address", "city", "state", "country", "postalCode"];
    const updateData = { updatedAt: BigInt(Date.now()) };
    for (const k of allowed) if (data[k] !== undefined) updateData[k] = data[k];
    // Qualified-invoice registration number printed on this org's receipts
    // (client #4). Empty clears it; otherwise it must be the JP format T+13 digits.
    if (data.taxRegistrationNumber !== undefined) {
      const raw = String(data.taxRegistrationNumber || "").trim().toUpperCase();
      if (raw === "") {
        updateData.taxRegistrationNumber = null;
      } else if (/^T\d{13}$/.test(raw)) {
        updateData.taxRegistrationNumber = raw;
      } else {
        throw new Error("Registration number must be 'T' followed by 13 digits");
      }
    }
    // Booking reminder intervals (hours before start). Whitelisted to the
    // client-agreed options; at least one must stay selected.
    if (Array.isArray(data.reminderHours)) {
      const ALLOWED_HOURS = [168, 48, 24];
      const hours = [...new Set(data.reminderHours.map(Number))].filter((h) =>
        ALLOWED_HOURS.includes(h),
      );
      if (hours.length === 0) {
        throw new Error("Select at least one reminder interval");
      }
      updateData.reminderHours = hours.sort((a, b) => b - a);
    }
    return prisma.organization.update({ where: { id: orgId }, data: updateData });
  },

  // Super admin: get a short-lived token to act as an org's NPO_ADMIN
  impersonate: async (orgId, superAdmin) => {
    const org = await prisma.organization.findFirst({
      where: { id: orgId, isDeleted: false },
    });
    if (!org) throw new Error("Organization not found");

    const admin = await prisma.user.findFirst({
      where: { organizationId: orgId, role: "NPO_ADMIN", isDeleted: false },
      orderBy: { createdAt: "asc" },
    });
    if (!admin) throw new Error("This organization has no admin to impersonate");

    const token = jwt.sign(
      {
        userId: admin.id,
        role: admin.role,
        organizationId: admin.organizationId,
        impersonatedBy: superAdmin.id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" },
    );

    logAudit({
      authData: { id: superAdmin.id, role: "SUPER_ADMIN", organizationId: orgId },
      action: "OVERRIDE",
      entity: "Organization",
      entityId: orgId,
      metadata: { impersonatedUserId: admin.id, reason: "Super admin impersonation" },
    });

    return {
      token,
      user: {
        id: admin.id,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        organizationId: admin.organizationId,
        organizationName: org.name,
        impersonated: true,
      },
    };
  },
};
module.exports = originationServices;
