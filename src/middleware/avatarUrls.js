const storage = require("../utils/storage");

/**
 * Response middleware: anywhere a payload carries `profileImage` (a private B2
 * object key), attach a signed `profileImageUrl` the browser can actually render.
 *
 * Doing this centrally beats threading a mapper through every service: users
 * surface in a dozen shapes (booking.participant, assignment.user, search
 * groups, incident.reporter…) and each new endpoint would otherwise have to
 * remember. Here, adding `profileImage: true` to a Prisma select is enough.
 *
 * Cheap: signing is local crypto (no network), each distinct key is signed once
 * per response, and a payload with no avatars costs a single tree walk.
 * Best-effort — a signing failure leaves the response untouched rather than
 * failing the request.
 */

// Image columns that hold a private B2 key → the field we expose alongside it.
const IMAGE_FIELDS = {
  profileImage: "profileImageUrl", // user avatars
  brandLogo: "brandLogoUrl", // organisation logo
};

// Legacy images were inline base64 data-URLs; those are already renderable.
const isKey = (v) => typeof v === "string" && v.length > 0 && !v.startsWith("data:");

/** Collect every node holding an image column, and the distinct keys involved. */
const collect = (node, out, keys, seen) => {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return; // guard against cycles
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) collect(item, out, keys, seen);
    return;
  }

  for (const field of Object.keys(IMAGE_FIELDS)) {
    if (field in node) {
      out.push([node, field]);
      if (isKey(node[field])) keys.add(node[field]);
    }
  }

  for (const value of Object.values(node)) collect(value, out, keys, seen);
};

const attachAvatarUrls = async (body) => {
  if (!body || typeof body !== "object") return body;

  const nodes = [];
  const keys = new Set();
  collect(body, nodes, keys, new WeakSet());
  if (nodes.length === 0) return body;

  // Sign each distinct key once, even if 50 rows share it.
  const urls = new Map();
  await Promise.all(
    [...keys].map(async (key) => {
      const url = await storage.getAvatarUrl(key);
      if (url) urls.set(key, url);
    }),
  );

  for (const [node, field] of nodes) {
    const urlField = IMAGE_FIELDS[field];
    if (node[urlField] !== undefined) continue; // already set upstream
    const img = node[field];
    node[urlField] = isKey(img) ? urls.get(img) || null : img || null;
  }

  return body;
};

const avatarUrlsMiddleware = (req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    attachAvatarUrls(body)
      .then(sendJson)
      .catch(() => sendJson(body)); // never fail a response over an avatar
    return res;
  };
  next();
};

module.exports = avatarUrlsMiddleware;
module.exports.attachAvatarUrls = attachAvatarUrls;
