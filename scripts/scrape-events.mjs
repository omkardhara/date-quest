/**
 * GitHub Actions event scraper — three sources:
 *   1. BookMyShow  (Playwright, full dates + prices)
 *   2. allevents.in listing  (plain fetch → HTML fallback → links only)
 *   3. allevents.in detail enrichment  (fetch each event page for JSON-LD dates)
 *
 * Run:  node scripts/scrape-events.mjs
 * Requires Node 18+.  Playwright is installed in CI via the workflow.
 */

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT        = join(__dirname, "../data/events-cache.json");
const MOVIES_OUTPUT = join(__dirname, "../data/movies-cache.json");

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
    });
  } catch { return iso; }
}

function buildPriceLabel(low, high) {
  if (low == null) return undefined;
  const lo = Math.round(parseFloat(String(low)));
  if (lo === 0 || isNaN(lo)) return lo === 0 ? "Free" : undefined;
  const hi = high != null ? Math.round(parseFloat(String(high))) : undefined;
  return hi && hi !== lo ? `₹${lo}–₹${hi}` : `₹${lo} onwards`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 1. BookMyShow via Playwright ─────────────────────────────────────────────

const BMS_CATEGORY_MAP = {
  "music": "music", "concert": "music", "live music": "music",
  "comedy": "comedy", "stand-up": "comedy",
  "theatre": "theatre", "theater": "theatre", "play": "theatre",
  "art": "art", "exhibition": "art", "workshop": "art",
  "food": "food", "festival": "food",
  "film": "film", "screening": "film",
};

function guessBmsCategory(title = "", tags = []) {
  const text = (title + " " + tags.join(" ")).toLowerCase();
  for (const [kw, cat] of Object.entries(BMS_CATEGORY_MAP)) {
    if (text.includes(kw)) return cat;
  }
  return "other";
}

async function scrapeBMS() {
  let pw;
  try { pw = await import("playwright"); }
  catch { console.warn("[bms] playwright not installed — skipping"); return { events: [], movies: [] }; }

  console.log("[bms] launching Chromium…");
  const browser = await pw.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-IN",
    extraHTTPHeaders: { "Accept-Language": "en-IN,en;q=0.9" },
  });

  const page = await ctx.newPage();

  // Capture BMS API JSON responses — events listing AND movies listing
  const captured = [];
  const capturedMovies = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("bookmyshow.com")) return;
    const ct = resp.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const json = await resp.json();
      if (json?.EventsListData || json?.BookMyShow || json?.EventList || json?.events) {
        captured.push(json);
      }
      // Movie API responses — BMS uses various field names; be permissive
      const firstRow = Array.isArray(json) ? json[0] : (json?.Rows?.[0] ?? json?.data?.[0] ?? json?.results?.[0]);
      const hasMovieKey = (o) => o && typeof o === "object" &&
        (o.MovieName || o.filmName || o.ContentName || o.Title || o.MasterImage || o.MediaURL || o.MovieURL);
      if (json?.MovieList || json?.FilmGrid || json?.Films || json?.filmList ||
          json?.ContentList || hasMovieKey(firstRow)) {
        capturedMovies.push(json);
      }
    } catch { /* ignore non-JSON */ }
  });

  const events = [];
  const movies = [];
  let moviesDebug = null;

  try {
    await page.goto("https://in.bookmyshow.com/explore/events-mumbai", {
      waitUntil: "domcontentloaded", timeout: 60_000,
    });

    // Give JS time to render cards
    await sleep(5000);

    // Scroll to trigger lazy-loading so image src attributes are populated
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Try __NEXT_DATA__ first (reliable structured data from SSR)
    const fromNextData = await page.evaluate(() => {
      try {
        const nd = window.__NEXT_DATA__;
        if (!nd) return [];
        const str = JSON.stringify(nd);
        // Pull all objects that look like event cards
        const matches = [];
        const walk = (obj) => {
          if (!obj || typeof obj !== "object") return;
          if (obj.EventTitle || obj.EventName || obj.eventName) {
            matches.push(obj);
            return;
          }
          for (const v of Object.values(obj)) walk(v);
        };
        walk(nd.props ?? nd);
        return matches.slice(0, 60);
      } catch { return []; }
    });

    if (fromNextData.length > 0) {
      console.log(`[bms] __NEXT_DATA__ → ${fromNextData.length} raw items`);
      for (const item of fromNextData) {
        const title = item.EventTitle ?? item.EventName ?? item.eventName ?? "";
        if (!title) continue;
        const dateStr = item.ShowDates ?? item.EventDate ?? item.startDate ?? item.Date ?? "";
        const startIso = dateStr ? new Date(dateStr).toISOString() : undefined;
        const price = parseFloat(item.MinCost ?? item.Price ?? item.minPrice ?? "") || undefined;
        events.push({
          title: title.trim(),
          when: startIso ? formatDate(startIso) : dateStr || undefined,
          startIso: startIso && !isNaN(new Date(startIso).getTime()) ? startIso : undefined,
          venue: (item.VenueName ?? item.Venue ?? item.venue ?? "").trim() || undefined,
          link: item.EventURL ?? item.url ?? undefined,
          thumbnail: item.CoverImage ?? item.Image ?? item.thumbnail ?? undefined,
          price: isNaN(price) ? undefined : price,
          priceLabel: price != null && !isNaN(price) ? buildPriceLabel(price, undefined) : undefined,
          category: guessBmsCategory(title, item.Tags ?? []),
          source: "bms",
        });
      }
    }

    // DOM extraction fallback
    if (events.length < 5) {
      console.log("[bms] trying DOM extraction…");
      const domEvents = await page.evaluate(() => {
        const results = [];
        // BMS typically uses <a> tags wrapping each event card
        const anchors = Array.from(document.querySelectorAll("a[href*='/events/']"));
        for (const a of anchors.slice(0, 40)) {
          const href = a.href;
          // Avoid nav/breadcrumb links
          if (!href.includes("/events/") || href.includes("/explore")) continue;
          const img    = a.querySelector("img");
          const titleEl = a.querySelector("h2, h3, h4, [class*='title'], [class*='name'], [class*='heading']");
          const dateEl  = a.querySelector("[class*='date'], [class*='time'], time");
          const venueEl = a.querySelector("[class*='venue'], [class*='location']");
          const priceEl = a.querySelector("[class*='price'], [class*='cost']");
          const title = titleEl?.textContent?.trim() || img?.alt?.trim() || "";
          if (!title || title.length < 3) continue;
          // Prefer data-src (lazy-load full URL) over src (may be tiny LQIP placeholder).
          // Also check srcset for the full resolution URL.
          const dataSrc = img?.getAttribute("data-src") || undefined;
          const srcset = img?.getAttribute("srcset") || "";
          const srcsetFull = srcset ? (srcset.split(",").pop()?.trim().split(" ")[0] || undefined) : undefined;
          const thumbnail = dataSrc || srcsetFull || img?.src || undefined;
          results.push({
            title,
            link: href,
            thumbnail: thumbnail && thumbnail.length > 30 ? thumbnail : undefined,
            when: dateEl?.textContent?.trim() || undefined,
            venue: venueEl?.textContent?.trim() || undefined,
            priceText: priceEl?.textContent?.trim() || undefined,
          });
        }
        return results;
      });

      for (const item of domEvents) {
        if (events.some(e => e.link === item.link)) continue;
        const priceM = (item.priceText ?? "").match(/[\d,]+/);
        const price  = priceM ? parseInt(priceM[0].replace(/,/g, ""), 10) : undefined;
        events.push({
          title: item.title,
          when: item.when || undefined,
          startIso: undefined, // will be enriched if we fetch the event page
          venue: item.venue || undefined,
          link: item.link,
          thumbnail: item.thumbnail || undefined,
          price,
          priceLabel: buildPriceLabel(price, undefined),
          category: guessBmsCategory(item.title),
          source: "bms",
        });
      }
      console.log(`[bms] DOM → ${events.length} events`);
    }

    // ── Movies listing ── scrape BEFORE detail enrichment so browser isn't flagged by Cloudflare ──
    capturedMovies.length = 0;
    const allMoviesPageResponses = [];
    const moviesPageHandler = async (resp) => {
      if (!resp.url().includes("bookmyshow.com")) return;
      if (!(resp.headers()["content-type"] ?? "").includes("json")) return;
      try {
        const j = await resp.json();
        allMoviesPageResponses.push({ url: resp.url().slice(0, 120), keys: Object.keys(j ?? {}).slice(0, 10) });
        if (Array.isArray(j) && j.length > 0) capturedMovies.push({ _arr: j });
        else capturedMovies.push(j);
      } catch {}
    };
    page.on("response", moviesPageHandler);
    console.log("[bms-movies] navigating to movies page…");
    await page.goto("https://in.bookmyshow.com/explore/movies-mumbai", {
      waitUntil: "load", timeout: 60_000,
    });
    await sleep(5000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    page.off("response", moviesPageHandler);

    function parseMovieItem(m) {
      const title = m.MovieName ?? m.filmName ?? m.ContentName ?? m.Title ?? m.title ?? "";
      if (!title || title.length < 2) return null;
      const genreRaw = m.Genres ?? m.Genre ?? m.genre ?? m.Categories ?? "";
      const genre = Array.isArray(genreRaw) ? genreRaw.join(", ") : (genreRaw ?? "");
      const poster = m.MasterImage ?? m.Poster ?? m.posterImage ?? m.ImageURL ?? m.image ?? m.MediaURL ?? "";
      const link = m.MovieURL ?? m.ContentURL ?? m.url ?? m.link ?? "";
      return {
        title: title.trim(),
        genre: genre.trim() || undefined,
        language: (m.Language ?? m.language ?? "").trim() || undefined,
        poster: poster && String(poster).startsWith("http") && poster.length > 30 ? poster : undefined,
        link: link || undefined,
      };
    }

    const pageDebug = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href*='/movie']"));
      return {
        title: document.title,
        url: window.location.href,
        totalAnchors: document.querySelectorAll("a").length,
        movieAnchors: anchors.length,
        sampleHrefs: anchors.slice(0, 5).map(a => a.href),
        bodySnippet: document.body?.innerText?.slice(0, 300),
        nextDataKeys: window.__NEXT_DATA__ ? Object.keys(window.__NEXT_DATA__) : [],
      };
    });
    console.log("[bms-movies] page debug:", JSON.stringify(pageDebug));
    console.log(`[bms-movies] captured ${capturedMovies.length} JSON responses`);

    if (capturedMovies.length > 0) {
      for (const json of capturedMovies) {
        const sources = [
          json?._arr, json, json?.MovieList, json?.FilmGrid, json?.Films, json?.filmList,
          json?.ContentList, json?.Rows, json?.data, json?.results, json?.items,
        ];
        for (const src of sources) {
          if (!src) continue;
          const items = Array.isArray(src) ? src : [src];
          for (const item of items) {
            if (!item || typeof item !== "object") continue;
            const parsed = parseMovieItem(item);
            if (parsed && !movies.some(m => m.title === parsed.title)) movies.push(parsed);
          }
        }
      }
      console.log(`[bms-movies] from network: ${movies.length} movies`);
    }
    const responseKeySample = allMoviesPageResponses.slice(0, 15);

    if (movies.length === 0) {
      const ndMovies = await page.evaluate(() => {
        try {
          const nd = window.__NEXT_DATA__;
          if (!nd) return [];
          const matches = [];
          const walk = (obj, depth = 0) => {
            if (!obj || typeof obj !== "object" || depth > 20) return;
            if (Array.isArray(obj)) {
              const first = obj[0];
              if (first && typeof first === "object" &&
                  (first.MovieName || first.filmName || first.ContentName || first.Title)) {
                matches.push(...obj.slice(0, 40));
                return;
              }
              for (const item of obj) walk(item, depth + 1);
              return;
            }
            if (obj.MovieName || obj.filmName || obj.ContentName) { matches.push(obj); return; }
            for (const v of Object.values(obj)) walk(v, depth + 1);
          };
          walk(nd.props ?? nd);
          return matches.slice(0, 40);
        } catch { return []; }
      });
      console.log(`[bms-movies] __NEXT_DATA__ walk → ${ndMovies.length} raw`);
      for (const m of ndMovies) {
        const parsed = parseMovieItem(m);
        if (parsed && !movies.some(x => x.title === parsed.title)) movies.push(parsed);
      }
    }

    if (movies.length === 0) {
      console.log("[bms-movies] trying DOM fallback…");
      const domMovies = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll(
          "a[href*='/movies/mumbai/'], a[href*='/movies/'], a[href*='/film/']"
        ));
        const seen = new Set();
        return anchors.slice(0, 50).reduce((acc, a) => {
          const href = a.href;
          if (seen.has(href) || !href.match(/\/movies?\//)) return acc;
          seen.add(href);
          const img     = a.querySelector("img");
          const titleEl = a.querySelector("h2,h3,h4,[class*='title'],[class*='name'],[class*='film']");
          const genreEl = a.querySelector("[class*='genre'],[class*='tag'],[class*='categor']");
          const langEl  = a.querySelector("[class*='lang']");
          const title   = titleEl?.textContent?.trim() || img?.alt?.trim() || "";
          if (!title || title.length < 2) return acc;
          const dataSrc = img?.getAttribute("data-src") || undefined;
          const srcset  = (img?.getAttribute("srcset") ?? "").split(",").pop()?.trim().split(" ")[0];
          const poster  = dataSrc || (srcset?.startsWith("http") ? srcset : undefined) || img?.src || "";
          acc.push({ title, genre: genreEl?.textContent?.trim() || "", language: langEl?.textContent?.trim() || "", poster, link: href });
          return acc;
        }, []);
      });
      for (const m of domMovies) {
        const parsed = parseMovieItem(m);
        if (parsed && !movies.some(x => x.title === parsed.title)) movies.push(parsed);
      }
      console.log(`[bms-movies] DOM → ${movies.length} movies`);
    }

    console.log(`[bms-movies] collected ${movies.length} movies total`);
    moviesDebug = { pageDebug, responseKeySample };

    // Playwright detail-page enrichment: visit each event page to extract dates/prices.
    // Uses waitUntil:"load" so React fully hydrates before we read JSON-LD / __NEXT_DATA__.
    const toEnrich = events.filter(e => !e.startIso && e.link).slice(0, 15);
    if (toEnrich.length > 0) {
      console.log(`[bms] enriching ${toEnrich.length} events via detail pages…`);
      for (const ev of toEnrich) {
        try {
          await sleep(600);
          // Capture per-page API responses that contain event detail data
          const pageResponses = [];
          const handler = async (resp) => {
            if (!resp.url().includes("bookmyshow.com")) return;
            if (!(resp.headers()["content-type"] ?? "").includes("json")) return;
            try {
              const j = await resp.json();
              if (j?.EventCode || j?.ShowDetails || j?.startDate || j?.EventDetails) pageResponses.push(j);
            } catch {}
          };
          page.on("response", handler);
          await page.goto(ev.link, { waitUntil: "load", timeout: 35_000 });
          await sleep(3000);
          page.off("response", handler);

          const detail = await page.evaluate(() => {
            // 1. JSON-LD (best source — has startDate, offers, location)
            try {
              for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
                const json = JSON.parse(s.textContent ?? "");
                if (String(json["@type"] ?? "").match(/Event/i)) return { _src: "ld", ...json };
              }
            } catch {}
            // 2. __NEXT_DATA__ regex scan
            try {
              const nd = window.__NEXT_DATA__;
              if (!nd) return null;
              const str = JSON.stringify(nd);
              const dateM  = str.match(/"startDate"\s*:\s*"([^"]+)"/);
              if (!dateM) return null;
              const priceM = str.match(/"(?:minPrice|MinCost|Price|lowPrice)"\s*:\s*"?(\d[\d.]*)"?/);
              const highM  = str.match(/"(?:maxPrice|highPrice|MaxCost)"\s*:\s*"?(\d[\d.]*)"?/);
              const venueM = str.match(/"(?:VenueName|venueName|venue_name|name)"\s*:\s*"([^"]{3,80})"/);
              const imgM   = str.match(/"(?:CoverImage|EventImage|masterImage|image)"\s*:\s*"(https:\\?\/\\?\/[^"]+\.(?:jpg|jpeg|png|webp))"/);
              return {
                _src: "nd",
                startDate: dateM[1],
                offers: priceM ? [{ "@type": "AggregateOffer", lowPrice: priceM[1], highPrice: highM?.[1] }] : undefined,
                location: venueM ? { name: venueM[1] } : undefined,
                image: imgM ? imgM[1].replace(/\\\//g, "/") : undefined,
              };
            } catch {}
            return null;
          });

          if (!detail) { console.log(`  [bms-detail] ${ev.title.slice(0,40)}: no data`); continue; }
          const start     = detail.startDate ?? detail.startTime;
          const offersRaw = detail.offers;
          const offerObj  = Array.isArray(offersRaw)
            ? (offersRaw.find(o => o["@type"] === "AggregateOffer") ?? offersRaw[0])
            : offersRaw;
          const low = offerObj?.lowPrice ?? offerObj?.price;
          const high = offerObj?.highPrice;
          if (start) { ev.startIso = new Date(start).toISOString(); ev.when = formatDate(ev.startIso); }
          if (low != null) { ev.price = Math.round(parseFloat(low)); ev.priceLabel = buildPriceLabel(low, high); }
          if (detail.location?.name) ev.venue = detail.location.name.trim();
          const img = Array.isArray(detail.image) ? detail.image[0] : detail.image;
          if (img && String(img).startsWith("http") && String(img).length > 30) ev.thumbnail = String(img);
          console.log(`  [bms-detail:${detail._src}] ${ev.title.slice(0,40)} → ${ev.startIso ?? "(no date)"}`);
        } catch(err) { console.warn(`  [bms-detail] ${ev.title.slice(0,30)}: ${err.message}`); }
      }
    }

  } catch (err) {
    console.warn("[bms] scrape error:", err.message);
  } finally {
    await browser.close();
  }

  return { events, movies, _moviesDebug: moviesDebug };
}

