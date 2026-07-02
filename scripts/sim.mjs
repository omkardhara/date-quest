// Date Quest — place frequency simulation
// Usage: node scripts/sim.mjs
// Runs ~300 plan builds across diverse Answers combos and reports which places
// appear most often, so we can spot scoring monoculture and fix it.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const PLACES = JSON.parse(readFileSync(join(__dir, "../data/places.json"), "utf8"));

// ── Ported from PROFILE ──────────────────────────────────────────────────────
const LOVES = ["dessert","nature","lowcrowd","instagrammable","exoticfruit","brunch","waterfall",
               "lakeside","forest","sizzler","shopping","thrift","temple","serene","muscat",
               "arabic","sunset","spa"];
const VEG_DAYS = [1, 4, 6];

// ── Corridor & travel (mirrors engine.ts) ───────────────────────────────────
const CORRIDOR_ZONES = {
  bandra_hub:      ["bandra","andheri_w","central","multiple"],
  south_loop:      ["south","central","bandra","multiple"],
  north_adventure: ["borivali","andheri_w","bandra","multiple"],
  thane_east:      ["thane","home","andheri_w","multiple"],
  full_day_out:    ["vasai","karjat","kolad","gorai","multiple"],
};
const TRAVEL_BASE = {
  "andheri_w-bandra":20,"andheri_w-borivali":35,"andheri_w-central":40,
  "andheri_w-home":20,"andheri_w-south":55,"andheri_w-thane":55,
  "bandra-central":30,"bandra-home":35,"bandra-south":35,"bandra-thane":65,
  "borivali-home":60,"borivali-vasai":50,"central-home":40,"central-south":20,
  "central-thane":50,"gorai-home":75,"home-south":60,"home-thane":45,"home-vasai":90,
};
function travelMin(from, to) {
  if (from === to) return 10;
  return TRAVEL_BASE[[from, to].sort().join("-")] ?? 45;
}

function detectCorridor(ans) {
  const p = ans.personality;
  const allMoods = ans.moodList ?? [ans.mood];
  const dayMins = ans.endMin - ans.startMin;
  const isRomantic = allMoods.some(m => ["romantic","anniversary"].includes(m));
  if (isRomantic && !p.includes("adventure"))
    return p.includes("culture") || p.includes("spiritual") ? "south_loop" : "bandra_hub";
  if (!ans.wetDay && p.includes("adventure") && ans.startMin <= 480 && dayMins >= 660) return "full_day_out";
  if (p.includes("adventure") && ans.startMin <= 600 && dayMins >= 480) return "north_adventure";
  if (p.includes("adventure")) return "thane_east";
  if (p.includes("culture") || p.includes("spiritual") || allMoods.includes("romantic")) return "south_loop";
  return "bandra_hub";
}

// ── Scoring (mirrors engine.ts exactly, including the new noise) ─────────────
function overlap(a = [], b = []) { return a.filter(x => b.includes(x)).length; }
function bandFor(m) {
  if (m < 720) return "morning"; if (m < 1020) return "afternoon";
  if (m < 1200) return "evening"; return "night";
}
function timeAllowed(p, atMin) {
  switch (p.bestTime) {
    case "morning":   return atMin < 780;
    case "afternoon": return atMin >= 660 && atMin < 1140;
    case "evening":   return atMin >= 900;
    case "night":     return atMin >= 1020;
    default:          return true;
  }
}
function blocked(p, ans) {
  const foody = ["food","dessert"];
  if (foody.includes(p.category) && ans.dayOfWeek !== undefined &&
      VEG_DAYS.includes(ans.dayOfWeek) && p.veg === false) return true;
  if (ans.wetDay && p.outdoor && p.monsoonRisk === "avoid") return true;
  return false;
}
function baseScore(p, ans, band, remainingBudget) {
  let s = 0;
  s += overlap(p.vibes ?? [], ans.personality) * 3;
  const allMoods = ans.moodList ?? [ans.mood];
  if ((p.moods ?? []).some(m => allMoods.includes(m))) s += 2;
  if (p.bestTime === band || p.bestTime === "any") s += 2;
  s += overlap(p.tags ?? [], LOVES);
  const cost = p.costPerPerson * 2;
  if (cost <= remainingBudget)            s += 2;
  else if (cost > remainingBudget * 1.3)  s -= 5;
  if (ans.personality.includes("adventure")) s += (p.adventureLevel ?? 0);
  if (ans.personality.includes("peaceful"))  s += 3 - (p.adventureLevel ?? 0);
  if (p.rating) s += (p.rating - 3.6) * 3;
  if (p.source === "live") s += 2;
  return s;
}

