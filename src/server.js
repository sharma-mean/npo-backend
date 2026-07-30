require("dotenv").config();

const app = require("./app");
const prisma = require("./config/db");
const { startCronJobs } = require("./cron/scheduler");

async function startServer() {
  try {
    await prisma.$connect();
    console.log("Database Connected");

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log("Server is running at : " + PORT);
      // In-process node-cron scheduler (self-host/local; no Redis). On Vercel
      // this file isn't the entry (api/index.js → app.js), so it never runs
      // there — Vercel Cron hits /api/cron/daily instead.
      startCronJobs();
    });
  } catch (error) {
    console.error("Database Connection Error:", error);
  }
}

startServer();
  