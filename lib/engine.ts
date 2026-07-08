import placesData from "@/data/places.json";
import travelMatrixData from "@/data/travel-matrix.json";
import { Answers, Place, Plan, PlanBlock, Category, TravelFromPrev, AltPlace, MovieInfo } from "./types";
import { PROFILE } from "./profile";
import { narrate, greeting, signoff } from "./narrate";
import { restroomFor, outfitFor, buildFlags } from "./concierge";

const TRAVEL_MATRIX = travelMatrixData as Record<string, number>;

const MONSOON_MONTHS = [5, 6, 7, 8]; // Jun–Sep

const PLACES = placesData as Place[];

// ─── Zones ────────────────────────────────────────────────────────────────────
type Zone = "home" | "bandra" | "south" | "central" | "andheri_w" | "borivali" | "thane" | "vasai" | "navi_mumbai" | "karjat" | "kolad" | "gorai" | "multiple";

export const TRAVEL_BASE: Record<string, number> = {
  "andheri_w-bandra":   20,
  "andheri_w-borivali": 35,
  "andheri_w-central":  40,
  "andheri_w-home":     20,
  "andheri_w-south":    55,
  "andheri_w-thane":    55,
  "bandra-central":     30,
  "bandra-home":        35,
  "bandra-south":       35,
  "bandra-thane":       65,
  "borivali-bandra":    50,
  "borivali-central":   55,
  "borivali-home":      60,
  "borivali-vasai":     50,
  "central-home":       40,
  "central-south":      20,
  "central-thane":      50,
  "gorai-home":         75,
  "gorai-vasai":        75,  // coastal road north, feasible but a stretch
  "home-navi_mumbai":   55,  // via Atal Setu (Trans-Harbor Link)
  "andheri_w-navi_mumbai": 50,
  "bandra-navi_mumbai": 55,
  "central-navi_mumbai": 50,
  "south-navi_mumbai":  40,  // shorter via MTHL from Sewri
  "thane-navi_mumbai":  60,
  "borivali-navi_mumbai": 75,
  "navi_mumbai-vasai":  90,
  "karjat-kolad":       60,  // same direction, one valley over
  "karjat-vasai":      200,  // must cut through the city — almost never worth it
  "karjat-gorai":      180,  // city crossing required
  "kolad-vasai":       220,  // city crossing + coastal highway
  "kolad-gorai":       190,
  "home-south":         60,
  "home-thane":         45,
  "home-vasai":         90,
  "home-karjat":       150,
  "home-kolad":        150,
  "home-gorai":         75,
  "home-borivali":      60,
  "thane-vasai":       140,
};

// Approx minutes to get back to the city from a far-out destination. Used when
// the next stop is a flexible ("multiple") place — you can't teleport from Vasai.
const FAR_RETURN: Partial<Record<Zone, number>> = {
  vasai: 90, karjat: 130, kolad: 150, gorai: 70, borivali: 50, thane: 45, navi_mumbai: 55,
};

function travelMins(from: Zone, to: Zone, atMin: number): number {
  if (from === to) return 10;
  let base: number;
  if (from === "multiple" || to === "multiple") {
    // A flexible-location place. If we're leaving a far zone, charge the real return drive.
    const far = from === "multiple" ? FAR_RETURN[to] : FAR_RETURN[from];
    base = far ?? 15;
  } else {
    base = TRAVEL_BASE[[from, to].sort().join("-")] ?? 60;
  }
  if (atMin >= 1020 && atMin < 1200) return Math.round(base * 1.4); // 5–8 pm rush
  if (atMin >= 720  && atMin < 900)  return Math.round(base * 1.2); // noon rush
  return base;
}

// Per-place accurate lookup using the precomputed Google Maps matrix.
// Falls back to zone-based travelMins when a pair is not in the matrix
// (out-of-city places, or the home→home self-trip).
function travelMinsById(fromId: string, from: Zone, toId: string, to: Zone, atMin: number): number {
  const base = TRAVEL_MATRIX[`${fromId}|${toId}`];
  if (base !== undefined) {
    if (atMin >= 1020 && atMin < 1200) return Math.round(base * 1.4);
    if (atMin >= 720  && atMin < 900)  return Math.round(base * 1.2);
    return base;
  }
  return travelMins(from, to, atMin);
}

function directionsUrl(fromName: string, fromArea: string, toName: string, toArea: string): string {
  const origin = encodeURIComponent(`${fromName}, ${fromArea}, Mumbai`);
  const dest   = encodeURIComponent(`${toName}, ${toArea}, Mumbai`);
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;
}

// ─── Corridors ────────────────────────────────────────────────────────────────
type Corridor = "bandra_hub" | "south_loop" | "north_adventure" | "thane_east" | "full_day_out";

const CORRIDOR_ZONES: Record<Corridor, Zone[]> = {
  bandra_hub:      ["bandra", "andheri_w", "central", "multiple"],
  south_loop:      ["south", "central", "bandra", "multiple"],
  north_adventure: ["borivali", "vasai", "bandra", "multiple"],
  thane_east:      ["thane", "navi_mumbai", "home", "multiple"],
  full_day_out:    ["karjat", "kolad", "gorai", "multiple"],
};

