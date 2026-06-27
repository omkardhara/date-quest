import placesData from "@/data/places.json";
import { Answers, Place, Plan, PlanBlock, Category, TravelFromPrev, AltPlace } from "./types";
import { PROFILE } from "./profile";
import { narrate, greeting, signoff } from "./narrate";
import { restroomFor, outfitFor, buildFlags } from "./concierge";

const MONSOON_MONTHS = [5, 6, 7, 8]; // Jun–Sep

const PLACES = placesData as Place[];

// ─── Zones ────────────────────────────────────────────────────────────────────
type Zone = "home" | "bandra" | "south" | "central" | "andheri_w" | "borivali" | "thane" | "vasai" | "karjat" | "kolad" | "gorai" | "multiple";

const TRAVEL_BASE: Record<string, number> = {
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
  "borivali-home":      60,
  "borivali-vasai":     50,
  "central-home":       40,
  "central-south":      20,
  "central-thane":      50,
  "gorai-home":         75,
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
  vasai: 90, karjat: 130, kolad: 150, gorai: 70, borivali: 50, thane: 45,
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
  north_adventure: ["borivali", "andheri_w", "bandra", "multiple"],
  thane_east:      ["thane", "home", "andheri_w", "multiple"],
  full_day_out:    ["vasai", "karjat", "kolad", "gorai", "multiple"],
};

function detectCorridor(ans: Answers): Corridor {
  const p = ans.personality;
  const dayMins = ans.endMin - ans.startMin;
  const monsoon = isMonsoon(ans);
  // In peak monsoon the far waterfalls are unsafe, so never route a full day out to them.
  if (!monsoon && p.includes("adventure") && ans.startMin <= 480 && dayMins >= 660) return "full_day_out";
  if (p.includes("adventure") && ans.startMin <= 600 && dayMins >= 480) return "north_adventure";
  if (p.includes("adventure")) return "thane_east";
  if (p.includes("culture") || p.includes("spiritual") || ans.mood === "romantic") return "south_loop";
  return "bandra_hub";
}

// Real zones (for live discovery) the day will actually draw from.
export function zonesForAnswers(ans: Answers): Zone[] {
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
    case "evening":   return atMin >= 900;                 // after 3 pm
    case "night":     return atMin >= 1080;                // after 6 pm
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
    term.toLowerCase().split(/\s+/).map(stem).filter(w => w.length >= 4).some(w =>
      tokens.some(t => t.length >= 4 && (t.startsWith(w) || w.startsWith(t))),
    ),
  );
}

function isMonsoon(ans: Answers): boolean {
  return ans.month !== undefined && MONSOON_MONTHS.includes(ans.month);
}

function score(p: Place, ans: Answers, band: string, remainingBudget: number): number {
  let s = 0;
  s += overlap(p.vibes, ans.personality) * 3;
  if (p.moods.includes(ans.mood)) s += 2;
  if (p.bestTime === band || p.bestTime === "any") s += 2;
  if (FOODY.includes(p.category)) s += overlap(p.cuisines, ans.foods) * 4;
  s += overlap(p.tags ?? [], PROFILE.loves) * 2;
  const cost = p.costPerPerson * 2;
  if (cost <= remainingBudget)            s += 2;
  else if (cost > remainingBudget * 1.3)  s -= 5;
  if (ans.personality.includes("adventure")) s += p.adventureLevel;
  if (ans.personality.includes("peaceful"))  s += 3 - p.adventureLevel;
  // Monsoon: demote exposed outdoor stops that only get a "caution" in heavy rain.
  if (isMonsoon(ans) && p.outdoor && p.monsoonRisk === "caution") s -= 8;
  if (p.rating) s += (p.rating - 3.8) * 2; // live places: reward strong Google ratings
  if (matchesRequest(p, ans.mustInclude ?? [])) s += 25; // strongly prefer requested things
  return s;
}

function blocked(p: Place, ans: Answers): boolean {
  if (FOODY.includes(p.category) && ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek) && p.veg === false) return true;
  if (ans.dislikes && overlap(p.contains ?? [], ans.dislikes) > 0) return true;
  // Closed that day of the week.
  if (ans.dayOfWeek !== undefined && (p.closedDays ?? []).includes(ans.dayOfWeek)) return true;
  // Genuinely unsafe outdoors in peak monsoon (e.g. waterfalls in flood).
  if (isMonsoon(ans) && p.outdoor && p.monsoonRisk === "avoid") return true;
  return false;
}