function weightedPick(arr) {
  if (arr.length <= 1) return arr[0];
  const w = arr.map((_, i) => Math.pow(0.65, i));
  const sum = w.reduce((a,b) => a+b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; }
  return arr[arr.length-1];
}

const FAR_ZONES = new Set(["borivali","thane","south","vasai","karjat","kolad","gorai"]);

function pick(pool, ans, band, cats, used, currentZone, corridorZones, atMin, remainingBudget) {
  const base = pool.filter(p =>
    cats.includes(p.category) && !used.has(p.id) && !blocked(p, ans) &&
    timeAllowed(p, atMin) && p.costPerPerson * 2 <= remainingBudget &&
    (corridorZones.includes(p.zone ?? "multiple") || (p.zone ?? "multiple") === "multiple")
  );
  if (!base.length) return undefined;
  const primaryFarZone = corridorZones.find(z => FAR_ZONES.has(z));
  const ranked = base.map(p => {
    const z = p.zone ?? "multiple";
    let v = baseScore(p, ans, band, remainingBudget) - travelMin(currentZone, z) / 8;
    // Same-zone bonus only applies when the place actually matches the personality vibe.
    if (z !== "multiple" && z === currentZone) {
      v += overlap(p.vibes ?? [], ans.personality) > 0 ? 4 : 1;
    }
    // Far-corridor destination nudge.
    if (primaryFarZone && z === primaryFarZone && currentZone !== primaryFarZone) {
      v += 6;
    }
    v += (Math.random() - 0.5) * 2; // same noise as engine
    return { p, v };
  }).sort((a,b) => b.v - a.v);
  const top = ranked[0].v;
  const contenders = ranked.filter(r => r.v >= top - 8).slice(0, 6).map(r => r.p);
  return weightedPick(contenders);
}

function sim(ans) {
  const used = new Set();
  const picked = [];
  let cursor = ans.startMin, currentZone = "home", runningCost = 0, lastMealEnd = 0;
  const corridor = detectCorridor(ans);
  const corridorZones = CORRIDOR_ZONES[corridor];
  const end = ans.endMin;
  const dayMins = end - ans.startMin;
  const FULL_MEALS = ["food","cafe"];

  const add = (place) => {
    if (!place || cursor >= end) return;
    const z = place.zone ?? "multiple";
    const arrival = cursor + travelMin(currentZone, z);
    if (arrival + 20 > end) return;
    const isFullMeal = FULL_MEALS.includes(place.category);
    if (isFullMeal && lastMealEnd > 0 && arrival - lastMealEnd < 150) return;
    const blockCost = place.costPerPerson * 2;
    if (picked.length > 0 && blockCost > 0 && runningCost + blockCost > ans.budget) return;
    used.add(place.id);
    picked.push({ id: place.id, name: place.name, category: place.category });
    runningCost += blockCost;
    cursor = arrival + Math.min(place.durationMins, end - arrival);
    if (isFullMeal) lastMealEnd = cursor;
    if (z !== "multiple") currentZone = z;
  };

  const b = () => bandFor(cursor);
  const remaining = () => ans.budget - runningCost;
  const dinnerRes = () => end > 1140 ? Math.floor(ans.budget * 0.40) : 0;
  const actBudget = () => Math.max(0, remaining() - dinnerRes());

  if (ans.startMin < 660) {
    add(pick(PLACES, ans, b(), ["activity","experience"], used, currentZone, corridorZones, cursor, actBudget()));
    const cafeBudget = Math.min(remaining(), Math.max(800, Math.round(ans.budget * 0.20)));
    add(pick(PLACES, ans, b(), ["cafe"], used, currentZone, corridorZones, cursor, cafeBudget));
  }
  if (cursor < 960 && end > 780) {
    const lb = Math.max(0, remaining() - Math.floor(ans.budget * 0.40));
    add(pick(PLACES, ans, b(), ["food"], used, currentZone, corridorZones, cursor, lb));
  }
  if (end > 840)
    add(pick(PLACES, ans, b(), ["experience","activity","shopping"], used, currentZone, corridorZones, cursor, actBudget()));
  if (dayMins >= 360 && cursor < 1080 && end > 960)
    add(pick(PLACES, ans, b(), ["experience","activity","shopping"], used, currentZone, corridorZones, cursor, actBudget()));
  if (dayMins >= 720 && cursor < 1020 && end > 1080)
    add(pick(PLACES, ans, b(), ["experience","activity","shopping"], used, currentZone, corridorZones, cursor, actBudget()));
  if (end > 1140)
    add(pick(PLACES, ans, b(), ["food"], used, currentZone, corridorZones, cursor, remaining()));
  if (end - cursor > 20)
    add(pick(PLACES, ans, b(), ["dessert"], used, currentZone, corridorZones, cursor, remaining()));

  return picked;
}

