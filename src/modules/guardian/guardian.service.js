const prisma = require("../../config/db");
const bcrypt = require("bcryptjs");
const normalizeEmail = require("../../utils/normalizeEmail");
const { sendCredentialsEmail } = require("../../utils/accountSetup");
const userValidation = require("../user/user.validation");

const GUARDIAN_SAFE_SELECT = {
  id: true,
  fullName: true,
  profileImage: true,
  email: true,
  phone: true,
  alternatePhone: true,
  relationshipType: true,
  role: true,
  serviceType: true,
  status: true,
  organizationId: true,
  address: true,
  createdAt: true,
  updatedAt: true,
};

const guardianService = {
  createGuardian: async (data, authUser) => {
    if (!data.fullName) throw new Error("Full name is required");
    if (!data.email) throw new Error("Email is required");
    if (!data.phone) throw new Error("Phone is required");
    if (!data.relationshipType) throw new Error("Relationship type is required");
    userValidation.validatePassword(data.password);

    const email = normalizeEmail(data.email);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new Error("Email already exists");

    const now = BigInt(Date.now());
    const hashedPassword = await bcrypt.hash(data.password, 10);

    const guardian = await prisma.user.create({
      data: {
        fullName:         data.fullName,
        email:            email,
        password:         hashedPassword,
        phone:            data.phone,
        alternatePhone:   data.alternatePhone   || null,
        role:             "GUARDIAN",
        relationshipType: data.relationshipType,
        address:          data.address          || null,
        city:             data.city             || null,
        state:            data.state            || null,
        country:          data.country          || null,
        postalCode:       data.postalCode        || null,
        organizationId:   authUser.organizationId,
        createdBy:        authUser.id,
        status:           true,
        emailVerifiedAt:  now,
        createdAt:        now,
        updatedAt:        now,
      },
    });

    // Welcome email with the admin-chosen login credentials.
    await sendCredentialsEmail(guardian, data.password);
    return guardian;
  },

  getGuardians: async (authUser) => {
    return await prisma.user.findMany({
      where: {
        role: "GUARDIAN",
        isDeleted: false,
        organizationId: authUser.organizationId,
      },
      select: {
        ...GUARDIAN_SAFE_SELECT,
        participantsAsGuardian: {
          where: { role: "PARTICIPANT", isDeleted: false },
          select: {
            id: true,
            fullName: true,
            gender: true,
            dateOfBirth: true,
            serviceType: true,
            medicalNotes: true,
            allergyNotes: true,
            mobilitySupport: true,
            needsWheelchair: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  getGuardianById: async (id, organizationId) => {
    const guardian = await prisma.user.findFirst({
      where: { id, role: "GUARDIAN", isDeleted: false, organizationId },
      select: {
        ...GUARDIAN_SAFE_SELECT,
        participantsAsGuardian: {
          where: { role: "PARTICIPANT", isDeleted: false },
          select: {
            id: true,
            fullName: true,
            gender: true,
            dateOfBirth: true,
            serviceType: true,
            medicalNotes: true,
            allergyNotes: true,
            mobilitySupport: true,
            needsWheelchair: true,
            status: true,
          },
        },
      },
    });
    if (!guardian) throw new Error("Guardian not found");
    return guardian;
  },

  updateGuardian: async (id, data, organizationId) => {
    const guardian = await prisma.user.findFirst({
      where: { id, role: "GUARDIAN", isDeleted: false, organizationId },
    });
    if (!guardian) throw new Error("Guardian not found");

    // Email is the login identity — normalize + ensure it stays unique.
    let email;
    if (data.email !== undefined) {
      email = normalizeEmail(data.email);
      if (email && email !== guardian.email) {
        const clash = await prisma.user.findUnique({ where: { email } });
        if (clash) throw new Error("Email already exists");
      }
    }

    const updateData = { updatedAt: BigInt(Date.now()) };
    const fields = [
      "fullName", "phone", "alternatePhone", "relationshipType",
      "address", "city", "state", "country", "postalCode",
    ];
    for (const f of fields) if (data[f] !== undefined) updateData[f] = data[f];
    if (email) updateData.email = email;

    return await prisma.user.update({
      where: { id },
      data: updateData,
      select: GUARDIAN_SAFE_SELECT,
    });
  },

  deleteGuardian: async (id, organizationId) => {
    const guardian = await prisma.user.findFirst({
      where: { id, role: "GUARDIAN", isDeleted: false, organizationId },
    });
    if (!guardian) throw new Error("Guardian not found");

    // soft delete guardian + all their participants
    await prisma.user.updateMany({
      where: { guardianUserId: id, organizationId },
      data: { isDeleted: true, status: false, updatedAt: BigInt(Date.now()) },
    });

    const deleted = await prisma.user.update({
      where: { id },
      data: { isDeleted: true, status: false, updatedAt: BigInt(Date.now()) },
    });

    // Cancel every active future booking this guardian made (covers all their
    // participants) — frees seats, promotes waitlist, notifies. Best-effort.
    try {
      const bookingService = require("../booking/booking.service");
      await bookingService.cancelActiveBookingsFor(
        { guardianId: id },
        organizationId,
        "Guardian removed",
      );
    } catch (err) {
      console.error("[guardian] cascade cancel failed:", err.message);
    }

    return deleted;
  },
};

module.exports = guardianService;
