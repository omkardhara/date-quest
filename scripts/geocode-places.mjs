/**
 * One-time (idempotent) geocoder: adds real lat/lng to every place in
 * data/places.json via the Places API (New) text search, so the chat
 * assistant's "nearby" search can filter by actual distance instead of the
 * coarse zone label (e.g. Powai and Vile Parle both being "andheri_w").
 *
 * Usage:
 *   node scripts/geocode-places.mjs <API_KEY>
 *
 * Safe to re-run: places that already have lat/lng are skipped, so this only
 * costs API calls for newly added places.
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const API_KEY = process.argv[2] ?? process.env.GOOGLE_MAPS_KEY;

if (!API_KEY) {
  console.error("Usage: node scripts/geocode-places.mjs <API_KEY>");
  process.exit(1);
}

const placesPath = join(__dir, "../data/places.json");
const places = JSON.parse(readFileSync(placesPath, "utf8"));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function geocode(place, attempt = 1) {
  const textQuery = `${place.name}, ${place.area}, Mumbai, India`;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "places.location",
      },
      body: JSON.stringify({ textQuery, maxResultCount: 1, regionCode: "IN" }),
    });
    if (res.status === 429 && attempt <= 3) {
      console.warn(`  Rate-limited on ${place.id}, waiting ${2 * attempt}s…`);
      await sleep(2000 * attempt);
      return geocode(place, attempt + 1);
    }
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for ${place.id}`);
      return null;
    }
    const data = await res.json();
    const loc = data?.places?.[0]?.location;
    if (!loc) return null;
    return { lat: loc.latitude, lng: loc.longitude };
  } catch (e) {
    console.warn(`  Error geocoding ${place.id}: ${e.message}`);
    return null;
  }
}

const toGeocode = places.filter((p) => p.lat == null || p.lng == null);
console.log(`Places: ${places.length} total, ${toGeocode.length} need geocoding`);

let done = 0;
let failed = 0;
for (const place of toGeocode) {
  const coords = await geocode(place);
  if (coords) {
    place.lat = coords.lat;
    place.lng = coords.lng;
    done++;
  } else {
    failed++;
  }
  if ((done + failed) % 20 === 0) {
    console.log(`  ${done + failed}/${toGeocode.length} processed (${done} ok, ${failed} failed)`);
  }
  await sleep(120); // polite rate limit
}

writeFileSync(placesPath, JSON.stringify(places, null, 2) + "\n");
console.log(`\nDone. ${done} geocoded, ${failed} failed. data/places.json updated.`);
if (failed > 0) {
  console.log("Failed places (kept without lat/lng, nearby search falls back to zone matching for these):");
  for (const p of toGeocode) if (p.lat == null) console.log(`  - ${p.id}: ${p.name}`);
}
