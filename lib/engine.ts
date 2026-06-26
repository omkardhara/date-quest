import placesData from "@/data/places.json";
import { Answers, Place, Plan, PlanBlock, Category } from "./types";
import { PROFILE } from "./profile";
import { narrate, greeting, signoff } from "./narrate";

const PLACES = placesData as Place[];

// ─── Zones ───────────────────────────────────────────────────────────────────
type Zone = "home" | "bandra" | "south" | "central" | "andheri_w" | "borivali" | "thane" | "vasai" | "karjat" | "kolad" | "gorai" | "multiple";

// Base travel times in minutes (off-peak daytime, private vehicle).
// Keys are always alphabetically sorted zone pairs.
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
  // Evening rush 5–8 pm: +40 %
  if (atMin >= 1020 && atMin < 1200) return Math.round(base * 1.4);
  // Midday 12–3 pm: +20 %
  if (atMin >= 720 && atMin < 900) return Math.round(base * 1.2);
  return base;
}

// ─── Corridors ────────────────────────────────────────────────────────────────
// Each corridor is an ordered list of zones the day is allowed to draw from.
// "multiple" is always included — those places work anywhere.
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

  // Far-out full-day adventures only if leaving very early and have all day
  if (p.includes("adventure") && ans.startMin <= 480 && dayMins >= 660) return "full_day_out";

  // North adventure (Borivali/SGNP) — needs early start
  if (p.includes("adventure") && ans.startMin <= 600 && dayMins >= 480) return "north_adventure";

  // Thane east — adventure with later start, avoids massive north drive
  if (p.includes("adventure")) return "thane_east";

  // South loop — culture, spiritual, romantic sightseeing day
  if (p.includes("culture") || p.includes("spiritual") || ans.mood === "romantic") return "south_loop";

  // Default: Bandra hub — closest to home, most food/shopping options
  return "bandra_hub";
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
const FOODY: Category[] = ["food", "dessert"];

function bandFor(min: number): string {
  if (min < 720)  return "morning";
  if (min < 1020) return "afternoon";
  if (min < 1200) return "evening";
  return "night";
}

function overlap(a: string[] = [], b: string[] = []): number {
  return a.filter(x => b.includes(x)).length;
}

function score(p: Place, ans: Answers, band: string): number {
  let s = 0;
  s += overlap(p.vibes, ans.personality) * 3;
  if (p.moods.includes(ans.mood)) s += 2;
  if (p.bestTime === band || p.bestTime === "any") s += 2;
  if (FOODY.includes(p.category)) s += overlap(p.cuisines, ans.foods) * 4;
  s += overlap(p.tags ?? [], PROFILE.loves) * 2;
  if (p.costPerPerson * 2 <= ans.budget / 2) s += 1;
  if (ans.personality.includes("adventure")) s += p.adventureLevel;
  if (ans.personality.includes("peaceful"))  s += 3 - p.adventureLevel;
  return s;
}

function blocked(p: Place, ans: Answers): boolean {
  if (FOODY.includes(p.category) && ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek) && p.veg === false) return true;
  if (ans.dislikes && overlap(p.contains ?? [], ans.dislikes) > 0) return true;
  return false;
}

