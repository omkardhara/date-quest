import getawayData from "@/data/getaways.json";
import { Place, PlanBlock, GetawayPlan, GetawayDay, AltPlace, Flag, Category } from "./types";
import { searchPlaces, searchPlace, LivePlace } from "./google";

interface Highlight { name: string; kind: string; outdoor?: boolean; monsoonRisk?: "ok" | "caution" | "avoid"; note: string; }
interface TravelAlt { mode: "train" | "flight"; note: string; }
interface Dest {
  id: string; name: string; region: string;
  driveFromMumbaiMins: number; driveFromMumbaiKm: number;
  driveFromPuneMins: number; driveFromPuneKm: number;
  travelAlt?: TravelAlt[];
  monsoon: "great" | "caution" | "poor"; bestMonths: string; summary: string;
  vibes: string[]; highlights: Highlight[]; stays: string[]; eat: string[];
}

const DESTS = getawayData as Dest[];

function rnd<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

const MUMBAI_COORD = { lat: 19.07, lng: 72.88 };
const PUNE_COORD = { lat: 18.52, lng: 73.86 };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// A destination the user typed in themselves (e.g. "Diveagar", "Bilimora") that isn't one
// of our curated picks. Geocodes it via Places, then estimates drive time from straight-line
// distance the same way engine.ts does for Mumbai legs — everything else (highlights, eats,
// stays) is left empty so buildGetaway falls through entirely to its own live-search paths.
async function buildCustomDest(name: string): Promise<Dest | null> {
  const geo = await searchPlace(`${name}, India`);
  if (!geo.found || geo.lat == null || geo.lng == null) return null;
  // Google's Places search is typo-tolerant (e.g. "Divyaghar" still resolves to the real
  // Diveagar) — use its corrected canonical name for display and for every downstream
  // search query, rather than echoing back whatever the user actually typed.
  const displayName = geo.name ?? name;
  const kmFromMumbai = haversineKm(MUMBAI_COORD.lat, MUMBAI_COORD.lng, geo.lat, geo.lng) * 1.3;
  const kmFromPune = haversineKm(PUNE_COORD.lat, PUNE_COORD.lng, geo.lat, geo.lng) * 1.3;
  // ~45km/h effective speed for highway/ghat driving outside the city, matching the kind
  // of routes our curated destinations are on.
  const minsFromMumbai = Math.max(60, Math.round(kmFromMumbai / 45 * 60));
  const minsFromPune = Math.max(45, Math.round(kmFromPune / 45 * 60));
  return {
    id: "custom", name: displayName, region: "your own pick",
    driveFromMumbaiMins: minsFromMumbai, driveFromMumbaiKm: Math.round(kmFromMumbai),
    driveFromPuneMins: minsFromPune, driveFromPuneKm: Math.round(kmFromPune),
    monsoon: "caution", bestMonths: "check locally for the best season",
    summary: `A getaway to ${displayName} — since this isn't one of our curated picks yet, distances are estimated and the highlights, food, and stays below come straight from live search.`,
    vibes: [], highlights: [], stays: [], eat: [],
  };
}