// ─── BMS detail-page JSON-LD parser ──────────────────────────────────────────
// BMS uses Next.js SSR so detail pages return JSON-LD in the initial HTML.

function bmsParseJsonLd(html) {
  const rx = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    try {
      const json = JSON.parse(m[1]);
      if (!(json["@type"] ?? "").match(/Event/i)) continue;
      const start     = json.startDate ?? json.startTime ?? "";
      const offersRaw = json.offers;
      const offerObj  = Array.isArray(offersRaw)
        ? (offersRaw.find(o => o["@type"] === "AggregateOffer") ?? offersRaw[0])
        : offersRaw;
      const low   = offerObj?.lowPrice ?? offerObj?.price;
      const high  = offerObj?.highPrice;
      const price = low != null ? parseFloat(String(low)) : undefined;
      const img   = Array.isArray(json.image) ? json.image[0] : json.image;
      return {
        startIso: start ? new Date(start).toISOString() : undefined,
        when: start ? formatDate(start) : undefined,
        venue: json.location?.name?.trim() || undefined,
        address: json.location?.address?.streetAddress?.trim() || undefined,
        price: price != null && !isNaN(price) ? price : undefined,
        priceLabel: buildPriceLabel(low, high),
        thumbnail: (typeof img === "string" && img.startsWith("http")) ? img : undefined,
      };
    } catch { /* skip malformed */ }
  }
  return null;
}

