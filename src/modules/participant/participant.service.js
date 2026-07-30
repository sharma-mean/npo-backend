const prisma = require("../../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const normalizeEmail = require("../../utils/normalizeEmail");
const { sendAccountSetupEmail, sendCredentialsEmail } = require("../../utils/accountSetup");
const userValidation = require("../user/user.validation");
const subscriptionService = require("../organizationSubscription/organizationSubscription.service");
const autoUpgradeService = require("../organizationSubscription/autoUpgrade.service");

const GENDER = ["MALE", "FEMALE", "OTHER"];
const PARTICIPANT_STATUS = ["ACTIVE", "INACTIVE", "WAITLISTED", "BLOCKED"];

const PARTICIPANT_SAFE_SELECT = {
  id: true,
  fullName: true,
  profileImage: true,
  nameKana: true,
  email: true,
  userCode: true,
  phone: true,
  role: true,
  serviceType: true,
  status: true,
  organizationId: true,
  gender: true,
  dateOfBirth: true,
  address: true,
  medicalNotes: true,
  allergyNotes: true,
  emergencyInstructions: true,
  mobilitySupport: true,
  needsWheelchair: true,
  guardianUserId: true,
  participantStatus: true,
  createdAt: true,
  updatedAt: true,
};

const GUARDIAN_SAFE_SELECT = {
  id: true,
  fullName: true,
  profileImage: true,
  nameKana: true,
  email: true,
  phone: true,
  alternatePhone: true,
  role: true,
  relationshipType: true,
  status: true,
  organizationId: true,
  address: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  emergencyContactPhone: true,
  createdAt: true,
  updatedAt: true,
};

const parseDob = (dob) => {
  if (dob === undefined || dob === null || dob === "") return undefined;
  if (typeof dob === "bigint") return dob;
  if (typeof dob === "number" && Number.isInteger(dob)) return BigInt(dob);
  if (typeof dob === "string" && /^\d+$/.test(dob.trim()))
    return BigInt(dob.trim());
  const ms = new Date(dob).getTime();
  if (Number.isNaN(ms)) throw new Error("Invalid date of birth");
  return BigInt(ms);
};

const participantService = {
  createParticipant: async (data, authUser) => {
    let { guardianId, guardian, participant } = data;

    // A guardian always creates participants under their own account
    if (authUser.role === "GUARDIAN") {
      guardianId = authUser.id;
      guardian = undefined;
    }

    if (!guardianId && !guardian) throw new Error("Guardian is required");

    // Participant validation
    if (!participant?.firstName)
      throw new Error("participant.firstName is required");
    if (!participant?.lastName)
      throw new Error("participant.lastName is required");
    if (!participant?.dob) throw new Error("participant.dob is required");
    if (!participant?.gender) throw new Error("participant.gender is required");
    if (!GENDER.includes(participant.gender))
      throw new Error("Invalid gender. Must be MALE, FEMALE or OTHER");

    // Participant-based plans auto-UPGRADE on over-cap (UC35, never block) — so we
    // do NOT hard-block at the cap here. The only block is when a previous upgrade
    // was reverted for non-payment ("restrict excess participant activity").
    if (await autoUpgradeService.isParticipantAddRestricted(authUser.organizationId)) {
      throw new Error(
        "Your plan's participant limit is reached and a pending upgrade payment is unpaid. Please complete the payment before adding more participants.",
      );
    }

    const now = BigInt(Date.now());
    let guardianUser;

    if (guardianId) {
      // Use existing guardian
      guardianUser = await prisma.user.findFirst({
        where: {
          id: guardianId,
          role: "GUARDIAN",
          isDeleted: false,
          organizationId: authUser.organizationId,
        },
        select: GUARDIAN_SAFE_SELECT,
      });
      if (!guardianUser) throw new Error("Guardian not found");
    } else {
      // Create new guardian
      if (!guardian.fullName) throw new Error("guardian.fullName is required");
      if (!guardian.email) throw new Error("guardian.email is required");
      if (!guardian.phone) throw new Error("guardian.phone is required");
      if (!guardian.relationshipType)
        throw new Error("guardian.relationshipType is required");

      const guardianEmail = normalizeEmail(guardian.email);
      const existingGuardian = await prisma.user.findUnique({
        where: { email: guardianEmail },
      });
      if (existingGuardian) throw new Error("Guardian email already exists");

      // Admin-chosen password from the create form; bulk import omits it and
      // falls back to a random placeholder + set-password link.
      const guardianPlainPassword = guardian.password || null;
      if (guardianPlainPassword) userValidation.validatePassword(guardianPlainPassword);
      const guardianPassword = await bcrypt.hash(
        guardianPlainPassword || crypto.randomBytes(24).toString("hex"),
        10,
      );
      guardianUser = await prisma.user.create({
        data: {
          fullName: guardian.fullName,
          nameKana: guardian.nameKana || null,
          email: guardianEmail,
          password: guardianPassword,
          phone: guardian.phone,
          alternatePhone: guardian.alternatePhone || null,
          role: "GUARDIAN",
          relationshipType: guardian.relationshipType,
          address: guardian.address || null,
          city: guardian.city || null,
          state: guardian.state || null,
          country: guardian.country || null,
          postalCode: guardian.postalCode || null,
          organizationId: authUser.organizationId,
          createdBy: authUser.id,
          status: true,
          emailVerifiedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        select: GUARDIAN_SAFE_SELECT,
      });

      // New guardian account → credentials email (form) or set-password link (import).
      if (guardianPlainPassword) {
        await sendCredentialsEmail(guardianUser, guardianPlainPassword);
      } else {
        await sendAccountSetupEmail(guardianUser);
      }
    }

    const dateOfBirth = parseDob(participant.dob);
    if (dateOfBirth === undefined)
      throw new Error("participant.dob is required");

    // Participants have real logins (read-only portal) — email is required in
    // the create forms. Bulk import may pass a generated @npo.local placeholder
    // (admin sets the real email later via edit, which sends the login link).
    if (!participant.email) throw new Error("participant.email is required");
    const participantEmail = normalizeEmail(participant.email);
    const existingParticipant = await prisma.user.findUnique({
      where: { email: participantEmail },
    });
    if (existingParticipant) throw new Error("Participant email already exists");
    const isRealEmail = !participantEmail.endsWith("@npo.local");

    const participantFullName = `${participant.firstName} ${participant.lastName}`;
    // Admin-chosen password from the create form (real-email participants);
    // bulk import / placeholder emails fall back to a random placeholder.
    const participantPlainPassword = isRealEmail ? participant.password || null : null;
    if (participantPlainPassword) userValidation.validatePassword(participantPlainPassword);
    const participantPassword = await bcrypt.hash(
      participantPlainPassword || crypto.randomBytes(24).toString("hex"),
      10,
    );

    // Report code: participants get P001-style per-org codes (atomic counter).
    const orgSeq = await prisma.organization.update({
      where: { id: authUser.organizationId },
      data: { participantSeq: { increment: 1 } },
      select: { participantSeq: true },
    });

    const participantUser = await prisma.user.create({
      data: {
        fullName: participantFullName,
        nameKana: participant.nameKana || null,
        email: participantEmail,
        password: participantPassword,
        userCode: `P${String(orgSeq.participantSeq).padStart(3, "0")}`,
        role: "PARTICIPANT",
        dateOfBirth,
        gender: participant.gender,
        medicalNotes: participant.medicalNotes || null,
        allergyNotes: participant.allergyNotes || null,
        mobilitySupport: participant.mobilitySupport || false,
        needsWheelchair: participant.needsWheelchair || false,
        address: participant.address || null,
        emergencyInstructions: participant.emergencyInstructions || null,
        participantStatus: "ACTIVE",
        guardianUserId: guardianUser.id,
        organizationId: authUser.organizationId,
        createdBy: authUser.id,
        status: true,
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      select: PARTICIPANT_SAFE_SELECT,
    });

    // Participant login onboarding: credentials email (form) or set-password
    // link (import) — best-effort; skipped for placeholder emails.
    if (isRealEmail) {
      if (participantPlainPassword) {
        await sendCredentialsEmail(
          { ...participantUser, organizationId: authUser.organizationId },
          participantPlainPassword,
        );
      } else {
        await sendAccountSetupEmail({ ...participantUser, organizationId: authUser.organizationId });
      }
    }

    // Automatic participant-based plan upgrade (UC 35–37) — never blocks the add.
    autoUpgradeService
      .evaluateOnParticipantChange(authUser.organizationId, authUser.id)
      .catch((e) => console.error("[participant] auto-upgrade check failed:", e.message));

    return { guardian: guardianUser, participant: participantUser };
  },

  /**
   * Re-send the set-password (login) link to a participant. Allowed for
   * managers (org-scoped) and the participant's own guardian — can be used
   * any number of times; each send issues a fresh 24h token.
   */
  sendLoginLink: async (id, authUser) => {
    const where = {
      id,
      role: "PARTICIPANT",
      isDeleted: false,
      organizationId: authUser.organizationId,
    };
    if (authUser.role === "GUARDIAN") where.guardianUserId = authUser.id;

    const participant = await prisma.user.findFirst({
      where,
      select: { id: true, fullName: true, email: true, organizationId: true },
    });
    if (!participant) throw new Error("Participant not found");
    if (!participant.email || participant.email.endsWith("@npo.local")) {
      throw new Error(
        "This participant has no login email yet. Edit the participant and set their email first.",
      );
    }

    await sendAccountSetupEmail(participant);
    return { sent: true, email: participant.email };
  },

  // Bulk import participants from parsed CSV rows. dryRun → validate only,
  // returns per-row {valid, errors} preview without writing. Org-scoped.
  importParticipants: async (authUser, rows, { dryRun = false } = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("No rows to import");
    }
    if (rows.length > 500) {
      throw new Error("Too many rows (max 500 per import)");
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Validate every row first (pure, no writes).
    const validated = rows.map((raw, idx) => {
      const errors = [];
      const r = {
        firstName: (raw.firstName || "").trim(),
        lastName: (raw.lastName || "").trim(),
        email: normalizeEmail(raw.email || ""),
        dob: (raw.dob || "").trim(),
        gender: (raw.gender || "").trim().toUpperCase(),
        guardianName: (raw.guardianName || "").trim(),
        guardianEmail: normalizeEmail(raw.guardianEmail || ""),
        guardianPhone: (raw.guardianPhone || "").trim(),
        relationshipType: (raw.relationshipType || "Parent").trim(),
        medicalNotes: (raw.medicalNotes || "").trim(),
        address: (raw.address || "").trim(),
      };

      // Participant login email: optional in bulk import (placeholder is
      // generated when missing; admin can set it later to enable login).
      if (r.email && !emailRe.test(r.email)) errors.push("email invalid");
      if (!r.firstName) errors.push("firstName required");
      if (!r.lastName) errors.push("lastName required");
      if (!r.gender) errors.push("gender required");
      else if (!GENDER.includes(r.gender)) errors.push("gender must be MALE/FEMALE/OTHER");
      if (!r.dob) errors.push("dob required");
      else {
        try { parseDob(r.dob); } catch { errors.push("dob invalid date"); }
      }
      if (!r.guardianName) errors.push("guardianName required");
      if (!r.guardianEmail) errors.push("guardianEmail required");
      else if (!emailRe.test(r.guardianEmail)) errors.push("guardianEmail invalid");
      if (!r.guardianPhone) errors.push("guardianPhone required");

      // NB: a repeated guardianEmail is NOT an error — siblings share one
      // guardian. The commit resolves/reuses an existing guardian by email.

      return { row: idx + 1, data: r, valid: errors.length === 0, errors };
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

    // Commit: create each valid row. Per-row try/catch — partial success ok.
    // Resolve guardians by email so multiple participants (siblings) attach to
    // ONE guardian instead of the 2nd row failing on "email already exists".
    let created = 0;
    const failed = [];
    const guardianByEmail = new Map(); // email → guardian id (this batch)
    for (const v of validated) {
      if (!v.valid) {
        failed.push({ row: v.row, errors: v.errors });
        continue;
      }
      try {
        // Prefer an already-known guardian (created earlier this batch, or an
        // existing org guardian with that email); else create a new one.
        let guardianId = guardianByEmail.get(v.data.guardianEmail);
        if (!guardianId) {
          const existing = await prisma.user.findFirst({
            where: {
              email: v.data.guardianEmail,
              role: "GUARDIAN",
              isDeleted: false,
              organizationId: authUser.organizationId,
            },
            select: { id: true },
          });
          if (existing) {
            guardianId = existing.id;
            guardianByEmail.set(v.data.guardianEmail, guardianId);
          }
        }

        const participant = {
          firstName: v.data.firstName,
          lastName: v.data.lastName,
          email:
            v.data.email ||
            `participant.${Date.now()}.${v.row}@npo.local`,
          dob: v.data.dob,
          gender: v.data.gender,
          medicalNotes: v.data.medicalNotes || undefined,
          address: v.data.address || undefined,
        };

        const result = await participantService.createParticipant(
          guardianId
            ? { guardianId, participant }
            : {
                guardian: {
                  fullName: v.data.guardianName,
                  email: v.data.guardianEmail,
                  phone: v.data.guardianPhone,
                  relationshipType: v.data.relationshipType,
                },
                participant,
              },
          authUser,
        );
        // Remember a freshly-created guardian for the next sibling row.
        if (!guardianId && result?.guardian?.id) {
          guardianByEmail.set(v.data.guardianEmail, result.guardian.id);
        }
        created += 1;
      } catch (err) {
        failed.push({ row: v.row, errors: [err.message] });
      }
    }

    return {
      dryRun: false,
      total: validated.length,
      created,
      failed: failed.length,
      failures: failed,
    };
  },

  getParticipants: async (authUser) => {
    const where = {
      role: "PARTICIPANT",
      isDeleted: false,
      organizationId: authUser.organizationId,
    };

    // A guardian may only see their own participants
    if (authUser.role === "GUARDIAN") {
      where.guardianUserId = authUser.id;
    }
    // A participant login may only ever see itself (read-only portal —
    // never other participants' medical/personal data).
    if (authUser.role === "PARTICIPANT") {
      where.id = authUser.id;
    }

    return await prisma.user.findMany({
      where,
      select: {
        ...PARTICIPANT_SAFE_SELECT,
        guardianUser: { select: GUARDIAN_SAFE_SELECT },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  getParticipantById: async (id, authUser) => {
    const where = { id, role: "PARTICIPANT", isDeleted: false };

    if (authUser) {
      where.organizationId = authUser.organizationId;
      if (authUser.role === "GUARDIAN") {
        where.guardianUserId = authUser.id;
      }
      // Participant login: self only
      if (authUser.role === "PARTICIPANT") {
        where.id = authUser.id;
      }
    }

    const participant = await prisma.user.findFirst({
      where,
      select: {
        ...PARTICIPANT_SAFE_SELECT,
        guardianUser: { select: GUARDIAN_SAFE_SELECT },
      },
    });
    if (!participant) throw new Error("Participant not found");
    return participant;
  },

  updateParticipant: async (id, data, authUser) => {
    const where = {
      id,
      role: "PARTICIPANT",
      isDeleted: false,
      organizationId: authUser.organizationId,
    };

    // A guardian may only update their own participant
    if (authUser.role === "GUARDIAN") {
      where.guardianUserId = authUser.id;
    }

    const participant = await prisma.user.findFirst({ where });
    if (!participant) throw new Error("Participant not found");

    // Login email change (managers or owning guardian): normalize + uniqueness,
    // then send a fresh set-password link to the new address.
    let emailChanged = false;
    let newEmail;
    if (data.email !== undefined && data.email !== null && data.email !== "") {
      newEmail = normalizeEmail(data.email);
      if (newEmail !== participant.email) {
        const existing = await prisma.user.findUnique({ where: { email: newEmail } });
        if (existing && existing.id !== participant.id) {
          throw new Error("Email already exists");
        }
        emailChanged = true;
      }
    }

    if (data.gender && !GENDER.includes(data.gender))
      throw new Error("Invalid gender");

    if (
      data.participantStatus &&
      !PARTICIPANT_STATUS.includes(data.participantStatus)
    )
      throw new Error("Invalid participantStatus");

    const updated = await prisma.user.update({
      where: { id },
      data: {
        fullName: data.fullName || undefined,
        nameKana: data.nameKana !== undefined ? (data.nameKana || null) : undefined,
        address: data.address !== undefined ? data.address : undefined,
        gender: data.gender || undefined,
        serviceType: data.serviceType || undefined,
        medicalNotes:
          data.medicalNotes !== undefined ? data.medicalNotes : undefined,
        allergyNotes:
          data.allergyNotes !== undefined ? data.allergyNotes : undefined,
        mobilitySupport:
          data.mobilitySupport !== undefined ? data.mobilitySupport : undefined,
        needsWheelchair:
          data.needsWheelchair !== undefined ? data.needsWheelchair : undefined,
        emergencyInstructions:
          data.emergencyInstructions !== undefined
            ? data.emergencyInstructions
            : undefined,
        participantStatus: data.participantStatus || undefined,
        email: emailChanged ? newEmail : undefined,
        dateOfBirth: parseDob(data.dob),
        updatedAt: BigInt(Date.now()),
      },
      select: PARTICIPANT_SAFE_SELECT,
    });

    // New/changed login email → fresh set-password link (best-effort).
    if (emailChanged) {
      await sendAccountSetupEmail({
        id: updated.id,
        fullName: updated.fullName,
        email: newEmail,
        organizationId: authUser.organizationId,
      });
    }

    return updated;
  },

  deleteParticipant: async (id, authUser) => {
    const where = {
      id,
      role: "PARTICIPANT",
      isDeleted: false,
      organizationId: authUser.organizationId,
    };

    // A guardian may only remove their own participant
    if (authUser.role === "GUARDIAN") {
      where.guardianUserId = authUser.id;
    }

    const participant = await prisma.user.findFirst({ where });
    if (!participant) throw new Error("Participant not found");

    // Invariant: every guardian must keep at least one participant. Block
    // removing a guardian's last participant — the guardian should be removed
    // instead (which cascades to their participants).
    if (participant.guardianUserId) {
      const siblingCount = await prisma.user.count({
        where: {
          guardianUserId: participant.guardianUserId,
          role: "PARTICIPANT",
          isDeleted: false,
          organizationId: authUser.organizationId,
          id: { not: id },
        },
      });
      if (siblingCount === 0) {
        throw new Error(
          "Cannot remove the guardian's only participant. Add another participant to this guardian first, or remove the guardian instead.",
        );
      }
    }

    const deleted = await prisma.user.update({
      where: { id },
      data: {
        isDeleted: true,
        status: false,
        participantStatus: "INACTIVE",
        updatedAt: BigInt(Date.now()),
      },
    });

    // Cancel the participant's active future bookings so seats free up and no
    // orphaned bookings linger for a removed participant (best-effort).
    try {
      const bookingService = require("../booking/booking.service");
      await bookingService.cancelActiveBookingsFor(
        { participantId: id },
        authUser.organizationId,
        "Participant removed",
      );
    } catch (err) {
      console.error("[participant] cascade cancel failed:", err.message);
    }

    return deleted;
  },
};

module.exports = participantService;
