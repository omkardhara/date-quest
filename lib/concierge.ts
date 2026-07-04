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

function rnd<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// One practical outfit line synthesised from the day's venues + the season.
// Multiple phrasings per condition so it reads fresh on every plan.
export function outfitFor(places: Place[], isMonsoon: boolean, month?: number): string {
  const hasTemple   = places.some(p => (p.tags ?? []).includes("temple"));
  const hasFancy    = places.some(p => p.budgetLevel >= 4 || (p.mustBook && p.category === "food"));
  const hasSpa      = places.some(p => (p.tags ?? []).includes("spa"));
  const hasOutdoor  = places.some(p => p.outdoor);
  const lotsWalking = places.filter(p => p.category === "shopping" || (p.outdoor && p.category !== "food")).length >= 2;

  const parts: string[] = [];

  if (hasFancy) {
    parts.push(isMonsoon
      ? rnd([
          "a breezy co-ord or flowy dress in a print you love — something that handles Mumbai humidity with grace and still looks great in a candlelit room",
          "a bold printed co-ord or a midi dress in quick-dry fabric — monsoon-proof but dinner-ready",
          "something you'd genuinely choose for a nice dinner, just in cotton or synthetic that doesn't sulk in the humidity",
        ])
      : rnd([
          "smart-casual you genuinely feel like the queen in — something that photographs naturally, not forced",
          "that dress or co-ord you always save for a good reason — today's a good reason",
          "an outfit you'd choose on your own for a day you actually care about — put-together without trying too hard",
          "something that reads 'effortlessly dressed' in photos, not 'made an effort' — you know the difference",
        ]));
  } else {
    parts.push(isMonsoon
      ? rnd([
          "comfortable separates you can move in — a light kurta or a casual dress you aren't precious about getting slightly damp",
          "easy, quick-dry separates — leave anything you love too much at home today",
          "a casual outfit in forgiving fabric; monsoon has opinions and will share them",
        ])
      : rnd([
          "something effortless you'd pick yourself on a free day",
          "easy and comfortable — whatever makes you feel like yourself without trying",
          "your go-to relaxed outfit; nothing needs to be impressive, just comfortable and you",
        ]));
  }

  if (hasSpa) parts.push(rnd([
    "you'll change at the spa, so comfortable separates that are easy to slip off and back on",
    "spa-friendly separates — easy layers you can take off without a whole production",
  ]));

  if (lotsWalking || hasOutdoor) parts.push(rnd([
    "block heels or ballet flats you can walk in for hours — not the ones that look great but hurt by noon",
    "something flat and comfortable on the feet — sneakers, ballet flats, anything that doesn't protest after 30 minutes",
    "wear shoes your feet actually get along with; this isn't a day for beautiful-but-painful",
  ]));

  if (hasTemple) parts.push(rnd([
    "covered shoulders and knees for the temple stop — a dupatta or light jacket in your bag works fine",
    "carry a dupatta or stole — you'll need to cover up at the temple, and it doubles as a layer later",
  ]));

  if (isMonsoon) parts.push(rnd([
    "quick-dry fabrics only, nothing silk or suede; a compact fold-up umbrella tucked in your bag",
    "leave the silk at home; pack a compact umbrella — Mumbai rains don't announce themselves",
    "fabrics that forgive water, shoes that handle a wet pavement, and an umbrella that actually fits in your bag",
  ]));
  else {
    const m = month ?? 10;
    if (m === 11 || m <= 1) parts.push(rnd([
      "light layers — evenings can get pleasantly cool this time of year",
      "carry a light jacket or stole for the evening; Mumbai nights are actually nice right now",
      "a layer for later — evenings are cooler than you'd expect in these months",
    ]));
    else if (m >= 3 && m <= 5) parts.push(rnd([
      "sunscreen and something light — it'll be hot; carry water",
      "light, breathable fabric and real sunscreen — not the SPF 15 one you've been meaning to replace",
      "it's going to be warm; dress for airflow, bring real sunscreen, and carry water",
    ]));
    else parts.push(rnd([
      "sunscreen and something breathable for the day",
      "breathable fabric — Mumbai's humidity will keep you honest",
      "light and breathable; sunscreen is non-negotiable even on overcast days",
    ]));
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

  if (vegDay) flags.push({ icon: "🥬", text: "It's one of your veg days (Mon/Thu/Sat), so every food stop here is vegetarian." });

  if (blocks.some(b => (b.place?.tags ?? []).includes("temple")))
    flags.push({ icon: "🛕", text: "There's a temple stop: dress modestly and carry socks (shoes come off)." });

  return flags;
}
