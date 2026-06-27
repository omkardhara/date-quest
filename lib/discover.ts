import { Answers, Place, Category } from "./types";
import { searchPlaces, LivePlace } from "./google";
import { zonesForAnswers } from "./engine";
import { PROFILE } from "./profile";

// Zone → a Google-friendly search area string.
const ZONE_AREA: Record<string, string> = {
  bandra:    "Bandra West, Mumbai",
  south:     "Colaba and Fort, South Mumbai",
  central:   "Lower Parel and Byculla, Mumbai",
  andheri_w: "Andheri West, Mumbai",
  borivali:  "Borivali, Mumbai",
  thane:     "Thane West",
};

const PRICE: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 300,
  PRICE_LEVEL_MODERATE: 700,
  PRICE_LEVEL_EXPENSIVE: 1300,
  PRICE_LEVEL_VERY_EXPENSIVE: 2200,
};

const DUR: Record<string, number> = { food: 80, cafe: 60, dessert: 30, experience: 90, activity: 90, shopping: 75 };
const VIBES: Record<string, string[]> = {
  food: ["foodie"], cafe: ["foodie", "peaceful"], dessert: ["foodie", "playful"],
  experience: ["culture"], activity: ["adventure"], shopping: ["shopper"],
};

function costFrom(pl?: string): number { return pl ? PRICE[pl] ?? 600 : 600; }
function budgetLevelFrom(cost: number): 1 | 2 | 3 | 4 { return cost <= 300 ? 1 : cost <= 800 ? 2 : cost <= 1500 ? 3 : 4; }

function catFromTypes(types: string[] = []): Category {
  if (types.some(t => ["ice_cream_shop", "bakery", "dessert_shop"].includes(t))) return "dessert";
  if (types.some(t => ["cafe", "coffee_shop"].includes(t))) return "cafe";
  if (types.some(t => ["restaurant", "meal_takeaway", "fine_dining_restaurant"].includes(t))) return "food";
  if (types.some(t => ["shopping_mall", "clothing_store", "market", "store"].includes(t))) return "shopping";
  return "experience";
}

function toPlace(lp: LivePlace, zone: string, category: Category, mood: string, cuisine?: string, outdoor = false): Place {
  const cost = costFrom(lp.priceLevel);
  return {
    id: "live:" + lp.id,
    name: lp.name,
    area: lp.address?.split(",").slice(0, 2).join(",").trim() || ZONE_AREA[zone] || zone,
    zone,
    category,
    moods: [mood],
    vibes: VIBES[category] ?? [],
    cuisines: cuisine ? [cuisine] : [],
    budgetLevel: budgetLevelFrom(cost),
    costPerPerson: cost,
    durationMins: DUR[category] ?? 75,
    bestTime: "any",
    indoor: !outdoor,
    outdoor,
    monsoonRisk: outdoor ? "caution" : "ok",
    adventureLevel: 0,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lp.name)}&query_place_id=${lp.id}`,
    summary: lp.summary ?? `Rated ${lp.rating ?? "—"}★ on Google${lp.userRatings ? ` (${lp.userRatings.toLocaleString("en-IN")} reviews)` : ""}.`,
    veg: undefined,
    tags: [],
    rating: lp.rating,
    source: "live",
  };
}

function foodCat(cuisine: string): Category {
  return ["dessert", "icecream", "coffee"].includes(cuisine) ? "dessert" : "food";
}

// Pull live, real places for the day's zones + tastes and normalise them for the engine.
export async function discoverPlaces(ans: Answers): Promise<Place[]> {
  const zones = zonesForAnswers(ans).filter(z => ZONE_AREA[z]).slice(0, 2);
  if (!zones.length) return [];
  const vegDay = ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek);
  const mood = ans.mood;

  const tasks: Promise<Place[]>[] = [];
  for (const zone of zones) {
    const area = ZONE_AREA[zone];

    // Restaurants by cuisine — skipped on veg days since live veg status is unknown.
    if (!vegDay) {
      for (const c of (ans.foods ?? []).slice(0, 3)) {
        tasks.push(searchPlaces(`best ${c} restaurants in ${area}`, 4).then(rs => rs.map(r => toPlace(r, zone, foodCat(c), mood, c))));
      }
      tasks.push(searchPlaces(`popular highly rated restaurants in ${area}`, 3).then(rs => rs.map(r => toPlace(r, zone, "food", mood))));
    }

    // Things to do + cafes for breadth.
    tasks.push(searchPlaces(`top things to do in ${area}`, 4).then(rs => rs.map(r => {
      const cat = catFromTypes(r.types);
      const outdoor = (r.types ?? []).some(t => ["park", "tourist_attraction", "hiking_area", "beach"].includes(t)) && !(r.types ?? []).includes("museum");
      return toPlace(r, zone, cat, mood, undefined, outdoor);
    })));
    tasks.push(searchPlaces(`best cafes in ${area}`, 3).then(rs => rs.map(r => toPlace(r, zone, "cafe", mood, "cafe"))));
  }

  const all = (await Promise.all(tasks)).flat();
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const p of all) if (p.name && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
  return out;
}
