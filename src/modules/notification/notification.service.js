const path = require("path");

const nodemailer = require("nodemailer");

const prisma = require("../../config/db");
const { renderTemplate } = require("./notification.helper");
const { sendPushToUser } = require("../../utils/push");

const transporter = nodemailer.createTransport({
  service: "gmail",

  auth: {
    user: process.env.EMAIL_USER,

    pass: process.env.EMAIL_PASSWORD,
  },
});

// The brand logo ships as a CID attachment, not a hosted <img src>. A remote
// URL depends on FRONTEND_URL being publicly reachable from the recipient's
// mail client — it isn't in dev, and Gmail proxies (and by default blocks)
// remote images. The CID copy always renders. 128px PNG, ~27 KB.
const BRAND_NAME = "SHINY - SOMS";
const LOGO_CID = "shinysomslogo";
const LOGO_PATH = path.join(__dirname, "..", "..", "assets", "shiny-logo.png");

//SEND SINGLE EMAIL

const sendEmail = async ({ to, subject, data }) => {
  if (!to) {
    throw new Error("Receiver email is required");
  }

  // Never send real email from the test suite.
  if (process.env.NODE_ENV === "test") return;

  const html = await renderTemplate({
    templateName: "notification-template",

    data: { ...data, logoCid: LOGO_CID },
  });

  await transporter.sendMail({
    from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,

    to,

    subject,

    html,

    attachments: [
      {
        filename: "shiny-logo.png",
        path: LOGO_PATH,
        cid: LOGO_CID,
        contentDisposition: "inline",
      },
    ],
  });
};

const sendBulkEmails = async ({ emails, subject, data }) => {
  const validEmails = emails.filter(Boolean);

  await Promise.all(
    validEmails.map((email) =>
      sendEmail({
        to: email,

        subject,

        data,
      }),
    ),
  );
};

// ─────────────────────────────────────────────────────────────────────────
// In-app notifications
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// Email auto-enrichment
//
// Most notify() callers pass only { title, message } — which used to render a
// bare email with no recipient name, no booking details and no call-to-action.
// Rather than wiring emailData through ~20 call sites (and every future one),
// notify() enriches the email itself: given `userId` and `relatedBookingId` it
// resolves the recipient's name and the booking's participant / service / code
// / schedule, and derives a role-correct deep link. A caller that DOES pass
// emailData still wins — auto-fill only supplies what's missing.
// ─────────────────────────────────────────────────────────────────────────

const SERVICE_LABEL = {
  MOBILITY: "Mobility",
  RECREATION: "Recreation",
  DAYCARE: "Daycare",
};

// Booking lists are role-specific routes in the SPA — link each recipient to
// the page they're actually allowed to open.
const BOOKING_HOME = {
  GUARDIAN: "/my-bookings",
  STAFF: "/staff",
  NPO_ADMIN: "/booking-list",
  COORDINATOR: "/booking-list",
};

const EYEBROW = {
  BOOKING_CREATED: "New booking",
  BOOKING_APPROVED: "Booking approved",
  BOOKING_REJECTED: "Booking rejected",
  BOOKING_CANCELLED: "Booking cancelled",
  BOOKING_COMPLETED: "Booking completed",
  BOOKING_PROGRESS: "Booking update",
  BOOKING_PROMOTED: "Waitlist update",
  BOOKING_REMINDER: "Reminder",
  BOOKING_UPDATED: "Booking update",
  ASSIGNMENT_CREATED: "New assignment",
  INCIDENT_REPORTED: "Incident",
  INCIDENT_RESOLVED: "Incident resolved",
  COMPLIANCE: "Compliance",
  BILLING: "Billing",
};

