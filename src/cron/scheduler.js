const cron = require("node-cron");
const subscriptionService = require("../modules/organizationSubscription/organizationSubscription.service");
const autoUpgradeService = require("../modules/organizationSubscription/autoUpgrade.service");
const bookingService = require("../modules/booking/booking.service");
const reportService = require("../modules/report/report.service");
const complianceService = require("../modules/document/compliance.service");





// In-process scheduler (node-cron, NO Redis/queue). Runs inside a long-running
// server process (`npm run dev`/`start` → server.js). On Vercel serverless the
// process is not always-on, so node-cron would never fire there — Vercel uses
// the `/api/cron/daily` HTTP endpoint (vercel.json crons) instead. Same service
// fns back both paths, so behavior is identical either way.
//
// Set DISABLE_CRON=true to skip starting it (e.g. when you run cron elsewhere).

const REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h so a daily run never misses

// Wrap each sweep so a failure is logged and never crashes the scheduler/server.
const safe = (name, fn) => async () => {
  try {
    const result = await fn();
    console.log(`[cron:${name}]`, JSON.stringify(result));
  } catch (err) {
    console.error(`[cron:${name}] failed:`, err.message);
  }
};

const startCronJobs = () => {
  if (process.env.DISABLE_CRON === "true") {
    console.log("[cron] DISABLE_CRON=true — in-process scheduler not started.");
    return;
  }

  // Daily 02:00 — expire/renew subscriptions + expiry emails.
  cron.schedule("0 2 * * *", safe("subscriptions", () => subscriptionService.runExpirySweep()));

  // Hourly — 24h-ahead booking reminders (reminderSentAt dedupes across runs).
  cron.schedule("0 * * * *", safe("reminders", () => bookingService.sendDueReminders()));

  // Weekly Monday 08:00 — booking digest emails to managers.
  cron.schedule("0 8 * * 1", safe("reports", () => reportService.sendWeeklyDigests()));

  // Every 3h — post-approval staffing monitor + missing check-in alerts.
  cron.schedule("0 */3 * * *", safe("staffing", () => bookingService.runStaffingMonitorSweep()));

  // Every 6h — revoke provisional plan upgrades whose 3-day konbini grace lapsed unpaid.
  cron.schedule("0 */6 * * *", safe("autoUpgradeGrace", () => autoUpgradeService.runAutoUpgradeGraceSweep()));

  console.log("[cron] in-process scheduler started (subscriptions/daily, reminders/hourly, staffing/3h, reports/weekly).");
};

// Single combined sweep — mirrors /api/cron/daily. Handy for a `npm run cron`
// one-shot on hosts where you'd rather trigger externally than keep node-cron
// resident. 48h reminder window + Monday-gated reports (safe to run daily).
const runDailySweep = async () => {
  const out = {};
  try { out.subscriptions = await subscriptionService.runExpirySweep(); }
  catch (e) { out.subscriptions = { error: e.message }; }
  try { out.reminders = await bookingService.sendDueReminders(REMINDER_WINDOW_MS); }
  catch (e) { out.reminders = { error: e.message }; }
  try {
    out.reports = new Date().getDay() === 1
      ? await reportService.sendWeeklyDigests()
      : { skipped: "not Monday" };
  } catch (e) { out.reports = { error: e.message }; }
  // Warn managers about driving licences / vehicle inspections (車検) that have
  // expired or lapse within 30 days — those block driver assignment / dispatch.
  try { out.compliance = await complianceService.runComplianceSweep(); }
  catch (e) { out.compliance = { error: e.message }; }
  // Post-approval staffing monitor + missing check-in alerts (SOW §11/§14).
  try { out.staffing = await bookingService.runStaffingMonitorSweep(); }
  catch (e) { out.staffing = { error: e.message }; }
  // Revoke unpaid provisional plan upgrades past their 3-day grace (UC 36).
  try { out.autoUpgradeGrace = await autoUpgradeService.runAutoUpgradeGraceSweep(); }
  catch (e) { out.autoUpgradeGrace = { error: e.message }; }
  return out;
};

module.exports = { startCronJobs, runDailySweep };
