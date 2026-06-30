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
export function outfitFor(places: Place[], isMonsoon: boolean, month?: number): string {
  const hasTemple   = places.some(p => (p.tags ?? []).includes("temple"));
  const hasFancy    = places.some(p => p.budgetLevel >= 4 || (p.mustBook && p.category === "food"));
  const hasSpa      = places.some(p => (p.tags ?? []).includes("spa"));
  const hasOutdoor  = places.some(p => p.outdoor);
  const lotsWalking = places.filter(p => p.category === "shopping" || (p.outdoor && p.category !== "food")).length >= 2;

  const parts: string[] = [];

  if (hasFancy) {
    parts.push(isMonsoon
      ? "a breezy co-ord or flowy dress in a print she loves — something that handles July humidity with grace and still looks great in a candlelit room"
      : "smart-casual she genuinely feels like the queen in — something that photographs naturally, not forced");
  } else {
    parts.push(isMonsoon
      ? "comfortable separates she can move in — a light kurta or a casual dress she isn't precious about getting slightly damp"
      : "something effortless she'd pick herself on a free day");
  }

  if (hasSpa) parts.push("she'll change at the spa, so comfortable separates that are easy to slip off and back on");
  if (lotsWalking || hasOutdoor) parts.push("block heels or ballet flats she can walk in for hours — not the ones that look great but hurt by noon");
  if (hasTemple) parts.push("covered shoulders and knees for the temple stop — a dupatta or light jacket in the bag works fine");
  if (isMonsoon) parts.push("quick-dry fabrics only, nothing silk or suede; a compact fold-up umbrella tucked in her bag");
  else {
    const m = month ?? 10;
    if (m === 11 || m <= 1) parts.push("light layers — evenings can get pleasantly cool this time of year");
    else if (m >= 3 && m <= 5) parts.push("sunscreen and something light — it'll be hot; carry water");
    else parts.push("sunscreen and something breathable for the day");
  }

  return parts.join("; ") + ".";
}

// Early heads-up flags so nothing surprises you on the day.
export function buildFlags(blocks: PlanBlock[], ans: Answers, isWet: boolean, vegDay: boolean): Flag[] {
  const flags: Flag[] = [];

  const outdoor = blocks.some(b => b.place?.outdoor);
  if (ans.weatherSummary) {
    // Live forecast available — be specific.
    flags.push({
      icon: isWet ? "🌧️" : "⛅",
      text: isWet
        ? `Forecast: ${ans.weatherSummary}. Rain is likely, so the plan leans indoors and every outdoor stop has a backup.`
        : `Forecast: ${ans.weatherSummary}. Looking dry, so outdoor stops are in.`,
    });
  } else if (isWet) {
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
