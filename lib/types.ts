export type Category = "activity" | "food" | "cafe" | "dessert" | "rest" | "experience" | "shopping";
export type TimeBand = "morning" | "afternoon" | "evening" | "night" | "any";

export interface Place {
  id: string;
  name: string;
  category: Category;
  area: string;
  zone?: string;            // geographic zone for routing: south, bandra, central, andheri_w, borivali, thane, vasai, karjat, kolad, gorai, multiple
  moods: string[];        // birthday, romantic, chill, adventure, celebrate
  vibes: string[];        // queen, adventure, peaceful, foodie, culture, playful
  cuisines: string[];     // for food/dessert: lebanese, chinese, dessert, icecream, indian...
  budgetLevel: 1 | 2 | 3 | 4;
  costPerPerson: number;  // approx INR
  durationMins: number;
  bestTime: TimeBand;
  indoor: boolean;        // used for rain backup
  adventureLevel: 0 | 1 | 2 | 3;
  bookingUrl?: string;
  mapsUrl: string;
  summary: string;        // one honest line about the place
  veg?: boolean;          // food/dessert: is a strong veg option available
  tags?: string[];        // instagrammable, lowcrowd, nature, waterfall, lakeside, brunch, exoticfruit, monsoon, sizzler
  contains?: string[];    // ingredients to match against dislikes (mushroom, capsicum, oily)
  safety?: string;        // optional seasonal/safety note
  topDishes?: string[];   // food/cafe/dessert: what to actually order
  mustBook?: boolean;     // reservation/booking strongly recommended
  outdoor?: boolean;      // exposed to rain (matters in monsoon)
  monsoonRisk?: "ok" | "caution" | "avoid"; // how it holds up in heavy monsoon
  closedDays?: number[];  // 0=Sun..6=Sat the venue is closed
}

export interface Answers {
  who: string;            // her name
  mood: string;
  personality: string[];  // queen, adventure, peaceful, foodie, playful, culture
  foods: string[];        // cuisines she wants
  budget: number;         // total INR
  startMin: number;       // minutes from midnight
  endMin: number;
  dayOfWeek?: number;     // 0=Sun..6=Sat, controls veg-day rule
  month?: number;         // 0=Jan..11=Dec, for monsoon-aware planning
  dislikes?: string[];    // ingredients to avoid
  mustInclude?: string[]; // specific activities the user already wants in the day
}

export interface TravelFromPrev {
  mins: number;
  fromLabel: string;      // "Home (Marol)" or previous place name
  directionsUrl: string;  // Google Maps directions link
}

export interface PlanBlock {
  startMin: number;
  endMin: number;
  title: string;
  place?: Place;
  why: string;            // narration (templated now, AI later)
  cost: number;
  travelFromPrev?: TravelFromPrev;
  backup?: string;        // rain / energy backup
  restroom?: string;      // nearest women-friendly restroom near this stop
  alternatives?: AltPlace[]; // swap options for this slot
  kind: Category | "buffer";
}

export interface AltPlace {
  id: string;
  name: string;
  area: string;
  summary: string;
  cost: number;
  mapsUrl: string;
  topDishes?: string[];
  mustBook?: boolean;
}

export interface Flag {
  icon: string;
  text: string;
}

export interface Plan {
  blocks: PlanBlock[];
  totalCost: number;
  budget: number;
  overBudget: boolean;
  greeting?: string;
  signoff?: string;
  fullDayMapUrl?: string; // Google Maps route with all waypoints
  requests?: string[];    // specific activities the user asked to include
  flags?: Flag[];         // early heads-up: monsoon, bookings, veg day
  outfit?: string;        // what to wear given the day's venues + weather
  weatherNote?: string;   // season/weather framing
}
