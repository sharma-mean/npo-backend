const express = require("express");
const router = express.Router();

const subscriptionService = require("../organizationSubscription/organizationSubscription.service");
const bookingService = require("../booking/booking.service");
const reportService = require("../report/report.service");
const complianceService = require("../document/compliance.service");
const { runDailySweep } = require("../../cron/scheduler");

// HTTP-triggered scheduled sweeps for serverless deploys (Vercel Cron hits
// these instead of running a persistent BullMQ worker). Vercel Cron issues a
// GET with `Authorization: Bearer <CRON_SECRET>`; we also accept POST and an
// `x-cron-secret` header / `?secret=` for manual triggering. Guarded only when
// CRON_SECRET is set (open in dev; MUST be set in production).
const guard = (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return next();
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer || req.headers["x-cron-secret"] || req.query.secret;
  if (provided !== secret) {
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }
  next();
};

const run = (fn) => async (req, res) => {
  try {
    const result = await fn();
    return res.status(200).json({ status: true, data: result });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ── Combined daily sweep (Vercel Hobby: max 2 crons, daily-only) ────────────
// One endpoint does everything so a single daily Vercel Cron covers all
// scheduled work on the free plan: subscriptions (expire/renew) + reminders
// (48h window so a once-a-day run never misses a booking; reminderSentAt
// dedupes) + weekly digest (Monday-gated). Implemented once in the scheduler
// and reused here so both the in-process and HTTP paths behave identically.
router.route("/daily").get(guard, run(runDailySweep)).post(guard, run(runDailySweep));

// Individual endpoints kept for manual triggering / self-hosted schedulers.
router
  .route("/subscriptions")
  .get(guard, run(() => subscriptionService.runExpirySweep()))
  .post(guard, run(() => subscriptionService.runExpirySweep()));
router
  .route("/reminders")
  .get(guard, run(() => bookingService.sendDueReminders()))
  .post(guard, run(() => bookingService.sendDueReminders()));
router
  .route("/reports")
  .get(guard, run(() => reportService.sendWeeklyDigests()))
  .post(guard, run(() => reportService.sendWeeklyDigests()));
router
  .route("/compliance")
  .get(guard, run(() => complianceService.runComplianceSweep()))
  .post(guard, run(() => complianceService.runComplianceSweep()));

module.exports = router;