// ── Test matrix ──────────────────────────────────────────────────────────────
const PERSONALITIES = [
  ["shopper","queen"], ["shopper","artsy"], ["shopper"],
  ["queen"], ["artsy","queen"], ["culture"],
  ["adventure"], ["peaceful"], ["foodie"],
  ["shopper","queen","artsy"], ["peaceful","culture"],
];
const MOOD_SETS = [
  { mood:"birthday",   moodList:["birthday","romantic"] },
  { mood:"chill",      moodList:["chill"] },
  { mood:"date night", moodList:["date night","romantic"] },
  { mood:"just because", moodList:["just because"] },
];
const TIMES = [
  { startMin:480,  endMin:1320 },
  { startMin:600,  endMin:1320 },
  { startMin:720,  endMin:1440 },
  { startMin:480,  endMin:1200 },
];
const BUDGETS = [3000, 5000, 8000, 12000];
const DAYS = [3, 6]; // Wed (no veg), Sat (veg day)

const tests = [];
for (const personality of PERSONALITIES) {
  for (const ms of MOOD_SETS) {
    for (const time of TIMES) {
      for (const budget of BUDGETS) {
        for (const dayOfWeek of DAYS) {
          tests.push({ who:"Amruta", ...ms, personality, foods:["dessert"], budget, ...time, dayOfWeek, month:6, wetDay:false });
        }
      }
    }
  }
}

// Also add shopper-specific extra weight (most problematic)
for (let i = 0; i < 40; i++) {
  const budget = [3000,5000,8000][i % 3];
  const time = TIMES[i % TIMES.length];
  const ms = MOOD_SETS[i % MOOD_SETS.length];
  tests.push({ who:"Amruta", ...ms, personality:["shopper","queen"], foods:["dessert","thrift"], budget, ...time, dayOfWeek:i%2===0?3:6, month:6, wetDay:false });
}

// Run 3× each up to ~300 total for stable stats
const RUNS_PER = Math.ceil(300 / tests.length);
const counts = {}; // id → count
const byPersonality = {}; // "shopper,queen" → { id → count }
const nameMap = {};
let totalRuns = 0;
const byCategory = {}; // id → category

