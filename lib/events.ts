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
    const cachePath = join(process.cwd(), "data", "events-cache.json");
    const raw = readFileSync(cachePath, "utf-8");
    const cache = JSON.parse(raw) as { fetchedAt: string; events: PlanEvent[] };
    const age = Date.now() - new Date(cache.fetchedAt).getTime();
    const stale = age > 48 * 60 * 60 * 1000; // >48h old
    if (!stale && Array.isArray(cache.events) && cache.events.length > 0) {
      console.log(`[events] file cache: ${cache.events.length} events (${Math.round(age / 3600000)}h old)`);
      return cache.events;
    }
    console.log(`[events] file cache stale or empty (age=${Math.round(age / 3600000)}h, count=${cache.events?.length ?? 0})`);
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
      searchSerpAll(dateISO),
      scrapeAllEvents(),
    ]);
    const serp   = serpResult.status  === "fulfilled" ? serpResult.value  : [];
    const scraped = liveResult.status === "fulfilled" ? liveResult.value : [];

    // Merge: serp first (date-aware, has concrete dates), then file cache (undated
    // but rich), then live scrape. Dedup by title so the serp version wins when
    // the same event appears in both serp and file cache.
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

    // Events that are explicitly on or within ±1 day of the outing date.
    const onDay = cachedEvents.filter((e) => {
      if (e.startIso) {
        const evMs = new Date(e.startIso).getTime();
        return Math.abs(evMs - outingMs) <= dayMs;
      }
      // Fall back to string match on 'when' field — only match the exact date string.
      return (e.when ?? "").includes(md);
    });

    // Events with no date info at all — safe to show as "upcoming" context.
    const undated = cachedEvents.filter((e) => !e.when && !e.startIso);

    const combined = dedup([...onDay, ...undated]);
    return combined.slice(0, 12);
  }

  return cachedEvents.slice(0, 12);
}
