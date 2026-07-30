const registrationService = require("./registration.service");

const registrationController = {
  register: async (req, res) => {
    try {
      const data = await registrationService.register(req.body);
      return res.status(201).json({
        status: true,
        message: "Registration successful. Check your email to verify your account.",
        data,
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  verifyEmail: async (req, res) => {
    try {
      const result = await registrationService.verifyEmail(req.body.token);
      return res.status(200).json({
        status: true,
        message: result.alreadyVerified
          ? "Email already verified. You can log in."
          : "Email verified. Log in and choose a plan to get started.",
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  resend: async (req, res) => {
    try {
      await registrationService.resendVerification(req.body.email);
      return res.status(200).json({
        status: true,
        message: "If that account needs verification, a new link has been sent.",
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = registrationController;
