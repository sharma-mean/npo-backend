const serializeBigInt = require("../../utils/bigIntSerializer");
const service = require("./accountDeletion.service");

const ok = (res, data, status = 200) =>
  res.status(status).json({ status: true, data: serializeBigInt(data) });
const fail = (res, error) =>
  res.status(400).json({ status: false, message: error.message });

const accountDeletionController = {
  // ── Self-service (any authenticated role) ──────────────────────────
  requestMine: async (req, res) => {
    try {
      return ok(res, await service.requestDeletion(req.user, req.body || {}), 201);
    } catch (e) {
      return fail(res, e);
    }
  },
  getMine: async (req, res) => {
    try {
      return ok(res, await service.getMyRequest(req.user));
    } catch (e) {
      return fail(res, e);
    }
  },
  cancelMine: async (req, res) => {
    try {
      return ok(res, await service.cancelMyRequest(req.user));
    } catch (e) {
      return fail(res, e);
    }
  },

  // ── Manager review ─────────────────────────────────────────────────
  list: async (req, res) => {
    try {
      return ok(res, await service.listRequests(req.user, req.query));
    } catch (e) {
      return fail(res, e);
    }
  },
  approve: async (req, res) => {
    try {
      return ok(res, await service.approveRequest(req.user, req.params.id, req.body || {}));
    } catch (e) {
      return fail(res, e);
    }
  },
  reject: async (req, res) => {
    try {
      return ok(res, await service.rejectRequest(req.user, req.params.id, req.body || {}));
    } catch (e) {
      return fail(res, e);
    }
  },
};

module.exports = accountDeletionController;
