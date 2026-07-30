const prisma = require("../config/db");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100; // Expo's documented max messages per request

const isExpoToken = (t) =>
  typeof t === "string" &&
  (t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken["));

/**
 * Push to every device a user has registered.
 *
 * Best-effort, exactly like `notify()`'s email leg: a network failure, an Expo
 * outage or a malformed token is logged and swallowed — a push must never abort
 * the booking/incident operation that triggered it.
 *
 * Tokens Expo rejects with `DeviceNotRegistered` (app uninstalled, token
 * rotated) are deleted, so we don't keep pushing into the void forever.
 */
const sendPushToUser = async (
  userId,
  { title, body, data = {}, organizationId = null },
) => {
  if (!userId || !title) return;

  let devices = [];
  try {
    // userId is a globally-unique PK so it already pins one tenant, but the
    // org filter is applied when the caller knows it — same defensive scoping
    // as every other query. Org-less callers (e.g. account-setup email to a
    // SUPER_ADMIN) fall back to the user filter alone.
    devices = await prisma.deviceToken.findMany({
      where: { userId, ...(organizationId ? { organizationId } : {}) },
    });
  } catch (err) {
    console.error("[push] token lookup failed:", err.message);
    return;
  }

  const tokens = devices.map((d) => d.token).filter(isExpoToken);
  if (tokens.length === 0) return;

  for (let i = 0; i < tokens.length; i += CHUNK) {
    const batch = tokens.slice(i, i + CHUNK);
    const messages = batch.map((to) => ({
      to,
      title,
      body: body || "",
      sound: "default",
      data,
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(messages),
      });
      const json = await res.json();

      // Receipts come back positionally, one per message in the batch.
      const tickets = Array.isArray(json?.data) ? json.data : [];
      const dead = tickets
        .map((ticket, idx) =>
          ticket?.status === "error" &&
          ticket?.details?.error === "DeviceNotRegistered"
            ? batch[idx]
            : null,
        )
        .filter(Boolean);

      if (dead.length) {
        await prisma.deviceToken
          .deleteMany({ where: { token: { in: dead } } })
          .catch(() => {});
      }
    } catch (err) {
      console.error("[push] send failed:", err.message);
    }
  }
};

module.exports = { sendPushToUser, isExpoToken };
