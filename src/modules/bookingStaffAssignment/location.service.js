const prisma = require("../../config/db");
const { ASSIGNMENT_STATUS } = require("./bookingStaffAssignment.constants");
const { geocodeAddress } = require("../../utils/geocode");

/**
 * Live location for an in-progress task.
 *
 * Deliberate limits — this is employee-location data, not a product feature to
 * be generous with:
 *  - the staff member must have opted in (`User.consentLocationSharing`) — the
 *    phone's OS permission alone is not consent, because that is a device
 *    setting an employer can stand over someone while they tap;
 *  - a ping is only accepted while the assignment is **START** (task running);
 *  - only the staff member the task belongs to may ping it (never a body-supplied
 *    userId);
 *  - only the LAST position is kept (overwritten each ping) — no movement trail;
 *  - the position is WIPED when the task ends/completes/cancels;
 *  - guardians see an APPROXIMATED position, managers see the exact one — a
 *    parent needs to know the trip is close, not which shop the driver stopped at;
 *  - a reader sees `stale: true` rather than a confidently-wrong old pin.
 */

/** A fix older than this is reported as stale rather than shown as "live". */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Grid size used to blur a position before showing it to a guardian.
 * 0.001° ≈ 110 m — close enough to see the van approaching, coarse enough that
 * it does not pinpoint a staff member's exact doorstep.
 */
const GUARDIAN_PRECISION = 0.001;

/** Snap a coordinate to the guardian-visible grid. */
const approximate = (v) =>
  Math.round(v / GUARDIAN_PRECISION) * GUARDIAN_PRECISION;

const isFiniteCoord = (v, max) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;

/**
 * Staff pings their position. `authUser` decides ownership — the route never
 * trusts a userId from the body.
 */
const recordLocation = async (assignmentId, authUser, { lat, lng }) => {
  if (!isFiniteCoord(lat, 90) || !isFiniteCoord(lng, 180)) {
    throw new Error("lat and lng must be valid coordinates");
  }

  const assignment = await prisma.bookingStaffAssignment.findFirst({
    where: {
      id: assignmentId,
      organizationId: authUser.organizationId,
      userId: authUser.id, // only your own task — managers do not ping
    },
    select: { id: true, status: true, user: { select: { consentLocationSharing: true } } },
  });
  if (!assignment) throw new Error("Assignment not found");

  // Consent is checked server-side, not just in the app: a stale client build,
  // or a request replayed by hand, must not be able to write a position for
  // someone who has turned sharing off.
  if (!assignment.user?.consentLocationSharing) {
    return { accepted: false, reason: "Location sharing consent not given" };
  }

  // Outside the START window there is nothing to share. Returning silently (not
  // throwing) keeps a late in-flight ping from a just-ended task from surfacing
  // an error in the app.
  if (assignment.status !== ASSIGNMENT_STATUS.START) {
    return { accepted: false, reason: "Task is not in progress" };
  }

  const now = BigInt(Date.now());
  await prisma.bookingStaffAssignment.update({
    where: { id: assignment.id },
    data: { lastLat: lat, lastLng: lng, lastLocationAt: now, updatedAt: now },
  });

  return { accepted: true, at: now };
};

/**
 * Wipe the position. Called on end/complete/cancel — best-effort, because
 * failing to clear a pin must never fail the task transition itself (the status
 * change is what the staff member actually asked for).
 */
const clearLocation = async (assignmentId, { recordEnd = true } = {}) => {
  try {
    const data = { lastLat: null, lastLng: null, lastLocationAt: null };
    if (recordEnd) {
      // Preserve the last known fix as the task's END location before wiping the
      // live pin — one final point, not a trail. If there's no current fix (e.g.
      // this runs at COMPLETE after END already wiped it, or the staff never
      // shared location), leave the previously-captured end location untouched.
      const a = await prisma.bookingStaffAssignment.findUnique({
        where: { id: assignmentId },
        select: { lastLat: true, lastLng: true, lastLocationAt: true },
      });
      if (a && a.lastLat != null && a.lastLng != null) {
        data.endLat = a.lastLat;
        data.endLng = a.lastLng;
        data.endLocationAt = a.lastLocationAt;
      }
    }
    await prisma.bookingStaffAssignment.update({
      where: { id: assignmentId },
      data,
    });
  } catch (err) {
    console.error("[location] clear failed:", err.message);
  }
};

/**
 * Venue coordinates, geocoded on first use and cached on the row.
 *
 * Best-effort: a venue we can't place simply comes back without coords (the map
 * drops that marker). It must never fail the live-location read — the driver's
 * position is the point of the call.
 */
/**
 * Geocode the venue with the BOOKING'S organization settings — that tenant's
 * map provider/key is the correct one for its own venue.
 */
const withVenueCoords = async (venue, organizationId) => {
  const base = { id: venue.id, name: venue.name, address: venue.address };
  if (venue.lat != null && venue.lng != null && (venue.lat !== 0 || venue.lng !== 0)) {
    return { ...base, lat: venue.lat, lng: venue.lng };
  }
  if (!venue.address) return { ...base, lat: null, lng: null };

  try {
    const org = organizationId
      ? await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        mapProvider: true,
        googleMapsApiKey: true,
        city: true,
        state: true,
        country: true,
      },
        })
      : null;
    const context = [org?.city, org?.state, org?.country]
      .map((v) => (v || "").trim())
      .filter((v) => v && v.length > 1)
      .join(", ");

    const coords = await geocodeAddress(venue.address, {
      provider: org?.mapProvider,
      apiKey: org?.googleMapsApiKey,
      context,
    });
    if (!coords) return { ...base, lat: null, lng: null };

    await prisma.venue
      .update({ where: { id: venue.id }, data: { lat: coords.lat, lng: coords.lng } })
      .catch(() => {});
    return { ...base, ...coords };
  } catch (err) {
    console.error("[location] venue geocode failed:", err.message);
    return { ...base, lat: null, lng: null };
  }
};