function detectCorridor(ans: Answers): Corridor {
  const p    = ans.personality;
  const mood = ans.moodList ?? [ans.mood];
  const dayMins = ans.endMin - ans.startMin;
  const monsoon = wet(ans);

  const hasAdventure = p.includes("adventure");
  const hasNature    = p.includes("nature");
  const hasSpiritual = p.includes("spiritual");
  const hasCulture   = p.includes("culture");
  const hasArtsy     = p.includes("artsy");
  const isRomantic   = mood.some(m => ["romantic", "anniversary"].includes(m));

  const veryEarly = ans.startMin <= 480;  // ≤ 8 am
  const earlyish  = ans.startMin <= 600;  // ≤ 10 am
  const longDay   = dayMins >= 480;       // ≥ 8 h
  const fullDay   = dayMins >= 660;       // ≥ 11 h

  // Full-day-out: adventure + very early start + very long day + no monsoon.
  if (!monsoon && hasAdventure && veryEarly && fullDay) return "full_day_out";

  // North/Borivali (SGNP, Aarey): adventure with time to get there, OR
  // nature-seekers who start early enough to make the drive worthwhile.
  if (hasAdventure && earlyish && longDay) return "north_adventure";
  if (hasNature    && earlyish)            return "north_adventure";

  // Thane/East: adventure fallback when start is too late for Borivali, OR
  // nature with a later start (Yeoor Hills, Upvan Lake don't need an early alarm).
  if (hasAdventure || hasNature) return "thane_east";

  // South/Colaba/Fort: spiritual strongly anchors here (temples, dargahs,
  // churches concentrated in the south). Romantic + culture = heritage date in
  // Colaba/Fort — the one romantic case where south beats Bandra.
  // Artsy alone routes here too: Kala Ghoda, Jehangir, CSMVS, Fort galleries
  // are the core of Mumbai's art scene — bandra_hub would miss all 15 south
  // artsy places. south_loop covers south+central+bandra = 34 of 35 artsy places.
  if (hasSpiritual)              return "south_loop";
  if (isRomantic && hasCulture)  return "south_loop";
  if (hasArtsy)                  return "south_loop";
  if (hasCulture)                return "south_loop";

  // Default: Bandra hub — covers romantic alone (Carter Road, Sea Link, Bandra
  // Fort), playful, foodie, shopper, cozy, luxe, nightlife.
  return "bandra_hub";
}

// Real zones (for live discovery) the day will actually draw from.
export function zonesForAnswers(ans: Answers): Zone[] {
  if (ans.areas?.length) return ans.areas as Zone[];
  return CORRIDOR_ZONES[detectCorridor(ans)].filter(z => z !== "multiple" && z !== "home");
}

// ─── Scoring & filtering ──────────────────────────────────────────────────────
const FULL_MEALS: Category[] = ["food", "cafe"]; // these need spacing; dessert does not
const FOODY:      Category[] = ["food", "dessert"];

function bandFor(min: number): string {
  if (min < 720)  return "morning";
  if (min < 1020) return "afternoon";
  if (min < 1200) return "evening";
  return "night";
}

function overlap(a: string[] = [], b: string[] = []): number {
  return a.filter(x => b.includes(x)).length;
}

// Hard time-of-day gate so morning cafes never appear at dinner etc.
function timeAllowed(p: Place, atMin: number): boolean {
  switch (p.bestTime) {
    case "morning":   return atMin < 780;                  // before 1 pm
    case "afternoon": return atMin >= 660 && atMin < 1140; // 11 am – 7 pm
    case "evening":   return atMin >= 1020;                // after 5 pm (sunset/evening proper)
    case "night":     return atMin >= 1080;                // after 6 pm (dinner window)
    default:          return true;
  }
}

// Reduce a word to a rough stem so plurals match: galleries→gallery, movies→movie.
function stem(w: string): string {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("es")  && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s")   && w.length > 3) return w.slice(0, -1);
  return w;
}

// Best-effort match of a place against the user's typed "must include" requests.
function matchesRequest(p: Place, requests: string[]): boolean {
  if (!requests.length) return false;
  const tokens = `${p.name} ${p.area} ${(p.tags ?? []).join(" ")} ${(p.cuisines ?? []).join(" ")} ${(p.vibes ?? []).join(" ")}`
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  return requests.some(term =>
    term.toLowerCase().split(/\s+/).map(stem).filter(w => w.length >= 3).some(w =>
      tokens.some(t => t === w),
    ),
  );
}

function isMonsoon(ans: Answers): boolean {
  return ans.month !== undefined && MONSOON_MONTHS.includes(ans.month);
}

// Live forecast wins when we have it; otherwise fall back to the season.
function wet(ans: Answers): boolean {
  return ans.wetDay !== undefined ? ans.wetDay : isMonsoon(ans);
}