function getawayOutfitFor(d: Dest, highlights: Highlight[], isMonsoon: boolean, month?: number): string {
  const text = highlights.map(h => h.name + " " + h.note).join(" ").toLowerCase();
  const hasTrek    = /trek|trail|hike|climb|peak|fort|rappel|waterfall/.test(text);
  const hasBeach   = /\bbeach\b|\bcoast\b|\bsea\b|\bsand\b|\bshore\b/.test(text);
  const isHill     = /\bghat|\bhill\b|\bvalley\b|\bghats\b/.test(d.region.toLowerCase()) || /mahabaleshwar|lonavala|jawhar|malshej|mulshi|bhandardara/.test(d.id);
  const hasTemple  = /\btemple\b|\bmandir\b|\bdargah\b|\bchurch\b|\biskcon\b|\bcaves\b/.test(text);
  const hasWater   = /waterfall|river|\blake\b|\bdam\b|rafting|kayak/.test(text);
  const isBeachDest = /alibaug|palghar|goa/.test(d.id) || hasBeach;
  const parts: string[] = [];

  // ── Base outfit ──────────────────────────────────────────────────────────────
  // Priority: beach > hill > trek > casual — beach and hill destinations have
  // specific needs that trump generic "fort hike" detection.
  if (isBeachDest) {
    parts.push(isMonsoon
      ? rnd([
          "breezy separates you're happy to get sea-spray on — leave anything precious at home",
          "casual beachwear in quick-dry fabric; monsoon beaches are more drama and wind than swimming",
          "easy cotton separates that dry fast; the sea air will do what it wants",
        ])
      : rnd([
          "a flowy beach dress or easy separates that look great against sand without requiring maintenance",
          "your favourite beach outfit — something that moves in the sea breeze and photographs naturally",
          "light, airy clothes for the day; a cover-up for when you step off the beach into a restaurant",
        ]));
  } else if (isHill) {
    const m = month ?? 10;
    const cold = m === 11 || m === 0 || m === 1;
    parts.push(isMonsoon
      ? rnd([
          "layers — hill mornings are cool, afternoons unpredictably wet; a light waterproof jacket is not optional",
          "a windcheater or waterproof layer on top, comfortable separates underneath; hill weather makes its own rules",
        ])
      : cold
        ? rnd([
            "proper warm layers — hill stations in winter are colder than people expect; a fleece or jacket is essential",
            "warm clothes for the day and genuinely warm layers for evening; temperature drops fast after sunset at altitude",
          ])
        : rnd([
            "light layers for the day, a jacket for evenings — hills cool down quickly after sunset",
            "comfortable separates plus a light jacket or shawl; mornings at altitude have a chill even when Mumbai felt warm",
          ]));
  } else if (hasTrek || hasWater) {
    parts.push(isMonsoon
      ? rnd([
          "moisture-wicking clothes you don't mind getting mud-splattered — dark colours hide the trail better",
          "quick-dry separates; save your nicer things for the resort in the evening",
          "trekking-ready layers you can peel off as it warms up — quick-dry everything, nothing cotton",
        ])
      : rnd([
          "breathable trekking clothes — a full-sleeve layer for the cool morning start, something lighter underneath",
          "comfortable activewear you can move freely in; nothing too precious for rocks and forest paths",
          "light trekking clothes, ideally full-length tracks to avoid scratchy undergrowth on the trail",
        ]));
  } else {
    parts.push(isMonsoon
      ? rnd([
          "easy, quick-dry separates — leave anything silk or suede behind",
          "comfortable clothes in forgiving fabric; the rains will have opinions",
        ])
      : rnd([
          "resort-casual: something comfortable and put-together that works from morning into dinner",
          "a nice outfit you actually enjoy wearing on holiday — not your travelling clothes, the proper ones",
        ]));
  }

  // ── Footwear ─────────────────────────────────────────────────────────────────
  if (hasTrek) {
    parts.push(rnd([
      "proper closed-toe shoes with grip — trail runners or sturdy sneakers; sandals are for the resort, not the trail",
      "footwear with real grip: trail runners or trekking shoes — no slip-ons on any wet surface",
    ]));
  } else if (isBeachDest) {
    parts.push(rnd([
      "flat sandals for the beach and a second pair that handles the drive, forts, and dinner",
      "sandals or juttis for the beach, something more structured for cobblestone forts or restaurants",
    ]));
  } else if (isHill || hasTrek) {
    parts.push(rnd([
      "comfortable closed-toe walking shoes — hill paths and fort steps are uneven",
      "flat shoes with grip; heels make no sense on a hill path or inside a fort",
    ]));
  } else {
    parts.push(rnd([
      "flat, comfortable shoes you can walk in for longer than you expect",
      "comfortable walking shoes — even a relaxed getaway covers more ground than a city day",
    ]));
  }

  // ── Temple cover ─────────────────────────────────────────────────────────────
  if (hasTemple) parts.push(rnd([
    "pack a stole or dupatta — there's a temple or cave stop, so covered shoulders and knees are needed",
    "a light scarf in your bag for the temple; it doubles as a layer on breezy evenings",
  ]));

  // ── Rain / sun protection ────────────────────────────────────────────────────
  if (isMonsoon) {
    parts.push(rnd([
      "a packable rain jacket or poncho — umbrellas lose on forest trails and near waterfalls",
      "rain protection that leaves your hands free; a poncho beats an umbrella on any outdoor getaway",
      "a compact waterproof layer; waterfall spray and forest rain don't announce themselves",
    ]));
  } else {
    const m = month ?? 10;
    if (m >= 3 && m <= 5) parts.push(rnd([
      "real sunscreen — not the SPF 15 one you've been meaning to replace — and carry water",
      "sunscreen, a hat if you have one you like, and water; it'll be genuinely hot",
    ]));
    else if (m === 11 || m === 0 || m === 1) parts.push(rnd([
      "sunscreen still matters even when it's cool; dry winter air is deceptive",
      "sunscreen — people forget it when it's cold, but the sun at altitude hits harder",
    ]));
    else parts.push(rnd([
      "sunscreen is non-negotiable even on overcast days",
      "sunscreen and something breathable for the warmer stretches of the day",
    ]));
  }

  return parts.join("; ") + ".";
}