// Pick best place from the corridor, penalising those far from currentZone.
function pick(
  ans: Answers,
  band: string,
  cats: Category[],
  used: Set<string>,
  currentZone: Zone,
  corridorZones: Zone[],
  cuisineFilter?: string[],
): { place: Place; zone: Zone } | undefined {
  const pool = PLACES.filter(p =>
    cats.includes(p.category) &&
    !used.has(p.id) &&
    !blocked(p, ans) &&
    (corridorZones.includes((p.zone ?? "multiple") as Zone) || (p.zone ?? "multiple") === "multiple") &&
    (!cuisineFilter?.length || overlap(p.cuisines ?? [], cuisineFilter) > 0),
  );
  if (!pool.length) return undefined;

  const best = pool.sort((a, b) => {
    const az = (a.zone ?? "multiple") as Zone;
    const bz = (b.zone ?? "multiple") as Zone;
    // Penalise travel cost in scoring (divide by 15 to keep units comparable)
    const as = score(a, ans, band) - travelMins(currentZone, az, 720) / 15;
    const bs = score(b, ans, band) - travelMins(currentZone, bz, 720) / 15;
    return bs - as;
  })[0];

  return { place: best, zone: (best.zone ?? "multiple") as Zone };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function transportFor() {
  return { publicOption: PROFILE.transport.publicOption, privateOption: PROFILE.transport.privateOption };
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
  const used      = new Set<string>();
  const blocks:    PlanBlock[] = [];
  let cursor       = ans.startMin;
  let currentZone: Zone = "home";
  const end        = ans.endMin;
  const dayMins    = end - ans.startMin;
  const vegDay     = ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek);

  const corridor      = detectCorridor(ans);
  const corridorZones = CORRIDOR_ZONES[corridor];

  // Add a block, accounting for real travel time from the previous zone.
  const add = (result: { place: Place; zone: Zone } | undefined, kind: Category) => {
    if (!result || cursor >= end) return;
    const { place: p, zone } = result;
    const tripMins   = travelMins(currentZone, zone, cursor);
    const arrivalMin = cursor + tripMins;
    if (arrivalMin + 20 > end) return; // not enough time after travel
    const dur = Math.min(p.durationMins, end - arrivalMin);
    used.add(p.id);
    blocks.push({
      startMin:  arrivalMin,
      endMin:    arrivalMin + dur,
      title:     p.name,
      place:     p,
      why:       narrate(p, ans),
      cost:      p.costPerPerson * 2,
      transport: blocks.length === 0 ? undefined : transportFor(),
      backup:    backupFor(p),
      kind,
    });
    cursor = arrivalMin + dur;
    if (zone !== "multiple") currentZone = zone;
  };

  const longDay = dayMins > 480;

  // Morning activity + café (if early start)
  if (ans.startMin < 660) {
    add(pick(ans, "morning", ["activity", "experience"], used, currentZone, corridorZones), "activity");
    add(pick(ans, "morning", ["cafe"], used, currentZone, corridorZones), "cafe");
  }

  // Lunch
  if (cursor < 900 && end > 780) {
    add(pick(ans, "afternoon", ["food"], used, currentZone, corridorZones, ans.foods), "food");
  }

  // Afternoon experience / shopping
  if (end > 900) {
    add(pick(ans, "afternoon", ["experience", "activity", "shopping"], used, currentZone, corridorZones), "experience");
  }

  // Mid-day rest — only worthwhile if we're near home already
  if (longDay && cursor < 1140 && (currentZone === "home" || currentZone === "andheri_w" || currentZone === "bandra")) {
    const restPlace = PLACES.find(p => p.category === "rest");
    if (restPlace) add({ place: restPlace, zone: "home" }, "rest");
  }

  // Evening activity
  if (end > 1080) {
    add(pick(ans, "evening", ["activity", "experience", "shopping", "cafe"], used, currentZone, corridorZones), "activity");
  }

  // Dinner
  if (end > 1140) {
    add(pick(ans, "night", ["food"], used, currentZone, corridorZones, ans.foods), "food");
  }

  // Dessert
  if (end - cursor > 15) {
    add(pick(ans, "night", ["dessert"], used, currentZone, corridorZones, ans.foods), "dessert");
  }

  const totalCost = blocks.reduce((s, b) => s + b.cost, 0);
  const plan: Plan = {
    blocks,
    totalCost,
    budget:     ans.budget,
    overBudget: totalCost > ans.budget,
    greeting:   greeting(ans),
    signoff:    signoff(),
  };

  if (vegDay && blocks.length) {
    blocks[0].backup = `Heads up: it's a veg day (Mon, Thu, Sat), so every food stop is vegetarian. ${blocks[0].backup ?? ""}`.trim();
  }

  return plan;
}
