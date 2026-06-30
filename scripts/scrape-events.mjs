/**
 * Standalone scraper for GitHub Actions.
 * Fetches Mumbai events from allevents.in listing pages,
 * parses JSON-LD structured data, and writes data/events-cache.json.
 *
 * Runs with: node scripts/scrape-events.mjs
 * Requires Node 18+ (built-in fetch).
 */

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "../data/events-cache.json");

const BASE = "https://allevents.in/mumbai";

const CATEGORY_URLS = [
  { url: `${BASE}/music`,          category: "music"   },
  { url: `${BASE}/comedy`,         category: "comedy"  },
  { url: `${BASE}/theatre`,        category: "theatre" },
  { url: `${BASE}/art`,            category: "art"     },
  { url: `${BASE}/food-and-drinks`,category: "food"    },
  { url: `${BASE}/film`,           category: "film"    },
  { url: `${BASE}/fitness`,        category: "fitness" },
  { url: `${BASE}/all`,            category: "other"   },
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9,hi;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
};

// Parse JSON-LD script blocks from listing page HTML.
function parseJsonLd(html, category) {
  const results = [];
  const scriptRx = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRx.exec(html)) !== null) {
    try {
      const json = JSON.parse(m[1]);
      const items =
        json["@type"] === "ItemList"
          ? (json.itemListElement ?? []).map((e) => e.item ?? e)
          : json["@type"]?.match(/Event/)
          ? [json]
          : [];
      for (const ev of items) {
        if (!ev?.name) continue;
        const start = ev.startDate ?? ev.startTime ?? "";
        const priceSpec = ev.offers?.lowPrice ?? ev.offers?.price;
        const price = priceSpec != null ? parseFloat(String(priceSpec)) : undefined;
        results.push({
          title: ev.name.trim(),
          when: start ? formatDate(start) : undefined,
          startIso: start || undefined,
          venue: ev.location?.name?.trim(),
          address: ev.location?.address?.streetAddress?.trim(),
          link: ev.url,
          thumbnail: Array.isArray(ev.image) ? ev.image[0] : ev.image,
          price: price != null && !isNaN(price) ? price : undefined,
          priceLabel: buildPriceLabel(ev.offers),
          category,
          source: "allevents",
        });
      }
    } catch {
      // malformed JSON block — skip
    }
  }
  return results;
}

// Regex fallback: find event anchor links and images when JSON-LD is absent.
function parseHtmlFallback(html, category) {
  const results = [];
  const seen = new Set();

  // allevents.in URLs: https://allevents.in/mumbai/<slug>/<numeric-id>
  const linkRx = /href="(https:\/\/allevents\.in\/mumbai\/[^/"?\s]+\/\d+)"/gi;
  // Only capture src/data-src attributes — avoids CSS background-image URLs
  const imgRx  = /(?:src|data-src)="(https?:\/\/cdn[^"]+(?:allevents\.in|cdn-az\.allevents|cdn-ip\.allevents)[^"]+)"/gi;
  const imgs   = [...html.matchAll(imgRx)]
    .map((m) => m[1].split(");")[0].trim()) // strip CSS ); suffix if any
    .filter((u) => /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(u));

  let imgIdx = 0;
  let m;
  while ((m = linkRx.exec(html)) !== null) {
    const link = m[1];
    if (seen.has(link)) continue;
    seen.add(link);

    // Grab nearest image (imprecise but good-enough for the fallback)
    const thumbnail = imgs[imgIdx++];
    // Try to extract a slug-based title
    const slug = link.split("/").slice(-2, -1)[0] ?? "";
    const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    if (title.length < 5) continue; // skip empty or garbage slugs
    results.push({ title, link, thumbnail, category, source: "allevents" });
  }
  return results;
}

async function fetchCategory({ url, category }) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      console.warn(`[${category}] HTTP ${res.status} for ${url}`);
      return [];
    }
    const html = await res.text();
    const fromJsonLd = parseJsonLd(html, category);
    if (fromJsonLd.length > 0) {
      console.log(`[${category}] JSON-LD: ${fromJsonLd.length} events`);
      return fromJsonLd;
    }
    const fromFallback = parseHtmlFallback(html, category);
    console.log(`[${category}] fallback: ${fromFallback.length} events`);
    return fromFallback;
  } catch (err) {
    console.warn(`[${category}] fetch error:`, err.message);
    return [];
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return iso;
  }
}

function buildPriceLabel(offers) {
  if (!offers) return undefined;
  const low  = offers.lowPrice  ?? offers.price;
  const high = offers.highPrice;
  if (low == null) return undefined;
  if (Number(low) === 0) return "Free";
  return high && high !== low ? `₹${low}–₹${high}` : `₹${low} onwards`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Scraping Mumbai events from allevents.in…");

  const batches = await Promise.allSettled(CATEGORY_URLS.map(fetchCategory));

  const seenTitles = new Set();
  const events = [];

  for (const batch of batches) {
    if (batch.status !== "fulfilled") continue;
    for (const ev of batch.value) {
      const key = ev.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 35);
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      events.push(ev);
    }
  }

  // Keep next 60 days of events; keep max 80 total
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 60);
  const filtered = events
    .filter((e) => {
      if (!e.startIso) return true; // no date → keep (might be upcoming)
      const d = new Date(e.startIso);
      return !isNaN(d.getTime()) && d <= cutoff;
    })
    .slice(0, 80);

  const output = {
    fetchedAt: new Date().toISOString(),
    count: filtered.length,
    events: filtered,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${filtered.length} events to data/events-cache.json`);
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