// ─── 2. allevents.in listing (plain fetch) ────────────────────────────────────

const AE_BASE = "https://allevents.in/mumbai";
const AE_CATEGORIES = [
  { url: `${AE_BASE}/music`,           category: "music"   },
  { url: `${AE_BASE}/comedy`,          category: "comedy"  },
  { url: `${AE_BASE}/theatre`,         category: "theatre" },
  { url: `${AE_BASE}/art`,             category: "art"     },
  { url: `${AE_BASE}/food-and-drinks`, category: "food"    },
  { url: `${AE_BASE}/film`,            category: "film"    },
  { url: `${AE_BASE}/all`,             category: "other"   },
];

const AE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};

const BMS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
  "Referer": "https://in.bookmyshow.com/explore/events-mumbai",
};

function aeParseJsonLd(html, category) {
  const results = [];
  const rx = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    try {
      const json = JSON.parse(m[1]);
      const items = json["@type"] === "ItemList"
        ? (json.itemListElement ?? []).map(e => e.item ?? e)
        : (json["@type"] ?? "").match(/Event/) ? [json] : [];
      for (const ev of items) {
        if (!ev?.name) continue;
        const start = ev.startDate ?? ev.startTime ?? "";
        // offers may be a single object or an array; prefer AggregateOffer for price range
        const offersRaw = ev.offers;
        const offerObj  = Array.isArray(offersRaw)
          ? (offersRaw.find(o => o["@type"] === "AggregateOffer") ?? offersRaw[0])
          : offersRaw;
        const low   = offerObj?.lowPrice ?? offerObj?.price;
        const high  = offerObj?.highPrice;
        const price = low != null ? parseFloat(String(low)) : undefined;
        results.push({
          title: ev.name.trim(),
          when: start ? formatDate(start) : undefined,
          startIso: start ? new Date(start).toISOString() : undefined,
          venue: ev.location?.name?.trim(),
          address: ev.location?.address?.streetAddress?.trim(),
          link: ev.url,
          thumbnail: Array.isArray(ev.image) ? ev.image[0] : ev.image,
          price: price != null && !isNaN(price) ? price : undefined,
          priceLabel: buildPriceLabel(low, high),
          category,
          source: "allevents",
        });
      }
    } catch { /* skip malformed block */ }
  }
  return results;
}

