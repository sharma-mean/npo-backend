const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./vehicleOperation.controller");

const MANAGER = ["NPO_ADMIN", "COORDINATOR"];

// Report is readable by any authenticated org member; writes are manager-gated.
router.get("/", auth(), controller.report);
router.post("/", auth(MANAGER), controller.upsert);
router.delete("/:id", auth(MANAGER), controller.remove);

module.exports = router;
