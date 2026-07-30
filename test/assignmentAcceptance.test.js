const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Guards for the staff accept/decline gate on booking assignments.
 *
 * Source-level like privacyGuards.test.js: each invariant below was the whole
 * point of the feature, and every one of them is a single innocuous edit away
 * from silently regressing (a default flipped back to ASSIGNED, a `notIn` that
 * loses DECLINED, an owner check dropped). Asserting at the source catches that
 * without a live DB, a seeded tenant or a running trip.
 */

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");
const readMigration = (dir) =>
  fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", dir, "migration.sql"),
    "utf8",
  );

const assignSvc = () =>
  read("modules/bookingStaffAssignment/bookingStaffAssignment.service.js");
const assignRoutes = () =>
  read("modules/bookingStaffAssignment/bookingStaffAssignment.routes.js");
const constants = () =>
  read("modules/bookingStaffAssignment/bookingStaffAssignment.constants.js");
const bookingSvc = () => read("modules/booking/booking.service.js");
const fulfillSvc = () => read("modules/booking/bookingFulfillment.service.js");

/* ── New assignments require acknowledgement ───────────────────────────── */

test("a new assignment starts PENDING_ACCEPTANCE, not ASSIGNED", () => {
  const src = assignSvc();
  const create = src.slice(
    src.indexOf("createAssignment:"),
    src.indexOf("getAvailableStaff:"),
  );
  assert.ok(
    /status:\s*ASSIGNMENT_STATUS\.PENDING_ACCEPTANCE/.test(create),
    "createAssignment must create the row as PENDING_ACCEPTANCE",
  );
});

test("fulfillBooking assigns staff as PENDING_ACCEPTANCE too", () => {
  assert.ok(
    /status:\s*"PENDING_ACCEPTANCE"/.test(fulfillSvc()),
    "fulfillBooking's assignment create must use PENDING_ACCEPTANCE",
  );
});

test("the assignment status default in the schema is PENDING_ACCEPTANCE", () => {
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "schema.prisma"),
    "utf8",
  );
  const model = schema.slice(
    schema.indexOf("model BookingStaffAssignment"),
    schema.indexOf("model BookingStaffAssignment") + 1200,
  );
  assert.ok(
    /status\s+String\s+@default\("PENDING_ACCEPTANCE"\)/.test(model),
    "schema default must be PENDING_ACCEPTANCE",
  );
});

/* ── Can't start an un-accepted task ───────────────────────────────────── */

test("startTask refuses a PENDING_ACCEPTANCE assignment", () => {
  const src = assignSvc();
  const start = src.slice(src.indexOf("startTask:"), src.indexOf("endTask:"));
  assert.ok(
    start.includes("ASSIGNMENT_STATUS.PENDING_ACCEPTANCE"),
    "startTask must explicitly reject a not-yet-accepted assignment",
  );
});

/* ── Accept / decline are owner-only ───────────────────────────────────── */

test("acceptAssignment and declineAssignment are owner-scoped", () => {
  const src = assignSvc();
  const accept = src.slice(
    src.indexOf("acceptAssignment:"),
    src.indexOf("declineAssignment:"),
  );
  const decline = src.slice(
    src.indexOf("declineAssignment:"),
    src.indexOf("startTask:"),
  );
  for (const [name, block] of [["accept", accept], ["decline", decline]]) {
    assert.ok(block.length > 0, `${name} block not found`);
    assert.ok(
      block.includes("assignment.userId !== authUser.id"),
      `${name} must reject anyone but the assignment's own staff member`,
    );
  }
});

test("declineAssignment requires a non-empty reason", () => {
  const src = assignSvc();
  const decline = src.slice(
    src.indexOf("declineAssignment:"),
    src.indexOf("startTask:"),
  );
  assert.ok(
    /A reason is required/.test(decline),
    "declineAssignment must reject a blank reason",
  );
});

test("a decline notifies the org's managers", () => {
  const src = assignSvc();
  assert.ok(
    src.includes("notifyManagersOfDecline"),
    "declining must alert managers so the booking can be reassigned",
  );
});

/* ── Declined assignments drop out of the staffing tally ───────────────── */

test("DECLINED never counts toward staffing", () => {
  const src = bookingSvc();
  const tally = src.slice(
    src.indexOf("const assignedStaffTally"),
    src.indexOf("const staffingShortfall"),
  );
  assert.ok(
    tally.includes('notIn: ["CANCELLED", "DECLINED"]'),
    "assignedStaffTally must exclude DECLINED (and CANCELLED)",
  );
});

test("INACTIVE_STATUSES covers both CANCELLED and DECLINED", () => {
  const src = constants();
  const block = src.slice(src.indexOf("INACTIVE_STATUSES"));
  assert.ok(block.includes("CANCELLED"), "INACTIVE_STATUSES must include CANCELLED");
  assert.ok(block.includes("DECLINED"), "INACTIVE_STATUSES must include DECLINED");
});

/* ── Routes are exposed ────────────────────────────────────────────────── */

test("accept and decline routes are wired", () => {
  const src = assignRoutes();
  assert.ok(/patch\("\/:id\/accept"/.test(src), "PATCH /:id/accept must exist");
  assert.ok(/patch\("\/:id\/decline"/.test(src), "PATCH /:id/decline must exist");
});

/* ── Migration adds the acknowledgement columns ────────────────────────── */

test("the acceptance migration adds accepted/declined columns", () => {
  const sql = readMigration("20260723100000_assignment_acceptance");
  for (const col of ["acceptedAt", "declinedAt", "declineReason"]) {
    assert.ok(sql.includes(col), `migration must add ${col}`);
  }
});
