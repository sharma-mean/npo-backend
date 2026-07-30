const prisma = require("../../config/db");
const now = () => BigInt(Date.now());

// Staff fields safe to expose — never include password / reset / verify tokens.
const STAFF_SAFE_SELECT = {
  id: true,
  fullName: true,
  profileImage: true,
  email: true,
  phone: true,
  role: true,
  serviceType: true,
  designationId: true,
  status: true,
};

const staffRoleService = {
  create: async (data, authData) => {
    const { name, description, roleType } = data;
    if (!roleType) throw new Error("Role type is required");
    if (!name) throw new Error("Role name is required");

    const trimmedName = name.trim().toUpperCase();
    const existingRole = await prisma.staffRole.findFirst({
      where: { name: trimmedName, organizationId: authData.organizationId },
    });
    if (existingRole) throw new Error("Role already exists");

    return prisma.staffRole.create({
      data: {
        name: trimmedName,
        description,
        // roles always apply to all service categories
        serviceType: null,
        roleType,
        organizationId: authData.organizationId,
        createdAt: now(),
        updatedAt: now(),
        createdBy: authData.id,
      },
    });
  },

  getAll: async (organizationId) => {
    return prisma.staffRole.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },

  getById: async (id, organizationId) => {
    const role = await prisma.staffRole.findFirst({
      where: { id, organizationId },
      include: {
        users: { where: { isDeleted: false }, select: STAFF_SAFE_SELECT },
      },
    });

    if (!role) {
      throw new Error("Role not found");
    }

    return role;
  },

  update: async (id, data, organizationId) => {
    const role = await prisma.staffRole.findFirst({
      where: { id, organizationId },
    });
    if (!role) throw new Error("Role not found");

    const { name, description, roleType } = data;

    if (name) {
      const trimmedName = name.trim().toUpperCase();
      const duplicate = await prisma.staffRole.findFirst({
        where: { name: trimmedName, organizationId, id: { not: id } },
      });
      if (duplicate) throw new Error("Role with this name already exists");
      data.name = trimmedName;
    }

    return prisma.staffRole.update({
      where: { id },
      data: {
        ...(name && { name: data.name }),
        ...(description !== undefined && { description }),
        ...(roleType && { roleType }),
        updatedAt: now(),
      },
    });
  },

  toggleStatus: async (id, organizationId) => {
    const role = await prisma.staffRole.findFirst({
      where: { id, organizationId },
    });
    if (!role) throw new Error("Role not found");

    return prisma.staffRole.update({
      where: { id },
      data: {
        status: !role.status,
        updatedAt: now(),
      },
    });
  },

  delete: async (id, organizationId) => {
    const role = await prisma.staffRole.findFirst({
      where: { id, organizationId },
      include: { users: { where: { isDeleted: false } } },
    });

    if (!role) {
      throw new Error("Role not found");
    }

    if (role.users.length > 0) {
      throw new Error(
        `Cannot delete: ${role.users.length} staff member(s) are assigned to this role`,
      );
    }

    await prisma.staffRole.delete({
      where: { id },
    });

    return true;
  },

  getStaffByRole: async (id, organizationId) => {
    return prisma.user.findMany({
      where: { designationId: id, isDeleted: false, organizationId },
      select: STAFF_SAFE_SELECT,
    });
  },
};

module.exports = staffRoleService;
