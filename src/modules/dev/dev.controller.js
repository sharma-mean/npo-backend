const { spawn } = require("child_process");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..");

// Parse node:test summary lines ("ℹ pass 32", "ℹ fail 0", "ℹ tests 32")
const parseSummary = (output) => {
  const num = (label) => {
    const m = output.match(new RegExp(`\\b${label}\\s+(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  return {
    total: num("tests"),
    pass: num("pass"),
    fail: num("fail"),
    skipped: num("skipped"),
  };
};

const devController = {
  runTests: async (req, res) => {
    // Hard block in production
    if (process.env.NODE_ENV === "production") {
      return res
        .status(403)
        .json({ status: false, message: "Test runner is disabled in production" });
    }

    // Optional shared-secret gate (set TEST_RUN_TOKEN to require it)
    if (process.env.TEST_RUN_TOKEN) {
      const provided = req.headers["x-test-token"] || req.query.token;
      if (provided !== process.env.TEST_RUN_TOKEN) {
        return res.status(401).json({ status: false, message: "Invalid test token" });
      }
    }

    const child = spawn("npm", ["test"], {
      cwd: PROJECT_ROOT,
      env: process.env,
    });

    let output = "";
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 60000);

    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));

    child.on("close", (code) => {
      clearTimeout(killTimer);
      const summary = parseSummary(output);
      const passed = code === 0 && summary.fail === 0;
      return res.status(passed ? 200 : 500).json({
        status: passed,
        message: passed ? "All tests passed" : "Some tests failed",
        summary,
        exitCode: code,
        output: output.replace(/\[[0-9;]*m/g, ""), // strip ANSI colors
      });
    });

    child.on("error", (err) => {
      clearTimeout(killTimer);
      return res
        .status(500)
        .json({ status: false, message: "Failed to run tests", error: err.message });
    });
  },
};

module.exports = devController;
