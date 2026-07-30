// Vercel serverless entry — import the Express app WITHOUT app.listen().
// src/server.js is for local/long-running hosts; on Vercel each request is
// handled by this exported app instance.
const app = require("../src/app");
module.exports = app;