function score(p: Place, ans: Answers, band: string, remainingBudget: number): number {
  let s = 0;
  // Food category: vibes × 1 (cuisine, budget, mood dominate restaurant selection).
  // Activities: vibes × 3 (personality match is the primary driver).
  const vibesWeight = FOODY.includes(p.category) ? 1 : 3;
  s += overlap(p.vibes, ans.personality) * vibesWeight;
  // Score against ALL selected moods, not just the primary one.
  const allMoods = ans.moodList ?? [ans.mood];
  if (p.moods.some(m => allMoods.includes(m))) s += 2;
  if (p.bestTime === band || p.bestTime === "any") s += 2;
  if (FOODY.includes(p.category)) s += overlap(p.cuisines, ans.foods) * 4;
  s += overlap(p.tags ?? [], PROFILE.loves); // her standing loves (kept modest so it doesn't always win)
  const cost = p.costPerPerson * 2;
  if (cost <= remainingBudget)            s += 2;
  else if (cost > remainingBudget * 1.3)  s -= 5;
  // Budget pressure: scale with how much budget is left and the plan's total budget,
  // so a ₹8k plan actively seeks premium experiences instead of settling for free parks.
  // Threshold 20% (not 40%) so pressure still applies late in plan when budget is mostly spent.
  if (cost > 0 && remainingBudget > ans.budget * 0.2) {
    // Scale by cost-as-%-of-budget so expensive food/experiences clearly beat cheap ones.
    const budgetScale = ans.budget / 5000; // 1.0 for ₹5k, 1.6 for ₹8k, 4.0 for ₹20k
    const leftRatio   = remainingBudget / ans.budget;
    s += Math.min(budgetScale * 25, (p.costPerPerson / ans.budget) * 100 * budgetScale) * leftRatio;
  }
  if (ans.personality.includes("adventure")) s += p.adventureLevel;
  if (ans.personality.includes("peaceful"))  s += 3 - p.adventureLevel;
  // Wet day: demote exposed outdoor stops that only get a "caution" in heavy rain.
  if (wet(ans) && p.outdoor && p.monsoonRisk === "caution") s -= 8;
  if (p.rating) s += (p.rating - 3.6) * 3; // reward strong Google ratings (mostly live places)
  if (p.source === "live") s += 2;          // counter curated's structural tag advantage
  return s;
}

function blocked(p: Place, ans: Answers): boolean {
  if (FOODY.includes(p.category) && ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek) && p.veg === false) return true;
  if (ans.dislikes && overlap(p.contains ?? [], ans.dislikes) > 0) return true;
  // Closed that day of the week.
  if (ans.dayOfWeek !== undefined && (p.closedDays ?? []).includes(ans.dayOfWeek)) return true;
  // Genuinely unsafe outdoors on a wet day (e.g. waterfalls in flood).
  if (wet(ans) && p.outdoor && p.monsoonRisk === "avoid") return true;
  return false;
}

// Detect religious/spiritual places (temples, ashrams, mosques, churches etc.)
// so we can hard-block a second one after the first is picked.
function isSpiritual(p: Place): boolean {
  const name = p.name.toLowerCase();
  const tags = p.tags ?? [];
  return tags.includes("spiritual") ||
    ["temple","mandir","ashram","mosque","church","basilica","gurudwara","dargah","iskcon","vitthal","sadbhakti"].some(w => name.includes(w));
}

// Classify a place into a broad environment bucket for diversity scoring.
function environment(p: Place): string {
  // Food venues are always "food" regardless of their location or tags.
  if (p.category === "food" || p.category === "cafe" || p.category === "dessert") return "food";
  const name = p.name.toLowerCase();
  const tags = p.tags ?? [];
  if (tags.some(t => ["beach","sea","promenade","waterfront","causeway","lake","river"].includes(t)) ||
      ["sea","beach","promenade","causeway","lake","river","coast"].some(w => name.includes(w)))
    return "sea";
  if (tags.some(t => ["garden","park","forest","nature","trek"].includes(t)) ||
      ["garden","park","colony","forest","hill","trail","nature"].some(w => name.includes(w)))
    return "park";
  // Shopping check before heritage — a shopping place is "shopping" even if its name has "walk"
  if (tags.some(t => ["shopping","browse","market","fashion","bazaar","street food"].includes(t)) ||
      p.category === "shopping")
    return "shopping";
  if (tags.some(t => ["heritage","architecture","walk","historic","fort","spiritual"].includes(t)) ||
      ["heritage","walk","fort","temple","basilica","dargah","tank","mandir","ashram","mosque","church","gurudwara"].some(w => name.includes(w)))
    return "heritage";
  if (p.indoor) return "indoor";
  return "outdoor";
}

