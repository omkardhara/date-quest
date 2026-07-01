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
  const allMoods = ans.moodList ?? [ans.mood];
  const dayMins = ans.endMin - ans.startMin;
  const monsoon = wet(ans);
  const isRomantic = allMoods.some(m => ["romantic", "anniversary"].includes(m));
  // Romantic/anniversary day without adventure intent → stay in city, scenic corridors.
  if (isRomantic && !p.includes("adventure")) {
    return p.includes("culture") || p.includes("spiritual") ? "south_loop" : "bandra_hub";
  }
  // On a wet day the far waterfalls are unsafe, so never route a full day out to them.
  if (!monsoon && p.includes("adventure") && ans.startMin <= 480 && dayMins >= 660) return "full_day_out";
  if (p.includes("adventure") && ans.startMin <= 600 && dayMins >= 480) return "north_adventure";
  if (p.includes("adventure")) return "thane_east";
  if (p.includes("culture") || p.includes("spiritual") || allMoods.includes("romantic")) return "south_loop";
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
  s += overlap(p.vibes, ans.personality) * 3;
  // Score against ALL selected moods, not just the primary one.
  const allMoods = ans.moodList ?? [ans.mood];
  if (p.moods.some(m => allMoods.includes(m))) s += 2;
  if (p.bestTime === band || p.bestTime === "any") s += 2;
  if (FOODY.includes(p.category)) s += overlap(p.cuisines, ans.foods) * 4;
  s += overlap(p.tags ?? [], PROFILE.loves); // her standing loves (kept modest so it doesn't always win)
  const cost = p.costPerPerson * 2;
  if (cost <= remainingBudget)            s += 2;
  else if (cost > remainingBudget * 1.3)  s -= 5;
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

