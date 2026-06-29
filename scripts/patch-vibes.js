// Run: node scripts/patch-vibes.js
// Adds missing vibe tags so that Artsy/Luxe/Cozy/Nightlife/Romantic
// personality selections actually influence scoring.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../data/places.json");
const places = JSON.parse(fs.readFileSync(FILE, "utf8"));

const ADD = {
  // luxe → high-end, premium feel
  "bastian-bandra":        ["luxe", "romantic"],
  "olive-italian":         ["luxe", "romantic"],
  "bayroute-lebanese":     ["luxe", "romantic", "nightlife"],
  "quan-spa":              ["luxe"],
  "bombay-canteen":        ["luxe"],
  "royal-china":           ["luxe"],
  "cafe-arabia":           ["luxe"],
  "sequel-brunch":         ["luxe", "cozy"],

  // romantic → scenic, date-friendly, intimate
  "marine-drive-walk":     ["romantic"],
  "worli-sea-face":        ["romantic"],
  "bandstand-promenade":   ["romantic", "nightlife"],
  "carter-road":           ["romantic", "nightlife"],
  "haji-ali-dargah":       ["romantic"],
  "kolad-lake":            ["romantic"],
  "juhu-beach":            ["romantic"],
  "versova-beach":         ["romantic"],
  "le15-patisserie":       ["romantic", "cozy"],
  "kunafa-arabic-sweets":  ["romantic", "cozy"],

  // artsy → creative, cultural, bohemian
  "kala-ghoda-art":        ["artsy"],
  "kitab-khana":           ["artsy", "cozy"],
  "todi-mill-social":      ["artsy", "nightlife"],
  "bombay-closet-cleanse": ["artsy"],
  "elephanta-caves":       ["artsy"],
  "cafe-mondegar":         ["artsy", "cozy"],
  "colaba-causeway":       ["artsy"],
  "chor-bazaar-thrift":    ["artsy"],
  "hill-road-bandra":      ["artsy"],

  // cozy → relaxed, quiet, warm
  "kitchen-garden-brunch": ["cozy"],
  "k-rustom":              ["cozy"],
  "hiranandani-cafe":      ["cozy"],
  "ramashray-dosa":        ["cozy"],
  "banganga-tank":         ["cozy"],
  "mount-mary-basilica":   ["cozy"],
  "naturals-icecream":     ["cozy"],

  // nightlife → evening energy, bars, live venues
  "movie-premium":         ["nightlife"],
  "jamjar-pasta":          ["nightlife", "cozy"],
  "yoko-sizzlers":         ["nightlife", "playful"],
  "bombay-sweet-shop":     ["cozy"],
};

let changed = 0;
for (const p of places) {
  const toAdd = ADD[p.id];
  if (!toAdd) continue;
  const before = p.vibes.length;
  p.vibes = [...new Set([...p.vibes, ...toAdd])];
  if (p.vibes.length !== before) changed++;
}

fs.writeFileSync(FILE, JSON.stringify(places, null, 2) + "\n");
console.log(`Patched ${changed} places.`);
