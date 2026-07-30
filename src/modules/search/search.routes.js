const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./search.controller");

// Any authenticated org member; service scopes results per role.
router.get("/", auth(), controller.search);

module.exports = router;