export function listGetaways(): { id: string; name: string; region: string }[] {
  return DESTS.map(d => ({ id: d.id, name: d.name, region: d.region }));
}

function hrs(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function syntheticPlace(title: string, area: string, kind: Category, opts: Partial<Place> = {}): Place {
  return {
    id: "g:" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: title, area, zone: "multiple", category: kind,
    moods: [], vibes: [], cuisines: [], budgetLevel: 2, costPerPerson: opts.costPerPerson ?? 0,
    durationMins: opts.durationMins ?? 90, bestTime: "any",
    indoor: !opts.outdoor, outdoor: !!opts.outdoor, monsoonRisk: opts.monsoonRisk ?? "ok",
    adventureLevel: 0,
    mapsUrl: opts.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${title} ${area}`)}`,
    summary: opts.summary ?? "", rating: opts.rating, source: opts.source ?? "curated",
    topDishes: opts.topDishes, mustBook: opts.mustBook,
  };
}

function toAlt(p: Place): AltPlace {
  return {
    id: p.id, name: p.name, area: p.area, zone: p.zone, summary: p.summary,
    cost: p.costPerPerson * 2, mapsUrl: p.mapsUrl, topDishes: p.topDishes, mustBook: p.mustBook,
  };
}

function liveToPlace(lp: LivePlace, area: string, kind: Category): Place {
  return syntheticPlace(lp.name, area, kind, {
    rating: lp.rating, source: "live",
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lp.name)}&query_place_id=${lp.id}`,
    summary: lp.summary ?? `Rated ${lp.rating ?? "—"}★ on Google${lp.userRatings ? ` (${lp.userRatings.toLocaleString("en-IN")} reviews)` : ""}.`,
    costPerPerson: 500,
  });
}

function block(startMin: number, durMin: number, kind: Category | "buffer", title: string, why: string, place?: Place, backup?: string): PlanBlock {
  return { startMin, endMin: startMin + durMin, title, place, why, cost: place?.costPerPerson ? place.costPerPerson * 2 : 0, kind, backup };
}

// Same idea as engine.ts's scoreHighlight() keyword sets, but for the live search query
// itself — previously the "things to do" search was always generic ("top things to do in
// X"), completely ignoring the preferences the user picked (Trekking & hikes selected for
// Karjat still searched generically and missed Garbett Plateau, a real, well-reviewed trek).
const PREF_QUERY_KEYWORDS: Record<string, string> = {
  "Trekking & hikes":    "trekking trails viewpoints hikes",
  "Water spots":         "waterfalls rivers lakes water sports",
  "Scenic photography":  "scenic viewpoints photography spots",
  "Relaxed resort":      "resorts spas relaxation",
  "History & culture":   "forts temples heritage historic sites",
  "Wildlife & nature":   "wildlife sanctuaries nature reserves birdwatching",
  "Camping & bonfire":   "camping sites bonfire spots",
  "Wine & food":         "wineries vineyards food experiences",
};
// Preferences beyond the preset chips (typed in via the "What kind of trip?" free-text
// field) aren't in PREF_QUERY_KEYWORDS — use the user's own words as the search phrase
// directly rather than silently dropping them.
function thingsToDoQuery(name: string, preferences: string[]): string {
  const kws = preferences.map(p => PREF_QUERY_KEYWORDS[p] ?? p);
  return kws.length ? `${kws.join(" ")} in ${name}` : `top things to do in ${name}`;
}

// Shared by curated highlights and live "things to do" results, so a well-reviewed live
// find (e.g. Garbett Plateau for Karjat + "Trekking & hikes") competes on the same terms as
// curated data instead of always losing to it — see scoreHighlight below.
const KNOWN_VIBES = new Set(Object.keys(PREF_QUERY_KEYWORDS));

function scoreByText(text: string, prefs: string[]): number {
  if (!prefs.length) return 0;
  const t = text.toLowerCase();
  let s = 0;
  if (prefs.includes("Trekking & hikes")   && /trek|trail|climb|hike|fort|rappel|plateau|peak|ghat/.test(t)) s += 5;
  if (prefs.includes("Water spots")        && /water|fall|river|lake|dam|rafting|kayak|pool|stream/.test(t)) s += 5;
  if (prefs.includes("Scenic photography") && /view|point|sunrise|sunset|valley|cliff|vista|scenic|panoram/.test(t)) s += 5;
  if (prefs.includes("History & culture")  && /temple|cave|fort|heritage|historic|church|ruin|buddhist|ancient/.test(t)) s += 5;
  if (prefs.includes("Wildlife & nature")  && /forest|bird|wildlife|flamingo|nature|jungle|animal|sanctuary/.test(t)) s += 5;
  if (prefs.includes("Camping & bonfire")  && /camp|bonfire|night|firefly|star/.test(t)) s += 5;
  // Free-typed custom preferences (not one of the preset chips) — score by direct word
  // overlap with the highlight's own text, since there's no curated keyword set for them.
  for (const p of prefs) {
    if (KNOWN_VIBES.has(p)) continue;
    const words = p.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.some(w => t.includes(w))) s += 5;
  }
  return s;
}

function scoreHighlight(h: Highlight, prefs: string[]): number {
  if (!prefs.length) return 0;
  let s = scoreByText(h.name + " " + h.note, prefs);
  if (prefs.includes("Relaxed resort")     && !h.outdoor) s += 4;
  if (prefs.includes("Relaxed resort")     && h.outdoor && h.monsoonRisk === "ok") s += 1;
  if (prefs.includes("Wine & food")        && h.kind === "food") s += 5;
  return s;
}

export async function buildGetaway(
  destId: string, nights: number, monsoon: boolean,
  weatherSummary?: string, month?: number,
  preferences: string[] = [], hotelBooked: string = "", customStops: string[] = [],
  customDestName?: string
): Promise<GetawayPlan | null> {
  const d = destId === "custom" && customDestName
    ? await buildCustomDest(customDestName)
    : DESTS.find(x => x.id === destId) ?? null;
  if (!d) return null;

  // Live augmentation for this destination.
  const [liveThings, liveEats, liveStays] = await Promise.all([
    searchPlaces(thingsToDoQuery(d.name, preferences), 6),
    searchPlaces(`best restaurants in ${d.name}`, 5),
    searchPlaces(`resorts and stays in ${d.name}`, 5),
  ]);

  const eatsRaw = liveEats.length
    ? liveEats.map(e => liveToPlace(e, d.name, "food"))
    : d.eat.length
      ? d.eat.map(n => syntheticPlace(n, d.name, "food", { costPerPerson: 600 }))
      // Neither live search nor curated data found anything — a real (if rare) possibility
      // for an obscure typed-in destination. nextEat() below indexes into this array
      // unconditionally, so it must never be empty.
      : [syntheticPlace(`Local restaurant in ${d.name}`, d.name, "food", { costPerPerson: 600, summary: "Ask locally for the best spot — we couldn't find listings for this destination yet." })];
  // Shuffle so meal assignments vary across regenerations and wrap-around varies order.
  const eats = [...eatsRaw].sort(() => Math.random() - 0.5);
  let eatIdx = 0;
  const nextEat = (mealMins: number, label: string): PlanBlock => {
    const p = eats[eatIdx % eats.length]; eatIdx++;
    return block(mealMins, 75, "food", `${label}: ${p.name}`, p.summary || "A good local table.", p);
  };

  // Highlights: curated (with monsoon awareness) and live "things to do" results are scored
  // on the same preference criteria and merged into one queue — previously curated highlights
  // always filled every slot before live ones were ever reached, so a genuinely better-matched
  // live find (e.g. Garbett Plateau for Karjat + "Trekking & hikes") never made the cut in a
  // short trip even though the destination had it.
  const usableHi = d.highlights.filter(h => !(monsoon && h.outdoor && h.monsoonRisk === "avoid"));

  // User's explicit custom stops go first — they always make the itinerary.
  const customHiBlocks: PlanBlock[] = customStops.map(name => {
    const p = syntheticPlace(name, d.name, "experience", { outdoor: true, monsoonRisk: "caution", summary: `Your must-see stop: ${name}.` });
    return block(0, 120, "experience", name, `Your must-see stop at ${name}.`, p);
  });

  const liveHi = liveThings.map(t => liveToPlace(t, d.name, "experience"));
  const curatedScored = usableHi.map(h => {
    const p = syntheticPlace(h.name, d.name, (h.kind as Category) || "experience", { outdoor: h.outdoor, monsoonRisk: h.monsoonRisk, summary: h.note });
    const backup = monsoon && h.outdoor && h.monsoonRisk === "caution" ? `Monsoon caution: ${h.note}` : undefined;
    // Small trust bonus for curated data so it wins ties against an equally-scored live result.
    return { score: scoreHighlight(h, preferences) + 0.5, blk: block(0, 120, p.category, h.name, h.note, p, backup) };
  });
  const liveScored = liveHi.map(p => ({
    score: scoreByText(p.name + " " + (p.summary ?? ""), preferences),
    blk: block(0, 90, "experience", p.name, p.summary, p),
  }));
  const rankedHi = [...curatedScored, ...liveScored];
  if (preferences.length) rankedHi.sort((a, b) => b.score - a.score);
  const highlightQueue: PlanBlock[] = [...customHiBlocks, ...rankedHi.map(x => x.blk)];
  let hiIdx = 0;
  const nextHi = (startMin: number, durMin = 120): PlanBlock | null => {
    if (hiIdx >= highlightQueue.length) return null;
    const h = highlightQueue[hiIdx]; hiIdx++;
    return { ...h, startMin, endMin: startMin + durMin };
  };

  // Stays.
  const stays: AltPlace[] = (liveStays.length ? liveStays.map(s => ({
    id: s.id, name: s.name, area: d.name, summary: s.summary ?? `Rated ${s.rating ?? "—"}★ on Google.`,
    cost: 0, mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name)}&query_place_id=${s.id}`,
  })) : d.stays.map(n => ({ id: n, name: n, area: d.name, summary: "Curated stay.", cost: 0, mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${n} ${d.name}`)}` })));
  const stayName = stays[0]?.name ?? "your stay";

  const days: GetawayDay[] = [];

  // Every other destination is a 1.5-4.5h Western Ghats drive; Goa alone is an 11h haul.
  // Templating it the same way (arrival lunch + highlight + check-in + highlight + dinner
  // on arrival day; breakfast + highlight + lunch before the drive on departure day) pushed
  // blocks well past midnight on both ends. Long-haul destinations skip the same-day
  // arrival/departure activities entirely, since there's no realistic time for them.
  const isLongHaul = d.driveFromMumbaiMins > 400;

  // Day 1 — getting there (+ heading back same day if this is a day trip).
  {
    const blocks: PlanBlock[] = [];
    let cur = 480; // leave 8:00 AM
    blocks.push(block(cur, d.driveFromMumbaiMins, "buffer", `Drive to ${d.name}`, `About ${hrs(d.driveFromMumbaiMins)} from Mumbai (${d.driveFromMumbaiKm} km). ${isLongHaul ? "That's a long haul for one day of driving — flying is worth considering instead." : "Leave early to beat weekend traffic."}`));
    cur += d.driveFromMumbaiMins;
    if (isLongHaul) {
      if (nights >= 1) { blocks.push(block(cur, 60, "rest", `Check in & freshen up — ${stayName}`, "Long day of driving — settle in and rest before dinner.", syntheticPlace(stayName, d.name, "rest"))); cur += 60 + 10; }
      blocks.push(nextEat(Math.max(cur, 1170), "Dinner")); cur = Math.max(cur, 1170) + 75;
    } else {
      blocks.push(nextEat(cur, "Lunch on arrival")); cur += 75 + 15;
      const h1 = nextHi(cur); if (h1) { blocks.push(h1); cur = h1.endMin + 15; }
      if (nights >= 1) { blocks.push(block(cur, 60, "rest", `Check in & freshen up — ${stayName}`, "Settle in, breathe, change for the evening.", syntheticPlace(stayName, d.name, "rest"))); cur += 60 + 10; }
      const h2 = nextHi(cur, 90); if (h2) { blocks.push(h2); cur = h2.endMin + 15; }
      // On a day trip, only stay for dinner if there's still enough drive-home time left
      // afterwards to arrive at a sane hour — a 3.5-4.5h destination (Mulshi, Mahabaleshwar,
      // Bhandardara) plus an on-site 7:30pm dinner plus the drive back was landing well
      // past midnight. Staying overnight has no such constraint (no drive left that night).
      const dinnerThenHomeBy = Math.max(cur, 1170) + 75 + (nights === 0 ? d.driveFromMumbaiMins : 0);
      if (nights >= 1 || dinnerThenHomeBy <= 1380) {
        blocks.push(nextEat(Math.max(cur, 1170), "Dinner")); cur = Math.max(cur, 1170) + 75;
      }
    }
    // A day trip (0 nights) has no "final day" section to carry the drive home — it
    // has to happen today, or the itinerary just strands the reader at the destination.
    if (nights === 0) {
      const skippedDinner = cur < 1170;
      blocks.push(block(cur, d.driveFromMumbaiMins, "buffer", "Drive back to Mumbai", `About ${hrs(d.driveFromMumbaiMins)} home. ${skippedDinner ? "Grab dinner on the way back or once you're home — staying on for dinner here would get you back very late." : "Easy pace after a full day out."}`));
    }
    days.push({ label: "Day 1", subtitle: isLongHaul ? "The long drive down" : "Getting there & settling in", blocks });
  }

  // Middle nights (2-night trips get a full day).
  for (let n = 1; n < nights; n++) {
    const blocks: PlanBlock[] = [];
    let cur = 540; // 9:00 AM
    blocks.push(block(cur, 45, "cafe", `Breakfast at ${stayName}`, "Slow morning, hot chai, no rush.")); cur += 45 + 15;
    const a = nextHi(cur); if (a) { blocks.push(a); cur = a.endMin + 15; }
    blocks.push(nextEat(Math.max(cur, 780), "Lunch")); cur = Math.max(cur, 780) + 90;
    const b = nextHi(cur); if (b) { blocks.push(b); cur = b.endMin + 15; }
    blocks.push(nextEat(Math.max(cur, 1170), "Dinner"));
    days.push({ label: `Day ${n + 1}`, subtitle: "A full day out", blocks });
  }

  // Final day — heading back (only if at least one night).
  if (nights >= 1) {
    const blocks: PlanBlock[] = [];
    let cur = 540;
    blocks.push(block(cur, 45, "cafe", `Breakfast at ${stayName}`, "One last slow morning before the drive.")); cur += 45 + 15;
    if (isLongHaul) {
      // Skip the highlight + lunch-before-you-leave that a normal departure day gets —
      // an 11h drive needs to start right after breakfast, not mid-afternoon, or it lands
      // well past midnight.
      blocks.push(block(cur, d.driveFromMumbaiMins, "buffer", "Drive back to Mumbai", `About ${hrs(d.driveFromMumbaiMins)} home — best to leave straight after breakfast so the long drive is done in daylight.`));
    } else {
      const a = nextHi(cur, 90); if (a) { blocks.push(a); cur = a.endMin + 15; }
      blocks.push(nextEat(Math.max(cur, 780), "Lunch before you leave")); cur = Math.max(cur, 780) + 90;
      blocks.push(block(cur, d.driveFromMumbaiMins, "buffer", "Drive back to Mumbai", `About ${hrs(d.driveFromMumbaiMins)} home. Easy pace, you have memories to replay.`));
    }
    days.push({ label: `Day ${nights + 1}`, subtitle: "Heading home", blocks });
  }

  // Flags.
  const flags: Flag[] = [];
  if (weatherSummary) {
    flags.push({ icon: monsoon ? "🌧️" : "⛅", text: `Forecast for ${d.name}: ${weatherSummary}. ${monsoon ? "Rain likely, so keep the waterfall and viewpoint stops cautious and have indoor backups." : "Looking clear enough for the outdoor stops."}` });
  }
  flags.push({ icon: "🚗", text: `It's about ${hrs(d.driveFromMumbaiMins)} from Mumbai (${d.driveFromMumbaiKm} km). From your Pune house it's ~${hrs(d.driveFromPuneMins)}.` });
  // Driving isn't the only way there for some destinations — surface flight/train as real
  // alternatives (the itinerary itself still schedules around driving; this is informational
  // so you can decide before you commit to the drive time above).
  for (const alt of d.travelAlt ?? []) {
    flags.push({ icon: alt.mode === "flight" ? "✈️" : "🚆", text: `Or ${alt.mode === "flight" ? "fly" : "take the train"}: ${alt.note}` });
  }
  if (monsoon && d.highlights.some(h => h.outdoor && h.monsoonRisk !== "ok")) {
    flags.push({ icon: "🌧️", text: "Monsoon here means waterfalls and mist, but wet, slippery roads and viewpoints too. Drive slow and keep off fast water." });
  } else if (monsoon && d.monsoon === "poor") {
    flags.push({ icon: "🌧️", text: `${d.name} is better outside the monsoon (${d.bestMonths}). In the rains, lean on the indoor and sheltered stops.` });
  }
  // No stay to book on a day trip — this flag was firing regardless of `nights`, telling
  // 0-night day-trippers to "book the stay ahead" for a hotel they were never getting.
  if (nights >= 1) {
    if (hotelBooked === "booked") {
      flags.push({ icon: "🏨", text: `Stay is sorted — nice. Just confirm your check-in time ahead of the drive so you're not waiting around after a long road.` });
    } else {
      flags.push({ icon: "🏨", text: `Book the stay ahead — ${stayName} and similar fill up on weekends. See the suggestions below.` });
    }
  }

  const allPlaces = days.flatMap(dy => dy.blocks.map(b => b.place).filter(Boolean)) as Place[];

  // Swap options — same feature as the Mumbai day plan: each card offers a
  // few real substitutes from this destination's own pool (other highlights,
  // other meal options, other stays), never a place already used elsewhere
  // in the trip.
  const highlightIds = new Set(highlightQueue.map(b => b.place?.id).filter(Boolean));
  const eatIds = new Set(eats.map(p => p.id));
  const usedElsewhere = new Set(allPlaces.map(p => p.id));

  for (const day of days) {
    for (const b of day.blocks) {
      if (!b.place) continue;
      if (eatIds.has(b.place.id)) {
        b.alternatives = eats.filter(p => p.id !== b.place!.id).slice(0, 3).map(toAlt);
      } else if (highlightIds.has(b.place.id)) {
        b.alternatives = highlightQueue
          .map(hb => hb.place)
          .filter((p): p is Place => !!p && p.id !== b.place!.id && !usedElsewhere.has(p.id))
          .slice(0, 3)
          .map(toAlt);
      } else if (b.kind === "rest") {
        b.alternatives = stays.filter(s => s.name !== stayName).slice(0, 3);
      }
    }
  }

  return {
    destination: d.name,
    region: d.region,
    summary: d.summary,
    nights,
    driveNote: `~${hrs(d.driveFromMumbaiMins)} from Mumbai · ~${hrs(d.driveFromPuneMins)} from your Pune house`,
    monsoonNote: monsoon ? `Monsoon trip. ${d.name} in the rains: ${d.monsoon === "great" ? "lush and at its best, with care." : "manageable, but not its prettiest season."}` : undefined,
    bestMonths: d.bestMonths,
    outfit: getawayOutfitFor(d, d.highlights, monsoon, month),
    flags,
    days,
    stays,
  };
}
