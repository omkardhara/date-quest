import placesData from "@/data/places.json";
import { Answers, Place, Plan, PlanBlock, Category, TravelFromPrev } from "./types";
import { PROFILE } from "./profile";
import { narrate, greeting, signoff } from "./narrate";

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
  "gorai-home":         90,
  "home-south":         60,
  "home-thane":         45,
  "karjat-home":       150,
  "kolad-home":        150,
  "thane-vasai":       140,
};

function travelMins(from: Zone, to: Zone, atMin: number): number {
  if (from === to || from === "multiple" || to === "multiple") return 10;
  const key = [from, to].sort().join("-");
  const base = TRAVEL_BASE[key] ?? 60;
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
  if (p.includes("adventure") && ans.startMin <= 480 && dayMins >= 660) return "full_day_out";
  if (p.includes("adventure") && ans.startMin <= 600 && dayMins >= 480) return "north_adventure";
  if (p.includes("adventure")) return "thane_east";
  if (p.includes("culture") || p.includes("spiritual") || ans.mood === "romantic") return "south_loop";
  return "bandra_hub";
}

// ─── Scoring & filtering ──────────────────────────────────────────────────────
const MEAL_CATS: Category[] = ["food", "cafe", "dessert"];
const FOODY:     Category[] = ["food", "dessert"];

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
    case "morning":   return atMin < 780;   // before 1 pm
    case "afternoon": return atMin >= 660 && atMin < 1140; // 11 am – 7 pm
    case "evening":   return atMin >= 900;  // after 3 pm
    case "night":     return atMin >= 1080; // after 6 pm
    default:          return true;
  }
}

function score(p: Place, ans: Answers, band: string, remainingBudget: number): number {
  let s = 0;
  s += overlap(p.vibes, ans.personality) * 3;
  if (p.moods.includes(ans.mood)) s += 2;
  if (p.bestTime === band || p.bestTime === "any") s += 2;
  if (FOODY.includes(p.category)) s += overlap(p.cuisines, ans.foods) * 4;
  s += overlap(p.tags ?? [], PROFILE.loves) * 2;
  const cost = p.costPerPerson * 2;
  if (cost <= remainingBudget)        s += 2;
  else if (cost > remainingBudget * 1.3) s -= 5; // strong penalty for busting budget
  if (ans.personality.includes("adventure")) s += p.adventureLevel;
  if (ans.personality.includes("peaceful"))  s += 3 - p.adventureLevel;
  return s;
}

function blocked(p: Place, ans: Answers): boolean {
  if (FOODY.includes(p.category) && ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek) && p.veg === false) return true;
  if (ans.dislikes && overlap(p.contains ?? [], ans.dislikes) > 0) return true;
  return false;
}

