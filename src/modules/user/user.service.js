const prisma = require("../../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const userValidation = require("./user.validation");
const notificationService = require("../notification/notification.service");
const subscriptionService = require("../organizationSubscription/organizationSubscription.service");
const normalizeEmail = require("../../utils/normalizeEmail");
const { sendAccountSetupEmail, sendCredentialsEmail } = require("../../utils/accountSetup");
const storage = require("../../utils/storage");

/**
 * `profileImage` on the row is a B2 object KEY (or a legacy base64 data-URL).
 * A client can't render a key, so every user we return also carries a
 * `profileImageUrl` — a signed link, or the data-URL passed straight through.
 * Signing is local crypto (no network call), so mapping a whole list is cheap.
 */
const withAvatarUrl = async (user) => {
  if (!user) return user;
  return { ...user, profileImageUrl: await storage.getAvatarUrl(user.profileImage) };
};
const withAvatarUrls = async (users) => Promise.all((users || []).map(withAvatarUrl));

// Roles that consume a paid staff-side seat (counted against plan.maxUsers).
const SEAT_ROLES = ["NPO_ADMIN", "COORDINATOR", "STAFF"];

// Privilege ranking — an actor may never run account-control ops on a target
// that outranks them (prevents e.g. a COORDINATOR resetting an NPO_ADMIN's
// password / disabling the admin). Equal-rank is allowed only when explicitly
// permitted (lateral profile edits) or when acting on oneself.
const ROLE_RANK = {
  SUPER_ADMIN: 5,
  NPO_ADMIN: 4,
  COORDINATOR: 3,
  STAFF: 2,
  GUARDIAN: 1,
  PARTICIPANT: 0,
};
const assertCanManage = (actor, target, { allowEqual = false } = {}) => {
  const a = ROLE_RANK[actor.role] ?? -1;
  const t = ROLE_RANK[target.role] ?? -1;
  if (t > a || (!allowEqual && t === a && target.id !== actor.id)) {
    throw new Error("You do not have permission to manage this user");
  }
};
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../../config/jwt");

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

// Never return secret/auth columns (password hash, reset/verify tokens) to clients.
const USER_SAFE_SELECT = {
  id: true,
  fullName: true,
  nameKana: true,
  email: true,
  userCode: true,
  profileImage: true,
  phone: true,
  emergencyContactPhone: true,
  contractedHoursPerDay: true,
  workingDays: true,
  role: true,
  designationId: true,
  serviceType: true,
  address: true,
  status: true,
  organizationId: true,
  dateOfBirth: true,
  dateOfJoining: true,
  emailVerifiedAt: true,
  consentLocationSharing: true,
  loginAt: true,
  createdAt: true,
  updatedAt: true,
};

// Roles an org-admin may assign when creating users. SUPER_ADMIN/NPO_ADMIN
// are never assignable through this endpoint (no self-escalation / no platform-admin minting).
const ASSIGNABLE_ROLES = ["COORDINATOR", "STAFF", "GUARDIAN", "PARTICIPANT"];

const userService = {
  // opts.setupLinkEmail: bulk import passes true — the generated random
  // password is never emailed; the user gets a set-password link instead.
  // Form creates (default) email the admin-chosen credentials directly.
  createUser: async (data, authUser, { setupLinkEmail = false } = {}) => {
    userValidation.validateCreateUser(data);
    data.email = normalizeEmail(data.email);

    if (!ASSIGNABLE_ROLES.includes(data.role)) {
      throw new Error("Invalid role");
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email: data.email,
      },
    });

    if (existingUser) {
      throw new Error("Email already exists");
    }

    // Enforce the plan's staff seat limit before adding a staff-side user.
    if (SEAT_ROLES.includes(data.role)) {
      await subscriptionService.assertSeatCapacity(authUser.organizationId);
    }

    userValidation.staffRoleAssign(data);

    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Report code: staff get S001-style per-org codes (atomic counter).
    let userCode = null;
    if (data.role === "STAFF") {
      const org = await prisma.organization.update({
        where: { id: authUser.organizationId },
        data: { staffSeq: { increment: 1 } },
        select: { staffSeq: true },
      });
      userCode = `S${String(org.staffSeq).padStart(3, "0")}`;
    }

    const user = await prisma.user.create({
      data: {
        fullName: data.fullName,

        nameKana: data.nameKana || null,

        email: data.email,

        password: hashedPassword,

        userCode,

        phone: data.phone,

        emergencyContactPhone: data.emergencyContactPhone,

        role: data.role,

        designationId: data.designationId,

        serviceType: data.serviceType,

        address: data.address,

        contractedHoursPerDay:
          data.contractedHoursPerDay !== undefined && data.contractedHoursPerDay !== null && data.contractedHoursPerDay !== ""
            ? Number(data.contractedHoursPerDay)
            : null,

        workingDays: Array.isArray(data.workingDays)
          ? data.workingDays.map(Number).filter((d) => d >= 0 && d <= 6)
          : undefined,

        status: true,

        dateOfBirth: data.dateOfBirth ? BigInt(data.dateOfBirth) : null,

        dateOfJoining: data.dateOfJoining ? BigInt(data.dateOfJoining) : null,

        organizationId: authUser.organizationId,

        createdBy: authUser.id,
        emailVerifiedAt: BigInt(Date.now()),
        loginAt: BigInt(Date.now()),
        createdAt: BigInt(Date.now()),

        updatedAt: BigInt(Date.now()),
      },
    });

    // Email new login-capable users: admin-chosen credentials (form create)
    // or a secure "set your password" link (bulk import).
    if (["STAFF", "COORDINATOR", "GUARDIAN"].includes(user.role)) {
      if (setupLinkEmail) {
        await sendAccountSetupEmail(user);
      } else {
        await sendCredentialsEmail(user, data.password);
      }
    }

    // New staff added → nudge managers if upcoming bookings still need staff.
    if (user.role === "STAFF") {
      try {
        const bookingService = require("../booking/booking.service");
        await bookingService.notifyUnderstaffedBookings(authUser.organizationId);
      } catch (err) {
        console.error("[user] understaffed notify failed:", err.message);
      }
    }
    return user;
  },

  // Bulk import staff/coordinators from parsed CSV rows. dryRun → validate
  // only. Resolves designation name → StaffRole id (org-scoped). Each created
  // user gets a random password + set-password email (no plaintext emailed).
  importUsers: async (authUser, rows, { dryRun = false } = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("No rows to import");
    }
    if (rows.length > 500) {
      throw new Error("Too many rows (max 500 per import)");
    }

    const SERVICE_TYPES = ["MOBILITY", "RECREATION", "DAYCARE"];
    const IMPORT_ROLES = ["STAFF", "COORDINATOR"];
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Preload org designations for name → id resolution.
    const roles = await prisma.staffRole.findMany({
      where: { organizationId: authUser.organizationId },
      select: { id: true, name: true },
    });
    const roleByName = new Map(roles.map((r) => [r.name.trim().toLowerCase(), r.id]));

    const seenEmails = new Set();
    const validated = rows.map((raw, idx) => {
      const errors = [];
      const r = {
        fullName: (raw.fullName || "").trim(),
        email: normalizeEmail(raw.email || ""),
        phone: (raw.phone || "").trim(),
        role: (raw.role || "STAFF").trim().toUpperCase(),
        serviceType: (raw.serviceType || "").trim().toUpperCase(),
        designation: (raw.designation || "").trim(),
      };

      if (!r.fullName) errors.push("fullName required");
      if (!r.email) errors.push("email required");
      else if (!emailRe.test(r.email)) errors.push("email invalid");
      if (!IMPORT_ROLES.includes(r.role)) errors.push("role must be STAFF or COORDINATOR");
      if (r.serviceType && !SERVICE_TYPES.includes(r.serviceType))
        errors.push("serviceType must be MOBILITY/RECREATION/DAYCARE");

      let designationId = null;
      if (r.role === "STAFF") {
        if (!r.serviceType) errors.push("serviceType required for STAFF");
        if (!r.designation) errors.push("designation required for STAFF");
        else {
          designationId = roleByName.get(r.designation.toLowerCase()) || null;
          if (!designationId) errors.push(`designation "${r.designation}" not found`);
        }
      }

      if (r.email) {
        if (seenEmails.has(r.email)) errors.push("duplicate email in file");
        else seenEmails.add(r.email);
      }

      return { row: idx + 1, data: { ...r, designationId }, valid: errors.length === 0, errors };
    });

    const validCount = validated.filter((v) => v.valid).length;

    if (dryRun) {
      return {
        dryRun: true,
        total: validated.length,
        valid: validCount,
        invalid: validated.length - validCount,
        rows: validated,
      };
    }

    let created = 0;
    const failed = [];
    for (const v of validated) {
      if (!v.valid) {
        failed.push({ row: v.row, errors: v.errors });
        continue;
      }
      try {
        await userService.createUser(
          {
            fullName: v.data.fullName,
            email: v.data.email,
            phone: v.data.phone || undefined,
            role: v.data.role,
            serviceType: v.data.serviceType || undefined,
            designationId: v.data.designationId || undefined,
            password: crypto.randomBytes(24).toString("hex"),
          },
          authUser,
          { setupLinkEmail: true },
        );
        created += 1;
      } catch (err) {
        failed.push({ row: v.row, errors: [err.message] });
      }
    }

    return { dryRun: false, total: validated.length, created, failed: failed.length, failures: failed };
  },

  login: async (data) => {
    if (!data.email) {
      throw new Error("Email is required");
    }

    if (!data.password) {
      throw new Error("Password is required");
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizeEmail(data.email),
      },
      include: {
        organization: true,
      },
    });

    if (!user) {
      throw new Error("Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password);

    if (!isPasswordValid) {
      throw new Error("Invalid email or password");
    }

    if (!user.emailVerifiedAt) {
      throw new Error("Please verify your email before logging in. Check your inbox for the verification link.");
    }

    if (!user.status) {
      throw new Error("User account suspended");
    }

    if (user.organization && !user.organization.status) {
      throw new Error("Organization is inactive");
    }

    // Fire-and-forget — don't block the login response on this write
    prisma.user
      .update({
        where: { id: user.id },
        data: { loginAt: BigInt(Date.now()), updatedAt: BigInt(Date.now()) },
      })
      .catch(() => {});

    const token = generateAccessToken(user);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organization: user.organization?.name,
        servicetype: user.serviceType,
        originationID: user.organizationId,
        // Signed avatar link so the header shows the picture straight after
        // login, without waiting for a profile fetch.
        profileImage: user.profileImage,
        profileImageUrl: await storage.getAvatarUrl(user.profileImage),
      },
    };
  },

  getUsers: async (organizationId) => {
    const users = await prisma.user.findMany({
      where: {
        isDeleted: false,
        organizationId,
        role: { in: ["STAFF", "COORDINATOR", "NPO_ADMIN"] },
      },
      select: { ...USER_SAFE_SELECT, designation: true },
      orderBy: { createdAt: "desc" },
    });
    return withAvatarUrls(users);
  },

  getUserById: async (id, authUser) => {
    // A non-manager may only read their OWN record (profile) — prevents a
    // guardian/participant/staff from reading other users' details by id.
    const isManager = ["NPO_ADMIN", "COORDINATOR"].includes(authUser.role);
    if (!isManager && id !== authUser.id) {
      throw new Error("Not authorized to view this user");
    }
    const user = await prisma.user.findFirst({
      where: { id, organizationId: authUser.organizationId, isDeleted: false },
      select: USER_SAFE_SELECT,
    });
    return withAvatarUrl(user);
  },

  updateUser: async (id, data, authUser) => {
    userValidation.validateUpdateUser(data);
    if (data.email !== undefined) data.email = normalizeEmail(data.email);

    const user = await prisma.user.findFirst({
      where: { id, organizationId: authUser.organizationId, isDeleted: false },
    });
    if (!user) throw new Error("User not found");
    assertCanManage(authUser, user, { allowEqual: true });

    if (data.email && data.email !== user.email) {
      const existing = await prisma.user.findUnique({
        where: { email: data.email },
      });
      if (existing) throw new Error("Email already exists");
    }

    // whitelist fields — never allow role/organizationId changes via this endpoint
    const updateData = {
      ...(data.fullName !== undefined && { fullName: data.fullName }),
      ...(data.nameKana !== undefined && { nameKana: data.nameKana || null }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.emergencyContactPhone !== undefined && {
        emergencyContactPhone: data.emergencyContactPhone,
      }),
      ...(data.designationId !== undefined && {
        designationId: data.designationId || null,
      }),
      ...(data.serviceType !== undefined && { serviceType: data.serviceType }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.dateOfBirth !== undefined && {
        dateOfBirth: data.dateOfBirth ? BigInt(data.dateOfBirth) : null,
      }),
      ...(data.dateOfJoining !== undefined && {
        dateOfJoining: data.dateOfJoining ? BigInt(data.dateOfJoining) : null,
      }),
      ...(data.contractedHoursPerDay !== undefined && {
        contractedHoursPerDay:
          data.contractedHoursPerDay === null || data.contractedHoursPerDay === ""
            ? null
            : Number(data.contractedHoursPerDay),
      }),
      ...(Array.isArray(data.workingDays) && {
        workingDays: data.workingDays.map(Number).filter((d) => d >= 0 && d <= 6),
      }),
      updatedAt: BigInt(Date.now()),
    };

    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    return await prisma.user.update({
      where: { id },
      data: updateData,
    });
  },

  deleteUser: async (id, authUser) => {
    const user = await prisma.user.findFirst({
      where: { id, organizationId: authUser.organizationId, isDeleted: false },
    });
    if (!user) throw new Error("User not found");

    if (user.id === authUser.id) {
      throw new Error("You cannot delete your own account");
    }
    assertCanManage(authUser, user);

    const deleted = await prisma.user.update({
      where: { id },
      data: {
        isDeleted: true,
        status: false,
        updatedAt: BigInt(Date.now()),
      },
    });

    // A removed staff member must be pulled off their upcoming bookings —
    // otherwise those bookings keep a dead assignment. Release + notify
    // guardian/managers (booking now needs re-staffing). Best-effort.
    if (user.role === "STAFF") {
      try {
        const bookingService = require("../booking/booking.service");
        await bookingService.releaseStaffFromUpcoming(
          id,
          authUser.organizationId,
          "staff removed",
        );
      } catch (err) {
        console.error("[user] release staff assignments failed:", err.message);
      }
    }

    return deleted;
  },

  updateUserPassword: async (userId, oldPassword, newPassword) => {
    userValidation.validatePassword(newPassword);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isOldPasswordValid) {
      throw new Error("Old password is incorrect");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    return await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        updatedAt: BigInt(Date.now()),
      },
    });
  },

  userResetPassword: async (userId, newPassword, authUser) => {
    userValidation.validateUpdateUser({ password: newPassword });

    const target = await prisma.user.findFirst({
      where: { id: userId, organizationId: authUser.organizationId, isDeleted: false },
      select: { id: true, role: true },
    });
    if (!target) throw new Error("User not found");
    assertCanManage(authUser, target);

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    return await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        updatedAt: BigInt(Date.now()),
      },
      select: USER_SAFE_SELECT,
    });
  },

  // Self-service: generate reset token + email link. Always succeeds (no email enumeration).
  forgotPassword: async (rawEmail) => {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new Error("Email is required");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.isDeleted || !user.status) {
      return; // silently no-op — do not reveal whether the account exists
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiry = BigInt(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: tokenHash, resetTokenExpiry: expiry, updatedAt: BigInt(Date.now()) },
    });

    const baseUrl =
      process.env.FRONTEND_URL ||
      (process.env.ALLOWED_ORIGINS || "").split(",")[0].trim() ||
      "";
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    await notificationService.notify({
      userId: user.id,
      organizationId: user.organizationId,
      title: "Password Reset Request",
      message:
        "We received a request to reset your password. Use the button below to set a new one. If you did not request this, you can safely ignore this email — your password stays unchanged.",
      type: "GENERAL",
      email: user.email,
      emailSubject: "Reset your password",
      recipientName: user.fullName,
      emailData: {
        eyebrow: "Security",
        details: [
          ["Account", user.email],
          ["Link expires", "1 hour from now"],
        ],
        actionUrl: resetUrl,
        actionText: "Reset Password",
      },
    });
  },

  resetPasswordWithToken: async (rawToken, newPassword) => {
    if (!rawToken) throw new Error("Reset token is required");
    userValidation.validatePassword(newPassword);

    const tokenHash = hashToken(rawToken);
    const user = await prisma.user.findFirst({
      where: { resetToken: tokenHash },
    });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < BigInt(Date.now())) {
      throw new Error("Reset link is invalid or has expired");
    }
    // Token may have been issued before the account was suspended/deleted.
    if (user.isDeleted || !user.status) {
      throw new Error("This account is no longer active");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
        updatedAt: BigInt(Date.now()),
      },
    });
  },

  toggleUserStatus: async (userId, authUser) => {
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId: authUser.organizationId, isDeleted: false },
    });

    if (!user) {
      throw new Error("User not found");
    }
    if (user.id === authUser.id) {
      throw new Error("You cannot change your own account status");
    }
    assertCanManage(authUser, user);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        status: !user.status,
        updatedAt: BigInt(Date.now()),
      },
      select: USER_SAFE_SELECT,
    });

    // Deactivating a staff member → release their upcoming assignments + flag
    // for re-staffing. Re-activating → nudge managers that they can now help
    // staff any short bookings. Best-effort (never blocks the toggle).
    if (user.role === "STAFF") {
      try {
        const bookingService = require("../booking/booking.service");
        if (user.status) {
          // was active → now deactivated
          await bookingService.releaseStaffFromUpcoming(userId, authUser.organizationId, "staff deactivated");
        } else {
          // was inactive → now active (freed up)
          await bookingService.notifyUnderstaffedBookings(authUser.organizationId);
        }
      } catch (err) {
        console.error("[user] toggle reactivity failed:", err.message);
      }
    }

    return updated;
  },

  getActiveUsers: async (organizationId) => {
    return await prisma.user.findMany({
      where: {
        status: true,
        isDeleted: false,
        organizationId,
      },
      select: USER_SAFE_SELECT,
    });
  },

  /**
   * Step 1 of the avatar upload — a presigned PUT so the browser sends the file
   * straight to B2. Any authenticated user may set their OWN picture.
   */
  createAvatarUploadUrl: async (authUser, { fileName, mimeType, size }) => {
    if (!storage.isConfigured()) throw new Error("File storage is not configured");
    if (!fileName) throw new Error("fileName is required");
    if (!mimeType || !storage.AVATAR_MIME.includes(mimeType)) {
      throw new Error("Picture must be a PNG, JPEG or WebP image");
    }
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("Invalid file size");
    if (bytes > storage.AVATAR_MAX_BYTES) {
      throw new Error(`Picture is too large (max ${storage.AVATAR_MAX_BYTES / (1024 * 1024)} MB)`);
    }
    return storage.getUploadUrl({ fileName, mimeType });
  },

  /**
   * Step 2 — persist the avatar. `image` is the B2 object key returned by the
   * upload-url step, or null to remove the picture.
   *
   * Avatars used to be inline base64 data-URLs on the User row, which bloated
   * every user-list query. They now live in B2 and the row only holds the key;
   * a legacy data-URL is still accepted so old clients don't break.
   *
   * The previous B2 object is deleted on replace/remove so the bucket doesn't
   * accumulate orphans (best-effort — never fails the update).
   */
  updateProfileImage: async (authUser, image) => {
    const isDataUrl = typeof image === "string" && image.startsWith("data:");

    if (image !== null && !isDataUrl) {
      if (typeof image !== "string" || !storage.isValidKey(image)) {
        throw new Error("Invalid image reference");
      }
    }
    if (isDataUrl) {
      // Legacy path — keep the old guards.
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(image)) {
        throw new Error("image must be a PNG/JPEG/WebP data URL");
      }
      if (image.length > 400_000) {
        throw new Error("Image too large — please use a smaller picture");
      }
    }

    const before = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { profileImage: true },
    });

    const user = await prisma.user.update({
      where: { id: authUser.id },
      data: { profileImage: image, updatedAt: BigInt(Date.now()) },
      select: USER_SAFE_SELECT,
    });

    // Drop the replaced object from B2 (skip legacy data-URLs — nothing stored).
    const old = before?.profileImage;
    if (old && !String(old).startsWith("data:") && old !== image) {
      await storage.deleteFile(old);
    }

    return withAvatarUrl(user);
  },

  /**
   * Turn live location sharing on or off for yourself.
   *
   * Self-service only — a manager cannot switch this on for a staff member,
   * because consent someone else granted on your behalf is not consent. Turning
   * it OFF also wipes any position currently being shared, so the toggle takes
   * effect immediately rather than at the end of the running task.
   */
  setLocationConsent: async (authUser, consent) => {
    const value = consent === true || consent === "true";

    const user = await prisma.user.update({
      where: { id: authUser.id },
      data: { consentLocationSharing: value, updatedAt: BigInt(Date.now()) },
      select: USER_SAFE_SELECT,
    });

    if (!value) {
      await prisma.bookingStaffAssignment
        .updateMany({
          where: { userId: authUser.id, organizationId: authUser.organizationId },
          data: { lastLat: null, lastLng: null, lastLocationAt: null },
        })
        .catch((err) =>
          console.error("[user] clearing shared location failed:", err.message)
        );
    }

    return withAvatarUrl(user);
  },
};

module.exports = userService;
