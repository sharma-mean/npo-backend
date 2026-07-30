const express = require("express");


const app = express();

const subscriptionPlansRoutes = require("./modules/subscriptionPlan/subscriptionPlan.routes");
const organizationRoutes = require("./modules/organization/organization.routes");
const organizationSubscriptionRoutes = require("./modules/organizationSubscription/organizationSubscription.routes");
const userRoutes = require("./modules/user/user.routes");
const guardianRoutes = require("./modules/guardian/guardian.routes");
const participantRoutes = require("./modules/participant/participant.routes");
const staffRoutes = require("./modules/staffRole/staffRole.routes");
const vehiclRoutes = require("./modules/vehicle/vehicle.routes");
const venueRoutes = require("./modules/venue/venue.routes");
const bookingRoutes = require("./modules/booking/booking.routes");
const bookingStaffAssignmentRoutes = require("./modules/bookingStaffAssignment/bookingStaffAssignment.routes");
const attendanceRoutes = require("./modules/staffAttendance/staffAttendance.routes");
const notificationRoutes = require("./modules/notification/notification.routes");
const serviceRoutes = require("./modules/service/ServiceRoutes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const staffModuleRoutes = require("./modules/staff/staff.routes");
const serviceSlotRoutes = require("./modules/serviceSlot/serviceSlot.routes");
const incidentRoutes = require("./modules/incident/incident.routes");
const dailyReportRoutes = require("./modules/dailyReport/dailyReport.routes");
const accountDeletionRoutes = require("./modules/accountDeletion/accountDeletion.routes");
const staffAvailabilityRoutes = require("./modules/staffAvailability/staffAvailability.routes");
const auditLogRoutes = require("./modules/auditLog/auditLog.routes");
const reportRoutes = require("./modules/report/report.routes");
const vehicleOperationRoutes = require("./modules/vehicleOperation/vehicleOperation.routes");
const dispatchRoutes = require("./modules/dispatch/dispatch.routes");
const devRoutes = require("./modules/dev/dev.routes");
const registrationRoutes = require("./modules/registration/registration.routes");
const searchRoutes = require("./modules/search/search.routes");
const analyticsRoutes = require("./modules/analytics/analytics.routes");
const cronRoutes = require("./modules/cron/cron.routes");
const documentRoutes = require("./modules/document/document.routes");
const deviceRoutes = require("./modules/device/device.routes");
const ongoingBookingRoutes = require("./modules/ongoingBooking/ongoingBooking.routes");
const paymentRoutes = require("./modules/payment/payment.routes");
const paymentController = require("./modules/payment/payment.controller");
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// Stripe webhook — MUST come before express.json(): signature verification runs
// against the exact bytes Stripe signed, and a parsed body would break it.
//
// Several spellings are accepted because the endpoint URL is configured by hand
// in the Stripe dashboard, and a typo there fails silently (Stripe just logs
// 404s and the subscription never activates). Cheaper to accept the obvious
// variants than to debug it again.
app.post(
  ["/api/webhooks/stripe", "/api/stripe/webhook", "/stripe/webhook", "/webhooks/stripe"],
  express.raw({ type: "application/json" }),
  paymentController.webhook,
);

app.use(express.json());

// Any response carrying a `profileImage` (a private B2 key) gets a signed
// `profileImageUrl` attached, so avatars render wherever a user appears —
// lists, booking relations, search results — without every controller
// remembering to map it.
app.use(require("./middleware/avatarUrls"));
app.use("/api/subscription-plans", subscriptionPlansRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/organization-subscriptions", organizationSubscriptionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/guardians", guardianRoutes);
app.use("/api/participants", participantRoutes);
app.use("/api/staff-role", staffRoutes);
app.use("/api/vehicles", vehiclRoutes);
app.use("/api/venues", venueRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/booking-staff-assignments", bookingStaffAssignmentRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/staff", staffModuleRoutes);
app.use("/api/service-slots", serviceSlotRoutes);
app.use("/api/incidents", incidentRoutes);
app.use("/api/daily-reports", dailyReportRoutes);
app.use("/api/account-deletion", accountDeletionRoutes);
app.use("/api/staff-availability", staffAvailabilityRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/vehicle-operations", vehicleOperationRoutes);
app.use("/api/dispatch", dispatchRoutes);
app.use("/api/dev", devRoutes);
app.use("/api/register", registrationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/ongoing-bookings", ongoingBookingRoutes);
app.use("/api/payments", paymentRoutes);

app.get("/", (req, res) => {
  res.send("NPO SaaS backend Running!");
});

// Liveness + DB readiness probe for monitoring / uptime checks
app.get("/health", async (req, res) => {
  try {
    const prisma = require("./config/db");
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", db: "up" });
  } catch (err) {
    res.status(503).json({ status: "degraded", db: "down" });
  }
});

module.exports = app;
  