function pick(
  pool: Place[], ans: Answers, band: string, cats: Category[],
  used: Set<string>, currentZone: Zone, corridorZones: Zone[],
  atMin: number, remainingBudget: number, usedCuisines: Set<string>,
  cuisineFilter?: string[],
): { place: Place; zone: Zone; alts: Place[] } | undefined {
  const base = pool.filter(p =>
    cats.includes(p.category) &&
    !used.has(p.id) &&
    !blocked(p, ans) &&
    timeAllowed(p, atMin) &&
    (corridorZones.includes((p.zone ?? "multiple") as Zone) || (p.zone ?? "multiple") === "multiple"),
  );
  if (!base.length) return undefined;

  // Cuisine is a soft preference: only narrow if it leaves something.
  let cand = base;
  if (cuisineFilter?.length) {
    const filtered = base.filter(p => overlap(p.cuisines ?? [], cuisineFilter) > 0);
    if (filtered.length) cand = filtered;
  }

  const rank = (p: Place) => {
    const z = (p.zone ?? "multiple") as Zone;
    let v = score(p, ans, band, remainingBudget) - travelMins(currentZone, z, atMin) / 15;
    if (overlap(p.cuisines ?? [], Array.from(usedCuisines)) > 0) v -= 6; // don't repeat a cuisine
    return v;
  };

  const sorted = [...cand].sort((a, b) => rank(b) - rank(a));
  const best = sorted[0];
  return { place: best, zone: (best.zone ?? "multiple") as Zone, alts: sorted.slice(1, 4) };
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
export function buildPlan(ans: Answers, extra: Place[] = []): Plan {
  const pool       = extra.length ? [...PLACES, ...extra] : PLACES;
  const used       = new Set<string>();
  const blocks:      PlanBlock[] = [];
  let cursor         = ans.startMin;
  let currentZone:   Zone = "home";
  let prevName       = `Home (${PROFILE.homeArea})`;
  let prevArea       = PROFILE.homeArea;
  let runningCost    = 0;
  let lastMealEnd    = 0; // end time of the last full meal (food/cafe), for spacing
  const usedCuisines = new Set<string>(); // avoid repeating a cuisine across the day
  const monsoon      = isMonsoon(ans);
  const end          = ans.endMin;
  const dayMins      = end - ans.startMin;
  const vegDay       = ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek);

  const corridor      = detectCorridor(ans);
  const corridorZones = CORRIDOR_ZONES[corridor];

  const toAlt = (p: Place): AltPlace => ({
    id: p.id, name: p.name, area: p.area, summary: p.summary,
    cost: p.costPerPerson * 2, mapsUrl: p.mapsUrl, topDishes: p.topDishes, mustBook: p.mustBook,
  });

  const add = (result: { place: Place; zone: Zone; alts?: Place[] } | undefined, kind: Category) => {
    if (!result || cursor >= end) return;
    const { place: p, zone } = result;

    const tripMins   = travelMins(currentZone, zone, cursor);
    const arrivalMin = cursor + tripMins;
    if (arrivalMin + 20 > end) return; // no time left after travel

    // Meal spacing: two full meals need a 150-min gap. Dessert is exempt.
    const isFullMeal = FULL_MEALS.includes(p.category);
    if (isFullMeal && lastMealEnd > 0 && arrivalMin - lastMealEnd < 150) return;

    // Budget: never exceed it (except the very first stop, so the plan is never empty).
    const blockCost = p.costPerPerson * 2;
    if (blocks.length > 0 && runningCost + blockCost > ans.budget) return;

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
      restroom:       restroomFor(zone),
      alternatives:   (result.alts ?? []).map(toAlt),
      kind,
    });

    runningCost += blockCost;
    cursor       = arrivalMin + dur;
    if (isFullMeal) lastMealEnd = cursor;
    (p.cuisines ?? []).forEach(c => usedCuisines.add(c));
    if (zone !== "multiple") currentZone = zone;
    else if (FAR_RETURN[currentZone]) currentZone = "home"; // we've driven back to the city
    prevName = p.name;
    prevArea = p.area;
  };

  const longDay   = dayMins > 480;
  const remaining = () => ans.budget - runningCost;
  const b = () => bandFor(cursor); // band follows the real clock, so any start time works

  // Morning activity + café (early starts only)
  if (ans.startMin < 660) {
    add(pick(pool, ans, b(), ["activity", "experience"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines), "activity");
    add(pick(pool, ans, b(), ["cafe"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines), "cafe");
  }

  // Lunch (skipped automatically by meal-spacing if breakfast was recent)
  if (cursor < 960 && end > 780) {
    add(pick(pool, ans, b(), ["food"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, ans.foods), "food");
  }

  // Afternoon / first-half experience or shopping
  if (end > 840) {
    add(pick(pool, ans, b(), ["experience", "activity", "shopping"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines), "experience");
  }

  // Mid-day rest — only if near home and it's a long day
  if (longDay && cursor < 1140 && (currentZone === "home" || currentZone === "andheri_w" || currentZone === "bandra")) {
    const restPlace = PLACES.find(p => p.category === "rest");
    if (restPlace) add({ place: restPlace, zone: "home" }, "rest");
  }

  // Evening activity / shopping / café
  if (end > 1080) {
    add(pick(pool, ans, b(), ["activity", "experience", "shopping", "cafe"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines), "activity");
  }

  // Dinner
  if (end > 1140) {
    add(pick(pool, ans, b(), ["food"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, ans.foods), "food");
  }

  // Dessert
  if (end - cursor > 15) {
    add(pick(pool, ans, b(), ["dessert"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, ans.foods), "dessert");
  }

  // Full-day map URL with all waypoints
  const waypoints = blocks.filter(x => x.place).map(x => `${x.place!.name}, ${x.place!.area}, Mumbai`);
  const fullDayMapUrl = waypoints.length >= 2
    ? `https://www.google.com/maps/dir/${waypoints.map(w => encodeURIComponent(w)).join("/")}`
    : undefined;

  const requests = (ans.mustInclude ?? []).map(s => s.trim()).filter(Boolean);

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
    outfit:      placesInPlan.length ? outfitFor(placesInPlan, monsoon) : undefined,
    weatherNote: monsoon ? "Planned for monsoon: indoor-leaning, with rain backups." : undefined,
  };

  return plan;
}
