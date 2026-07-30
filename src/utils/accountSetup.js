const crypto = require("crypto");
const prisma = require("../config/db");
const notificationService = require("../modules/notification/notification.service");

const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

// Enum values read as shouting in an email — humanize for the detail rows.
const ROLE_LABEL = {
  SUPER_ADMIN: "Super Admin",
  NPO_ADMIN: "Administrator",
  COORDINATOR: "Coordinator",
  STAFF: "Staff",
  GUARDIAN: "Guardian",
  PARTICIPANT: "Participant",
};

// Onboarding link TTL — longer than a normal password reset (1h) since a new
// user may not check email immediately.
const SETUP_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Send a "welcome — set your password" email to a newly created user.
 * Issues a tokenized link (reuses the resetToken infra → the existing
 * /reset-password page) so no plaintext password is ever emailed.
 * Best-effort: never throws into the caller (account creation must not fail
 * because email/Redis is down) — failures are logged.
 */
const sendAccountSetupEmail = async (user) => {
  if (!user?.email) return;
  try {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const expiry = BigInt(Date.now() + SETUP_TTL_MS);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: hashToken(rawToken),
        resetTokenExpiry: expiry,
        updatedAt: BigInt(Date.now()),
      },
    });

    const baseUrl =
      process.env.FRONTEND_URL ||
      (process.env.ALLOWED_ORIGINS || "").split(",")[0].trim() ||
      "";
    const setupUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    await notificationService.notify({
      userId: user.id,
      organizationId: user.organizationId,
      title: "Welcome — set up your account",
      message:
        "An account has been created for you. Use the button below to choose a password, then sign in.",
      type: "GENERAL",
      email: user.email,
      recipientName: user.fullName,
      emailSubject: "Set up your account",
      emailData: {
        eyebrow: "Account created",
        details: [
          ["Sign-in email", user.email],
          ...(user.role ? [["Role", ROLE_LABEL[user.role] || user.role]] : []),
          ["Link expires", "24 hours from now"],
        ],
        actionUrl: setupUrl,
        actionText: "Set Your Password",
      },
    });
  } catch (err) {
    console.error("[accountSetup] welcome email failed:", err.message);
  }
};

/**
 * Send a "welcome — here are your login credentials" email to a newly created
 * user whose password was chosen by the admin in the create form. Includes the
 * plaintext password (explicit product requirement) + a login link.
 * Best-effort: never throws into the caller — failures are logged.
 */
const sendCredentialsEmail = async (user, plainPassword) => {
  if (!user?.email || !plainPassword) return;
  try {
    const baseUrl =
      process.env.FRONTEND_URL ||
      (process.env.ALLOWED_ORIGINS || "").split(",")[0].trim() ||
      "";
    const loginUrl = `${baseUrl}/login`;

    await notificationService.notify({
      userId: user.id,
      // No organizationId → skips the in-app notification row so the
      // plaintext password is never persisted in the DB; email only.
      organizationId: null,
      title: "Welcome — your account is ready",
      // Newlines don't survive HTML — the credentials belong in detail rows,
      // not crammed into one run-on paragraph.
      message:
        "An account has been created for you. Sign in with the credentials below, and change your password after your first login.",
      type: "GENERAL",
      email: user.email,
      recipientName: user.fullName,
      emailSubject: "Your account credentials",
      emailData: {
        eyebrow: "Account created",
        details: [
          ["Email", user.email],
          ["Password", plainPassword],
          ...(user.role ? [["Role", ROLE_LABEL[user.role] || user.role]] : []),
        ],
        actionUrl: loginUrl,
        actionText: "Log In",
      },
    });
  } catch (err) {
    console.error("[accountSetup] credentials email failed:", err.message);
  }
};

module.exports = { sendAccountSetupEmail, sendCredentialsEmail };