function pick(
  ans: Answers, band: string, cats: Category[],
  used: Set<string>, currentZone: Zone, corridorZones: Zone[],
  atMin: number, remainingBudget: number,
  cuisineFilter?: string[],
): { place: Place; zone: Zone } | undefined {
  const pool = PLACES.filter(p =>
    cats.includes(p.category) &&
    !used.has(p.id) &&
    !blocked(p, ans) &&
    timeAllowed(p, atMin) &&
    (corridorZones.includes((p.zone ?? "multiple") as Zone) || (p.zone ?? "multiple") === "multiple") &&
    (!cuisineFilter?.length || overlap(p.cuisines ?? [], cuisineFilter) > 0),
  );
  if (!pool.length) return undefined;

  const best = pool.sort((a, b) => {
    const az = (a.zone ?? "multiple") as Zone;
    const bz = (b.zone ?? "multiple") as Zone;
    const as = score(a, ans, band, remainingBudget) - travelMins(currentZone, az, atMin) / 15;
    const bs = score(b, ans, band, remainingBudget) - travelMins(currentZone, bz, atMin) / 15;
    return bs - as;
  })[0];

  return { place: best, zone: (best.zone ?? "multiple") as Zone };
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
export function buildPlan(ans: Answers): Plan {
  const used       = new Set<string>();
  const blocks:      PlanBlock[] = [];
  let cursor         = ans.startMin;
  let currentZone:   Zone = "home";
  let prevName       = "Home (Marol)";
  let prevArea       = "Marol, Andheri East";
  let runningCost    = 0;
  let lastMealEnd    = 0; // track when last food/cafe ended for spacing
  const end          = ans.endMin;
  const dayMins      = end - ans.startMin;
  const vegDay       = ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek);

  const corridor      = detectCorridor(ans);
  const corridorZones = CORRIDOR_ZONES[corridor];

  const add = (result: { place: Place; zone: Zone } | undefined, kind: Category) => {
    if (!result || cursor >= end) return;
    const { place: p, zone } = result;

    // Meal spacing: need at least 150 min gap between food/cafe stops
    const isMeal = MEAL_CATS.includes(p.category);
    if (isMeal && lastMealEnd > 0) {
      const gap = cursor - lastMealEnd;
      if (gap < 150) return;
    }

    const tripMins   = travelMins(currentZone, zone, cursor);
    const arrivalMin = cursor + tripMins;
    if (arrivalMin + 20 > end) return;

    // Hard budget cap: skip if this stop would push 20 % over budget
    const blockCost = p.costPerPerson * 2;
    if (runningCost + blockCost > ans.budget * 1.2) return;

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
      kind,
    });

    runningCost += blockCost;
    cursor       = arrivalMin + dur;
    if (isMeal) lastMealEnd = cursor;
    if (zone !== "multiple") currentZone = zone;
    prevName = p.name;
    prevArea = p.area;
  };

  const longDay = dayMins > 480;
  const remaining = () => ans.budget - runningCost;

  // Morning activity + café (early starts only)
  if (ans.startMin < 660) {
    add(pick(ans, "morning", ["activity", "experience"], used, currentZone, corridorZones, cursor, remaining()), "activity");
    add(pick(ans, "morning", ["cafe"], used, currentZone, corridorZones, cursor, remaining()), "cafe");
  }

  // Lunch — only if it's been 150+ min since breakfast (handled inside add)
  if (cursor < 900 && end > 780) {
    add(pick(ans, "afternoon", ["food"], used, currentZone, corridorZones, cursor, remaining(), ans.foods), "food");
  }

  // Afternoon experience / shopping
  if (end > 900) {
    add(pick(ans, "afternoon", ["experience", "activity", "shopping"], used, currentZone, corridorZones, cursor, remaining()), "experience");
  }

  // Mid-day rest — only if we're near home and it's a long day
  if (longDay && cursor < 1140 && (currentZone === "home" || currentZone === "andheri_w" || currentZone === "bandra")) {
    const restPlace = PLACES.find(p => p.category === "rest");
    if (restPlace) add({ place: restPlace, zone: "home" }, "rest");
  }

  // Evening activity
  if (end > 1080) {
    add(pick(ans, "evening", ["activity", "experience", "shopping", "cafe"], used, currentZone, corridorZones, cursor, remaining()), "activity");
  }

  // Dinner
  if (end > 1140) {
    add(pick(ans, "night", ["food"], used, currentZone, corridorZones, cursor, remaining(), ans.foods), "food");
  }

  // Dessert
  if (end - cursor > 15) {
    add(pick(ans, "night", ["dessert"], used, currentZone, corridorZones, cursor, remaining(), ans.foods), "dessert");
  }

  // Full-day map URL with all waypoints
  const waypoints = blocks.filter(b => b.place).map(b => `${b.place!.name}, ${b.place!.area}, Mumbai`);
  const fullDayMapUrl = waypoints.length >= 2
    ? `https://www.google.com/maps/dir/${waypoints.map(w => encodeURIComponent(w)).join("/")}`
    : undefined;

  const totalCost = blocks.reduce((s, b) => s + b.cost, 0);
  const plan: Plan = {
    blocks,
    totalCost,
    budget:     ans.budget,
    overBudget: totalCost > ans.budget,
    greeting:   greeting(ans),
    signoff:    signoff(),
    fullDayMapUrl,
  };

  if (vegDay && blocks.length) {
    blocks[0].backup = `Heads up: it's a veg day (Mon, Thu, Sat), so every food stop is vegetarian. ${blocks[0].backup ?? ""}`.trim();
  }

  return plan;
}
