const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const guardianController = require("./guardian.controller");

router.post("/", auth(["NPO_ADMIN", "COORDINATOR"]), guardianController.createGuardian);
router.get("/", auth(["NPO_ADMIN", "COORDINATOR"]), guardianController.getGuardians);
router.get("/:id", auth(["NPO_ADMIN", "COORDINATOR"]), guardianController.getGuardianById);
router.put("/:id", auth(["NPO_ADMIN", "COORDINATOR"]), guardianController.updateGuardian);
router.delete("/:id", auth(["NPO_ADMIN", "COORDINATOR"]), guardianController.deleteGuardian);

module.exports = router;