function aeParseHtmlFallback(html, category) {
  const results = [];
  const seen = new Set();
  const linkRx = /href="(https:\/\/allevents\.in\/mumbai\/[^/"?\s]+\/\d+)"/gi;
  const imgRx  = /(?:src|data-src)="(https?:\/\/[^"]+(?:allevents\.in|cdn-az\.allevents|cdn-ip\.allevents)[^"]+)"/gi;
  const imgs   = [...html.matchAll(imgRx)].map(m => m[1]).filter(u => /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(u));
  let imgIdx = 0, m;
  while ((m = linkRx.exec(html)) !== null) {
    const link = m[1];
    if (seen.has(link)) continue;
    seen.add(link);
    const slug  = link.split("/").slice(-2, -1)[0] ?? "";
    const title = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    if (title.length < 5) continue;
    results.push({ title, link, thumbnail: imgs[imgIdx++], category, source: "allevents" });
  }
  return results;
}

async function fetchAeCategory({ url, category }) {
  try {
    const res = await fetch(url, { headers: AE_HEADERS });
    if (!res.ok) { console.warn(`[ae] ${res.status} ${url}`); return []; }
    const html  = await res.text();
    const fromLd = aeParseJsonLd(html, category);
    if (fromLd.length > 0) { console.log(`[ae:${category}] JSON-LD: ${fromLd.length}`); return fromLd; }
    const fromFb = aeParseHtmlFallback(html, category);
    console.log(`[ae:${category}] fallback: ${fromFb.length}`);
    return fromFb;
  } catch (err) {
    console.warn(`[ae:${category}] error:`, err.message);
    return [];
  }
}

