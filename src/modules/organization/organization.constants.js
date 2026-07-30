// Must match the OrganizationStatus enum in prisma/schema.prisma
const ORGANIZATION_STATUS = {
  ACTIVE: "ACTIVE",
  PENDING: "PENDING",
  INACTIVE: "INACTIVE",
  BLOCKED: "BLOCKED"
};

module.exports = {
  ORGANIZATION_STATUS
};