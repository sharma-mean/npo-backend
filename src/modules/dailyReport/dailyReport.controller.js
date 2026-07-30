const serializeBigInt = require("../../utils/bigIntSerializer");
const dailyReportService = require("./dailyReport.service");
const { STATES, NIGHT_WAKINGS, BELONGINGS, TRANSPORT, VIGOR_MIN, VIGOR_MAX } = require("./dailyReport.constants");

const ok = (res, data, status = 200) =>
  res.status(status).json({ status: true, data: serializeBigInt(data) });
const fail = (res, error) =>
  res.status(400).json({ status: false, message: error.message });

const dailyReportController = {
  // The allowed field options (for the form to render, localized client-side).
  options: async (_req, res) =>
    res.status(200).json({
      status: true,
      data: { states: STATES, nightWakings: NIGHT_WAKINGS, belongings: BELONGINGS, transport: TRANSPORT, vigorMin: VIGOR_MIN, vigorMax: VIGOR_MAX },
    }),

  create: async (req, res) => {
    try {
      return ok(res, await dailyReportService.createReport(req.body, req.user), 201);
    } catch (e) {
      return fail(res, e);
    }
  },
  list: async (req, res) => {
    try {
      return ok(res, await dailyReportService.getReports(req.user, req.query));
    } catch (e) {
      return fail(res, e);
    }
  },
  getById: async (req, res) => {
    try {
      return ok(res, await dailyReportService.getReportById(req.params.id, req.user));
    } catch (e) {
      return fail(res, e);
    }
  },
  update: async (req, res) => {
    try {
      return ok(res, await dailyReportService.updateReport(req.params.id, req.body, req.user));
    } catch (e) {
      return fail(res, e);
    }
  },
  finalize: async (req, res) => {
    try {
      return ok(res, await dailyReportService.finalizeReport(req.params.id, req.user));
    } catch (e) {
      return fail(res, e);
    }
  },
  remove: async (req, res) => {
    try {
      return ok(res, await dailyReportService.deleteReport(req.params.id, req.user));
    } catch (e) {
      return fail(res, e);
    }
  },
};

module.exports = dailyReportController;
