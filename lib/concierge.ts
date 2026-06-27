import { Answers, Place, PlanBlock, Flag } from "./types";

// Women-friendly, reliably clean restrooms near each zone. Real, well-known options.
const RESTROOMS: Record<string, string> = {
  south:     "Cleanest nearby: the Taj or Trident lobby, or a Starbucks around Colaba/Fort.",
  bandra:    "Cleanest nearby: Taj Lands End lobby, or a Starbucks/Theobroma on Linking Road.",
  central:   "Cleanest nearby: Phoenix Palladium, Lower Parel.",
  andheri_w: "Cleanest nearby: Infiniti Mall, Andheri West.",
  borivali:  "Park toilets are basic; use a cafe restroom before you enter SGNP.",
  thane:     "Cleanest nearby: Viviana Mall, Thane.",
  gorai:     "Facilities at the pagoda are basic; go before the ferry.",
  vasai:     "Very limited; plan a stop at a highway cafe or fuel station on the way.",
  karjat:    "Very limited; use a known restaurant's restroom.",
  kolad:     "Very limited; rely on your resort or restaurant.",
  multiple:  "Use a nearby mall or a good cafe for a clean restroom.",
};

export function restroomFor(zone?: string): string | undefined {
  if (!zone || zone === "home") return undefined;
  return RESTROOMS[zone] ?? RESTROOMS.multiple;
}

// One practical outfit line synthesised from the day's venues + the season.
export function outfitFor(places: Place[], isMonsoon: boolean): string {
  const hasTemple   = places.some(p => (p.tags ?? []).includes("temple"));
  const hasFancy    = places.some(p => p.budgetLevel >= 4 || (p.mustBook && p.category === "food"));
  const hasOutdoor  = places.some(p => p.outdoor);
  const lotsWalking = places.filter(p => p.category === "shopping" || (p.outdoor && p.category !== "food")).length >= 2;

  const parts: string[] = [];
  parts.push(hasFancy
    ? "smart-casual she feels like the queen in, something that photographs well"
    : "something comfortable she feels great in");
  if (lotsWalking || hasOutdoor) parts.push("flats or block heels she can walk in all day");
  if (hasTemple) parts.push("covered shoulders and knees for the temple stop");
  if (isMonsoon) parts.push("quick-dry fabrics over silk or suede, and a compact umbrella in the bag");

  return parts.join("; ") + ".";
}

// Early heads-up flags so nothing surprises you on the day.
export function buildFlags(blocks: PlanBlock[], _ans: Answers, isMonsoon: boolean, vegDay: boolean): Flag[] {
  const flags: Flag[] = [];

  if (isMonsoon) {
    const outdoor = blocks.some(b => b.place?.outdoor);
    flags.push({
      icon: "🌧️",
      text: outdoor
        ? "It's peak monsoon. Carry a compact umbrella; outdoor stops have an indoor backup noted on each card."
        : "It's peak monsoon, but this plan stays mostly indoors, so rain won't break it.",
    });
  }

  const toBook = blocks.filter(b => b.place?.mustBook).map(b => b.title);
  if (toBook.length) flags.push({ icon: "📅", text: `Book a day ahead: ${toBook.join(", ")}.` });

  if (vegDay) flags.push({ icon: "🥬", text: "It's one of her veg days (Mon/Thu/Sat), so every food stop here is vegetarian." });

  if (blocks.some(b => (b.place?.tags ?? []).includes("temple")))
    flags.push({ icon: "🛕", text: "There's a temple stop: dress modestly and carry socks (shoes come off)." });

  return flags;
}
