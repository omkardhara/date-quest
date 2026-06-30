import { EventCategory, PlanEvent } from "./types";
import { scrapeAllEvents } from "./scrapers/allevents";
import eventsCache from "@/data/events-cache.json";

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

async function fetchSerpCategory(
  q: string,
  category: EventCategory,
  dateISO?: string
): Promise<PlanEvent[]> {
  if (!KEY) return [];
  try {
    const url = `https://serpapi.com/search.json?engine=google_events&q=${encodeURIComponent(q)}&hl=en&gl=in&api_key=${KEY}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = await r.json().catch(() => ({} as any));
    if (data?.error) return [];

    let items = (data?.events_results ?? []).map((e: any): PlanEvent => {
      const priceMatch = (e.description ?? "").match(/₹\s*(\d[\d,]*)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : undefined;
      return {
        title: e.title,
        when: e.date?.when ?? e.date?.start_date,
        venue: e.venue?.name ?? (Array.isArray(e.address) ? e.address[0] : undefined),
        address: Array.isArray(e.address) ? e.address.join(", ") : e.address,
        link: e.link,
        thumbnail: e.thumbnail,
        price,
        priceLabel: price != null ? (price === 0 ? "Free" : `₹${price} onwards`) : undefined,
        category,
        source: "serp",
      };
    }).filter((e: PlanEvent) => e.title);

    // Narrow to the outing date if any match
    if (dateISO) {
      const d = new Date(dateISO + "T00:00:00");
      const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const onDay = items.filter((it: PlanEvent) =>
        (it.when ?? "").includes(md)
      );
      if (onDay.length) items = onDay;
    }

    return items.slice(0, 5);
  } catch (e) {
    console.warn("[events] SerpAPI error:", e);
    return [];
  }
}

async function searchSerpAll(dateISO?: string): Promise<PlanEvent[]> {
  const results = await Promise.allSettled(
    SERP_CATEGORIES.map(({ q, category }) =>
      fetchSerpCategory(q, category, dateISO)
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
    const cache = eventsCache as { fetchedAt: string; events: PlanEvent[] };
    const age = Date.now() - new Date(cache.fetchedAt).getTime();
    const stale = age > 48 * 60 * 60 * 1000; // >48h old = consider stale
    if (!stale && cache.events?.length) {
      console.log(`[events] file cache: ${cache.events.length} events (${Math.round(age / 3600000)}h old)`);
      return cache.events as PlanEvent[];
    }
  } catch {
    // malformed or missing cache — fall through
  }
  return [];
}

export async function searchEvents(
  _q: string,
  dateISO?: string
): Promise<PlanEvent[]> {
  const now = Date.now();

  if (!cachedEvents || now - cacheTime > CACHE_TTL_MS) {
    // 1. Load GitHub-Actions-scraped file cache (allevents.in data with prices)
    const fileEvents = loadFileCache();

    // 2. Run SerpAPI multi-category queries (live, date-aware)
    // 3. Try allevents live scrape (only works if not on Vercel datacenter IPs)
    const [serpEvents, liveScraped] = await Promise.allSettled([
      searchSerpAll(dateISO),
      scrapeAllEvents(),
    ]);

    const serp   = serpEvents.status === "fulfilled"  ? serpEvents.value  : [];
    const scraped = liveScraped.status === "fulfilled" ? liveScraped.value : [];

    // File cache first (richest data), then live serp, then live scrape
    cachedEvents = dedup([...fileEvents, ...serp, ...scraped]);
    cacheTime = now;
    console.log(
      `[events] refreshed: ${fileEvents.length} file + ${serp.length} serp + ${scraped.length} live = ${cachedEvents.length} deduped`
    );
  }

  if (dateISO) {
    const d = new Date(dateISO + "T00:00:00");
    const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const onDay = cachedEvents.filter((e) => (e.when ?? "").includes(md));
    return (onDay.length >= 3 ? onDay : cachedEvents).slice(0, 12);
  }

  return cachedEvents.slice(0, 12);
}
