const prisma = require("../../config/db");
const { isExpoToken } = require("../../utils/push");

const PLATFORMS = ["ios", "android"];

/**
 * Register (or re-point) an Expo push token for the calling user.
 *
 * The token is UNIQUE, not the user — one person may install the app on several
 * devices. An upsert re-points a token that already exists: if a phone is handed
 * over and a different user signs in, the row moves to the new user instead of
 * leaving the previous one receiving that phone's alerts.
 */
const registerDevice = async (authUser, data = {}) => {
  const token = String(data.token || "").trim();
  if (!isExpoToken(token)) {
    throw new Error("A valid Expo push token is required");
  }

  const platform = PLATFORMS.includes(data.platform) ? data.platform : null;
  const now = BigInt(Date.now());

  return prisma.deviceToken.upsert({
    where: { token },
    create: {
      token,
      platform,
      userId: authUser.id,
      organizationId: authUser.organizationId,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      userId: authUser.id,
      organizationId: authUser.organizationId,
      platform,
      updatedAt: now,
    },
    select: { id: true, platform: true, createdAt: true },
  });
};

/**
 * Drop a token on logout. Scoped to the caller — a user can only unregister a
 * token currently attached to their own account.
 */
const unregisterDevice = async (authUser, data = {}) => {
  const token = String(data.token || "").trim();
  if (!token) throw new Error("token is required");

  const { count } = await prisma.deviceToken.deleteMany({
    where: { token, userId: authUser.id },
  });
  return { removed: count };
};

module.exports = { registerDevice, unregisterDevice };