const withPickupCoords = async (booking) => {
  if (
    booking.pickupLat != null &&
    booking.pickupLng != null &&
    (booking.pickupLat !== 0 || booking.pickupLng !== 0)
  ) {
    return {
      lat: booking.pickupLat,
      lng: booking.pickupLng,
      address: booking.pickupAddress || null,
    };
  }
  if (!booking.pickupAddress) return null;

  try {
    const org = await prisma.organization.findUnique({
      where: { id: booking.organizationId },
      select: {
        mapProvider: true,
        googleMapsApiKey: true,
        city: true,
        state: true,
        country: true,
      },
    });
    const context = [org?.city, org?.state, org?.country]
      .map((v) => (v || "").trim())
      .filter((v) => v && v.length > 1)
      .join(", ");

    const coords = await geocodeAddress(booking.pickupAddress, {
      provider: org?.mapProvider,
      apiKey: org?.googleMapsApiKey,
      context,
    });
    if (!coords) return { lat: null, lng: null, address: booking.pickupAddress };

    await prisma.booking
      .update({
        where: { id: booking.id },
        data: { pickupLat: coords.lat, pickupLng: coords.lng },
      })
      .catch(() => {});
    return { ...coords, address: booking.pickupAddress };
  } catch (err) {
    console.error("[location] pickup geocode failed:", err.message);
    return { lat: null, lng: null, address: booking.pickupAddress };
  }
};

/**
 * Who is currently sharing a location on this booking.
 *
 * Scoping: a manager sees any booking in their org; a GUARDIAN only their own
 * booking; anyone else gets nothing. A staff member does not need this — they
 * are the source.
 */
const getBookingLiveLocations = async (bookingId, authUser) => {
  // SUPER_ADMIN operates across tenants and carries no organizationId, so an
  // org filter would never match for them. Every other role stays tenant-locked.
  const isSuperAdmin = authUser.role === "SUPER_ADMIN";
  const orgScope = isSuperAdmin ? {} : { organizationId: authUser.organizationId };

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, ...orgScope },
    select: {
      id: true,
      organizationId: true,
      guardianId: true,
      pickupAddress: true,
      pickupLat: true,
      pickupLng: true,
      venue: {
        select: { id: true, name: true, address: true, lat: true, lng: true },
      },
    },
  });
  if (!booking) throw new Error("Booking not found");

  const isManager = ["NPO_ADMIN", "COORDINATOR"].includes(authUser.role);
  const isOwningGuardian =
    authUser.role === "GUARDIAN" && booking.guardianId === authUser.id;

  // A staff member assigned to THIS booking may read it too — they need the
  // pickup/venue pins for their own trip map (and a co-driver's position on a
  // shared trip). A staff member NOT on the booking gets nothing.
  const isAssignedStaff =
    authUser.role === "STAFF" &&
    (await prisma.bookingStaffAssignment.count({
      where: {
        bookingId,
        userId: authUser.id,
        organizationId: authUser.organizationId,
      },
    })) > 0;

  if (!isSuperAdmin && !isManager && !isOwningGuardian && !isAssignedStaff) {
    throw new Error("Not authorized to view this booking");
  }

  const assignments = await prisma.bookingStaffAssignment.findMany({
    where: {
      bookingId,
      ...orgScope,
      status: ASSIGNMENT_STATUS.START, // only a running task shares a position
    },
    select: {
      id: true,
      assignmentRole: true,
      startedAt: true,
      lastLat: true,
      lastLng: true,
      lastLocationAt: true,
      user: {
        select: { id: true, fullName: true, phone: true, consentLocationSharing: true },
      },
    },
  });

  // The map wants three points: where the driver IS, where they collect from,
  // and where they're taking the participant. The venue is geocoded lazily and
  // cached on its row — the address never changes, so this runs at most once.
  const venue = booking.venue ? await withVenueCoords(booking.venue, booking.organizationId) : null;
  const pickup = await withPickupCoords(booking);

  const now = Date.now();
  // Guardians get a blurred fix; managers and the staff on the trip get the
  // exact one they need to actually do dispatch.
  const blur = isOwningGuardian;

  return {
    pickup,
    venue,
    staff: assignments.map((a) => {
      const at = a.lastLocationAt ? Number(a.lastLocationAt) : null;
      const hasFix = a.lastLat != null && a.lastLng != null && at != null;
      return {
        assignmentId: a.id,
        assignmentRole: a.assignmentRole,
        startedAt: a.startedAt ? Number(a.startedAt) : null,
        staff: { id: a.user.id, fullName: a.user.fullName, phone: a.user.phone },
        // Distinguishes "hasn't opted in" from "opted in but no fix yet", so the
        // map can say "Consent required" instead of a blank pin the reader has
        // to guess at.
        consentGiven: !!a.user.consentLocationSharing,
        approximate: blur,
        // No fix yet = the staff member hasn't granted location, or hasn't moved
        // since starting. That is not an error; say so honestly.
        location: hasFix
          ? {
              lat: blur ? approximate(a.lastLat) : a.lastLat,
              lng: blur ? approximate(a.lastLng) : a.lastLng,
              at,
            }
          : null,
        stale: hasFix ? now - at > STALE_AFTER_MS : false,
      };
    }),
  };
};

module.exports = {
  recordLocation,
  clearLocation,
  getBookingLiveLocations,
  STALE_AFTER_MS,
};
