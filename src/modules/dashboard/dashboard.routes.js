const express = require("express");
const router = express.Router();

const dashboardController = require("./dashboard.controller");
const auth = require("../../config/auth.middleware");

// Org-wide operational stats are a manager view.
router.get(
  "/stats",
  auth(["NPO_ADMIN", "COORDINATOR"]),
  dashboardController.getStats,
);

// Live ops snapshot: staff deployment, vehicle utilization, readiness,
// real-time attendance (dashboard widgets).
router.get(
  "/ops",
  auth(["NPO_ADMIN", "COORDINATOR"]),
  dashboardController.getOps,
);

// Lightweight action counts for nav-tab badges (pollable).
router.get(
  "/nav-counts",
  auth(["NPO_ADMIN", "COORDINATOR"]),
  dashboardController.getNavCounts,
);

module.exports = router;
