const prisma = require("../../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const notificationService = require("../notification/notification.service");
const { seedOrgStarterData } = require("./orgStarter");
const { validateRegistration } = require("./registration.logic");

const DAY_MS = 24 * 60 * 60 * 1000;

const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

// Auto-generate a unique org code from the name
const genCode = async (name) => {
  const base = (name || "ORG")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4)
    .padEnd(3, "X");
  for (let i = 0; i < 10; i++) {
    const code = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const exists = await prisma.organization.findUnique({ where: { code } });
    if (!exists) return code;
  }
  return `${base}${Date.now().toString().slice(-6)}`;
};

const registrationService = {
  register: async (data) => {
    // Single email is used for both the organization and its admin account.
    const { email } = validateRegistration(data);

    // Uniqueness checks (same email across both tables)
    const [orgExists, userExists] = await Promise.all([
      prisma.organization.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { email } }),
    ]);
    if (orgExists || userExists) throw new Error("An account with this email already exists");

    const now = BigInt(Date.now());
    const code = await genCode(data.orgName);
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const rawToken = crypto.randomBytes(32).toString("hex");

    const org = await prisma.organization.create({
      data: {
        name: data.orgName,
        code,
        email,
        phone: data.phone,
        address: data.address || "",
        city: data.city || "",
        state: data.state || "",
        country: data.country || "",
        postalCode: data.postalCode || "",
        status: "PENDING",
        createdAt: now,
        updatedAt: now,
      },
    });

    const admin = await prisma.user.create({
      data: {
        fullName: data.adminName,
        email,
        password: hashedPassword,
        role: "NPO_ADMIN",
        phone: data.phone,
        organizationId: org.id,
        status: true,
        emailVerifiedAt: null,
        verifyToken: hashToken(rawToken),
        verifyTokenExpiry: now + BigInt(DAY_MS), // 24h
        createdAt: now,
        updatedAt: now,
      },
    });

    const baseUrl =
      process.env.FRONTEND_URL ||
      (process.env.ALLOWED_ORIGINS || "").split(",")[0].trim() ||
      "";
    const verifyUrl = `${baseUrl}/verify-email?token=${rawToken}`;

    // Email is best-effort (org has no in-app notifications yet → send directly)
    try {
      await notificationService.sendEmail({
        to: admin.email,
        subject: "Verify your email to activate your account",
        data: {
          name: admin.fullName,
          title: "Welcome to SHINY - SOMS",
          eyebrow: "Confirm your account",
          message: `Your organization "${org.name}" is almost ready. Verify your email to activate your account, then choose a plan to get started.`,
          details: [
            ["Organization", org.name],
            ["Administrator", admin.fullName],
            ["Email", admin.email],
            ["Link expires", "24 hours from now"],
          ],
          actionUrl: verifyUrl,
          actionText: "Verify Email",
          year: new Date().getFullYear(),
        },
      });
    } catch (err) {
      console.error("[register] verify email failed:", err.message);
    }

    return { organizationId: org.id, email: admin.email };
  },

  verifyEmail: async (rawToken) => {
    if (!rawToken) throw new Error("Verification token is required");
    const tokenHash = hashToken(rawToken);
    const user = await prisma.user.findFirst({ where: { verifyToken: tokenHash } });
    if (!user || !user.verifyTokenExpiry || user.verifyTokenExpiry < BigInt(Date.now())) {
      throw new Error("Verification link is invalid or has expired");
    }
    if (user.emailVerifiedAt) return { alreadyVerified: true };

    const now = BigInt(Date.now());

    // No trial: verify email + activate org. The admin must subscribe (pay)
    // before the team can operate — there is no active subscription yet.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: now, status: true, verifyToken: null, verifyTokenExpiry: null, updatedAt: now },
      }),
      prisma.organization.update({
        where: { id: user.organizationId },
        data: { status: "ACTIVE", updatedAt: now },
      }),
    ]);

    // Seed starter example data so the admin doesn't face empty screens.
    // Best-effort — never block verification on this.
    try {
      await seedOrgStarterData(user.organizationId, user.id);
    } catch (err) {
      console.error("[verifyEmail] starter data seed failed:", err.message);
    }

    return { verified: true };
  },

  resendVerification: async (rawEmail) => {
    const email = (rawEmail || "").trim().toLowerCase();
    if (!email) return; // silent
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) return; // silent
    const now = BigInt(Date.now());
    const rawToken = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: { verifyToken: hashToken(rawToken), verifyTokenExpiry: now + BigInt(DAY_MS), updatedAt: now },
    });
    const baseUrl = process.env.FRONTEND_URL || "";
    try {
      await notificationService.sendEmail({
        to: user.email,
        subject: "Verify your email",
        data: {
          name: user.fullName,
          title: "Verify your email",
          eyebrow: "Confirm your account",
          message: "Use the button below to verify your email address and activate your account.",
          details: [
            ["Email", user.email],
            ["Link expires", "24 hours from now"],
          ],
          actionUrl: `${baseUrl}/verify-email?token=${rawToken}`,
          actionText: "Verify Email",
          year: new Date().getFullYear(),
        },
      });
    } catch (err) {
      console.error("[resend] failed:", err.message);
    }
  },
};

module.exports = registrationService;
