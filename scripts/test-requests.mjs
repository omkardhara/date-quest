import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const places = JSON.parse(readFileSync(join(__dir, "../data/places.json"), "utf8"));

function stem(w) {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("es")  && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s")   && w.length > 3) return w.slice(0, -1);
  return w;
}

function matchesRequest(p, requests) {
  if (!requests.length) return false;
  const tokens = [p.name, p.area, ...(p.tags ?? []), ...(p.cuisines ?? []), ...(p.vibes ?? [])]
    .join(" ").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  return requests.some(term =>
    term.toLowerCase().split(/\s+/).map(stem).filter(w => w.length >= 3).some(w =>
      tokens.some(t => t === w)
    )
  );
}

// All ACTIVITIES from page.tsx
const ALL_REQS = [
  "Watch a movie", "Spa or massage", "Long drive", "Beach time", "Live music",
  "Stand up comedy", "Art gallery", "Boat ride", "Arcade or gaming", "Workshop",
  "Sunset point", "Bookstore café", "Picnic"
];

console.log("=== mustInclude match test for all ACTIVITIES ===\n");
for (const req of ALL_REQS) {
  const matches = places.filter(p => matchesRequest(p, [req]));
  const status = matches.length === 0 ? "NO MATCH" : `${matches.length} place(s)`;
  console.log(`${matches.length === 0 ? "❌" : "✓"} "${req}" → ${status}`);
  for (const p of matches) {
    console.log(`     ${p.id} | ${p.category} | bestTime:${p.bestTime}`);
  }
}
