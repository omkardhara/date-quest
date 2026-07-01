/**
 * Self-test runner for the date-quest plan engine.
 * Flags the issues Omkar identified + systematic checks.
 * Run: node scripts/test-plans.mjs
 *
 * Uses the compiled Next.js output is NOT needed — we call the API routes
 * via a running dev server on localhost:3000. Start `npm run dev` first.
 */

const BASE = "http://127.0.0.1:3000";
const FAILS = [];
const PASSES = [];

function fail(label, detail) { FAILS.push({ label, detail }); }
function pass(label) { PASSES.push(label); }

async function buildPlan(overrides = {}) {
  const defaults = {
    who: "Amruta",
    mood: "birthday",
    moodList: ["birthday"],
    personality: ["peaceful", "foodie"],
    foods: ["lebanese", "dessert"],
    budget: 5000,
    startMin: 600,   // 10am
    endMin: 1320,    // 10pm
    dayOfWeek: 2,    // Tuesday (non-veg ok)
    month: 6,        // July
    dislikes: [],
    outingDate: "2026-07-08",
  };
  const ans = { ...defaults, ...overrides };
  const res = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ans),
  }).catch(() => null);
  if (!res) return null;
  const d = await res.json().catch(() => null);
  return d?.blocks ?? null;
}

// ── Data-layer checks (no server needed) ──────────────────────────────────────
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const places = JSON.parse(readFileSync(join(__dir, "../data/places.json"), "utf-8"));

function dataChecks() {
  // 1. No zone:multiple with vague area
  const vague = ["near", "pan-city", "multiple", "city-wide", "across"];
  const badZone = places.filter(p =>
    p.zone === "multiple" && vague.some(v => (p.area ?? "").toLowerCase().includes(v))
  );
  if (badZone.length) fail("zone:multiple + vague area", badZone.map(p => p.id).join(", "));
  else pass("no zone:multiple with vague area");

  // 2. Sunset-tagged places must be evening or night only (afternoon = 11am is still too early)
  const badSunset = places.filter(p =>
    (p.name.toLowerCase().includes("sunset") || (p.tags ?? []).includes("sunset")) &&
    !["evening", "night"].includes(p.bestTime)
  );
  if (badSunset.length) fail("sunset place not gated to evening/night (could show at 11am)", badSunset.map(p => `${p.id}(${p.bestTime})`).join(", "));
  else pass("all sunset places gated to evening or night");

  // 3. Sunrise/morning-walk named places must be morning-only
  const badMorning = places.filter(p =>
    (p.name.toLowerCase().includes("sunrise") || p.name.toLowerCase().includes("morning walk")) &&
    p.bestTime !== "morning"
  );
  if (badMorning.length) fail("sunrise place not morning gated", badMorning.map(p => `${p.id}(${p.bestTime})`).join(", "));
  else pass("all sunrise places are morning gated");

  // 4. Temples, mosques, ashrams, mandirs should have costPerPerson:0
  const religiousFree = places.filter(p => {
    const name = (p.name ?? "").toLowerCase();
    const isReligious = ["temple","mandir","ashram","mosque","church","gurudwara","dargah"].some(w => name.includes(w));
    return isReligious && p.costPerPerson > 0;
  });
  if (religiousFree.length) fail("religious place with non-zero cost", religiousFree.map(p => `${p.id}(₹${p.costPerPerson})`).join(", "));
  else pass("all religious places are free");

  // 5. No place with category food but bestTime morning (brunch places exempted if they have brunch cuisine)
  const earlyFood = places.filter(p => {
    if (p.category !== "food") return false;
    if (p.bestTime !== "morning") return false;
    const hasBrunch = (p.cuisines ?? []).includes("brunch") || (p.cuisines ?? []).includes("coffee");
    return !hasBrunch;
  });
  if (earlyFood.length) fail("food place with morning bestTime (non-brunch)", earlyFood.map(p => `${p.id}`).join(", "));
  else pass("no dinner-type food suggested in morning slots");

  // 6. Sizzler: only one place, must be evening or night
  const sizzlerPlaces = places.filter(p => (p.cuisines ?? []).includes("sizzler"));
  if (sizzlerPlaces.some(p => p.bestTime === "afternoon" || p.bestTime === "morning" || p.bestTime === "any")) {
    fail("sizzler place available before evening", sizzlerPlaces.map(p => `${p.id}(${p.bestTime})`).join(", "));
  } else pass("sizzler correctly gated to evening/night");

  // 7. Duplicate IDs
  const ids = places.map(p => p.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) fail("duplicate place IDs", dupes.join(", "));
  else pass("no duplicate IDs");

  // 8. Required fields present
  const missingFields = places.filter(p => !p.id || !p.name || !p.category || !p.zone || !p.bestTime || !p.mapsUrl);
  if (missingFields.length) fail("places missing required fields", missingFields.map(p => p.id ?? "(no id)").join(", "));
  else pass("all places have required fields");

  // 9. Heavy cuisines (sizzler, japanese, arabic) should NOT have bestTime:any or morning
  const heavyMorning = places.filter(p => {
    const heavy = ["sizzler","japanese","arabic","seafood","chinese"].some(c => (p.cuisines ?? []).includes(c));
    return heavy && p.category === "food" && (p.bestTime === "any" || p.bestTime === "morning");
  });
  if (heavyMorning.length) fail("heavy cuisine food place available in morning", heavyMorning.map(p => `${p.id}(${p.bestTime})`).join(", "));
  else pass("no heavy cuisine food in morning slots");
}

