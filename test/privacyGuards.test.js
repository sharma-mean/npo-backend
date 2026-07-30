const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Regression guards for privacy controls that are easy to undo by accident.
 *
 * These are deliberately SOURCE-level checks rather than behavioural ones: each
 * bug they guard against was introduced by a single innocuous-looking edit
 * (swapping a `select` for an `include`, dropping a field from a wipe list), and
 * a source assertion catches that at the exact moment it happens without
 * needing a live DB, a seeded tenant and a running trip.
 */

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

/* ── Guardian must never receive a live, exact staff position ──────────── */

test("booking relations never expose live staff coordinates", () => {
  const src = read("modules/booking/booking.service.js");

  // The shared select is what every guardian-reachable list goes through.
  const relations = src.slice(
    src.indexOf("const BOOKING_LIST_RELATIONS"),
    src.indexOf("const getMyBookings"),
  );
  assert.ok(relations.length > 0, "BOOKING_LIST_RELATIONS block not found");

  for (const field of ["lastLat", "lastLng", "lastLocationAt"]) {
    assert.ok(
      !relations.includes(field),
      `BOOKING_LIST_RELATIONS must not select ${field} — the live position is ` +
        `only served (blurred for guardians) by location.service`,
    );
  }
});

test("getMyBookings uses the shared safe select, not a bare include", () => {
  const src = read("modules/booking/booking.service.js");
  const fn = src.slice(
    src.indexOf("const getMyBookings"),
    src.indexOf("const getBookingsForIncident"),
  );
  assert.ok(fn.length > 0, "getMyBookings not found");

  assert.ok(
    fn.includes("include: BOOKING_LIST_RELATIONS"),
    "getMyBookings must reuse BOOKING_LIST_RELATIONS",
  );
  // Spelling the relation out again is how the leak got in: a hand-written
  // `staffAssignments: { include: ... }` returns EVERY scalar, live GPS with it.
  // Asserting the key is absent entirely is exact — a nested-brace regex is not,
  // because the `where: { status: { not: ... } }` clause defeats it.
  assert.ok(
    !fn.includes("staffAssignments:"),
    "getMyBookings must not declare its own staffAssignments relation — " +
      "use the shared select so the live position stays out of the payload",
  );
});

test("guardian coordinates are approximated before being returned", () => {
  const src = read("modules/bookingStaffAssignment/location.service.js");

  assert.ok(
    src.includes("GUARDIAN_PRECISION"),
    "the guardian coordinate grid must exist",
  );
  assert.ok(
    /const blur = isOwningGuardian/.test(src),
    "blur must be keyed on the reader being the owning guardian",
  );
  assert.ok(
    /lat: blur \? approximate\(/.test(src) && /lng: blur \? approximate\(/.test(src),
    "both lat and lng must go through approximate() when blurring",
  );
});

test("a location ping is rejected without recorded consent", () => {
  const src = read("modules/bookingStaffAssignment/location.service.js");
  assert.ok(
    src.includes("consentLocationSharing"),
    "recordLocation must check the staff member's recorded consent, not just " +
      "the device permission",
  );
});

/* ── Account deletion ──────────────────────────────────────────────────── */

test("anonymisation clears every personal identifier", () => {
  const src = read("modules/accountDeletion/accountDeletion.service.js");
  const fn = src.slice(
    src.indexOf("const anonymiseUser"),
    src.indexOf("const approveRequest"),
  );
  assert.ok(fn.length > 0, "anonymiseUser not found");

  // Every personal column on User. A new PII field added to the schema should
  // fail here until it is added to the wipe.
  const mustClear = [
    "fullName",
    "nameKana",
    "email",
    "password",
    "phone",
    "alternatePhone",
    "emergencyContactPhone",
    "emergencyInstructions",
    "address",
    "city",
    "state",
    "country",
    "postalCode",
    "dateOfBirth",
    "gender",
    "medicalNotes",
    "allergyNotes",
    "relationshipType",
    "userCode",
    "profileImage",
    "resetToken",
    "verifyToken",
  ];
  for (const field of mustClear) {
    assert.ok(fn.includes(`${field}:`), `anonymiseUser must clear ${field}`);
  }

  // Push tokens and any shared position must go too.
  assert.ok(fn.includes("deviceToken.deleteMany"), "must drop device tokens");
  assert.ok(fn.includes("lastLat: null"), "must drop any shared position");
});

test("approval requires a second person and protects the last admin", () => {
  const src = read("modules/accountDeletion/accountDeletion.service.js");
  const fn = src.slice(
    src.indexOf("const approveRequest"),
    src.indexOf("const rejectRequest"),
  );
  assert.ok(fn.length > 0, "approveRequest not found");

  assert.ok(
    fn.includes("request.userId === authUser.id"),
    "approving your own request would collapse the review model",
  );
  assert.ok(
    fn.includes("assertNotSoleAdmin"),
    "the sole-admin check must be re-run at approval, not only at request time",
  );
  assert.ok(
    fn.includes('authUser.role !== "NPO_ADMIN"'),
    "a coordinator must not be able to erase an administrator",
  );
});

test("deletion requests are org-scoped, never findUnique by id", () => {
  const src = read("modules/accountDeletion/accountDeletion.service.js");
  assert.ok(
    !src.includes("accountDeletionRequest.findUnique"),
    "a by-id read must be findFirst + organizationId, or one tenant could " +
      "action another tenant's request",
  );
  assert.ok(
    src.includes("organizationId: authUser.organizationId"),
    "manager queries must be scoped to the caller's own organization",
  );
});
