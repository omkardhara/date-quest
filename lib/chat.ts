// Backs the chat assistant: pulls relevant curated places for grounding, live
// web snippets for time-sensitive questions (showtimes, current events), and
// real Google review excerpts for "what to order" style questions (generic
// web search surfaces "10 best X restaurants" listicles for small/niche
// venues rather than anything about the specific place asked about).
import { readFileSync } from "fs";
import { join } from "path";
import { Place } from "./types";
import { searchPlaceReviews } from "./google";
import { TRAVEL_BASE } from "./engine";
import { PROFILE } from "./profile";
import travelMatrixData from "@/data/travel-matrix.json";

const TRAVEL_MATRIX = travelMatrixData as Record<string, number>;

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
  distanceKm?: number;
  topDishes?: string[];
}

function toContext(p: Place, distanceKm?: number): PlaceContext {
  return {
    name: p.name, area: p.area, category: p.category, summary: p.summary,
    tags: p.tags, bestTime: p.bestTime, monsoonRisk: p.monsoonRisk,
    safety: p.safety, costPerPerson: p.costPerPerson, topDishes: p.topDishes,
    distanceKm: distanceKm !== undefined ? Math.round(distanceKm * 10) / 10 : undefined,
  };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Scores every curated place by word overlap with the query text (name/area/
// tags vs. question words). Shared by place lookup, travel, and nearby search
// so "which place is this question about" is answered consistently everywhere.
function scorePlaces(text: string): { p: Place; score: number }[] {
  const qWords = new Set(words(text));
  if (!qWords.size) return [];
  const scored = loadPlaces().map((p) => {
    const hay = words([p.name, p.area, ...(p.tags ?? [])].join(" "));
    const score = hay.reduce((s, w) => s + (qWords.has(w) ? 1 : 0), 0);
    return { p, score };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// Finds curated places whose name/area/tags overlap with words in the question,
// so the model grounds venue-specific facts in our own data instead of guessing.
export function findRelevantPlaces(message: string, max = 4): PlaceContext[] {
  return scorePlaces(message).slice(0, max).map(({ p }) => toContext(p));
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
const OTHER_LIVE_HINT = /\b(movie|movies|showtime|showtimes|now showing|cinema|theatre|theater|showing today|event|events|happening|concert|weather|forecast|rain|open now|open today|hours today|timings today|best time (of year|to visit)|when (should|to) visit|which (month|season))\b/i;

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

// ── Travel / "how do I get there" ───────────────────────────────────────────

const TRAVEL_HINT = /\b(reach|get there|get here|travel time|how far|distance|commute|directions?|way to (reach|get)|travel option|how do i get|best way to (reach|get)|transport option|how long (does it|will it) take)\b/i;

export function isTravelQuestion(message: string): boolean {
  return TRAVEL_HINT.test(message);
}

export interface TravelInfo {
  venueName: string;
  venueArea: string;
  homeArea: string;
  mins?: number;
  minsIsExact: boolean; // true = real Google-computed drive time, false = rough zone estimate
  directionsUrl: string;
  transport: typeof PROFILE.transport;
}

// Grounds "how do I get there" questions in the app's own real travel data
// (a precomputed Google Maps drive-time matrix keyed by place id, same data
// the day-plan engine uses) instead of letting the model invent bus numbers
// or made-up transit specifics.
export function travelAdvice(message: string): TravelInfo | null {
  const best = scorePlaces(message)[0];
  if (!best) return null;
  const p = best.p;

  const exact = TRAVEL_MATRIX[`home|${p.id}`];
  const zoneMins = p.zone ? TRAVEL_BASE[["home", p.zone].sort().join("-")] : undefined;
  const mins = exact ?? zoneMins;

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${PROFILE.homeArea}, Mumbai`)}&destination=${encodeURIComponent(`${p.name}, ${p.area}, Mumbai`)}&travelmode=driving`;

  return {
    venueName: p.name,
    venueArea: p.area,
    homeArea: PROFILE.homeArea,
    mins,
    minsIsExact: exact !== undefined,
    directionsUrl,
    transport: PROFILE.transport,
  };
}

// ── "N good <category> places near <venue>" ─────────────────────────────────

const CATEGORY_WORDS: Record<string, Place["category"]> = {
  shopping: "shopping", shop: "shopping", shops: "shopping", boutique: "shopping", boutiques: "shopping",
  food: "food", restaurant: "food", restaurants: "food", dining: "food", lunch: "food", dinner: "food", eat: "food",
  cafe: "cafe", cafes: "cafe", coffee: "cafe",
  dessert: "dessert", desserts: "dessert", sweet: "dessert", sweets: "dessert",
  activity: "activity", activities: "activity",
  experience: "experience", experiences: "experience",
};

function detectCategory(message: string): Place["category"] | null {
  const lower = message.toLowerCase();
  for (const [word, category] of Object.entries(CATEGORY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return category;
  }
  return null;
}

export interface NearbyResult { category: string; zone?: string; places: PlaceContext[] }

// Handles "3 good shopping places near X" style questions: detects the
// category asked for, resolves the anchor venue, and filters curated places
// by real distance (haversine over geocoded lat/lng) when available — falling
// back to the coarser zone label otherwise. Zone alone isn't precise enough:
// Powai and Vile Parle are both "andheri_w" but 8+ km apart.
export function findNearby(message: string, max = 4): NearbyResult | null {
  const category = detectCategory(message);
  if (!category) return null;

  const anchorText = message.match(/near\s+(.+)$/i)?.[1] ?? message;
  const anchor = scorePlaces(anchorText)[0]?.p;
  if (!anchor) return null;

  const sameCategory = loadPlaces().filter((p) => p.category === category && p.id !== anchor.id);

  if (anchor.lat != null && anchor.lng != null) {
    const withDistance = sameCategory
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({ p, km: haversineKm(anchor.lat!, anchor.lng!, p.lat!, p.lng!) }));
    for (const radiusKm of [5, 8, 15]) {
      const within = withDistance.filter((x) => x.km <= radiusKm).sort((a, b) => a.km - b.km);
      if (within.length) {
        return {
          category,
          zone: anchor.zone,
          places: within.slice(0, max).map(({ p, km }) => toContext(p, km)),
        };
      }
    }
  }

  // Fallback: same zone label (coarser, but still better than no filter).
  if (anchor.zone) {
    const sameZone = sameCategory
      .filter((p) => p.zone === anchor.zone)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sameZone.length) {
      return { category, zone: anchor.zone, places: sameZone.slice(0, max).map((p) => toContext(p)) };
    }
  }

  return null;
}