// ── Engine simulation checks (need dev server) ─────────────────────────────────
async function serverAvailable() {
  try { await fetch(BASE); return true; } catch { return false; }
}

// Check if a plan has the same environment type appearing more than once
function checkEnvRepeat(blocks, label) {
  if (!blocks) return;
  const envCounts = {};
  const SPIRITUAL_WORDS = ["temple","mandir","ashram","mosque","church","gurudwara","dargah","iskcon","chinmayanand","sadbhakti","vitthal","siddhi"];
  for (const b of blocks) {
    const name = (b.title ?? "").toLowerCase();
    const isSpiritual = SPIRITUAL_WORDS.some(w => name.includes(w));
    if (isSpiritual) envCounts["spiritual"] = (envCounts["spiritual"] ?? 0) + 1;
  }
  if ((envCounts["spiritual"] ?? 0) > 1) {
    fail(`${label}: multiple spiritual places in plan`, blocks.filter(b => SPIRITUAL_WORDS.some(w => b.title.toLowerCase().includes(w))).map(b => b.title).join(" → "));
  } else pass(`${label}: no spiritual repeat`);
}

function checkCuisineRepeat(blocks, label) {
  if (!blocks) return;
  const foodBlocks = blocks.filter(b => b.kind === "food");
  if (foodBlocks.length < 2) { pass(`${label}: only one food block, no repeat possible`); return; }
  // Check if two food blocks share a notable cuisine
  const NOTABLE = ["sizzler","japanese","arabic","chinese","italian","thai","seafood","parsi","goan","burmese"];
  const cuisinesSeen = new Set();
  for (const b of foodBlocks) {
    const place = b.place;
    if (!place?.cuisines) continue;
    for (const c of place.cuisines) {
      if (NOTABLE.includes(c)) {
        if (cuisinesSeen.has(c)) {
          fail(`${label}: cuisine '${c}' repeated across food slots`, foodBlocks.map(b => b.title).join(" → "));
          return;
        }
        cuisinesSeen.add(c);
      }
    }
  }
  pass(`${label}: no cuisine repeated across food slots`);
}

function checkSunsetTime(blocks, label) {
  if (!blocks) return;
  const SUNSET_WORDS = ["sunset","versova beach","juhu beach"];
  for (const b of blocks) {
    const name = (b.title ?? "").toLowerCase();
    if (SUNSET_WORDS.some(w => name.includes(w)) && b.startMin < 900) {
      fail(`${label}: sunset place at ${Math.floor(b.startMin/60)}:${String(b.startMin%60).padStart(2,'0')} (before 3pm)`, b.title);
      return;
    }
  }
  pass(`${label}: no sunset place before 3pm`);
}

