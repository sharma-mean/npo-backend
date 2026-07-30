const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./analytics.controller");

const managers = auth(["NPO_ADMIN", "COORDINATOR"]);

router.get("/kpi", managers, controller.kpi);

module.exports = router;
