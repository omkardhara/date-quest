// Backs the chat assistant: pulls relevant curated places for grounding, live
// web snippets for time-sensitive questions (showtimes, current events), and
// real Google review excerpts for "what to order" style questions (generic
// web search surfaces "10 best X restaurants" listicles for small/niche
// venues rather than anything about the specific place asked about).
import { readFileSync } from "fs";
import { join } from "path";
import { Place } from "./types";
import { searchPlaceReviews, searchPlaces } from "./google";
import { TRAVEL_BASE } from "./engine";
import { PROFILE } from "./profile";
import { extractLocalityFromText, resolveZone } from "./areas";
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

interface ItineraryStop { name: string; area?: string }

// Itinerary lines look like "12:00 PM–1:00 PM: Vivi All Day Bistro (Thane) — ₹1200"
// (see PlanView.tsx / GetawayView.tsx onItineraryChange) — pull name + area out of each.
function parseItineraryStops(itinerary: string): ItineraryStop[] {
  const stops: ItineraryStop[] = [];
  const lineRe = /:\s*(.+?)(?:\s*\(([^)]+)\))?\s*—\s*₹/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(itinerary))) stops.push({ name: m[1].trim(), area: m[2]?.trim() });
  return stops;
}

// Finds a stop from the user's OWN current itinerary that the question is about (e.g.
// "shopping near Vivi All Day Bistro"). Itinerary stops are very often live-discovered
// places that were never in the curated dataset to begin with, so scorePlaces() alone
// (which only searches data/places.json) can never resolve them as an anchor — without
// this, a question about a real place on the user's own screen falls through to a
// generic, ungrounded, often wrong-city-area answer.
function findItineraryAnchor(message: string, itinerary: string): ItineraryStop | undefined {
  const stops = parseItineraryStops(itinerary);
  if (!stops.length) return undefined;
  const qWords = new Set(words(message));
  if (!qWords.size) return undefined;
  let best: { stop: ItineraryStop; score: number } | undefined;
  for (const stop of stops) {
    const score = words(stop.name).reduce((s, w) => s + (qWords.has(w) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { stop, score };
  }
  return best?.stop;
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

// Order is priority, not just a lookup table: specific terms are listed first so they
// win even when a generic term also literally appears in the same phrase (e.g. "sizzler
// restaurant" contains both "sizzler" and "restaurant" — sizzler must win, or the live
// search silently loses the one thing that was actually asked for).
const CATEGORY_WORDS: [string, Place["category"]][] = [
  ["sizzler", "food"], ["ice cream", "dessert"], ["bakery", "dessert"],
  ["rooftop", "experience"], ["bar", "experience"], ["pub", "experience"],
  ["spa", "experience"], ["lounge", "experience"],
  ["boutique", "shopping"], ["boutiques", "shopping"], ["market", "shopping"], ["mall", "shopping"],
  ["park", "activity"], ["garden", "activity"],
  ["thing to do", "activity"], ["things to do", "activity"],
  ["shopping", "shopping"], ["shop", "shopping"], ["shops", "shopping"],
  ["food", "food"], ["restaurant", "food"], ["restaurants", "food"], ["dining", "food"],
  ["lunch", "food"], ["dinner", "food"], ["eat", "food"],
  ["cafe", "cafe"], ["cafes", "cafe"], ["coffee", "cafe"],
  ["dessert", "dessert"], ["desserts", "dessert"], ["sweet", "dessert"], ["sweets", "dessert"],
  ["activity", "activity"], ["activities", "activity"],
  ["experience", "experience"], ["experiences", "experience"],
];

// Search-query phrase per trigger keyword — deliberately more specific than the broad
// Place category where possible, e.g. "sizzler" must search for sizzler places, not
// just any restaurant, or the live search silently loses the one thing that was asked for.
const KEYWORD_QUERY: Record<string, string> = {
  shopping: "shopping spots", shop: "shopping spots", shops: "shopping spots",
  boutique: "boutiques", boutiques: "boutiques", market: "markets", mall: "malls",
  food: "restaurants", restaurant: "restaurants", restaurants: "restaurants",
  dining: "restaurants", lunch: "restaurants", dinner: "restaurants", eat: "restaurants",
  sizzler: "sizzler restaurants",
  cafe: "cafes", cafes: "cafes", coffee: "cafes",
  dessert: "dessert places", desserts: "dessert places", sweet: "dessert places", sweets: "dessert places",
  "ice cream": "ice cream places", bakery: "bakeries",
  activity: "things to do", activities: "things to do",
  "thing to do": "things to do", "things to do": "things to do",
  park: "parks", garden: "gardens",
  experience: "experiences", experiences: "experiences",
  rooftop: "rooftop bars", bar: "bars", pub: "pubs", spa: "spas", lounge: "lounges",
};

interface CategoryMatch { category: Place["category"]; queryPhrase: string }

function detectCategory(message: string): CategoryMatch | null {
  const lower = message.toLowerCase();
  for (const [word, category] of CATEGORY_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return { category, queryPhrase: KEYWORD_QUERY[word] ?? word };
  }
  return null;
}

// Extra filler stripped only when building a live-search phrase (kept in STOP_WORDS-driven
// word() results elsewhere, since those still need to score against curated tags/areas).
const SEARCH_FILLER = new Set(["good", "any", "options", "option", "spot", "spots", "place", "places", "there", "some"]);

// CATEGORY_WORDS is necessarily a finite list (sizzler, rooftop, dessert...) and anything
// not on it — gaming, bowling, arcades, escape rooms, treks, whatever's asked next — used
// to fall straight through to the ungrounded curated-only path with no live search at all.
// This builds a live-search phrase directly from the question itself (locality words
// stripped out, since that's appended separately) so an unrecognised activity type still
// gets a real, geography-aware search instead of silently giving up.
function extractSearchPhrase(message: string, locality?: string): string {
  const localityWords = new Set(locality ? words(locality) : []);
  return message.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !SEARCH_FILLER.has(w) && !localityWords.has(w))
    .join(" ");
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface NearbyResult { category: string; zone?: string; places: PlaceContext[] }

async function liveNearby(
  match: CategoryMatch, localityLabel: string, zone: string | undefined, max: number,
): Promise<NearbyResult | null> {
  const areaLabel = titleCase(localityLabel);
  const live = await searchPlaces(`best ${match.queryPhrase} in ${areaLabel}, Mumbai`, max);
  if (!live.length) return null;
  return {
    category: match.category,
    zone,
    places: live.map((p): PlaceContext => ({
      name: p.name,
      area: p.address?.split(",").slice(0, 2).join(",").trim() || areaLabel,
      category: match.category,
      summary: p.summary || (p.rating ? `${p.rating}★ on Google, ${p.userRatings ?? 0} reviews.` : `A real spot in ${areaLabel}, found live.`),
    })),
  };
}

// Handles "3 good shopping places near X" / "dessert places in Powai" style questions.
// Priority order matters: (1) when the question explicitly names a locality (Powai,
// Khar...), live-search THAT locality first — a big zone like "andheri_w" spans Powai,
// Juhu, Versova etc, and a loose-radius curated match would happily substitute a
// same-zone neighbourhood 8-10 km away, which is exactly the "closest I have is Juhu"
// non-answer this is meant to avoid; (1.5) the venue named is on the user's OWN current
// itinerary (often live-discovered, never in curated data at all — e.g. "shopping near
// Vivi All Day Bistro" when Vivi is a live pick shown on screen) — use ITS real area;
// (2) a tight-radius curated match near a resolved curated-data anchor venue, for
// venue-anchored questions about a well-known place; (3) live search around that
// anchor's own area, for the same case when curated data is thin; (4) only as a genuine
// last resort, curated places anywhere in the same broad zone.
export async function findNearby(message: string, itinerary: string, max = 4): Promise<NearbyResult | null> {
  const textLocality = extractLocalityFromText(message);
  const detected = detectCategory(message);
  // CATEGORY_WORDS is a finite list — anything not on it (gaming, bowling, arcades, treks,
  // whatever's asked next) used to fall straight through to the curated-only path below
  // with zero live search. Build a generic phrase from the question itself as a fallback so
  // an unrecognised activity type still gets a real, geography-aware search.
  const match: CategoryMatch = detected ?? {
    category: "activity",
    queryPhrase: extractSearchPhrase(message, textLocality?.label),
  };
  const { category } = match;
  const hasUsableFallback = !!detected || match.queryPhrase.length > 0;

  const anchorText = message.match(/near\s+(.+)$/i)?.[1] ?? message;
  const anchor = scorePlaces(anchorText)[0]?.p;
  const sameCategory = loadPlaces().filter((p) => p.category === category && p.id !== anchor?.id);

  if (!hasUsableFallback && !anchor) return null;

  // 1. An explicit locality was named — answer for THAT place, not "closest I have".
  if (hasUsableFallback && textLocality) {
    const live = await liveNearby(match, textLocality.label, textLocality.zone, max);
    if (live) return live;
  }

  // 1.5. The question is about a venue on the user's own current itinerary.
  if (hasUsableFallback && itinerary) {
    const itinAnchor = findItineraryAnchor(message, itinerary);
    if (itinAnchor?.area) {
      const live = await liveNearby(match, itinAnchor.area, resolveZone(itinAnchor.area), max);
      if (live) return live;
    }
  }

  // 2. No named locality (or its live search came up empty): tight-radius curated
  // match near the resolved anchor venue. Kept tight (not the old 15 km tier) so a
  // same-zone-but-different-neighbourhood curated entry doesn't masquerade as local.
  if (anchor?.lat != null && anchor?.lng != null) {
    const withDistance = sameCategory
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({ p, km: haversineKm(anchor.lat!, anchor.lng!, p.lat!, p.lng!) }));
    for (const radiusKm of [3, 6]) {
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

  // 3. Live search around the anchor's own area (venue-anchored question, no named
  // locality, and curated data nearby was too thin).
  if (hasUsableFallback && anchor?.area) {
    const live = await liveNearby(match, anchor.area, anchor.zone, max);
    if (live) return live;
  }

  // 4. Last resort — only reached once live search has genuinely come up empty:
  // widen to curated places anywhere in the same broad zone.
  const zone = textLocality?.zone ?? anchor?.zone;
  if (zone) {
    const sameZone = sameCategory
      .filter((p) => p.zone === zone)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sameZone.length) {
      return { category, zone, places: sameZone.slice(0, max).map((p) => toContext(p)) };
    }
  }

  return null;
}
