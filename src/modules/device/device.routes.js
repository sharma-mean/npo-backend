const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./device.controller");

// Any authenticated role may register the device it is signed in on — the token
// is always bound to req.user, never to a user id from the body.
router.post("/register", auth(), controller.register);
router.delete("/", auth(), controller.unregister);

module.exports = router;