// ─── 3. allevents detail-page enrichment ──────────────────────────────────────
// Fetches each undated allevents event's own page to extract JSON-LD date + price.
// BMS enrichment is handled in-browser by scrapeBMS() (plain fetch returns 403).
// Capped at MAX_ENRICH to stay within GitHub Actions time limits.

const MAX_ENRICH = 40;

async function enrichWithDetails(events) {
  const undated = events.filter(e => !e.startIso && e.link && e.source === "allevents");
  const toEnrich = undated.slice(0, MAX_ENRICH);
  if (toEnrich.length === 0) return events;
  console.log(`[enrich] fetching ${toEnrich.length} allevents detail pages…`);

  for (const ev of toEnrich) {
    try {
      await sleep(300);
      const res = await fetch(ev.link, { headers: AE_HEADERS });
      if (!res.ok) continue;
      const html   = await res.text();
      const parsed = aeParseJsonLd(html, ev.category);
      const detail = parsed[0];
      if (!detail) continue;
      if (detail.startIso)      { ev.startIso = detail.startIso; ev.when = detail.when; }
      if (detail.price != null) { ev.price = detail.price; ev.priceLabel = detail.priceLabel; }
      if (detail.venue)         ev.venue    = detail.venue;
      if (detail.address)       ev.address  = detail.address;
      console.log(`   [ae] ${ev.title.slice(0, 50)} → ${ev.startIso ?? "(no date)"}`);
    } catch { /* skip on network error */ }
  }

  return events;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Date Quest event scraper ===\n");

  // Run BMS and allevents listing in parallel
  const [bmsResult, aeResults] = await Promise.allSettled([
    scrapeBMS(),
    Promise.allSettled(AE_CATEGORIES.map(fetchAeCategory)),
  ]);

  const bmsData   = bmsResult.status === "fulfilled" ? bmsResult.value : { events: [], movies: [] };
  const bmsEvents = bmsData.events ?? [];
  const bmsMovies = bmsData.movies ?? [];
  console.log(`[bms] collected ${bmsEvents.length} events, ${bmsMovies.length} movies`);

  const aeRaw = [];
  if (aeResults.status === "fulfilled") {
    const seenTitles = new Set();
    for (const b of aeResults.value) {
      if (b.status !== "fulfilled") continue;
      for (const ev of b.value) {
        const key = ev.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 35);
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);
        aeRaw.push(ev);
      }
    }
  }
  console.log(`[ae] collected ${aeRaw.length} events`);

  // Merge first (BMS first so it wins on dedup), then enrich the combined array
  const seenTitles = new Set();
  const merged = [];
  for (const ev of [...bmsEvents, ...aeRaw]) {
    const key = ev.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 35);
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    merged.push(ev);
  }

  // Enrich undated BMS + allevents events with detail-page JSON-LD
  const all = await enrichWithDetails(merged);

  // Keep upcoming 90 days; keep undated events (may be ongoing); cap at 100
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 90);
  const events = all
    .filter(e => {
      if (!e.startIso) return true;
      const d = new Date(e.startIso);
      return !isNaN(d.getTime()) && d <= cutoff;
    })
    .slice(0, 100);

  const dated = events.filter(e => e.startIso).length;
  console.log(`\nTotal: ${events.length} events (${dated} with dates, ${events.length - dated} undated)`);

  writeFileSync(OUTPUT, JSON.stringify({ fetchedAt: new Date().toISOString(), count: events.length, events }, null, 2));
  console.log(`Wrote → data/events-cache.json`);

  writeFileSync(MOVIES_OUTPUT, JSON.stringify({ fetchedAt: new Date().toISOString(), count: bmsMovies.length, movies: bmsMovies, _debug: bmsData._moviesDebug ?? null }, null, 2));
  console.log(`Wrote → data/movies-cache.json (${bmsMovies.length} movies)`);
}

main().catch(err => { console.error("Scrape failed:", err); process.exit(1); });
