// Run: node scripts/patch-gaps.js
// Fixes all gaps found by audit-gaps.ts
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../data/places.json");
const places = JSON.parse(fs.readFileSync(FILE, "utf8"));

// ─── 1. Add missing moods ─────────────────────────────────────────────────────
const MOOD_ADD = {
  // proposal → scenic, premium, romantic settings
  "bayroute-lebanese":   ["proposal","reunion"],
  "bastian-bandra":      ["proposal","reunion"],
  "olive-italian":       ["proposal","reunion"],
  "marine-drive-walk":   ["proposal","reunion","group outing","just because"],
  "bandstand-promenade": ["proposal","reunion","group outing","just because"],
  "worli-sea-face":      ["proposal","reunion","group outing","just because"],
  "carter-road":         ["proposal","reunion","group outing","just because"],
  "quan-spa":            ["proposal","anniversary"],
  "haji-ali-dargah":     ["proposal","reunion","just because"],
  "kolad-lake":          ["proposal"],

  // group outing → social, fun, large-table-friendly
  "todi-mill-social":    ["group outing","reunion","just because"],
  "bombay-canteen":      ["group outing","reunion","just because"],
  "jamjar-pasta":        ["group outing","just because"],
  "kala-ghoda-art":      ["group outing","reunion","just because"],
  "colaba-causeway":     ["group outing","reunion","just because"],
  "movie-premium":       ["group outing","reunion","just because"],
  "juhu-beach":          ["group outing","reunion","just because"],
  "elephanta-caves":     ["group outing","reunion","just because"],
  "sgnp-kanheri":        ["group outing","reunion","just because"],
  "hill-road-bandra":    ["group outing","just because"],

  // reunion → nostalgic, familiar, comfortable
  "cafe-mondegar":       ["reunion","group outing","just because"],
  "kitab-khana":         ["reunion","just because"],
  "ramashray-dosa":      ["reunion","group outing","just because"],
  "k-rustom":            ["reunion","just because"],
  "bombay-sweet-shop":   ["reunion","just because"],
  "chowpatty-beach-chaat": ["reunion","group outing","just because"],
  "elco-market-bandra":  ["group outing","reunion","just because"],

  // just because → casual, any day, no occasion needed
  "kitchen-garden-brunch": ["just because"],
  "sequel-brunch":          ["just because"],
  "versova-beach":          ["group outing","just because"],
  "naturals-icecream":      ["group outing","reunion","just because"],
  "le15-patisserie":        ["just because"],
  "kunafa-arabic-sweets":   ["just because"],
  "banganga-tank":          ["reunion","just because"],
  "mount-mary-basilica":    ["reunion","group outing","just because"],
  "powai-lake-walk":        ["group outing","just because"],
  "upvan-lake-thane":       ["group outing","just because"],
  "yoko-sizzlers":          ["group outing","just because"],
};

// ─── 2. Add missing activity tags ─────────────────────────────────────────────
const TAG_ADD = {
  // live music
  "todi-mill-social":    ["live music","nightlife"],
  "cafe-mondegar":       ["live music"],
  "carter-road":         ["live music"],    // street performers, buskers

  // workshop / creative
  "kala-ghoda-art":      ["workshop","artsy"],
  "kitab-khana":         ["workshop","bookstore"],

  // picnic-friendly outdoor spots
  "bandstand-promenade": ["picnic"],
  "carter-road":         ["picnic"],
  "marine-drive-walk":   ["picnic"],
  "juhu-beach":          ["picnic"],
  "sgnp-kanheri":        ["picnic"],
  "versova-beach":       ["picnic"],
  "powai-lake-walk":     ["picnic"],
  "upvan-lake-thane":    ["picnic"],

  // fill empty tags
  "royal-china":         ["chinese","instagrammable","group"],
  "movie-premium":       ["nightlife","cozy","date"],
};

// ─── 3. Add missing cuisine tags ──────────────────────────────────────────────
const CUISINE_ADD = {
  // healthy — fresh, lighter options
  "kitchen-garden-brunch": ["healthy"],
  "sequel-brunch":          ["healthy"],
  "marine-drive-walk":      [],   // skip — not food
  "ramashray-dosa":         ["healthy"],

  // coffee — all cafes should match "coffee" selection
  "kitchen-garden-brunch": ["coffee"],
  "sequel-brunch":          ["coffee"],
  "cafe-mondegar":          ["coffee"],
  "hiranandani-cafe":       ["coffee"],
  "kitab-khana":            ["coffee"],  // serves coffee

  // pizza — Bombay Canteen and Bastian both serve pizza
  "bombay-canteen":         ["pizza"],
  "bastian-bandra":         ["pizza","continental"],
  "jamjar-pasta":           ["pizza"],

  // asian — broader Asian tag
  "royal-china":            ["asian"],
  "yoko-sizzlers":          ["asian"],

  // seafood — more places
  "bayroute-lebanese":      ["seafood"],
  "bastian-bandra":         ["seafood"],

  // italian — more places
  "bombay-canteen":         ["italian"],
  "jamjar-pasta":           ["italian","continental"],
};

// Apply mood additions
let moodChanged = 0;
for (const p of places) {
  const toAdd = MOOD_ADD[p.id];
  if (!toAdd) continue;
  const before = p.moods.length;
  p.moods = [...new Set([...p.moods, ...toAdd])];
  if (p.moods.length !== before) moodChanged++;
}

// Apply tag additions
let tagChanged = 0;
for (const p of places) {
  const toAdd = TAG_ADD[p.id];
  if (!toAdd) continue;
  const before = (p.tags ?? []).length;
  p.tags = [...new Set([...(p.tags ?? []), ...toAdd])];
  if ((p.tags ?? []).length !== before) tagChanged++;
}

// Apply cuisine additions
let cuisineChanged = 0;
for (const p of places) {
  const toAdd = CUISINE_ADD[p.id];
  if (!toAdd || !toAdd.length) continue;
  const before = (p.cuisines ?? []).length;
  p.cuisines = [...new Set([...(p.cuisines ?? []), ...toAdd])];
  if ((p.cuisines ?? []).length !== before) cuisineChanged++;
}

fs.writeFileSync(FILE, JSON.stringify(places, null, 2) + "\n");
console.log(`Moods patched: ${moodChanged} places`);
console.log(`Tags patched:  ${tagChanged} places`);
console.log(`Cuisines patched: ${cuisineChanged} places`);