function pick(
  pool: Place[], ans: Answers, band: string, cats: Category[],
  used: Set<string>, currentZone: Zone, corridorZones: Zone[],
  atMin: number, remainingBudget: number, usedCuisines: Set<string>,
  pendingRequests: string[] = [],
  cuisineFilter?: string[],
  recentEnvs: string[] = [],
  spiritualUsed = false,
): { place: Place; zone: Zone; alts: Place[] } | undefined   {
  const base = pool.filter(p =>
    cats.includes(p.category) &&
    !used.has(p.id) &&
    !blocked(p, ans) &&
    timeAllowed(p, atMin) &&
    p.costPerPerson * 2 <= remainingBudget &&
    (corridorZones.includes((p.zone ?? "multiple") as Zone) || (p.zone ?? "multiple") === "multiple") &&
    !(spiritualUsed && isSpiritual(p)),
  );

  // mustInclude escape hatch: if none of the corridor-filtered candidates match a
  // pending request, widen to the full pool so a requested place is never silently dropped.
  // Skipped when the user explicitly confined the day to specific areas — geography they
  // picked on purpose should win over a request that simply has no match there, rather
  // than silently pulling in an out-of-area place to satisfy it.
  let extendedBase = base;
  if (pendingRequests.length > 0 && !ans.areas?.length && !base.some(p => matchesRequest(p, pendingRequests))) {
    const wider = pool.filter(p =>
      cats.includes(p.category) && !used.has(p.id) && !blocked(p, ans) &&
      timeAllowed(p, atMin) && p.costPerPerson * 2 <= remainingBudget &&
      matchesRequest(p, pendingRequests) &&
      !base.some(b => b.id === p.id),
    );
    if (wider.length) extendedBase = [...base, ...wider];
  }

  if (!extendedBase.length) return undefined;

  // Cuisine is a soft preference: only narrow if it leaves something.
  let cand = extendedBase;
  if (cuisineFilter?.length) {
    const filtered = extendedBase.filter(p => overlap(p.cuisines ?? [], cuisineFilter) > 0);
    if (filtered.length) cand = filtered;
  }

  // Locality narrowing: a zone (e.g. "andheri_w") can span several distinct named places
  // (Andheri West, Juhu, Versova, Powai...). If the user picked/typed a specific locality,
  // prefer places whose area string actually names it, so "Powai" doesn't silently resolve
  // to a Juhu or Andheri West stop just because they share a zone. Falls back to the wider
  // zone-filtered set if narrowing would leave nothing (e.g. no Powai food option at dinner).
  if (ans.areaLabels?.length) {
    const labels = ans.areaLabels.map(l => l.trim().toLowerCase()).filter(Boolean);
    const localityMatched = cand.filter(p => labels.some(l => (p.area ?? "").toLowerCase().includes(l)));
    if (localityMatched.length) cand = localityMatched;
  }

  // Hard-exclude a second shopping trip or a second sea/waterfront stop — both are repetitive.
  if (recentEnvs.includes("shopping")) {
    const noShop = cand.filter(p => environment(p) !== "shopping");
    if (noShop.length) cand = noShop;
    else return undefined; // no non-shopping alternatives — skip slot rather than doubling up
  }
  if (recentEnvs.includes("sea")) {
    const noSea = cand.filter(p => environment(p) !== "sea");
    if (noSea.length) cand = noSea;
    else return undefined; // all remaining options are sea — skip this slot
  }
  // Heritage: culture/spiritual plans can visit multiple sites; all others get one heritage stop max.
  const culturalDay = ans.personality.some((t: string) => ["culture","spiritual"].includes(t));
  if (!culturalDay && recentEnvs.includes("heritage")) {
    const noHeritage = cand.filter(p => environment(p) !== "heritage");
    if (noHeritage.length) cand = noHeritage;
    else return undefined; // all remaining options are heritage — skip this slot
  }

  // Zones far enough from home that the travel penalty would otherwise keep the engine
  // near Andheri all day, even for corridors explicitly meant to go there.
  const FAR_ZONES = new Set<Zone>(["borivali", "thane", "south", "vasai", "navi_mumbai", "karjat", "kolad", "gorai"]);
  const primaryFarZone = corridorZones.find(z => FAR_ZONES.has(z as Zone)) as Zone | undefined;

  const rank = (p: Place) => {
    const z = (p.zone ?? "multiple") as Zone;
    const tripCost = travelMins(currentZone, z, atMin);
    // Strong geographic penalty: /8 makes long trips (55+ min) very costly vs short ones (10-20 min).
    let v = score(p, ans, band, remainingBudget) - tripCost / 8;
    // Same-zone bonus only rewards places that actually match the personality — otherwise a
    // nearby spiritual place beats a perfectly-matched shop across town.
    if (z !== "multiple" && z === currentZone) {
      v += overlap(p.vibes ?? [], ans.personality) > 0 ? 4 : 1;
    }
    // "Go to your destination" nudge: for corridors that intentionally target a far zone
    // (Borivali, Thane, South), compensate for the home→destination travel penalty so
    // SGNP/Yeoor Hills/Colaba actually win their slots instead of always losing to nearby Aarey.
    if (primaryFarZone && z === primaryFarZone && currentZone !== primaryFarZone) {
      v += 6;
    }
    const cuisineRepeat = overlap(p.cuisines ?? [], Array.from(usedCuisines));
    if (cuisineRepeat > 0) v -= 8 * cuisineRepeat; // penalise each repeated cuisine heavily
    if (pendingRequests.length && matchesRequest(p, pendingRequests)) v += 25; // boost only until satisfied
    // Diversity: penalise repeating the same environment type across the whole day,
    // not just consecutive picks. This prevents two temples, two parks, two beaches etc.
    // Skip penalty for explicitly requested places — if the user asked for comedy and
    // gaming (both indoor), they should get both regardless of env repetition.
    const env = environment(p);
    // "outdoor" is a catch-all for adventure spots — multiple outdoor activities per day is expected.
    if (env !== "food" && env !== "outdoor" && recentEnvs.includes(env) && !matchesRequest(p, pendingRequests)) {
      const lastIdx = recentEnvs.lastIndexOf(env);
      const distFromEnd = recentEnvs.length - 1 - lastIdx;
      // Count-based stacking: 2nd occurrence −22, 3rd occurrence −44.
      const envCount = recentEnvs.filter(e => e === env).length;
      v -= Math.max(6, 22 - distFromEnd * 2) * Math.min(envCount, 2);
    }
    v += (Math.random() - 0.5) * 5; // ±2.5 noise — keeps top-ranked varied without tanking quality
    return v;
  };

  const ranked = cand.map(p => ({ p, v: rank(p) })).sort((a, b) => b.v - a.v);
  // Pick from the close contenders, not always #1, so re-runs vary and the live
  // pool actually surfaces. A clear winner (e.g. a requested stop) still wins.
  const top = ranked[0].v;
  const contenders = ranked.filter(r => r.v >= top - 10).slice(0, 8).map(r => r.p);
  const best = weightedPick(contenders);
  // Alternatives: same category first (so swapping a shopping card shows more shops),
  // then same zone, then anything. Keeps swap results relevant.
  const bestZone = best.zone ?? "multiple";
  const allAlts  = ranked.map(r => r.p).filter(p => p.id !== best.id);
  const sameCatAlts = allAlts.filter(p => p.category === best.category);
  const sameZoneSameCat = sameCatAlts.filter(p => (p.zone ?? "multiple") === bestZone);
  const sameZone = allAlts.filter(p => (p.zone ?? "multiple") === bestZone);
  const alts = sameZoneSameCat.length >= 1 ? sameZoneSameCat.slice(0, 3)
             : sameCatAlts.length >= 1 ? sameCatAlts.slice(0, 3)
             : sameZone.length >= 1 ? sameZone.slice(0, 3)
             : allAlts.slice(0, 3);
  return { place: best, zone: (best.zone ?? "multiple") as Zone, alts };
}

