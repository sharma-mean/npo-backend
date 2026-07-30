const paymentService = require("./payment.service");
const webhookService = require("./webhook.service");

const paymentController = {
  checkout: async (req, res) => {
    try {
      const data = await paymentService.createCheckoutSession(req.user, req.body);
      return res.status(200).json({ status: true, data });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  // Success-redirect fallback: capture the payment straight from the session if
  // the webhook hasn't (or won't) arrive. Safe to call every time — it's a
  // no-op when the webhook already processed the payment.
  confirm: async (req, res) => {
    try {
      const sessionId = req.body.sessionId || req.query.session_id;
      const data = await paymentService.confirmSession(req.user, sessionId);
      return res.status(200).json({ status: true, data });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  portal: async (req, res) => {
    try {
      const data = await paymentService.createPortalSession(req.user);
      return res.status(200).json({ status: true, data });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  /**
   * Stripe webhook. Mounted with express.raw() BEFORE express.json() so the
   * exact bytes Stripe signed are available — a parsed/re-serialized body would
   * fail signature verification.
   *
   * Always 2xx once the signature is valid: returning 5xx makes Stripe retry,
   * and a bug in our handler would then replay forever. Handler failures are
   * logged and surfaced in the body instead.
   */
  webhook: async (req, res) => {
    let event;
    try {
      event = webhookService.constructEvent(req.body, req.headers["stripe-signature"]);
    } catch (error) {
      console.error("[stripe] signature verification failed:", error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
      const result = await webhookService.handleEvent(event);
      return res.status(200).json({ received: true, ...result });
    } catch (error) {
      console.error(`[stripe] handler failed for ${event.type}:`, error.message);
      return res.status(200).json({ received: true, handled: false, error: error.message });
    }
  },
};

module.exports = paymentController;
