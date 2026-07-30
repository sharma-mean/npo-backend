const express = require("express");
const router = express.Router();

const controller = require("./auditLog.controller");
const auth = require("../../config/auth.middleware");

router.get("/", auth(), controller.getAuditLogs);

module.exports = router;
