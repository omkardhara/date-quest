import { EventCategory, PlanEvent } from "../types";

const BASE = "https://allevents.in/mumbai";

const CATEGORY_URLS: { url: string; category: EventCategory }[] = [
  { url: `${BASE}/music`, category: "music" },
  { url: `${BASE}/comedy`, category: "comedy" },
  { url: `${BASE}/theatre`, category: "theatre" },
  { url: `${BASE}/art`, category: "art" },
  { url: `${BASE}/food-and-drinks`, category: "food" },
  { url: `${BASE}/film`, category: "film" },
];

const SCRAPER_KEY = process.env.SCRAPER_API_KEY;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};

// Route through ScraperAPI (residential IPs) when key is available,
// otherwise attempt a direct fetch (works locally, may 403 on Vercel DCs).
function buildFetchUrl(targetUrl: string): { url: string; headers: Record<string, string> } {
  if (SCRAPER_KEY) {
    return {
      url: `https://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(targetUrl)}&country_code=in`,
      headers: {},
    };
  }
  return { url: targetUrl, headers: HEADERS };
}

// Tries to parse the JSON-LD array embedded in the listing-page HTML.
// allevents.in injects one <script type="application/ld+json"> per page
// containing an ItemList of Event objects.
function parseJsonLd(html: string, category: EventCategory): PlanEvent[] {
  const results: PlanEvent[] = [];
  const scriptRx = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRx.exec(html)) !== null) {
    try {
      const json = JSON.parse(m[1]);
      const items: any[] =
        json["@type"] === "ItemList"
          ? json.itemListElement?.map((e: any) => e.item ?? e) ?? []
          : json["@type"]?.includes("Event")
          ? [json]
          : [];
      for (const ev of items) {
        if (!ev?.name) continue;
        const start = ev.startDate ?? ev.startTime ?? "";
        const priceSpec = ev.offers?.lowPrice ?? ev.offers?.price;
        const price = priceSpec ? parseFloat(String(priceSpec)) : undefined;
        results.push({
          title: ev.name,
          when: start ? formatDate(start) : undefined,
          venue: ev.location?.name,
          address: ev.location?.address?.streetAddress,
          link: ev.url,
          thumbnail: Array.isArray(ev.image) ? ev.image[0] : ev.image,
          price: isNaN(price!) ? undefined : price,
          priceLabel: buildPriceLabel(ev.offers),
          category,
          source: "allevents",
        });
      }
    } catch {
      // malformed JSON block, skip
    }
  }
  return results;
}

// Regex fallback: pulls event links + thumbnails from HTML anchor patterns.
// allevents.in uses href="/mumbai/[slug]/[numeric-id]" on event cards.
function parseHtmlFallback(html: string, category: EventCategory): PlanEvent[] {
  const results: PlanEvent[] = [];
  const seen = new Set<string>();

  // Match event card anchors then nearby src/data-src image
  const cardRx =
    /href="(https:\/\/allevents\.in\/mumbai\/[^/"\s]+\/\d+)"[^>]*>[\s\S]{0,800}?(?:src|data-src)="(https?:\/\/cdn[^"]+allevents\.in[^"]+?\.(?:jpg|jpeg|png|webp|avif)[^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = cardRx.exec(html)) !== null) {
    const link = m[1];
    if (seen.has(link)) continue;
    seen.add(link);

    // Try to pull title from surrounding context (nearest alt text or aria-label)
    const snippet = html.slice(Math.max(0, m.index - 400), m.index + 400);
    const titleM =
      /alt="([^"]{5,120})"|aria-label="([^"]{5,120})"/.exec(snippet);
    const title = titleM ? (titleM[1] ?? titleM[2]) : link.split("/").slice(-2, -1)[0].replace(/-/g, " ");

    results.push({
      title: toTitleCase(title),
      link,
      thumbnail: m[2],
      category,
      source: "allevents",
    });
  }
  return results;
}

async function fetchCategory(
  url: string,
  category: EventCategory
): Promise<PlanEvent[]> {
  try {
    const { url: fetchUrl, headers } = buildFetchUrl(url);
    const res = await fetch(fetchUrl, { headers, next: { revalidate: 3600 } });
    if (!res.ok) {
      console.warn(`[allevents] ${res.status} for ${url}${SCRAPER_KEY ? " (via ScraperAPI)" : " (direct)"}`);
      return [];
    }
    const html = await res.text();
    const fromJsonLd = parseJsonLd(html, category);
    if (fromJsonLd.length > 0) return fromJsonLd;
    return parseHtmlFallback(html, category);
  } catch (e) {
    console.warn(`[allevents] fetch failed for ${url}:`, e);
    return [];
  }
}

export async function scrapeAllEvents(): Promise<PlanEvent[]> {
  const batches = await Promise.allSettled(
    CATEGORY_URLS.map(({ url, category }) => fetchCategory(url, category))
  );

  const all: PlanEvent[] = [];
  const seenTitles = new Set<string>();

  for (const b of batches) {
    if (b.status !== "fulfilled") continue;
    for (const ev of b.value) {
      const key = ev.title.toLowerCase().slice(0, 40);
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      all.push(ev);
    }
  }

  return all.slice(0, 40);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function buildPriceLabel(offers: any): string | undefined {
  if (!offers) return undefined;
  const low = offers.lowPrice ?? offers.price;
  const high = offers.highPrice;
  if (!low) return undefined;
  if (Number(low) === 0) return "Free";
  return high && high !== low ? `₹${low}–₹${high}` : `₹${low} onwards`;
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
