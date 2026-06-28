import getawayData from "@/data/getaways.json";
import { Place, PlanBlock, GetawayPlan, GetawayDay, AltPlace, Flag, Category } from "./types";
import { outfitFor } from "./concierge";
import { searchPlaces, LivePlace } from "./google";

interface Highlight { name: string; kind: string; outdoor?: boolean; monsoonRisk?: "ok" | "caution" | "avoid"; note: string; }
interface Dest {
  id: string; name: string; region: string;
  driveFromMumbaiMins: number; driveFromMumbaiKm: number;
  driveFromPuneMins: number; driveFromPuneKm: number;
  monsoon: "great" | "caution" | "poor"; bestMonths: string; summary: string;
  vibes: string[]; highlights: Highlight[]; stays: string[]; eat: string[];
}

const DESTS = getawayData as Dest[];

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

export async function buildGetaway(destId: string, nights: number, monsoon: boolean): Promise<GetawayPlan | null> {
  const d = DESTS.find(x => x.id === destId);
  if (!d) return null;

  // Live augmentation for this destination.
  const [liveThings, liveEats, liveStays] = await Promise.all([
    searchPlaces(`top things to do in ${d.name}`, 6),
    searchPlaces(`best restaurants in ${d.name}`, 5),
    searchPlaces(`resorts and stays in ${d.name}`, 5),
  ]);

  const eats = liveEats.length ? liveEats.map(e => liveToPlace(e, d.name, "food")) : d.eat.map(n => syntheticPlace(n, d.name, "food", { costPerPerson: 600 }));
  let eatIdx = 0;
  const nextEat = (mealMins: number, label: string): PlanBlock => {
    const p = eats[eatIdx % eats.length]; eatIdx++;
    return block(mealMins, 75, "food", `${label}: ${p.name}`, p.summary || "A good local table.", p);
  };

  // Highlights: curated (with monsoon awareness) first, then any extra live things-to-do.
  const usableHi = d.highlights.filter(h => !(monsoon && h.outdoor && h.monsoonRisk === "avoid"));
  const liveHi = liveThings.map(t => liveToPlace(t, d.name, "experience"));
  const highlightQueue: PlanBlock[] = [
    ...usableHi.map(h => {
      const p = syntheticPlace(h.name, d.name, (h.kind as Category) || "experience", { outdoor: h.outdoor, monsoonRisk: h.monsoonRisk, summary: h.note });
      const backup = monsoon && h.outdoor && h.monsoonRisk === "caution" ? `Monsoon caution: ${h.note}` : undefined;
      return block(0, 120, p.category, h.name, h.note, p, backup);
    }),
    ...liveHi.map(p => block(0, 90, "experience", p.name, p.summary, p)),
  ];
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

  // Day 1 — getting there.
  {
    const blocks: PlanBlock[] = [];
    let cur = 480; // leave 8:00 AM
    blocks.push(block(cur, d.driveFromMumbaiMins, "buffer", `Drive to ${d.name}`, `About ${hrs(d.driveFromMumbaiMins)} from Mumbai (${d.driveFromMumbaiKm} km). Leave early to beat weekend traffic.`));
    cur += d.driveFromMumbaiMins;
    blocks.push(nextEat(cur, "Lunch on arrival")); cur += 75 + 15;
    const h1 = nextHi(cur); if (h1) { blocks.push(h1); cur = h1.endMin + 15; }
    blocks.push(block(cur, 60, "rest", `Check in & freshen up — ${stayName}`, "Settle in, breathe, change for the evening.", syntheticPlace(stayName, d.name, "rest"))); cur += 60 + 10;
    const h2 = nextHi(cur, 90); if (h2) { blocks.push(h2); cur = h2.endMin + 15; }
    blocks.push(nextEat(Math.max(cur, 1170), "Dinner"));
    days.push({ label: "Day 1", subtitle: "Getting there & settling in", blocks });
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
    const a = nextHi(cur, 90); if (a) { blocks.push(a); cur = a.endMin + 15; }
    blocks.push(nextEat(Math.max(cur, 780), "Lunch before you leave")); cur = Math.max(cur, 780) + 90;
    blocks.push(block(cur, d.driveFromMumbaiMins, "buffer", "Drive back to Mumbai", `About ${hrs(d.driveFromMumbaiMins)} home. Easy pace, you have memories to replay.`));
    days.push({ label: `Day ${nights + 1}`, subtitle: "Heading home", blocks });
  }

  // Flags.
  const flags: Flag[] = [];
  flags.push({ icon: "🚗", text: `It's about ${hrs(d.driveFromMumbaiMins)} from Mumbai (${d.driveFromMumbaiKm} km). From your Pune house it's ~${hrs(d.driveFromPuneMins)}.` });
  if (monsoon && d.highlights.some(h => h.outdoor && h.monsoonRisk !== "ok")) {
    flags.push({ icon: "🌧️", text: "Monsoon here means waterfalls and mist, but wet, slippery roads and viewpoints too. Drive slow and keep off fast water." });
  } else if (monsoon && d.monsoon === "poor") {
    flags.push({ icon: "🌧️", text: `${d.name} is better outside the monsoon (${d.bestMonths}). In the rains, lean on the indoor and sheltered stops.` });
  }
  flags.push({ icon: "🏨", text: `Book the stay ahead — ${stayName} and similar fill up on weekends.` });

  const allPlaces = days.flatMap(dy => dy.blocks.map(b => b.place).filter(Boolean)) as Place[];

  return {
    destination: d.name,
    region: d.region,
    summary: d.summary,
    nights,
    driveNote: `~${hrs(d.driveFromMumbaiMins)} from Mumbai · ~${hrs(d.driveFromPuneMins)} from your Pune house`,
    monsoonNote: monsoon ? `Monsoon trip. ${d.name} in the rains: ${d.monsoon === "great" ? "lush and at its best, with care." : "manageable, but not its prettiest season."}` : undefined,
    bestMonths: d.bestMonths,
    outfit: allPlaces.length ? outfitFor(allPlaces, monsoon) : undefined,
    flags,
    days,
    stays,
  };
}
