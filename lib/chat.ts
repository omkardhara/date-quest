// Backs the chat assistant: pulls relevant curated places for grounding, live
// web snippets for time-sensitive questions (showtimes, current events), and
// real Google review excerpts for "what to order" style questions (generic
// web search surfaces "10 best X restaurants" listicles for small/niche
// venues rather than anything about the specific place asked about).
import { readFileSync } from "fs";
import { join } from "path";
import { Place } from "./types";
import { searchPlaceReviews } from "./google";

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "to", "of", "in", "on", "at", "for", "what",
  "whats", "best", "when", "time", "year", "visit", "and", "or", "do", "does",
  "can", "you", "your", "about", "tell", "currently", "listed", "near", "how",
]);

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

let _places: Place[] | null = null;
function loadPlaces(): Place[] {
  if (_places) return _places;
  try {
    const raw = readFileSync(join(process.cwd(), "data", "places.json"), "utf-8");
    const parsed = JSON.parse(raw);
    _places = Array.isArray(parsed) ? parsed : [];
  } catch {
    _places = [];
  }
  return _places;
}

export interface PlaceContext {
  name: string;
  area: string;
  category: string;
  summary: string;
  tags?: string[];
  bestTime?: string;
  monsoonRisk?: string;
  safety?: string;
  costPerPerson?: number;
}

// Finds curated places whose name/area/tags overlap with words in the question,
// so the model grounds venue-specific facts in our own data instead of guessing.
export function findRelevantPlaces(message: string, max = 4): PlaceContext[] {
  const qWords = new Set(words(message));
  if (!qWords.size) return [];
  const scored = loadPlaces().map((p) => {
    const hay = words([p.name, p.area, ...(p.tags ?? [])].join(" "));
    const score = hay.reduce((s, w) => s + (qWords.has(w) ? 1 : 0), 0);
    return { p, score };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map(({ p }) => ({
    name: p.name, area: p.area, category: p.category, summary: p.summary,
    tags: p.tags, bestTime: p.bestTime, monsoonRisk: p.monsoonRisk,
    safety: p.safety, costPerPerson: p.costPerPerson,
  }));
}

const SERP_KEY = process.env.SERP_API_KEY;

export interface SearchSnippet { title: string; snippet: string }

const searchCache = new Map<string, { data: SearchSnippet[]; time: number }>();
const SEARCH_TTL_MS = 30 * 60 * 1000;

// Live Google search snippets, for things our curated data can't answer
// (today's movie showtimes, current events, live hours). Best-effort — if the
// key is missing or the call fails, the caller just gets no live context.
export async function liveSearchSnippets(query: string, max = 4): Promise<SearchSnippet[]> {
  if (!SERP_KEY) return [];
  const key = query.toLowerCase().trim();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.time < SEARCH_TTL_MS) return hit.data;

  try {
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&hl=en&gl=in&api_key=${SERP_KEY}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const data = await r.json();

    const results: SearchSnippet[] = (data?.organic_results ?? [])
      .slice(0, max)
      .map((x: any) => ({ title: x.title ?? "", snippet: x.snippet ?? "" }))
      .filter((x: SearchSnippet) => x.title || x.snippet);

    // The answer box (common for showtimes/quick facts) is worth surfacing first.
    const box = data?.answer_box;
    if (box?.snippet || box?.answer) {
      results.unshift({ title: box.title ?? "Quick answer", snippet: box.snippet ?? box.answer });
    }

    searchCache.set(key, { data: results, time: Date.now() });
    return results;
  } catch {
    return [];
  }
}

const FOOD_HINT = /\b(order|dish|dishes|menu|must[- ]try|specialt|what to eat|signature|popular (dish|food|item)|recommend)\b/i;
const OTHER_LIVE_HINT = /\b(movie|movies|showtime|showtimes|now showing|cinema|theatre|theater|showing today|event|events|happening|concert|weather|forecast|rain|open now|open today|hours today|timings today)\b/i;

export function isFoodQuestion(message: string): boolean {
  return FOOD_HINT.test(message);
}

export function needsLiveSearch(message: string): boolean {
  return FOOD_HINT.test(message) || OTHER_LIVE_HINT.test(message);
}

// Question words to strip so what's left is (hopefully) just the venue name,
// e.g. "whats the best 2 things to order in italianoz bandra" -> "italianoz bandra".
const VENUE_QUESTION_WORDS = new Set([
  "the", "a", "an", "is", "are", "to", "of", "in", "on", "at", "for", "what",
  "whats", "best", "top", "good", "great", "things", "thing", "order", "dish",
  "dishes", "menu", "must", "try", "specialty", "specialties", "recommend",
  "recommendation", "recommendations", "popular", "item", "items", "eat",
  "should", "get", "and", "or", "you", "your", "i", "we", "can", "two",
  "three", "one",
]);

function extractVenueQuery(message: string): string {
  return message.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w && !VENUE_QUESTION_WORDS.has(w) && !/^\d+$/.test(w))
    .join(" ").trim();
}

export interface VenueReviews { name: string; rating?: number; userRatings?: number; reviews: string[] }

// Resolves the venue named in a food/menu question via Google Places and
// pulls its recent review text, so the model can point to dishes real
// customers actually mention instead of guessing or refusing to answer.
export async function findVenueReviews(message: string): Promise<VenueReviews | null> {
  const venue = extractVenueQuery(message);
  if (!venue) return null;
  const res = await searchPlaceReviews(`${venue} Mumbai`);
  if (!res.found || !res.reviews?.length) return null;
  return {
    name: res.name!,
    rating: res.rating,
    userRatings: res.userRatings,
    reviews: res.reviews.map((r) => (r.length > 300 ? r.slice(0, 300) + "…" : r)),
  };
}
