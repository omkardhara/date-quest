import { PlanEvent } from "./types";

const KEY = process.env.SERP_API_KEY;

export function hasEventsKey(): boolean {
  return !!KEY;
}

const cache = new Map<string, PlanEvent[]>();

// Live, structured events in Mumbai via SerpAPI's Google Events engine, narrowed
// to the outing date when possible. Returns [] gracefully if key missing/invalid.
export async function searchEvents(q: string, dateISO?: string): Promise<PlanEvent[]> {
  if (!KEY) return [];
  const cacheKey = `${q}|${dateISO ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  try {
    const url = `https://serpapi.com/search.json?engine=google_events&q=${encodeURIComponent(q)}&hl=en&gl=in&api_key=${KEY}`;
    const r = await fetch(url);
    const data = await r.json().catch(() => ({} as any));
    if (!r.ok || data?.error) {
      console.warn("[events] SerpAPI", r.status, data?.error ?? "");
      cache.set(cacheKey, []);
      return [];
    }

    let items: (PlanEvent & { startDate?: string })[] = (data?.events_results ?? []).map((e: any) => ({
      title: e.title,
      when: e.date?.when ?? e.date?.start_date,
      startDate: e.date?.start_date,
      venue: e.venue?.name ?? (Array.isArray(e.address) ? e.address[0] : undefined),
      address: Array.isArray(e.address) ? e.address.join(", ") : e.address,
      link: e.link,
      thumbnail: e.thumbnail,
    })).filter((e: PlanEvent) => e.title);

    // Narrow to the outing date (e.g. "Jul 8") if any match; otherwise keep all upcoming.
    if (dateISO) {
      const d = new Date(dateISO + "T00:00:00");
      const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); // "Jul 8"
      const onDay = items.filter(it => (it.when ?? "").includes(md) || (it.startDate ?? "").includes(md));
      if (onDay.length) items = onDay;
    }

    const out: PlanEvent[] = items.slice(0, 6).map(({ startDate, ...rest }) => rest);
    cache.set(cacheKey, out);
    return out;
  } catch (e) {
    console.warn("[events] SerpAPI error", e);
    return [];
  }
}
