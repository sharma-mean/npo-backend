const express = require("express");
const router = express.Router();

const controller = require("./serviceSlot.controller");
const auth = require("../../config/auth.middleware");

const MANAGER = ["NPO_ADMIN", "COORDINATOR"];

router.post("/", auth(MANAGER), controller.createSlot);

router.post("/recurring", auth(MANAGER), controller.generateRecurringSlots);

router.get("/", auth(), controller.getAllSlots);

router.get("/:id", auth(), controller.getSlotById);

router.put("/:id", auth(MANAGER), controller.updateSlot);

router.delete("/:id", auth(MANAGER), controller.deleteSlot);

module.exports = router;
