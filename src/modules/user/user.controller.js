const userService = require("./user.service");
const serializeBigInt = require("../../utils/bigIntSerializer");
const { parseCsv } = require("../../utils/csv");
const { generateAccessToken } = require("../../config/jwt");

const userController = {
  importUsers: async (req, res) => {
    try {
      let rows = req.body.rows;
      if (!rows && typeof req.body.csv === "string") {
        rows = parseCsv(req.body.csv);
      }
      const dryRun = req.body.dryRun === true || req.query.validate === "true";
      const result = await userService.importUsers(req.user, rows, { dryRun });
      return res.status(200).json({ status: true, data: serializeBigInt(result) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  createUser: async (req, res) => {
    try {
      const user = await userService.createUser(req.body, req.user);

      return res.status(201).json({
        status: true,
        message: "User created successfully",
        data: serializeBigInt(user),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  login: async (req, res) => {
    try {
      const data = await userService.login(req.body);

      res.status(200).json({
        status: true,
        data: serializeBigInt(data),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  getUsers: async (req, res) => {
    try {
      const users = await userService.getUsers(req.user.organizationId);

      res.json({
        status: true,
        data: serializeBigInt(users),
      });
    } catch (error) {
      res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },

  getUserById: async (req, res) => {
    try {
      const user = await userService.getUserById(req.params.id, req.user);

      res.json({
        status: true,
        data: serializeBigInt(user),
      });
    } catch (error) {
      const status = /not authorized/i.test(error.message) ? 403 : 500;
      res.status(status).json({
        status: false,
        message: error.message,
      });
    }
  },

  updateUser: async (req, res) => {
    try {
      const user = await userService.updateUser(
        req.params.id,
        req.body,
        req.user,
      );

      res.json({
        status: true,
        message: "Staff updated successfully",
        data: serializeBigInt(user),
      });
    } catch (error) {
      res.json({ status: false, message: error.message });
    }
  },

  deleteUser: async (req, res) => {
    try {
      await userService.deleteUser(req.params.id, req.user);

      res.json({
        status: true,
        message: "User deleted successfully",
      });
    } catch (error) {
      res.json({ status: false, message: error.message });
    }
  },

  updateUserPassword: async (req, res) => {
    try {
      const data = await userService.updateUserPassword(
        req.user.id,
        req.body.oldPassword,
        req.body.newPassword,
      );

      res.status(200).json({
        status: true,
        data: serializeBigInt(data),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  userResetPassword: async (req, res) => {
    try {
      const data = await userService.userResetPassword(
        req.params.id,
        req.body.newPassword,
        req.user,
      );

      res.status(200).json({
        status: true,
        data: serializeBigInt(data),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  forgotPassword: async (req, res) => {
    try {
      await userService.forgotPassword(req.body.email);
      // Always 200 — never reveal whether the email exists
      return res.status(200).json({
        status: true,
        message: "If an account exists for that email, a reset link has been sent.",
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  resetPassword: async (req, res) => {
    try {
      await userService.resetPasswordWithToken(
        req.body.token,
        req.body.newPassword,
      );
      return res.status(200).json({
        status: true,
        message: "Password reset successful. You can now log in.",
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  toggleUserStatus: async (req, res) => {
    try {
      const data = await userService.toggleUserStatus(req.params.id, req.user);

      res.status(200).json({
        status: true,
        data: serializeBigInt(data),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  // Presigned PUT so the browser uploads the picture straight to B2.
  avatarUploadUrl: async (req, res) => {
    try {
      const data = await userService.createAvatarUploadUrl(req.user, req.body);
      res.status(200).json({ status: true, data });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  setLocationConsent: async (req, res) => {
    try {
      const data = await userService.setLocationConsent(req.user, req.body?.consent);
      res.status(200).json({
        status: true,
        message: "Location sharing preference updated",
        data: serializeBigInt(data),
      });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  updateProfileImage: async (req, res) => {
    try {
      // `image` is now a B2 object key (or null to remove). A legacy base64
      // data-URL is still accepted by the service for backward compatibility.
      const image = req.body.image ?? null;
      const data = await userService.updateProfileImage(req.user, image);
      res.status(200).json({
        status: true,
        message: "Profile picture updated",
        data: serializeBigInt(data),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  getActiveUsers: async (req, res) => {
    try {
      const data = await userService.getActiveUsers(req.user.organizationId);
      res.status(200).json({
        status: true,
        data: serializeBigInt(data),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  // req.user is rebuilt from the DB by auth.middleware on every request, so a
  // suspended / deleted / role-changed user can never mint a fresh token here.
  refreshToken: async (req, res) => {
    try {
      const token = generateAccessToken({
        id: req.user.id,
        role: req.user.role,
        organizationId: req.user.organizationId,
      });

      return res.status(200).json({ status: true, data: { token } });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  logout: async (req, res) => {
    try {
      res.clearCookie("token");

      return res.status(200).json({
        status: true,
        message: "Logout successful",
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },
};

module.exports = userController;
