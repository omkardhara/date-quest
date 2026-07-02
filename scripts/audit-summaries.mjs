import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const places = JSON.parse(readFileSync(join(__dir, "../data/places.json"), "utf8"));

const timeWords = ["morning","sunrise","sunset","dusk","dawn","evening","night","afternoon","noon","midday"];

console.log("=== SUMMARY TIME-LANGUAGE AUDIT ===\n");
console.log("Places where summary has time words (regardless of bestTime):\n");

for (const p of places.sort((a, b) => a.id.localeCompare(b.id))) {
  const summary = (p.summary || "").toLowerCase();
  const matched = timeWords.filter(w => summary.includes(w));
  if (matched.length) {
    const conflict = p.bestTime === "any" ? " ⚠️ CONFLICT (bestTime=any)" : " [bestTime=" + p.bestTime + "]";
    console.log(p.id + conflict);
    console.log("  words: [" + matched.join(", ") + "]");
    console.log("  " + p.summary.slice(0, 130));
    console.log();
  }
}