// Weighted random favouring the front of the list (geometric falloff).
function weightedPick<T>(arr: T[]): T {
  if (arr.length <= 1) return arr[0];
  const weights = arr.map((_, i) => Math.pow(0.75, i));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
  return arr[arr.length - 1];
}

function backupFor(p: Place): string | undefined {
  if (p.safety) return p.safety;
  if (!p.indoor) {
    const alt = PLACES.find(x => x.indoor && x.category === p.category && x.id !== p.id);
    return alt ? `If it pours or gets too hot: swap for ${alt.name}.` : undefined;
  }
  return undefined;
}

// ─── Main builder ─────────────────────────────────────────────────────────────
export function buildPlan(ans: Answers, extra: Place[] = [], movies: MovieInfo[] = []): Plan {
  const pool       = extra.length ? [...PLACES, ...extra] : PLACES;
  const used       = new Set<string>();
  const blocks:      PlanBlock[] = [];
  let cursor         = ans.startMin;
  let currentZone:   Zone = "home";
  let currentPlaceId = "home";
  let prevName       = `Home (${PROFILE.homeArea})`;
  let prevArea       = PROFILE.homeArea;
  let runningCost    = 0;
  let lastMealEnd    = 0; // end time of the last full meal (food/cafe), for spacing
  const usedCuisines  = new Set<string>(); // avoid repeating a cuisine across the day
  const mealCuisines  = new Set<string>(); // cuisines from food picks only (lunch / dinner dedup)
  let   spiritualUsed = false;             // hard-block second temple/ashram/mosque in same plan
  const monsoon       = wet(ans);
  const end          = ans.endMin;
  const dayMins      = end - ans.startMin;
  const vegDay       = ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek);

  const corridor      = detectCorridor(ans);
  // A user-picked set of areas (e.g. Bandra + Andheri) hard-confines the whole day to those
  // zones instead of letting the corridor heuristic pick one; "multiple" stays allowed so
  // flexible-location picks (cinemas, live/discovered places) still work.
  const corridorZones: Zone[] = ans.areas?.length
    ? Array.from(new Set<Zone>([...(ans.areas as Zone[]), "multiple"]))
    : CORRIDOR_ZONES[corridor];
  const recentEnvs:   string[] = []; // last 2 non-food environments for diversity scoring

  const toAlt = (p: Place): AltPlace => ({
    id: p.id, name: p.name, area: p.area, zone: p.zone, summary: p.summary,
    cost: p.costPerPerson * 2, mapsUrl: p.mapsUrl, topDishes: p.topDishes, mustBook: p.mustBook,
  });

  const add = (result: { place: Place; zone: Zone; alts?: Place[] } | undefined, kind: Category) => {
    if (!result || cursor >= end) return;
    const { place: p, zone } = result;

    const tripMins   = travelMinsById(currentPlaceId, currentZone, p.id, zone, cursor);
    const arrivalMin = cursor + tripMins;
    if (arrivalMin + 20 > end) return; // no time left after travel

    // Meal spacing: café-to-food or food-to-food needs a 90-min gap. Dessert is exempt.
    const isFullMeal = FULL_MEALS.includes(p.category);
    if (isFullMeal && lastMealEnd > 0 && arrivalMin - lastMealEnd < 90) return;

    // Budget: never add paid stops that exceed budget. Free stops (costPerPerson 0) always fit.
    const blockCost = p.costPerPerson * 2;
    if (blocks.length > 0 && blockCost > 0 && runningCost + blockCost > ans.budget) return;

    const dur = Math.min(p.durationMins, end - arrivalMin);

    const travel: TravelFromPrev = {
      mins:          tripMins,
      fromLabel:     prevName,
      directionsUrl: directionsUrl(prevName, prevArea, p.name, p.area),
    };

    used.add(p.id);
    blocks.push({
      startMin:       arrivalMin,
      endMin:         arrivalMin + dur,
      title:          p.name,
      place:          p,
      why:            narrate(p, ans),
      cost:           blockCost,
      travelFromPrev: blocks.length === 0 && tripMins <= 10 ? undefined : travel,
      backup:         backupFor(p),
      // Only suggest a restroom for outdoor/open-air stops — restaurants and indoor venues have their own.
      restroom:       (p.indoor || ["food", "cafe", "dessert"].includes(p.category)) ? undefined : (p.restroom ?? restroomFor(zone)),
      // Filter alternatives by the actual arrival time so a swap card is always
      // time-appropriate (no morning-only alt offered for an evening slot).
      alternatives:   (result.alts ?? []).filter(a => timeAllowed(a, arrivalMin)).map(toAlt),
      kind,
    });

    // If this is a cinema and movies are available, attach a now-playing recommendation.
    if ((p.tags ?? []).includes("cinema") && movies.length > 0) {
      const allMoods = ans.moodList ?? [ans.mood];
      const preferGenres = allMoods.some(m => ["romantic", "anniversary", "date night"].includes(m))
        ? ["romance", "drama"]
        : undefined;
      let pool = movies;
      if (preferGenres?.length) {
        const filtered = movies.filter(m =>
          preferGenres.some(g => (m.genre ?? "").toLowerCase().includes(g.toLowerCase()))
        );
        if (filtered.length > 0) pool = filtered;
      }
      blocks[blocks.length - 1].movie = pool[Math.floor(Math.random() * pool.length)];
    }

    runningCost += blockCost;
    cursor       = arrivalMin + dur;
    if (isFullMeal) lastMealEnd = cursor;
    (p.cuisines ?? []).forEach(c => usedCuisines.add(c));
    if (kind === "food") (p.cuisines ?? []).forEach(c => mealCuisines.add(c));
    if (isSpiritual(p)) spiritualUsed = true;
    // Mark any request this place satisfies as done — won't boost further picks.
    for (let i = pendingRequests.length - 1; i >= 0; i--) {
      if (matchesRequest(p, [pendingRequests[i]])) pendingRequests.splice(i, 1);
    }
    if (zone !== "multiple") { currentZone = zone; currentPlaceId = p.id; }
    else if (FAR_RETURN[currentZone]) { currentZone = "home"; currentPlaceId = "home"; }
    // Track environment for consecutive-diversity penalty (food slots vary naturally, skip them)
    if (!FULL_MEALS.includes(p.category) && p.category !== "rest") {
      recentEnvs.push(environment(p));
      if (recentEnvs.length > 8) recentEnvs.shift(); // keep a full-day history for diversity scoring
    }
    prevName = p.name;
    prevArea = p.area;
  };

  const longDay          = dayMins > 480;
  const remaining        = () => ans.budget - runningCost;
  const b                = () => bandFor(cursor);
  const pendingRequests  = [...(ans.mustInclude ?? [])];

  // Cuisine filter for food picks: strip cuisines already served at a meal today
  // so lunch and dinner never repeat the same type (sizzler at lunch → dinner gets something else).
  const freshFoodFilter = (base?: string[]) => {
    if (!base?.length || !mealCuisines.size) return base;
    const f = base.filter(c => !mealCuisines.has(c));
    return f.length > 0 ? f : undefined; // all prefs served → pick freely; never loop back to same cuisine
  };

  // Hold back 20% for dinner — enough protection without blocking paid afternoon activities.
  const dinnerRes = () => end > 1140 ? Math.floor(ans.budget * 0.20) : 0;
  // Reserve budget for pending must-include requests. For a single request (e.g. comedy only),
  // this prevents an expensive activity from eating the budget needed for it. For two+ requests
  // (gaming + comedy), both will be picked by the pre-dinner loop instead — no reservation needed
  // (each actBudget call would only see the cheapest and still block the first item).
  const pendingRes = () => {
    if (pendingRequests.length !== 1) return 0; // only reserve when exactly one request is pending
    const matches = pool.filter(p => matchesRequest(p, pendingRequests) && !used.has(p.id));
    if (!matches.length) return 0;
    return matches.reduce((mn, p) => Math.min(mn, p.costPerPerson * 2), Infinity) || 0;
  };
  const actBudget = () => Math.max(0, remaining() - dinnerRes() - pendingRes());

  // Morning activity + café (early starts only).
  // Café budget is capped at 20% of total so an expensive brunch doesn't starve the rest of the day.
  if (ans.startMin < 660) {
    add(pick(pool, ans, b(), ["activity", "experience"], used, currentZone, corridorZones, cursor, actBudget(), usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "activity");
    const cafeBudget = Math.min(remaining(), Math.max(800, Math.round(ans.budget * 0.20)));
    add(pick(pool, ans, b(), ["cafe"], used, currentZone, corridorZones, cursor, cafeBudget, usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "cafe");
  }

  // Lunch — reserve dinner + pendingRes so a must-include isn't starved by an expensive lunch.
  if (cursor < 960 && end > 780) {
    const hadFood = blocks.some(bl => FULL_MEALS.includes(bl.kind as Category));
    const lunchBudget = hadFood ? remaining() : actBudget();
    add(pick(pool, ans, b(), ["food"], used, currentZone, corridorZones, cursor, lunchBudget, usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "food");
  }

  // Afternoon / first-half experience or shopping.
  // Always reserve dinner budget so afternoon picks can't starve dinner.
  if (end > 840) {
    add(pick(pool, ans, b(), ["experience", "activity", "shopping"], used, currentZone, corridorZones, cursor, actBudget(), usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "experience");
  }

  // Second lunch opportunity — fires when the first food slot was blocked by meal spacing
  // (very common on early-start days: the morning café counts as a "full meal" for the
  // 90-min spacing rule, so lunch fired right after it almost always gets rejected).
  // Not gated to short days (`end <= 1140`) — a full evening plan (e.g. 10am-10pm) needs
  // this recovery just as much, otherwise the day ends up with only a dinner and zero
  // lunch, whatever "no food places" would look like to the day it's for.
  // cursor≥600 catches adventure (end=1080) days where the first activity still runs before noon.
  if (cursor >= 600 && cursor < 1050 && end > 900 && !blocks.some(bl => ["food"].includes(bl.kind))) {
    add(pick(pool, ans, b(), ["food"], used, currentZone, corridorZones, cursor, actBudget(), usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "food");
  }

  // Second afternoon slot: fills the pre-evening gap on long days (noon–midnight, 4pm–midnight).
  // No "cafe" here — morning cafés score high but fail meal spacing and cascade-block the slot.
  if (end - ans.startMin >= 360 && cursor < 1080 && end > 960) {
    add(pick(pool, ans, b(), ["experience", "activity", "shopping"], used, currentZone, corridorZones, cursor, actBudget(), usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "activity");
  }

  // Extra afternoon slot for very long days (6am–midnight etc.) — bridges the gap between
  // morning stops and the 6pm evening window, especially on tight budgets with free places.
  if (end - ans.startMin >= 720 && cursor < 1020 && end > 1080) {
    add(pick(pool, ans, b(), ["experience", "activity", "shopping"], used, currentZone, corridorZones, cursor, actBudget(), usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "experience");
  }

  // Mid-day rest — only near home, genuinely long day (12 h+), good budget left,
  // several stops already done, still before 4 pm, AND the corridor keeps evening stops
  // close to home (south_loop = no: would send back to Colaba after an Andheri nap).
  const homeRestOk = corridor === "bandra_hub" || corridor === "thane_east" || corridor === "north_adventure";
  if (homeRestOk && dayMins >= 720 && cursor < 960 && remaining() >= 2500 && blocks.length >= 4 &&
      (currentZone === "home" || currentZone === "andheri_w" || currentZone === "bandra")) {
    const restPlace = PLACES.find(p => p.category === "rest");
    if (restPlace) add({ place: restPlace, zone: "home" }, "rest");
  }

  // Pre-dinner must-include loop (attempt 1): fires BEFORE evening when cursor is already ≥1080.
  // end-160 ensures at least 160 min remain: enough for travel + dinner.
  for (let _pi = 0; _pi < 3 && pendingRequests.length > 0 && cursor >= 1080 && end > 1200 && cursor < end - 160; _pi++) {
    const _prevCursor = cursor;
    add(pick(pool, ans, b(), ["experience", "activity"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "experience");
    if (cursor === _prevCursor) break;
  }

  // Evening activity / shopping — no cafe here (morning cafés always fail meal spacing at this hour)
  // Skip if dinner will fire and there's not enough room for both (~180 min: activity + travel + dinner).
  if (end > 1080 && !(end > 1140 && (end - cursor) < 180)) {
    add(pick(pool, ans, b(), ["activity", "experience", "shopping"], used, currentZone, corridorZones, cursor, actBudget(), usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "activity");
  }

  // Pre-dinner must-include loop (attempt 2): catches plans where cursor was <1080 before evening.
  // After evening fires, cursor is reliably ≥1080 so comedy/gaming can land before dinner consumes budget.
  for (let _pi = 0; _pi < 3 && pendingRequests.length > 0 && cursor >= 1080 && end > 1200 && cursor < end - 160; _pi++) {
    const _prevCursor = cursor;
    add(pick(pool, ans, b(), ["experience", "activity"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "experience");
    if (cursor === _prevCursor) break;
  }

  // Dinner
  if (end > 1140) {
    add(pick(pool, ans, b(), ["food"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, pendingRequests, freshFoodFilter(ans.foods), recentEnvs, spiritualUsed), "food");
  }

  // Post-dinner experience: honours explicit requests that need a late slot — standup comedy,
  // live music, gaming etc. that are gated to bestTime "night" (≥ 6 pm) and never get picked
  // in afternoon slots. Only fires when requests are still unfulfilled and there's room.
  if (pendingRequests.length > 0 && end > 1200 && cursor < end - 90) {
    add(pick(pool, ans, b(), ["experience", "activity"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, pendingRequests, undefined, recentEnvs, spiritualUsed), "experience");
  }

  // Dessert (20-min minimum to avoid a 5-minute dessert block)
  if (end - cursor > 20) {
    add(pick(pool, ans, b(), ["dessert"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, pendingRequests, ans.foods, recentEnvs, spiritualUsed), "dessert");
  }

  // Bonus suggestions: cheap activities/experiences not in the plan, ranked by score.
  // These surface in the UI when a swap frees up meaningful budget.
  let bonusPool = pool.filter(p =>
    !used.has(p.id) &&
    !blocked(p, ans) &&
    p.costPerPerson * 2 <= Math.min(ans.budget * 0.25, 1200) &&
    (corridorZones.includes((p.zone ?? "multiple") as Zone) || (p.zone ?? "multiple") === "multiple") &&
    ["activity", "experience", "dessert", "cafe"].includes(p.category)
  );
  if (ans.areaLabels?.length) {
    const labels = ans.areaLabels.map(l => l.trim().toLowerCase()).filter(Boolean);
    const localityMatched = bonusPool.filter(p => labels.some(l => (p.area ?? "").toLowerCase().includes(l)));
    if (localityMatched.length) bonusPool = localityMatched;
  }
  const bonusSuggestions: AltPlace[] = bonusPool
    .map(p => ({ p, v: score(p, ans, "afternoon", ans.budget) + overlap(p.vibes, ans.personality) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 5)
    .map(x => toAlt(x.p));

  // Strip alternatives that ended up as the main block elsewhere in the plan.
  const usedIds = new Set(blocks.map(b => b.place?.id).filter(Boolean) as string[]);
  for (const b of blocks) {
    if (b.alternatives?.length) {
      b.alternatives = b.alternatives.filter(a => !usedIds.has(a.id));
    }
  }

  // Full-day map URL with all waypoints
  const waypoints = blocks.filter(x => x.place).map(x => `${x.place!.name}, ${x.place!.area}, Mumbai`);
  const fullDayMapUrl = waypoints.length >= 2
    ? `https://www.google.com/maps/dir/${waypoints.map(w => encodeURIComponent(w)).join("/")}`
    : undefined;

  const requests = (ans.mustInclude ?? []).map(s => s.trim()).filter(Boolean);

  // Return-home travel segment — always show how long it takes to get back.
  let returnTravel: Plan["returnTravel"];
  if (blocks.length > 0) {
    const homeMins = travelMinsById(currentPlaceId, currentZone, "home", "home", cursor);
    returnTravel = {
      mins: homeMins,
      fromLabel: prevName,
      directionsUrl: directionsUrl(prevName, prevArea, `Home (${PROFILE.homeArea})`, PROFILE.homeArea),
    };
  }

  const placesInPlan = blocks.filter(x => x.place).map(x => x.place!);
  const totalCost = blocks.reduce((s, x) => s + x.cost, 0);
  const plan: Plan = {
    blocks,
    totalCost,
    budget:      ans.budget,
    overBudget:  totalCost > ans.budget,
    greeting:    greeting(ans),
    signoff:     signoff(),
    fullDayMapUrl,
    requests:    requests.length ? requests : undefined,
    flags:       buildFlags(blocks, ans, monsoon, vegDay),
    outfit:      placesInPlan.length ? outfitFor(placesInPlan, monsoon, ans.month) : undefined,
    weatherNote: ans.weatherSummary
      ? `Forecast for the day: ${ans.weatherSummary}.`
      : (monsoon ? "Planned for monsoon: indoor-leaning, with rain backups." : undefined),
    returnTravel,
    bonusSuggestions: bonusSuggestions.length ? bonusSuggestions : undefined,
  };

  return plan;
}
