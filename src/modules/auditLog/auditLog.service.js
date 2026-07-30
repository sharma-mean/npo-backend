const prisma = require("../../config/db");

const MANAGER_ROLES = ["NPO_ADMIN", "COORDINATOR", "SUPER_ADMIN"];

const getAuditLogs = async (authData, filters = {}) => {
  if (!MANAGER_ROLES.includes(authData.role)) {
    throw new Error("Not authorized to view audit logs");
  }

  const where = {};
  // SUPER_ADMIN may see across orgs; others scoped to their org
  if (authData.role !== "SUPER_ADMIN") {
    where.organizationId = authData.organizationId;
  } else if (filters.organizationId) {
    where.organizationId = filters.organizationId;
  }

  if (filters.entity) where.entity = filters.entity;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.action) where.action = filters.action;
  if (filters.actorId) where.actorId = filters.actorId;

  const take = Math.min(Number(filters.limit) || 100, 500);

  return prisma.auditLog.findMany({
    where,
    include: { actor: { select: { id: true, fullName: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
};

module.exports = { getAuditLogs };
