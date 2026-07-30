const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const dispatchService = require("./dispatch.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

// Dispatch board is a manager view (roster/resource allocation).
router.get("/board", auth(["NPO_ADMIN", "COORDINATOR"]), async (req, res) => {
  try {
    const data = await dispatchService.getBoard(req.user.organizationId, req.query.date);
    res.json({ status: true, data: serializeBigInt(data) });
  } catch (error) {
    res.status(400).json({ status: false, message: error.message });
  }
});

module.exports = router;