for (const ans of tests) {
  const persKey = ans.personality.sort().join(",");
  if (!byPersonality[persKey]) byPersonality[persKey] = {};
  for (let r = 0; r < RUNS_PER; r++) {
    totalRuns++;
    try {
      const plan = sim(ans);
      for (const place of plan) {
        counts[place.id] = (counts[place.id] ?? 0) + 1;
        byPersonality[persKey][place.id] = (byPersonality[persKey][place.id] ?? 0) + 1;
        nameMap[place.id] = place.name;
        byCategory[place.id] = place.category;
      }
    } catch {}
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n╔══ Date Quest Simulation ══════════════════════════════════════╗`);
console.log(`  ${tests.length} test combos × ${RUNS_PER} runs = ${totalRuns} total plan builds`);
console.log(`╚═══════════════════════════════════════════════════════════════╝\n`);

const freq = Object.entries(counts)
  .map(([id, n]) => ({ id, n, pct: Math.round(n/totalRuns*100), name: nameMap[id], cat: byCategory[id] }))
  .sort((a,b) => b.pct - a.pct);

console.log("TOP 30 MOST RECOMMENDED PLACES (all personalities combined):\n");
console.log("  %   count  category    name");
console.log("  ─── ─────  ──────────  ────────────────────────────────────────────");
for (const { id, n, pct, name, cat } of freq.slice(0, 30)) {
  const flag = pct >= 70 ? " ❌ >70%" : pct >= 50 ? " ⚠️ >50%" : "";
  const catPad = (cat ?? "?").padEnd(10);
  console.log(`  ${pct.toString().padStart(3)}%  ${String(n).padStart(4)}   ${catPad}  ${(name ?? id).slice(0,45)}${flag}`);
}

// Per-personality breakdown for shopping (most likely to be dominated)
console.log("\n\nSHOPPER+QUEEN — place frequency breakdown:");
const shopperCounts = byPersonality["queen,shopper"] ?? {};
const shopperRuns = Object.values(shopperCounts).reduce((a,b) => a+b, 0);
if (shopperRuns > 0) {
  const sf = Object.entries(shopperCounts)
    .map(([id, n]) => ({ id, n, pct: Math.round(n/shopperRuns*100*PLACES.length/5), name: nameMap[id], cat: byCategory[id] }))
    .sort((a,b) => b.n - a.n).slice(0, 20);
  // Better: count per-plan appearances, not slot appearances
  // Approximate: n / (totalRuns * avg_slots_per_plan ~5)
  const shopperTestRuns = tests.filter(t => JSON.stringify([...t.personality].sort()) === JSON.stringify(["queen","shopper"])).length * RUNS_PER;
  console.log(`  (${shopperTestRuns} plan builds for this personality)`);
  const sf2 = Object.entries(shopperCounts)
    .map(([id, n]) => ({ id, n, pct: Math.round(n/shopperTestRuns*100), name: nameMap[id] }))
    .sort((a,b) => b.n - a.n);
  for (const { id, n, pct, name } of sf2.slice(0, 20)) {
    const flag = pct >= 70 ? " ❌" : pct >= 50 ? " ⚠️" : "";
    console.log(`  ${pct.toString().padStart(3)}%  (${n}/${shopperTestRuns})  ${(name ?? id).slice(0,45)}${flag}`);
  }
}

// Show how many places are never picked
const totalPlaces = PLACES.length;
const neverPicked = PLACES.filter(p => !counts[p.id]);
const rarelyPicked = PLACES.filter(p => counts[p.id] && Math.round(counts[p.id]/totalRuns*100) < 3);
console.log(`\n\nPLACE UTILISATION:`);
console.log(`  Total places in DB : ${totalPlaces}`);
console.log(`  Never recommended  : ${neverPicked.length} (${Math.round(neverPicked.length/totalPlaces*100)}%)`);
console.log(`  Rarely (<3%)       : ${rarelyPicked.length}`);
console.log(`  Appeared ≥70%      : ${freq.filter(f=>f.pct>=70).length}`);
console.log(`\nNEVER PICKED places by category:`);
const npByCat = {};
for (const p of neverPicked) npByCat[p.category] = (npByCat[p.category]??0)+1;
for (const [cat, n] of Object.entries(npByCat).sort((a,b)=>b[1]-a[1]))
  console.log(`  ${cat.padEnd(12)} ${n}`);
console.log(`\nNEVER PICKED place IDs:`);
for (const p of neverPicked) console.log(`  ${p.category.padEnd(12)} ${p.id}`);
