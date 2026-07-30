// Forward geocoding. Two providers, chosen PER ORGANISATION:
//
//   OSM    — OpenStreetMap Nominatim. Free, no API key, works out of the box, so
//            it is the default for every new org (nothing to set up, nothing to
//            pay). Weaker on Japanese chome-banchi addresses and rate-limited to
//            ~1 req/sec.
//   GOOGLE — the org supplies its OWN API key, so Google's usage bill lands on
//            that org rather than on us across every tenant. Better accuracy.
//
// Never throws into callers — a failure returns null so a booking is never
// blocked by geocoding.

const NOMINATIM_URL =
  process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || "NPO-SaaS/1.0 (geocoding)";
const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

const TIMEOUT_MS = 6000;

// Nominatim's usage policy caps us at ~1 req/sec, so OSM lookups are serialized
// and throttled process-wide. Google has no such limit — don't slow it down.
let chain = Promise.resolve();
let lastAt = 0;
const throttleOsm = () =>
  (chain = chain.then(async () => {
    const wait = Math.max(0, 1600 - (Date.now() - lastAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  }));

const fetchJson = async (url, headers = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const res = await fetch(url, { headers, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
  if (!res.ok) return null;
  return res.json();
};

const geocodeWithOsm = async (q) => {
  await throttleOsm();
  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const data = await fetchJson(url, { "User-Agent": USER_AGENT, Accept: "application/json" });
  if (!Array.isArray(data) || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const geocodeWithGoogle = async (q, apiKey) => {
  const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson(url);
  // Google reports failures in the body (REQUEST_DENIED / OVER_QUERY_LIMIT /
  // ZERO_RESULTS) with a 200, so the status field is the real check.
  if (!data || data.status !== "OK" || !data.results?.length) return null;
  const loc = data.results[0].geometry?.location;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};


/**
 * Nominatim matches a whole free-text string or nothing — it has no notion of
 * "close enough". A real address typed by a guardian ("424 A , 60 Feet Road
 * Surya Nagar A , 60 Feet Road Surya Nagar Near Ridhi Sidhi Circle") therefore
 * returns NULL, even though "Surya Nagar, Jaipur" resolves fine.
 *
 * So we don't ask once — we ask with progressively coarser versions of the same
 * address and take the first hit. The pin lands on the street/area rather than
 * the exact door, which is still far more useful to a driver than an empty map.
 * Google (when an org supplies a key) handles the messy form directly, so this
 * only ever runs for the OSM path.
 */
const candidates = (address, context) => {
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const out = [];
  const withCtx = (v) => (context ? `${v}, ${context}` : v);

  // 1. Progressive left-to-right drops
  for (let i = 0; i < parts.length; i++) {
    const q = parts.slice(i).join(", ");
    if (q.length >= 4) {
      if (context) out.push(withCtx(q));
      out.push(q);
    }
  }

  // 2. Original combinations as backup fallbacks
  const last = parts.length > 1 ? parts[parts.length - 1] : null;
  const first = parts.length > 0 ? parts[0] : null;
  
  const words = address.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
  const lastWord = words.length > 0 ? words[words.length - 1] : null;
  
  const firstLastWord = first && lastWord && first !== lastWord ? `${first}, ${lastWord}` : null;
  const firstLast = first && last && first !== last ? `${first}, ${last}` : null;

  if (firstLast) {
    if (context) out.push(withCtx(firstLast));
    out.push(firstLast);
  }
  if (firstLastWord) {
    if (context) out.push(withCtx(firstLastWord));
    out.push(firstLastWord);
  }
  if (first) {
    if (context) out.push(withCtx(first));
    out.push(first);
  }
  if (last) {
    out.push(last);
    if (context) out.push(withCtx(last));
  }

  return [...new Set(out.filter((q) => q && q.length >= 4))];
};

const geocodeWithOsmFallback = async (address, context) => {
  for (const q of candidates(address, context)) {
    try {
      const hit = await geocodeWithOsm(q);
      if (hit) return hit;
    } catch (err) {
      // One attempt failing (timeout, abort, Nominatim rate-limit) must not kill
      // the remaining, coarser attempts — that was silently turning a resolvable
      // address into "we couldn't place this on the map".
      console.warn("[geocode] attempt failed:", err.message);
    }
  }
  return null;
};


/**
 * Geocode a free-text address → { lat, lng } or null.
 *
 * ALWAYS DEGRADES TO FREE OSM. A key that was valid when the admin saved it can
 * still break later — quota exhausted, billing disabled, key deleted/restricted.
 * When Google gives us nothing for any reason, we silently retry on Nominatim,
 * so the org keeps getting pins instead of a dead map. Same for the
 * half-configured case (GOOGLE selected, key missing).
 *
 * @param {string} address
 * @param {{provider?: "OSM"|"GOOGLE", apiKey?: string, context?: string}} [config]
 *        the ORG's map settings. `context` is the org's "city, state, country" —
 *        it anchors a partial address to the right city (see candidates()).
 */
const geocodeAddress = async (address, config = {}) => {
  const q = (address || "").trim();
  if (q.length < 4) return null;

  const useGoogle = config.provider === "GOOGLE" && config.apiKey;

  const context = (config.context || "").trim() || null;

  if (useGoogle) {
    try {
      // Google parses a messy address directly; the context only helps it.
      const viaGoogle = await geocodeWithGoogle(
        context ? `${q}, ${context}` : q,
        config.apiKey,
      );
      if (viaGoogle) return viaGoogle;
      console.warn("[geocode] Google returned no result — falling back to OSM");
    } catch (err) {
      console.warn("[geocode] Google failed, falling back to OSM:", err.message);
    }
  }

  try {
    return await geocodeWithOsmFallback(q, context);
  } catch {
    return null; // network/abort/parse — geocoding is non-critical
  }
};

/**
 * Validate an org-supplied Google key by actually geocoding with it. Returns
 * { ok, message } — never throws. Used by the settings screen so an admin finds
 * out immediately, not when the first booking silently fails to get a pin.
 */
const verifyGoogleKey = async (apiKey) => {
  if (!apiKey) return { ok: false, message: "API key is required" };
  try {
    const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent("Tokyo Station")}&key=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(url);
    if (!data) return { ok: false, message: "Could not reach Google Maps" };
    if (data.status === "OK") return { ok: true, message: "Key is valid" };
    return {
      ok: false,
      message: data.error_message || `Google rejected the key (${data.status})`,
    };
  } catch {
    return { ok: false, message: "Could not reach Google Maps" };
  }
};

module.exports = { geocodeAddress, verifyGoogleKey };