function checkBudgetGate(blocks, label, budget) {
  if (!blocks) return;
  const totalCost = blocks.reduce((s, b) => s + (b.cost ?? 0), 0);
  const freeBlocks = blocks.filter(b => (b.cost ?? 0) === 0);
  const paidBlocks = blocks.filter(b => (b.cost ?? 0) > 0);
  if (totalCost > budget * 1.05) {
    fail(`${label}: plan over budget (₹${totalCost} > ₹${budget})`, "");
  } else pass(`${label}: within budget (₹${totalCost}/₹${budget})`);
  // Free places should never be the last block (plan cut short by budget)
  if (paidBlocks.length > 0 && freeBlocks.length === 0 && blocks.length < 3) {
    fail(`${label}: suspiciously short plan (${blocks.length} blocks), possibly cut by budget`, "");
  } else pass(`${label}: plan has reasonable length (${blocks.length} blocks)`);
}

async function runServerTests() {
  const ok = await serverAvailable();
  if (!ok) {
    console.log("\n⚠️  Dev server not running — skipping engine tests. Run: npm run dev");
    return;
  }

  // Test 1: Spiritual personality → only 1 temple
  const spiritual = await buildPlan({ personality: ["spiritual", "peaceful"], foods: ["indian"] });
  checkEnvRepeat(spiritual, "spiritual plan");
  checkSunsetTime(spiritual, "spiritual plan");
  checkBudgetGate(spiritual, "spiritual plan", 5000);

  // Test 2: Sizzler + dessert → no cuisine repeat
  const sizzler = await buildPlan({ personality: ["foodie"], foods: ["sizzler", "dessert"], startMin: 720, endMin: 1380 });
  checkCuisineRepeat(sizzler, "sizzler+dessert plan");
  checkBudgetGate(sizzler, "sizzler+dessert plan", 5000);

  // Test 3: Sunset point as mustInclude → must be evening
  const sunset = await buildPlan({ mustInclude: ["sunset point"] });
  checkSunsetTime(sunset, "sunset point mustInclude");

  // Test 4: Free day (budget=400) → plan should not be cut short
  const freeDay = await buildPlan({ budget: 400, personality: ["peaceful", "nature"], foods: ["street"] });
  checkBudgetGate(freeDay, "free day", 400);

  // Test 5: Short plan (6pm–10pm) → sizzler should be reachable
  const evening = await buildPlan({ startMin: 1080, endMin: 1320, foods: ["sizzler"], personality: ["foodie"] });
  if (evening) {
    const hasSizzler = evening.some(b => (b.place?.cuisines ?? []).includes("sizzler"));
    if (hasSizzler) pass("evening plan: sizzler appears");
    else fail("evening plan: sizzler not found despite only evening food window", "Yoko Sizzlers should appear");
  }

  // Test 6: General diversity — no two adjacent blocks same category type
  const general = await buildPlan({});
  if (general) {
    for (let i = 1; i < general.length; i++) {
      const prev = general[i-1], cur = general[i];
      if (prev.kind === cur.kind && cur.kind !== "food") {
        fail(`general plan: consecutive same kind '${cur.kind}'`, `${prev.title} → ${cur.title}`);
      }
    }
    pass("general plan: no adjacent same-kind blocks");
  }
}

// ── Run everything ─────────────────────────────────────────────────────────────
console.log("=== DATE QUEST SELF-TEST ===\n");
console.log("--- Data layer checks ---");
dataChecks();

console.log("\n--- Engine checks (requires dev server) ---");
await runServerTests();

console.log("\n=== RESULTS ===");
console.log(`✅ ${PASSES.length} passed`);
if (FAILS.length) {
  console.log(`❌ ${FAILS.length} failed:\n`);
  for (const f of FAILS) console.log(`  ❌ ${f.label}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
} else {
  console.log("All checks passed.");
}
