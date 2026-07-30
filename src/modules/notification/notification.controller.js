const notificationService = require("./notification.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

// SEND SINGLE EMAIL

const sendEmail = async (req, res) => {
  try {
    const { to, subject, data } = req.body;

    if (!to) {
      return res.status(400).json({
        status: false,

        message: "Receiver email is required",
      });
    }

    if (!subject) {
      return res.status(400).json({
        status: false,

        message: "Email subject is required",
      });
    }

    await notificationService.sendEmail({
      to,
      subject,
      data,
    });

    return res.status(200).json({
      status: true,

      message: "Email sent successfully",
    });
  } catch (error) {
    return res.status(500).json({
      status: false,

      message: error.message,
    });
  }
};

// SEND BULK EMAILS

const sendBulkEmails = async (req, res) => {
  try {
    const { emails, subject, data } = req.body;

    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({
        status: false,

        message: "Emails array is required",
      });
    }

    if (!subject) {
      return res.status(400).json({
        status: false,

        message: "Email subject is required",
      });
    }

    // SEND EMAILS

    await notificationService.sendBulkEmails({
      emails,
      subject,
      data,
    });

    return res.status(200).json({
      status: true,

      message: "Bulk emails sent successfully",
    });
  } catch (error) {
    return res.status(500).json({
      status: false,

      message: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// In-app notifications (current user scope)
// ─────────────────────────────────────────────────────────────────────────

const getMyNotifications = async (req, res) => {
  try {
    const unreadOnly = req.query.unreadOnly === "true";
    const items = await notificationService.listForUser(req.user.id, {
      unreadOnly,
    });
    const count = await notificationService.unreadCount(req.user.id);
    return res.status(200).json({
      status: true,
      unreadCount: count,
      data: serializeBigInt(items),
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

const markRead = async (req, res) => {
  try {
    const updated = await notificationService.markRead(
      req.params.id,
      req.user.id,
    );
    return res
      .status(200)
      .json({ status: true, data: serializeBigInt(updated) });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const markAllRead = async (req, res) => {
  try {
    await notificationService.markAllRead(req.user.id);
    return res.status(200).json({ status: true, message: "All marked read" });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = {
  sendEmail,
  sendBulkEmails,
  getMyNotifications,
  markRead,
  markAllRead,
};
