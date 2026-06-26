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
  kind: Category | "buffer";
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
}
