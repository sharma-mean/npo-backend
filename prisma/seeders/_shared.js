const bcrypt = require("bcryptjs");

// Stable keys used across seeders so each can run standalone (idempotent).
const ORG_CODE = "SUNRISE001";
const PLAN_ID = "plan-seed-001";

const now = () => BigInt(Date.now());
const hashPw = () => bcrypt.hash("123456", 10);

// Common dependency fetchers (assume prerequisite seeders already ran)
const getOrg = (prisma) => prisma.organization.findUnique({ where: { code: ORG_CODE } });
const getSuperAdmin = (prisma) => prisma.user.findUnique({ where: { email: "superadmin@gmail.com" } });
const getAdmin = (prisma) => prisma.user.findUnique({ where: { email: "admin@gmail.com" } });

module.exports = { ORG_CODE, PLAN_ID, now, hashPw, getOrg, getSuperAdmin, getAdmin };
