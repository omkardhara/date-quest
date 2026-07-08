/**
 * Area-confinement + budget + travel audit for the plan engine.
 * For each zone (and a couple of free-text localities), builds several real plans
 * (curated + live discovery) and checks:
 *   - geographic leaks: any stop whose zone isn't in the allowed set
 *   - food/cafe/dessert coverage: did the requested categories actually show up
 *   - budget utilization: % of budget spent
 *   - travel sanity: any single leg over a threshold
 *
 * Run: node scripts/audit-areas.mjs   (needs `npm run dev` running on :3000)
 */
const BASE = "http://127.0.0.1:3000";

const ZONES = [
  ["Bandra", "bandra"], ["Andheri", "andheri_w"], ["Powai", "andheri_w"],
  ["South Mumbai", "south"], ["Central Mumbai", "central"],
  ["Borivali / Aarey", "borivali"], ["Thane", "thane"],
  ["Navi Mumbai", "navi_mumbai"], ["Vasai", "vasai"], ["Gorai", "gorai"],
];

const PROFILES = [
  { personality: ["romantic", "spiritual", "luxe"], foods: ["lebanese", "cafe"], mood: "anniversary" },
  { personality: ["foodie", "playful"], foods: ["chinese", "dessert"], mood: "birthday" },
  { personality: ["adventure", "nature"], foods: ["street", "indian"], mood: "chill" },
  { personality: ["shopper", "queen"], foods: ["continental", "coffee"], mood: "celebrate" },
];

const TRIALS_PER_ZONE = 3;
const TRAVEL_WARN_MIN = 60;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return res.json();
}

function baseAnswers(zoneKey, label, profile) {
  return {
    who: "Amruta", mood: profile.mood, moodList: [profile.mood],
    personality: profile.personality, foods: profile.foods,
    areas: [zoneKey], areaLabels: [label],
    budget: 5000, startMin: 600, endMin: 1320,
    dayOfWeek: 3, month: 6, outingDate: "2026-07-08",
  };
}

const results = [];

for (const [label, zoneKey] of ZONES) {
  for (const profile of PROFILES.slice(0, 2)) { // 2 profiles x 3 trials = 6 plans per zone
    const ans = baseAnswers(zoneKey, label, profile);
    const discover = await post("/api/discover", ans);
    const extra = Array.isArray(discover.places) ? discover.places : [];

    for (let t = 0; t < TRIALS_PER_ZONE; t++) {
      const plan = await post("/api/plan", { ...ans, extra });
      if (plan.error) { results.push({ label, zoneKey, error: plan.error }); continue; }
      const blocks = plan.blocks ?? [];
      const leaks = blocks.filter(b => b.place && b.place.zone !== zoneKey && b.place.zone !== "multiple");
      const kinds = blocks.map(b => b.kind);
      const hasFood = kinds.includes("food");
      const hasCafe = kinds.includes("cafe");
      const hasDessert = kinds.includes("dessert");
      const util = plan.budget ? Math.round((plan.totalCost / plan.budget) * 100) : 0;
      // Skip the very first stop's travel leg — that's the expected "get to the destination
      // zone" trip from home, which can legitimately be long for a far zone (Vasai, Gorai).
      // What matters here is INTRA-day zigzagging once the day is already out there.
      const bigLegs = blocks.slice(1).filter(b => b.travelFromPrev && b.travelFromPrev.mins > TRAVEL_WARN_MIN)
        .map(b => `${b.travelFromPrev.mins}min->${b.title}`);
      results.push({
        label, zoneKey, mood: profile.mood, trial: t + 1,
        stops: blocks.length, leaks: leaks.map(b => `${b.title}(${b.place.zone})`),
        hasFood, hasCafe, hasDessert, util, bigLegs, extraCount: extra.length,
      });
    }
  }
}

console.log("\n=== AREA AUDIT ===\n");
let leakCount = 0, noFoodCount = 0, lowUtilCount = 0, bigLegCount = 0, total = 0;
for (const r of results) {
  if (r.error) { console.log(`ERROR ${r.label}: ${r.error}`); continue; }
  total++;
  const flags = [];
  if (r.leaks.length) { flags.push(`LEAK: ${r.leaks.join(", ")}`); leakCount++; }
  if (!r.hasFood) { flags.push("NO FOOD"); noFoodCount++; }
  if (r.util < 50) { flags.push(`LOW UTIL ${r.util}%`); lowUtilCount++; }
  if (r.bigLegs.length) { flags.push(`BIG LEG: ${r.bigLegs.join(", ")}`); bigLegCount++; }
  if (flags.length) {
    console.log(`[${r.label}/${r.mood} #${r.trial}] stops=${r.stops} util=${r.util}% extra=${r.extraCount} -> ${flags.join(" | ")}`);
  }
}
console.log(`\nTotals: ${total} plans | leaks=${leakCount} | noFood=${noFoodCount} | lowUtil(<50%)=${lowUtilCount} | bigLeg(>${TRAVEL_WARN_MIN}min)=${bigLegCount}`);
