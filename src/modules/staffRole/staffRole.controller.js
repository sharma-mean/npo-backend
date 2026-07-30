const staffRoleService = require("./staffRole.service");
const serializeBigInt = require("../../utils/bigIntSerializer");
const send = (res, status, data = null, message = "") =>
  res.json({ status, message, data });

const staffRoleController = {
  create: async (req, res) => {
    try {
      const role = await staffRoleService.create(req.body, req.user);
      send(res, true, serializeBigInt(role), "Role created");
    } catch (error) {
      send(res, false, null, error.message);
    }
  },

  getAll: async (req, res) => {
    try {
      const roles = await staffRoleService.getAll(req.user.organizationId);
      send(res, true, serializeBigInt(roles));
    } catch (error) {
      send(res, false, null, error.message);
    }
  },

  getById: async (req, res) => {
    try {
      const role = await staffRoleService.getById(req.params.id, req.user.organizationId);
      send(res, true, serializeBigInt(role));
    } catch (error) {
      send(res, false, null, error.message);
    }
  },

  update: async (req, res) => {
    try {
      const role = await staffRoleService.update(
        req.params.id,
        req.body,
        req.user.organizationId,
      );
      send(res, true, serializeBigInt(role), "Role updated");
    } catch (error) {
      send(res, false, null, error.message);
    }
  },

  toggleStatus: async (req, res) => {
    try {
      const role = await staffRoleService.toggleStatus(
        req.params.id,
        req.user.organizationId,
      );
      send(res, true, serializeBigInt(role), "Status updated");
    } catch (error) {
      send(res, false, null, error.message);
    }
  },

  delete: async (req, res) => {
    try {
      await staffRoleService.delete(req.params.id, req.user.organizationId);
      send(res, true, null, "Role deleted");
    } catch (error) {
      send(res, false, null, error.message);
    }
  },

  getStaffByRole: async (req, res) => {
    try {
      const staff = await staffRoleService.getStaffByRole(req.params.id, req.user.organizationId);
      send(res, true, serializeBigInt(staff));
    } catch (error) {
      send(res, false, null, error.message);
    }
  },
};

module.exports = staffRoleController;
