import { readFileSync } from "fs";
import { join } from "path";
import { EventCategory, PlanEvent } from "./types";
import { scrapeAllEvents } from "./scrapers/allevents";

const KEY = process.env.SERP_API_KEY;

export function hasEventsKey(): boolean {
  return !!KEY;
}

// Deduplicate events by normalized title prefix
function dedup(events: PlanEvent[]): PlanEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const k = e.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── SerpAPI google_events (multiple category queries in parallel) ──────────

const SERP_CATEGORIES: { q: string; category: EventCategory }[] = [
  { q: "music concerts live shows Mumbai", category: "music" },
  { q: "comedy standup shows Mumbai", category: "comedy" },
  { q: "theatre drama plays Mumbai", category: "theatre" },
  { q: "art exhibitions workshops Mumbai", category: "art" },
  { q: "food festivals dining events Mumbai", category: "food" },
  { q: "film screenings cinema events Mumbai", category: "film" },
];

// Best-effort parse of SerpAPI "when" strings like "Thursday, Jul 10, 8:30 PM"
// or date ranges like "Jul 18 – Jul 20" into an ISO date string.
function parseWhenIso(when?: string): string | undefined {
  if (!when) return undefined;
  // For date ranges take only the start portion (before en/em dash or " - ")
  const firstPart = when.split(/\s*[–—]\s*|\s+-\s+/)[0];
  const m = firstPart.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2})/i);
  if (!m) return undefined;
  const year = new Date().getFullYear();
  const d = new Date(`${m[1]} ${m[2]} ${year}`);
  if (isNaN(d.getTime())) return undefined;
  // If the date is more than 60 days in the past, assume next year.
  if (d.getTime() < Date.now() - 60 * 24 * 3600 * 1000) d.setFullYear(year + 1);
  return d.toISOString();
}

async function fetchSerpCategory(
  q: string,
  category: EventCategory,
): Promise<PlanEvent[]> {
  if (!KEY) return [];
  try {
    const url = `https://serpapi.com/search.json?engine=google_events&q=${encodeURIComponent(q)}&hl=en&gl=in&api_key=${KEY}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = await r.json().catch(() => ({} as any));
    if (data?.error) return [];

    const items: PlanEvent[] = (data?.events_results ?? []).map((e: any): PlanEvent => {
      const priceMatch = (e.description ?? "").match(/₹\s*(\d[\d,]*)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : undefined;
      const when = e.date?.when ?? e.date?.start_date;
      return {
        title: e.title,
        when,
        startIso: parseWhenIso(when),
        venue: e.venue?.name ?? (Array.isArray(e.address) ? e.address[0] : undefined),
        address: Array.isArray(e.address) ? e.address.join(", ") : e.address,
        link: e.link,
        // Strip attendee-profile thumbnails (allevents CDN pattern for attendee photos).
        thumbnail: e.thumbnail && !String(e.thumbnail).includes("attendeethumb") ? e.thumbnail : undefined,
        price,
        priceLabel: price != null ? (price === 0 ? "Free" : `₹${price} onwards`) : undefined,
        category,
        source: "serp",
      };
    }).filter((e: PlanEvent) => e.title);

    return items.slice(0, 8);
  } catch (e) {
    console.warn("[events] SerpAPI error:", e);
    return [];
  }
}

async function searchSerpAll(): Promise<PlanEvent[]> {
  const results = await Promise.allSettled(
    SERP_CATEGORIES.map(({ q, category }) =>
      fetchSerpCategory(q, category)
    )
  );
  return results
    .filter((r): r is PromiseFulfilledResult<PlanEvent[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

// ── Public API ────────────────────────────────────────────────────────────────

// Module-level cache (warm across requests within the same serverless instance)
let cachedEvents: PlanEvent[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// GitHub Actions commits data/events-cache.json daily with fresh scraped data.
// We prefer that as the primary source (rich allevents data with prices).
// SerpAPI is the fallback/supplement (always live, good for the outing date).
function loadFileCache(): PlanEvent[] {
  try {
    const cachePath = join(process.cwd(), "data", "events-cache.json");
    const raw = readFileSync(cachePath, "utf-8");
    const cache = JSON.parse(raw) as { fetchedAt: string; events: PlanEvent[] };
    if (Array.isArray(cache.events) && cache.events.length > 0) {
      const age = Date.now() - new Date(cache.fetchedAt).getTime();
      console.log(`[events] file cache: ${cache.events.length} events (${Math.round(age / 3600000)}h old)`);
      return cache.events;
    }
  } catch (e) {
    console.warn("[events] file cache read failed:", (e as Error).message);
  }
  return [];
}

export async function searchEvents(
  _q: string,
  dateISO?: string
): Promise<PlanEvent[]> {
  const now = Date.now();

  if (!cachedEvents || now - cacheTime > CACHE_TTL_MS) {
    const fileEvents = loadFileCache();
    const [serpResult, liveResult] = await Promise.allSettled([
      searchSerpAll(),
      scrapeAllEvents(),
    ]);
    const serp    = serpResult.status  === "fulfilled" ? serpResult.value  : [];
    const scraped = liveResult.status === "fulfilled" ? liveResult.value : [];

    // Merge: serp first (date-parsed, most reliable), then live scrape, then file cache.
    // Dedup by title so the serp version wins when the same event appears in multiple sources.
    cachedEvents = dedup([...serp, ...scraped, ...fileEvents]);
    cacheTime = now;
    console.log(
      `[events] refreshed: ${serp.length} serp + ${scraped.length} live + ${fileEvents.length} file = ${cachedEvents.length} deduped`
    );
  }

  if (dateISO) {
    const outingMs = new Date(dateISO + "T00:00:00").getTime();
    const dayMs    = 24 * 60 * 60 * 1000;
    const md       = new Date(dateISO + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

    // Events explicitly on or within ±1 day of the outing date.
    const onDay = cachedEvents.filter((e) => {
      if (e.startIso) {
        const evMs = new Date(e.startIso).getTime();
        return Math.abs(evMs - outingMs) <= dayMs;
      }
      return (e.when ?? "").includes(md);
    });

    if (onDay.length >= 2) return dedup(onDay).slice(0, 12);

    // Fallback: show upcoming events within 30 days (or undated events when
    // the cache has no date info yet) so the section is never blank.
    const upcoming = cachedEvents.filter((e) => {
      if (!e.startIso) return true; // undated → always show in fallback
      const evMs = new Date(e.startIso).getTime();
      return evMs >= outingMs - dayMs && evMs <= outingMs + 30 * dayMs;
    });

    // Sort: dated events first (closer date = higher priority), undated last.
    const merged = dedup([...onDay, ...upcoming]);
    merged.sort((a, b) => {
      if (a.startIso && b.startIso) return new Date(a.startIso).getTime() - new Date(b.startIso).getTime();
      if (a.startIso) return -1;
      if (b.startIso) return 1;
      return 0;
    });
    return merged.slice(0, 12);
  }

  return cachedEvents.slice(0, 12);
}
