/**
 * Fetches real driving times between every in-city place pair using the
 * Google Maps Distance Matrix API. Outputs data/travel-matrix.json.
 *
 * Usage:
 *   node scripts/build-travel-matrix.mjs <API_KEY>
 *
 * The key needs Distance Matrix API enabled. Results are baseline driving
 * times (typical traffic). The engine applies rush-hour multipliers on top.
 *
 * Cost: ~19 000 elements × $5/1000 = ~$97 (one-time, within Google's $200 free credit).
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const API_KEY = process.argv[2] ?? process.env.GOOGLE_MAPS_KEY;

if (!API_KEY) {
  console.error("Usage: node scripts/build-travel-matrix.mjs <API_KEY>");
  process.exit(1);
}

// ── Places ────────────────────────────────────────────────────────────────────

const raw = JSON.parse(readFileSync(join(__dir, "../data/places.json"), "utf8"));
const EXCLUDE = new Set(["gorai", "karjat", "kolad", "vasai"]);
const cityPlaces = raw.filter(p => !EXCLUDE.has(p.zone ?? ""));

// Add home as a synthetic entry so engine can look up travel-to-home accurately.
const HOME = { id: "home", name: "Marol", area: "Andheri East", zone: "home" };
const allPlaces = [...cityPlaces, HOME];

function addressFor(p) {
  return `${p.name}, ${p.area}, Mumbai, India`;
}

// ── Batching ──────────────────────────────────────────────────────────────────

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const BATCH = 10; // 10×10 = 100 elements per request (API max with traffic)
const batches = chunk(allPlaces, BATCH);

// ── API call ──────────────────────────────────────────────────────────────────

async function fetchSegment(origins, destinations, attempt = 1) {
  const params = new URLSearchParams({
    origins:      origins.map(addressFor).join("|"),
    destinations: destinations.map(addressFor).join("|"),
    mode:         "driving",
    key:          API_KEY,
  });
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  if (data.status === "OVER_QUERY_LIMIT" && attempt <= 3) {
    console.warn("  Rate-limited, waiting 2s and retrying…");
    await sleep(2000 * attempt);
    return fetchSegment(origins, destinations, attempt + 1);
  }
  if (data.status !== "OK") {
    console.error("  API error:", data.status, data.error_message ?? "");
  }
  return data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────

const matrix = {};
let totalPairs = 0;
let failedPairs = 0;
let requestCount = 0;
const totalRequests = batches.length * batches.length;

console.log(`Places: ${allPlaces.length}  |  Batches: ${batches.length}×${batches.length} = ${totalRequests} requests`);

for (let oi = 0; oi < batches.length; oi++) {
  const origBatch = batches[oi];

  for (let di = 0; di < batches.length; di++) {
    const destBatch = batches[di];
    requestCount++;

    const data = await fetchSegment(origBatch, destBatch);

    if (data?.rows) {
      for (let r = 0; r < data.rows.length; r++) {
        const row = data.rows[r];
        for (let c = 0; c < row.elements.length; c++) {
          const el = row.elements[c];
          const fromId = origBatch[r]?.id;
          const toId   = destBatch[c]?.id;
          if (!fromId || !toId || fromId === toId) continue;

          if (el.status === "OK") {
            // duration.value is seconds. Use duration_in_traffic if present.
            const secs = el.duration_in_traffic?.value ?? el.duration?.value ?? 0;
            matrix[`${fromId}|${toId}`] = Math.round(secs / 60);
            totalPairs++;
          } else {
            failedPairs++;
          }
        }
      }
    }

    // Progress every 20 requests
    if (requestCount % 20 === 0 || requestCount === totalRequests) {
      const pct = Math.round(requestCount / totalRequests * 100);
      console.log(`  ${pct}%  (${requestCount}/${totalRequests} requests, ${totalPairs} pairs OK, ${failedPairs} failed)`);
    }

    // Polite rate limit: 150ms between requests (~6-7 req/s, well under 100 elem/s limit)
    await sleep(150);
  }
}

const outPath = join(__dir, "../data/travel-matrix.json");
writeFileSync(outPath, JSON.stringify(matrix, null, 0));
console.log(`\nDone. ${totalPairs} pairs written to data/travel-matrix.json`);
console.log(`Failed elements: ${failedPairs}`);
console.log(`File size: ${(JSON.stringify(matrix).length / 1024).toFixed(0)} KB`);