// No per-org timezone exists in the schema; every tenant is a Japanese NPO.
const formatSchedule = (startTime, endTime) => {
  const opts = { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false };
  try {
    const start = new Date(Number(startTime));
    if (Number.isNaN(start.getTime())) return null;
    const day = start.toLocaleDateString("en-GB", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const from = start.toLocaleTimeString("en-GB", opts);
    const end = endTime != null ? new Date(Number(endTime)) : null;
    const to = end && !Number.isNaN(end.getTime()) ? end.toLocaleTimeString("en-GB", opts) : null;
    return `${day}, ${from}${to ? `–${to}` : ""} JST`;
  } catch {
    return null;
  }
};

/**
 * Resolve the recipient + booking context an email needs. Best-effort: any
 * lookup failure degrades to an email without that detail, never throws.
 */
const buildEmailContext = async ({ userId, relatedBookingId, type }) => {
  const ctx = { eyebrow: EYEBROW[type] || null };

  const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");

  try {
    const [user, booking] = await Promise.all([
      userId
        ? prisma.user.findUnique({
            where: { id: userId },
            select: { fullName: true, role: true },
          })
        : null,
      relatedBookingId
        ? prisma.booking.findUnique({
            where: { id: relatedBookingId },
            select: {
              bookingCode: true,
              serviceType: true,
              startTime: true,
              endTime: true,
              pickupAddress: true,
              participant: { select: { fullName: true } },
            },
          })
        : null,
    ]);

    if (user?.fullName) ctx.recipientName = user.fullName;

    if (booking) {
      if (booking.participant?.fullName) ctx.participantName = booking.participant.fullName;
      if (booking.serviceType) {
        ctx.serviceType = SERVICE_LABEL[booking.serviceType] || booking.serviceType;
      }
      if (booking.bookingCode) ctx.bookingCode = booking.bookingCode;
      if (booking.pickupAddress) ctx.pickupAddress = booking.pickupAddress;

      const schedule = formatSchedule(booking.startTime, booking.endTime);
      if (schedule) ctx.schedule = schedule;

      // Deep link only when we know both the site and where this role may go.
      const route = BOOKING_HOME[user?.role];
      if (frontendUrl && route) {
        ctx.actionUrl = `${frontendUrl}${route}`;
        ctx.actionText = "View booking";
      }
    } else if (frontendUrl && user?.role) {
      ctx.actionUrl = frontendUrl;
      ctx.actionText = "Open dashboard";
    }
  } catch (err) {
    console.error("[notify] email enrich failed:", err.message);
  }

  return ctx;
};

/**
 * Create one in-app notification, and optionally an email alongside it.
 * Best-effort: email failures are logged, never thrown.
 */
/**
 * Run best-effort notification work without letting it hold up the caller's
 * response.
 *
 * `notify()` sends email inline (no queue — a Vercel function can't run a
 * worker), and Gmail's SMTP regularly takes several seconds per message. A
 * booking fulfilment that notifies three staff members plus the guardian could
 * therefore spend 30s+ *after* the database transaction had already committed —
 * long enough for the browser to abort the request. The user saw
 * "net::ERR_ABORTED" and assumed the save had failed, when in fact it had
 * succeeded and only the emails were still going out.
 *
 * Notifications are best-effort by contract, so cap how long a request will
 * wait for them. Anything still in flight keeps running; we simply stop
 * blocking the response on it.
 */
const NOTIFY_BUDGET_MS = 8000;

const withNotifyBudget = async (work, budgetMs = NOTIFY_BUDGET_MS) => {
  let timer;
  try {
    await Promise.race([
      work,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[notify] still sending after ${budgetMs}ms — responding without waiting`);
          resolve();
        }, budgetMs);
      }),
    ]);
  } catch (err) {
    console.error("[notify] batch failed:", err.message);
  } finally {
    clearTimeout(timer);
  }
};

const notify = async ({
  userId,
  organizationId,
  title,
  message,
  type = "GENERAL",
  relatedBookingId = null,
  relatedParticipantId = null,
  email = null,
  emailSubject = null,
  emailData = null,
  recipientName = "",
}) => {
  const now = BigInt(Date.now());

  // In-app notification requires an organization (FK). Org-less users (e.g.
  // SUPER_ADMIN) skip the in-app row but still receive the email.
  // Best-effort: an insert failure (FK on a deleted user/booking, DB hiccup)
  // must never abort the caller's main operation — log and continue to email.
  let notification = null;
  if (organizationId) {
    try {
      notification = await prisma.notification.create({
        data: {
          userId,
          organizationId,
          title,
          message,
          type,
          relatedBookingId,
          relatedParticipantId,
          isRead: false,
          createdAt: now,
        },
      });
    } catch (err) {
      console.error("[notify] in-app create failed:", err.message);
    }
  }

  if (email) {
    // Auto-fill recipient name, booking details and the call-to-action so every
    // caller gets a complete email without wiring emailData itself. Explicit
    // caller values override the derived ones.
    const ctx = await buildEmailContext({ userId, relatedBookingId, type });
    const { recipientName: derivedName, ...derived } = ctx;

    // The EJS template tolerates missing fields, but always provide the core
    // ones so rendered output is consistent.
    const payload = {
      to: email,
      subject: emailSubject || title,
      data: {
        name: recipientName || derivedName,
        title,
        message,
        year: new Date().getFullYear(),
        ...derived,
        ...(emailData || {}),
      },
    };
    try {
      // Inline (hand-to-hand) send — no queue/Redis. Serverless-friendly
      // (Vercel): the request awaits delivery. Best-effort: a send failure is
      // logged, never thrown into the caller's main operation.
      await sendEmail(payload);
    } catch (err) {
      console.error("[notify] email failed:", err.message);
    }
  }

  // Mobile push — every user-facing event already flows through notify(), so
  // registering a device token is all the app has to do to receive alerts.
  // Best-effort, same contract as email: a failure never reaches the caller.
  // `data` lets the app deep-link the tap straight to the booking.
  try {
    await sendPushToUser(userId, {
      title,
      body: message,
      organizationId,
      data: {
        type,
        notificationId: notification?.id || null,
        bookingId: relatedBookingId,
      },
    });
  } catch (err) {
    console.error("[notify] push failed:", err.message);
  }

  return notification;
};

/** Notify several users with the same payload. */
const notifyMany = async (userIds, payload) => {
  return Promise.all(
    [...new Set(userIds.filter(Boolean))].map((userId) =>
      notify({ ...payload, userId }),
    ),
  );
};

const listForUser = async (userId, { unreadOnly = false } = {}) => {
  return prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { isRead: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
};

const unreadCount = async (userId) => {
  return prisma.notification.count({ where: { userId, isRead: false } });
};

const markRead = async (id, userId) => {
  const notification = await prisma.notification.findFirst({
    where: { id, userId },
  });
  if (!notification) throw new Error("Notification not found");

  return prisma.notification.update({
    where: { id },
    data: { isRead: true },
  });
};

const markAllRead = async (userId) => {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
};

module.exports = {
  withNotifyBudget,
  NOTIFY_BUDGET_MS,
  sendEmail,
  sendBulkEmails,
  notify,
  notifyMany,
  listForUser,
  unreadCount,
  markRead,
  markAllRead,
};