// Classify a place into a broad environment bucket for diversity scoring.
function environment(p: Place): string {
  const name = p.name.toLowerCase();
  const tags = p.tags ?? [];
  if (tags.some(t => ["beach","sea","promenade","waterfront","causeway","lake","river"].includes(t)) ||
      ["sea","beach","promenade","causeway","lake","river","coast"].some(w => name.includes(w)))
    return "sea";
  if (tags.some(t => ["garden","park","forest","nature","trek"].includes(t)) ||
      ["garden","park","colony","forest","hill","trail","nature"].some(w => name.includes(w)))
    return "park";
  if (tags.some(t => ["heritage","architecture","walk","historic","fort"].includes(t)) ||
      ["heritage","walk","fort","temple","basilica","dargah","tank"].some(w => name.includes(w)))
    return "heritage";
  if (tags.some(t => ["shopping","browse","market","fashion","bazaar","street food"].includes(t)) ||
      p.category === "shopping")
    return "shopping";
  if (p.category === "food" || p.category === "cafe" || p.category === "dessert") return "food";
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
): { place: Place; zone: Zone; alts: Place[] } | undefined {
  const base = pool.filter(p =>
    cats.includes(p.category) &&
    !used.has(p.id) &&
    !blocked(p, ans) &&
    timeAllowed(p, atMin) &&
    p.costPerPerson * 2 <= remainingBudget &&
    (corridorZones.includes((p.zone ?? "multiple") as Zone) || (p.zone ?? "multiple") === "multiple"),
  );

  // mustInclude escape hatch: if none of the corridor-filtered candidates match a
  // pending request, widen to the full pool so a requested place is never silently dropped.
  let extendedBase = base;
  if (pendingRequests.length > 0 && !base.some(p => matchesRequest(p, pendingRequests))) {
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

  const rank = (p: Place) => {
    const z = (p.zone ?? "multiple") as Zone;
    const tripCost = travelMins(currentZone, z, atMin);
    // Strong geographic penalty: /8 makes long trips (55+ min) very costly vs short ones (10-20 min).
    let v = score(p, ans, band, remainingBudget) - tripCost / 8;
    // Same-zone bonus: actively reward staying nearby.
    if (z !== "multiple" && z === currentZone) v += 6;
    if (overlap(p.cuisines ?? [], Array.from(usedCuisines)) > 0) v -= 6; // don't repeat a cuisine
    if (pendingRequests.length && matchesRequest(p, pendingRequests)) v += 25; // boost only until satisfied
    // Soft diversity: penalise repeating the same environment in consecutive picks.
    const env = environment(p);
    if (env !== "food" && recentEnvs.length > 0 && recentEnvs[recentEnvs.length - 1] === env) v -= 5;
    if (env !== "food" && recentEnvs.length > 1 && recentEnvs[recentEnvs.length - 2] === env) v -= 3;
    return v;
  };

  const ranked = cand.map(p => ({ p, v: rank(p) })).sort((a, b) => b.v - a.v);
  // Pick from the close contenders, not always #1, so re-runs vary and the live
  // pool actually surfaces. A clear winner (e.g. a requested stop) still wins.
  const top = ranked[0].v;
  const contenders = ranked.filter(r => r.v >= top - 6).slice(0, 6).map(r => r.p);
  const best = weightedPick(contenders);
  const alts = ranked.map(r => r.p).filter(p => p.id !== best.id).slice(0, 3);
  return { place: best, zone: (best.zone ?? "multiple") as Zone, alts };
}

// Weighted random favouring the front of the list (geometric falloff).
function weightedPick<T>(arr: T[]): T {
  if (arr.length <= 1) return arr[0];
  const weights = arr.map((_, i) => Math.pow(0.55, i));
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
  const monsoon      = wet(ans);
  const end          = ans.endMin;
  const dayMins      = end - ans.startMin;
  const vegDay       = ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek);

  const corridor      = detectCorridor(ans);
  const corridorZones = CORRIDOR_ZONES[corridor];
  const recentEnvs:   string[] = []; // last 2 non-food environments for diversity scoring

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
      // Only suggest a restroom for outdoor/open-air stops — restaurants and indoor venues have their own.
      restroom:       (p.indoor || ["food", "cafe", "dessert"].includes(p.category)) ? undefined : restroomFor(zone),
      alternatives:   (result.alts ?? []).map(toAlt),
      kind,
    });

    runningCost += blockCost;
    cursor       = arrivalMin + dur;
    if (isFullMeal) lastMealEnd = cursor;
    (p.cuisines ?? []).forEach(c => usedCuisines.add(c));
    // Mark any request this place satisfies as done — won't boost further picks.
    for (let i = pendingRequests.length - 1; i >= 0; i--) {
      if (matchesRequest(p, [pendingRequests[i]])) pendingRequests.splice(i, 1);
    }
    if (zone !== "multiple") currentZone = zone;
    else if (FAR_RETURN[currentZone]) currentZone = "home"; // we've driven back to the city
    // Track environment for consecutive-diversity penalty (food slots vary naturally, skip them)
    if (!FULL_MEALS.includes(p.category) && p.category !== "rest") {
      recentEnvs.push(environment(p));
      if (recentEnvs.length > 2) recentEnvs.shift();
    }
    prevName = p.name;
    prevArea = p.area;
  };

  const longDay          = dayMins > 480;
  const remaining        = () => ans.budget - runningCost;
  const b                = () => bandFor(cursor);
  const pendingRequests  = [...(ans.mustInclude ?? [])];

  // Morning activity + café (early starts only).
  // Café budget is capped at 20% of total so an expensive brunch doesn't starve the rest of the day.
  if (ans.startMin < 660) {
    add(pick(pool, ans, b(), ["activity", "experience"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, pendingRequests, undefined, recentEnvs), "activity");
    const cafeBudget = Math.min(remaining(), Math.max(800, Math.round(ans.budget * 0.20)));
    add(pick(pool, ans, b(), ["cafe"], used, currentZone, corridorZones, cursor, cafeBudget, usedCuisines, pendingRequests, undefined, recentEnvs), "cafe");
  }

  // Lunch — reserve 35% of budget for post-lunch slots on the first food stop of the day,
  // so one expensive pick can't starve the rest of the plan.
  if (cursor < 960 && end > 780) {
    const hadFood = blocks.some(bl => FULL_MEALS.includes(bl.kind as Category));
    const lunchBudget = hadFood ? remaining() : Math.max(0, remaining() - Math.floor(ans.budget * 0.35));
    add(pick(pool, ans, b(), ["food"], used, currentZone, corridorZones, cursor, lunchBudget, usedCuisines, pendingRequests, ans.foods, recentEnvs), "food");
  }

  // Afternoon / first-half experience or shopping.
  // If this is the very first stop of the day (late starts skip opener + lunch), reserve 35%
  // so one expensive activity can't exhaust the budget and starve dessert/dinner.
  if (end > 840) {
    const firstStop = blocks.length === 0;
    const afternoonBudget = firstStop
      ? Math.max(0, remaining() - Math.floor(ans.budget * 0.35))
      : remaining();
    add(pick(pool, ans, b(), ["experience", "activity", "shopping"], used, currentZone, corridorZones, cursor, afternoonBudget, usedCuisines, pendingRequests, undefined, recentEnvs), "experience");
  }

  // Second afternoon slot: fills the pre-evening gap on long days (noon–midnight, 4pm–midnight).
  // No "cafe" here — morning cafés score high but fail meal spacing and cascade-block the slot.
  if (end - ans.startMin >= 360 && cursor < 1080 && end > 960) {
    add(pick(pool, ans, b(), ["experience", "activity", "shopping"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, pendingRequests, undefined, recentEnvs), "activity");
  }

  // Extra afternoon slot for very long days (6am–midnight etc.) — bridges the gap between
  // morning stops and the 6pm evening window, especially on tight budgets with free places.
  if (end - ans.startMin >= 720 && cursor < 1020 && end > 1080) {
    // If dinner will still fire (end>1140), hold back enough to cover it so shopping/experience
    // doesn't consume the entire remaining budget and leave nothing for food.
    const extraBudget = end > 1140
      ? Math.max(0, remaining() - Math.max(600, Math.floor(ans.budget * 0.20)))
      : remaining();
    add(pick(pool, ans, b(), ["experience", "activity", "shopping"], used, currentZone, corridorZones, cursor, extraBudget, usedCuisines, pendingRequests, undefined, recentEnvs), "experience");
  }

  // Mid-day rest — only if near home, long day, meaningful budget still left, and plan has content.
  if (longDay && cursor < 1140 && remaining() >= 1500 && blocks.length >= 2 &&
      (currentZone === "home" || currentZone === "andheri_w" || currentZone === "bandra")) {
    const restPlace = PLACES.find(p => p.category === "rest");
    if (restPlace) add({ place: restPlace, zone: "home" }, "rest");
  }

  // Evening activity / shopping — no cafe here (morning cafés always fail meal spacing at this hour)
  if (end > 1080) {
    // Hold back dinner budget so an expensive evening activity can't crowd out food.
    const eveningBudget = end > 1140
      ? Math.max(0, remaining() - Math.max(600, Math.floor(ans.budget * 0.20)))
      : remaining();
    add(pick(pool, ans, b(), ["activity", "experience", "shopping"], used, currentZone, corridorZones, cursor, eveningBudget, usedCuisines, pendingRequests, undefined, recentEnvs), "activity");
  }

  // Dinner
  if (end > 1140) {
    add(pick(pool, ans, b(), ["food"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, pendingRequests, ans.foods, recentEnvs), "food");
  }

  // Dessert
  if (end - cursor > 35) {
    add(pick(pool, ans, b(), ["dessert"], used, currentZone, corridorZones, cursor, remaining(), usedCuisines, pendingRequests, ans.foods, recentEnvs), "dessert");
  }

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
    const homeMins = travelMins(currentZone, "home", cursor);
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
  };

  return plan;
}
