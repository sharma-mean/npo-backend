/**
 * Configure CORS on the Backblaze B2 bucket so the browser can upload files
 * DIRECTLY to B2 via the presigned PUT URL. Without these rules the browser
 * blocks the cross-origin PUT and the user just sees a "Network error" on every
 * document / logo / avatar upload (client feedback #5, #7) — even though the
 * backend and credentials are perfectly fine.
 *
 * Idempotent: run it any time the set of front-end origins changes.
 *
 * Origins come from (first match wins):
 *   1. CLI args:            node scripts/set-b2-cors.js https://app.example.com https://staging...
 *   2. B2_CORS_ORIGINS env: comma-separated list
 *   3. Sensible defaults:   FRONTEND_URL + localhost dev + the Vercel preview URL
 *
 * IMPORTANT: list EVERY origin the app is served from (production domain, each
 * Vercel preview alias, and localhost for dev). A missing origin = failed upload
 * from that origin only.
 */
require("dotenv").config();
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require("@aws-sdk/client-s3");

const argOrigins = process.argv.slice(2).filter(Boolean);
const envOrigins = (process.env.B2_CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const defaults = [
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "https://npo-frontend.vercel.app",
].filter(Boolean);

const origins = [...new Set(argOrigins.length ? argOrigins : envOrigins.length ? envOrigins : defaults)];

const client = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: process.env.B2_REGION,
  credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APP_KEY },
});

(async () => {
  const config = {
    Bucket: process.env.B2_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          // PUT = upload, GET/HEAD = presigned download / avatar render.
          AllowedMethods: ["GET", "PUT", "HEAD"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  };
  await client.send(new PutBucketCorsCommand(config));
  const applied = await client.send(new GetBucketCorsCommand({ Bucket: process.env.B2_BUCKET }));
  console.log("B2 CORS applied for origins:", origins.join(", "));
  console.log(JSON.stringify(applied.CORSRules, null, 2));
})().catch((e) => {
  console.error("Failed to set B2 CORS:", e.message);
  process.exit(1);
});
