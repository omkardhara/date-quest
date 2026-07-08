import { Answers, Place, Category } from "./types";
import { searchPlaces, LivePlace } from "./google";
import { zonesForAnswers } from "./engine";
import { resolveZone } from "./areas";
import { PROFILE } from "./profile";

// Zone → a Google-friendly search area string.
const ZONE_AREA: Record<string, string> = {
  bandra:    "Bandra West, Mumbai",
  south:     "Colaba and Fort, South Mumbai",
  central:   "Lower Parel and Byculla, Mumbai",
  andheri_w: "Andheri West, Mumbai",
  borivali:  "Borivali, Mumbai",
  thane:     "Thane West",
  vasai:     "Vasai, Maharashtra",
  karjat:    "Karjat, Maharashtra",
  kolad:     "Kolad, Raigad, Maharashtra",
  gorai:     "Gorai, Borivali West, Mumbai",
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

const FREE_PLACE_TYPES = new Set(["place_of_worship","hindu_temple","mosque","church","buddhist_temple","jain_temple","synagogue","cemetery","park","national_park","nature_reserve"]);
function costFrom(pl?: string, types: string[] = []): number {
  if (types.some(t => FREE_PLACE_TYPES.has(t))) return 0;
  return pl ? PRICE[pl] ?? 600 : 600;
}
function budgetLevelFrom(cost: number): 1 | 2 | 3 | 4 { return cost <= 300 ? 1 : cost <= 800 ? 2 : cost <= 1500 ? 3 : 4; }

function catFromTypes(types: string[] = []): Category {
  if (types.some(t => ["ice_cream_shop", "bakery", "dessert_shop"].includes(t))) return "dessert";
  if (types.some(t => ["cafe", "coffee_shop"].includes(t))) return "cafe";
  if (types.some(t => ["restaurant", "meal_takeaway", "fine_dining_restaurant"].includes(t))) return "food";
  if (types.some(t => ["shopping_mall", "clothing_store", "market", "store"].includes(t))) return "shopping";
  return "experience";
}

// Pick a realistic bestTime for a live place so the time-band gate works properly.
function bestTimeFor(category: Category): import("./types").TimeBand {
  if (category === "cafe") return "morning";
  if (category === "food") return "afternoon"; // prevents live restaurants showing up at 8am
  if (category === "dessert") return "afternoon";
  if (category === "activity") return "afternoon"; // prevents dawn suggestions (water parks at 6am etc.)
  return "afternoon"; // experience, shopping
}

// Generate a warm, human fallback when Google has no editorial summary.
function fallbackSummary(lp: LivePlace, category: Category): string {
  const r = lp.rating ? `${lp.rating}★` : null;
  const loc = lp.address?.split(",")[0]?.trim();
  if (category === "food") return [r && `${r} on Google.`, loc && `Found in ${loc}.`, "Check the menu before you go."].filter(Boolean).join(" ");
  if (category === "cafe") return [r && `${r} on Google.`, "A well-reviewed local café — good for coffee and a bite."].filter(Boolean).join(" ");
  if (category === "dessert") return [r && `${r} on Google.`, "Worth the stop for something sweet."].filter(Boolean).join(" ");
  if (category === "activity" || category === "experience") return [r && `${r} on Google.`, loc && `In ${loc}.`, "A locally rated spot to explore."].filter(Boolean).join(" ");
  return r ? `${r} on Google.` : "A local pick worth exploring.";
}

function toPlace(lp: LivePlace, zone: string, category: Category, mood: string, cuisine?: string, outdoor = false, extraVibes: string[] = []): Place {
  const cost = costFrom(lp.priceLevel, lp.types ?? []);
  return {
    id: "live:" + lp.id,
    name: lp.name,
    area: lp.address?.split(",").slice(0, 2).join(",").trim() || ZONE_AREA[zone] || zone,
    zone,
    category,
    moods: [mood],
    vibes: Array.from(new Set([...(VIBES[category] ?? []), ...extraVibes])),
    cuisines: cuisine ? [cuisine] : [],
    budgetLevel: budgetLevelFrom(cost),
    costPerPerson: cost,
    durationMins: DUR[category] ?? 75,
    bestTime: bestTimeFor(category),
    indoor: !outdoor,
    outdoor,
    monsoonRisk: outdoor ? "caution" : "ok",
    adventureLevel: 0,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lp.name)}&query_place_id=${lp.id}`,
    summary: lp.summary ?? fallbackSummary(lp, category),
    veg: undefined,
    tags: [],
    rating: lp.rating,
    source: "live",
  };
}

function foodCat(cuisine: string): Category {
  return ["dessert", "icecream", "coffee"].includes(cuisine) ? "dessert" : "food";
}

// Pick an activity/experience search query that actually reflects the user's personality.
function activityQuery(personality: string[], area: string): string {
  const p = personality;
  if (p.includes("adventure"))                    return `outdoor adventure activities parks in ${area}`;
  if (p.includes("artsy") || p.includes("culture")) return `art galleries museums creative spaces in ${area}`;
  if (p.includes("spiritual"))                    return `temples heritage spiritual places in ${area}`;
  if (p.includes("nightlife"))                    return `bars live music rooftop venues in ${area}`;
  if (p.includes("luxe") || p.includes("queen"))  return `luxury upscale experiences fine dining in ${area}`;
  if (p.includes("nature"))                       return `parks gardens nature walks in ${area}`;
  if (p.includes("cozy"))                         return `cozy cafes bookstores quiet spaces in ${area}`;
  if (p.includes("shopper"))                      return `best shopping markets boutiques in ${area}`;
  if (p.includes("playful"))                      return `fun activities games entertainment in ${area}`;
  return `unique experiences things to do in ${area}`;
}

function restaurantQuery(personality: string[], area: string): string {
  const p = personality;
  if (p.includes("luxe") || p.includes("queen"))  return `fine dining upscale restaurants in ${area}`;
  if (p.includes("cozy"))                         return `cozy casual restaurants in ${area}`;
  if (p.includes("romantic"))                     return `romantic restaurants with view in ${area}`;
  if (p.includes("artsy"))                        return `trendy independent restaurants in ${area}`;
  if (p.includes("nature") || p.includes("peaceful")) return `outdoor garden restaurants in ${area}`;
  return `popular local restaurants in ${area}`;
}

// Pull live, real places for the day's zones + tastes and normalise them for the engine.
export async function discoverPlaces(ans: Answers): Promise<Place[]> {
  const zones = zonesForAnswers(ans).filter(z => ZONE_AREA[z]).slice(0, 3);
  if (!zones.length) return [];
  const vegDay = ans.dayOfWeek !== undefined && PROFILE.vegDays.includes(ans.dayOfWeek);
  const mood = ans.mood;
  const personality = (ans.personality ?? []).map(p => p.toLowerCase());

  const tasks: Promise<Place[]>[] = [];
  for (const zone of zones) {
    // Prefer the specific locality the user picked/typed (e.g. "Powai") over the zone's
    // broad canonical text (e.g. "Andheri West, Mumbai") so live search surfaces places
    // actually in that named neighbourhood, not just anywhere sharing its zone code.
    const areaLabel = ans.areaLabels?.find(l => resolveZone(l) === zone);
    const area = areaLabel ?? ZONE_AREA[zone];

    // Restaurants by cuisine — skipped on veg days since live veg status is unknown.
    if (!vegDay) {
      for (const c of (ans.foods ?? []).slice(0, 3)) {
        const cLabel = c === "icecream" ? "ice cream" : c;
        tasks.push(searchPlaces(`best ${cLabel} restaurants in ${area}`, 4).then(rs => rs.map(r => toPlace(r, zone, foodCat(c), mood, c))));
      }
      // Pass personality vibes so live restaurants score properly for luxe/romantic/etc.
      const restVibes = personality.filter(p => ["luxe","romantic","cozy","artsy","nightlife"].includes(p));
      tasks.push(searchPlaces(restaurantQuery(personality, area), 3).then(rs => rs.map(r => toPlace(r, zone, "food", mood, undefined, false, restVibes))));
    }

    // Personality-aware activity + experience search — pass matching vibes through.
    const actVibes = personality.filter(p => ["adventure","artsy","culture","nightlife","nature","spiritual","luxe","queen","cozy","romantic"].includes(p));
    tasks.push(searchPlaces(activityQuery(personality, area), 4).then(rs => rs.map(r => {
      const cat = catFromTypes(r.types);
      const outdoor = (r.types ?? []).some(t => ["park", "tourist_attraction", "hiking_area", "beach"].includes(t)) && !(r.types ?? []).includes("museum");
      return toPlace(r, zone, cat, mood, undefined, outdoor, actVibes);
    })));
    tasks.push(searchPlaces(`best cafes in ${area}`, 3).then(rs => rs.map(r => toPlace(r, zone, "cafe", mood, "cafe", false, ["cozy"]))));
  }

  const all = (await Promise.all(tasks)).flat();
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const p of all) if (p.name && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
  // Drop live activities that would eat too large a share of the day's budget.
  const maxActivity2 = Math.max(800, Math.round(ans.budget * 0.35));
  return out.filter(p => p.category !== "activity" || p.costPerPerson * 2 <= maxActivity2);
}
