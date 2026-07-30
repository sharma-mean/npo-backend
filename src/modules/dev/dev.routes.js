const express = require("express");
const router = express.Router();
const devController = require("./dev.controller");

// Runs the full test suite and returns the result as JSON.
// Disabled in production; optionally gated by TEST_RUN_TOKEN.
router.get("/run-tests", devController.runTests);

module.exports = router;
