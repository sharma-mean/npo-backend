const https = require("https");
const crypto = require("crypto");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { NodeHttpHandler } = require("@smithy/node-http-handler");

// Backblaze B2 via its S3-compatible API (AWS SDK — no B2-specific SDK needed).
// The bucket is PRIVATE: nothing is ever served publicly. Uploads and downloads
// both go through short-lived presigned URLs, so files stream browser↔B2
// directly and never pass through this server (keeps us inside Vercel's
// serverless body-size/timeout limits).
//
// NOTE: B2 rejects the *master* application key on the S3 API — the key must be
// a bucket-scoped Application Key (25-char keyId starting `005…`).

const BUCKET = process.env.B2_BUCKET;
const ENDPOINT = process.env.B2_ENDPOINT;
const REGION = process.env.B2_REGION;
const KEY_ID = process.env.B2_KEY_ID;
const APP_KEY = process.env.B2_APP_KEY;

const isConfigured = () => Boolean(BUCKET && ENDPOINT && REGION && KEY_ID && APP_KEY);

let _client = null;
const client = () => {
  if (!isConfigured()) {
    throw new Error("File storage is not configured (missing B2_* environment variables)");
  }
  if (_client) return _client;
  _client = new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    credentials: { accessKeyId: KEY_ID, secretAccessKey: APP_KEY },
    // AWS SDK v3 (>=3.729) attaches a CRC32 checksum to every PUT by default.
    // Backblaze (like R2/MinIO) doesn't implement that AWS extension, and on a
    // PRESIGNED url the checksum is baked into the query string as the checksum
    // of an EMPTY body — so the real upload fails the integrity check. Only
    // send checksums when the operation actually requires one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: new NodeHttpHandler({
      // family:4 — some networks (incl. this project's dev machines) hang on
      // IPv6 to Backblaze; forcing IPv4 avoids a silent connect timeout.
      httpsAgent: new https.Agent({ family: 4, keepAlive: true }),
      connectionTimeout: 10000,
      requestTimeout: 30000,
    }),
  });
  return _client;
};

// Allow-list — anything else is rejected before a presigned URL is issued.
const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const SIGNED_PUT_TTL = 300; // 5 min to start the upload
const SIGNED_GET_TTL = 300; // 5 min download link

// Avatars are embedded in <img> tags across long-lived pages, so their signed
// links need to outlive a typical session — 12h, refreshed on the next fetch.
const SIGNED_AVATAR_TTL = 12 * 60 * 60;

const AVATAR_MIME = ["image/png", "image/jpeg", "image/webp"];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// Sanitize a client-supplied filename → safe suffix for the object key.
const safeName = (name) =>
  String(name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(-80);

/**
 * Build a flat, unguessable object key — files land at the bucket root (no
 * folder nesting). The 16-hex random segment makes a key unguessable even when
 * the filename is known, and guarantees no collisions between tenants.
 *
 * Tenant isolation is NOT carried by the key path; it's enforced in the service
 * (`confirmUpload` validates the shape + rejects a key already registered by
 * any other document row, so one org can never claim another's object).
 */
const KEY_RE = /^\d{13}-[0-9a-f]{16}-[\w.\-]{1,80}$/;

const buildKey = (fileName) =>
  `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName(fileName)}`;

/** True when a client-supplied key matches exactly what we would have issued. */
const isValidKey = (key) => KEY_RE.test(String(key || ""));

/** Presigned PUT — the browser uploads straight to B2 with this URL. */
const getUploadUrl = async ({ fileName, mimeType }) => {
  const fileKey = buildKey(fileName);
  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: BUCKET, Key: fileKey, ContentType: mimeType }),
    { expiresIn: SIGNED_PUT_TTL },
  );
  return { uploadUrl: url, fileKey };
};

/** Presigned GET — short-lived download link for a private object. */
const getDownloadUrl = async (fileKey, fileName) =>
  getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      // Force a download with the original name rather than the opaque key.
      ResponseContentDisposition: `attachment; filename="${safeName(fileName)}"`,
    }),
    { expiresIn: SIGNED_GET_TTL },
  );

/**
 * Signed URL for an avatar. Longer-lived than a document link because it is
 * rendered in <img> tags on pages the user keeps open.
 *
 * Legacy avatars were stored as inline base64 data-URLs on the User row; those
 * are passed straight through so old pictures keep working after the migration.
 */
const getAvatarUrl = async (profileImage) => {
  if (!profileImage) return null;
  if (String(profileImage).startsWith("data:")) return profileImage; // legacy
  if (!isConfigured()) return null;
  try {
    return await getSignedUrl(
      client(),
      new GetObjectCommand({ Bucket: BUCKET, Key: profileImage }),
      { expiresIn: SIGNED_AVATAR_TTL },
    );
  } catch {
    return null; // a broken avatar must never break the request
  }
};

/** Best-effort object delete — a storage failure must not block the DB write. */
const deleteFile = async (fileKey) => {
  try {
    await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileKey }));
    return true;
  } catch (err) {
    console.error("[storage] delete failed:", err.message);
    return false;
  }
};

module.exports = {
  isConfigured,
  getUploadUrl,
  getDownloadUrl,
  getAvatarUrl,
  deleteFile,
  isValidKey,
  ALLOWED_MIME,
  MAX_SIZE_BYTES,
  AVATAR_MIME,
  AVATAR_MAX_BYTES,
};
