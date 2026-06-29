// Run: npx tsx --tsconfig tsconfig.json scripts/audit-gaps.ts
import * as fs from "fs";
import * as path from "path";

const places: any[] = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/places.json"), "utf8"));

const UI_MOODS       = ["birthday","anniversary","romantic","date night","chill","celebrate","adventure","group outing","proposal","reunion","just because"];
const UI_PERSONALITY = ["queen","adventure","peaceful","foodie","shopper","spiritual","playful","culture","nature","artsy","nightlife","cozy","luxe","romantic"];
const UI_FOODS       = ["lebanese","arabic","chinese","italian","sizzler","dessert","icecream","brunch","indian","mediterranean","continental","asian","thai","japanese","seafood","healthy","cafe","pizza","coffee","street","chaat"];
const UI_ACTIVITIES  = ["watch a movie","spa or massage","long drive","beach time","live music","art gallery","boat ride","arcade or gaming","workshop","sunset point","bookstore café","picnic"];

// ─── 1. Mood coverage ─────────────────────────────────────────────────────────
const allPlaceMoods = new Set(places.flatMap(p => p.moods ?? []));
console.log("\n=== MOODS WITH NO MATCHING PLACE ===");
for (const m of UI_MOODS) {
  if (!allPlaceMoods.has(m)) console.log(`  ✗ "${m}" — no place has this mood`);
}
console.log("\n=== MOODS → place count ===");
for (const m of UI_MOODS) {
  const n = places.filter(p => (p.moods ?? []).includes(m)).length;
  if (n < 3) console.log(`  ⚠  "${m}" → only ${n} places`);
}

// ─── 2. Personality/vibe coverage ─────────────────────────────────────────────
const allVibes = new Set(places.flatMap(p => p.vibes ?? []));
console.log("\n=== PERSONALITY OPTIONS WITH NO VIBE MATCH ===");
for (const v of UI_PERSONALITY) {
  const n = places.filter(p => (p.vibes ?? []).includes(v)).length;
  console.log(`  ${n < 3 ? "✗" : "✓"} "${v}" → ${n} places`);
}

// ─── 3. Food / cuisine coverage ───────────────────────────────────────────────
const allCuisines = new Set(places.flatMap(p => p.cuisines ?? []));
console.log("\n=== FOOD SELECTIONS WITH NO CUISINE MATCH ===");
for (const f of UI_FOODS) {
  const n = places.filter(p => (p.cuisines ?? []).includes(f)).length;
  if (n === 0) console.log(`  ✗ "${f}" — no place has this cuisine`);
  else if (n < 3) console.log(`  ⚠  "${f}" → only ${n} places`);
}

// ─── 4. ACTIVITIES mustInclude matching ───────────────────────────────────────
function stem(w: string) {
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("es")  && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s")   && w.length > 3) return w.slice(0, -1);
  return w;
}
function matchesRequest(p: any, term: string): boolean {
  const tokens = `${p.name} ${p.area} ${(p.tags ?? []).join(" ")} ${(p.cuisines ?? []).join(" ")} ${(p.vibes ?? []).join(" ")}`
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  return term.toLowerCase().split(/\s+/).map(stem).filter((w: string) => w.length >= 3).some((w: string) =>
    tokens.some((t: string) => t.length >= 3 && (t.startsWith(w) || w.startsWith(t))),
  );
}
console.log("\n=== ACTIVITIES → places they match ===");
for (const act of UI_ACTIVITIES) {
  const matches = places.filter(p => matchesRequest(p, act)).map(p => p.name);
  if (matches.length === 0) console.log(`  ✗ "${act}" — matches NOTHING`);
  else if (matches.length < 2) console.log(`  ⚠  "${act}" → only: ${matches.join(", ")}`);
  else console.log(`  ✓ "${act}" → ${matches.length} places: ${matches.slice(0,3).join(", ")}${matches.length > 3 ? "..." : ""}`);
}

// ─── 5. Corridor place counts ─────────────────────────────────────────────────
const CORRIDORS: Record<string, string[]> = {
  bandra_hub:      ["bandra","andheri_w","central","multiple"],
  south_loop:      ["south","central","bandra","multiple"],
  north_adventure: ["borivali","andheri_w","bandra","multiple"],
  thane_east:      ["thane","home","andheri_w","multiple"],
  full_day_out:    ["vasai","karjat","kolad","gorai","multiple"],
};
const CATS = ["activity","experience","shopping","cafe","food","dessert"];
console.log("\n=== CORRIDOR COVERAGE (static places only) ===");
for (const [corridor, zones] of Object.entries(CORRIDORS)) {
  const inCorridor = places.filter(p => zones.includes(p.zone ?? "multiple"));
  const byCat: Record<string, number> = {};
  for (const c of CATS) byCat[c] = inCorridor.filter(p => p.category === c).length;
  const thin = Object.entries(byCat).filter(([,n]) => n < 2).map(([c,n]) => `${c}:${n}`);
  if (thin.length) console.log(`  ⚠  ${corridor} — thin: ${thin.join(", ")} (total: ${inCorridor.length})`);
  else console.log(`  ✓  ${corridor} — ${inCorridor.length} places: ${Object.entries(byCat).map(([c,n]) => `${c}:${n}`).join(", ")}`);
}

// ─── 6. Besttime gate coverage ────────────────────────────────────────────────
const BANDS = ["morning","afternoon","night","any"];
console.log("\n=== BESTTIME DISTRIBUTION (activity/experience/shopping) ===");
for (const b of BANDS) {
  const n = places.filter(p => ["activity","experience","shopping"].includes(p.category) && p.bestTime === b).length;
  console.log(`  ${b}: ${n}`);
}

// ─── 7. Budget level distribution ─────────────────────────────────────────────
console.log("\n=== ACTIVITY/EXPERIENCE COUNT BY COST RANGE ===");
const ranges = [[0,0],[1,400],[401,800],[801,1500],[1501,9999]];
for (const [lo,hi] of ranges) {
  const n = places.filter(p => ["activity","experience","shopping"].includes(p.category) && p.costPerPerson*2 >= lo && p.costPerPerson*2 <= hi).length;
  console.log(`  ₹${lo}–₹${hi === 9999 ? "∞" : hi}: ${n} places`);
}

// ─── 8. Night-time food options ───────────────────────────────────────────────
console.log("\n=== FOOD PLACES AVAILABLE AT NIGHT (cursor >= 1080) ===");
const nightFood = places.filter(p => p.category === "food" && (p.bestTime === "night" || p.bestTime === "any" || p.bestTime === "afternoon"));
console.log(`  Total: ${nightFood.length} — ${nightFood.map(p => p.name).join(", ")}`);

// ─── 9. Places with no tags at all ────────────────────────────────────────────
console.log("\n=== PLACES WITH EMPTY TAGS (miss PROFILE.loves bonus) ===");
places.filter(p => !p.tags?.length).forEach(p => console.log(`  ${p.id} (${p.category})`));
