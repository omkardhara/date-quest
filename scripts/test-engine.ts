/**
 * Comprehensive engine test — runs many Answers permutations through buildPlan
 * and reports every issue found.
 *
 * Run with:  npx tsx scripts/test-engine.ts
 */

import { buildPlan } from "../lib/engine";
import { Answers, Plan, PlanBlock, Category } from "../lib/types";

// ── Test matrix ───────────────────────────────────────────────────────────────

const MOODS = [
  "birthday", "anniversary", "romantic", "date night", "chill",
  "celebrate", "adventure", "group outing", "proposal", "just because",
];

// Key combos of personality traits
const PERSONALITY_SETS = [
  ["queen", "foodie"],
  ["adventure", "nature"],
  ["peaceful", "spiritual", "culture"],
  ["playful", "nightlife"],
  ["luxe", "cozy"],
  ["artsy", "culture"],
  ["foodie", "romantic"],
  ["adventure", "nature", "culture"],
];

const BUDGETS = [400, 1000, 2000, 5000, 10000, 20000];

// [startMin, endMin, label]
const TIME_WINDOWS: [number, number, string][] = [
  [360,  720,  "6am–12pm (short morning)"],
  [480,  960,  "8am–4pm (morning-afternoon)"],
  [600, 1080,  "10am–6pm (classic day)"],
  [600, 1320,  "10am–10pm (long day)"],
  [720, 1320,  "12pm–10pm (noon start)"],
  [840, 1320,  "2pm–10pm (afternoon start)"],
  [1080, 1440, "6pm–midnight (evening only)"],
  [360, 1440,  "6am–midnight (marathon)"],
];

// day configs: [dayOfWeek, month, wetDay, label]
// Real veg days from PROFILE: Mon=1, Thu=4, Sat=6
const DAY_CONFIGS: [number, number, boolean | undefined, string][] = [
  [1, 1,  false,     "Mon Feb (veg day, dry)"],
  [4, 1,  false,     "Thu Feb (veg day, dry)"],
  [6, 1,  false,     "Sat Feb (veg day, dry)"],
  [0, 1,  false,     "Sun Feb (non-veg, dry)"],
  [6, 6,  true,      "Sat Jul (veg day, monsoon, wet=true)"],
  [6, 6,  false,     "Sat Jul (veg day, monsoon, wet=false)"],
  [0, 3,  undefined, "Sun Apr (non-veg, dry, no wx)"],
  [5, 7,  true,      "Fri Aug (non-veg, monsoon, wet)"],
];

const FOOD_SETS = [
  ["indian", "dessert"],
  ["italian", "continental"],
  ["chinese", "icecream"],
  ["lebanese", "arabic"],
  ["seafood", "thai"],
  [],
];

// ── Validators ────────────────────────────────────────────────────────────────

type Issue = { test: string; issue: string; severity: "error" | "warn" };

function validate(plan: Plan, ans: Answers, label: string): Issue[] {
  const issues: Issue[] = [];
  const t = (issue: string, severity: "error" | "warn" = "error") =>
    issues.push({ test: label, issue, severity });

  const blocks = plan.blocks;
  const FULL_MEALS: Category[] = ["food", "cafe"];
  const FOODY: Category[] = ["food", "dessert"];

  // 1. Plan must not be empty
  if (blocks.length === 0) {
    t("Plan is EMPTY — no blocks produced");
    return issues; // nothing more to check
  }

  // 2. Budget — allow 5% rounding tolerance
  if (plan.overBudget && plan.totalCost > ans.budget * 1.05) {
    t(`Over budget: spent ₹${plan.totalCost} vs ₹${ans.budget}`, "warn");
  }

  // 3. All blocks must have narration (why)
  for (const b of blocks) {
    if (b.place && !b.why?.trim()) {
      t(`Missing narration for ${b.title}`, "warn");
    }
  }

  // 4. Meal spacing: two full meals need ≥150 min gap
  const meals = blocks.filter(b => FULL_MEALS.includes(b.kind as Category));
  for (let i = 1; i < meals.length; i++) {
    const gap = meals[i].startMin - meals[i - 1].endMin;
    if (gap < 145) { // 5 min tolerance for rounding
      t(`Meal spacing violation: ${meals[i-1].title} → ${meals[i].title} only ${gap} min apart (need 150)`);
    }
  }

  // 5. Veg day: no non-veg food on Mon/Thu/Sat (PROFILE.vegDays = [1,4,6])
  const vegDays = [1, 4, 6];
  if (ans.dayOfWeek !== undefined && vegDays.includes(ans.dayOfWeek)) {
    for (const b of blocks) {
      if (b.place && FOODY.includes(b.place.category) && b.place.veg === false) {
        t(`Veg-day violation: ${b.title} is non-veg on Tuesday`);
      }
    }
  }

  // 6. Monsoon / wet-day: no outdoor "avoid" places
  const effectivelyWet = ans.wetDay !== undefined ? ans.wetDay : [5,6,7,8].includes(ans.month ?? -1);
  if (effectivelyWet) {
    for (const b of blocks) {
      if (b.place?.outdoor && b.place?.monsoonRisk === "avoid") {
        t(`Monsoon violation: ${b.title} is outdoor+avoid on a wet day`);
      }
    }
  }

  // 7. Closed-day: no blocks on their closed day
  if (ans.dayOfWeek !== undefined) {
    for (const b of blocks) {
      if (b.place && (b.place as any).closedDays?.includes(ans.dayOfWeek)) {
        t(`Closed-day violation: ${b.title} is closed on day ${ans.dayOfWeek}`);
      }
    }
  }

  // 8. Time ordering: blocks should be ascending
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].startMin < blocks[i-1].endMin) {
      t(`Time overlap: ${blocks[i-1].title} (ends ${blocks[i-1].endMin}) overlaps ${blocks[i].title} (starts ${blocks[i].startMin})`);
    }
  }

  // 9. No block should start after endMin
  for (const b of blocks) {
    if (b.startMin >= ans.endMin) {
      t(`Block ${b.title} starts at ${b.startMin} which is after endMin ${ans.endMin}`, "warn");
    }
  }

  // 10. Reasonable block count for day length
  const dayMins = ans.endMin - ans.startMin;
  const minExpected = dayMins >= 480 ? 2 : 1;
  if (blocks.filter(b => b.place).length < minExpected) {
    t(`Only ${blocks.filter(b => b.place).length} place(s) in a ${dayMins}-min window — feels sparse`, "warn");
  }

  // 11. Budget ₹400 (free): should still produce at least 1 block
  if (ans.budget <= 400 && blocks.length === 0) {
    t("Free-budget plan produced no blocks at all");
  }

  // 12. All blocks must have kind
  for (const b of blocks) {
    if (!b.kind) t(`Block ${b.title} has no kind`);
  }

  return issues;
}

// ── Runner ────────────────────────────────────────────────────────────────────

function run() {
  const allIssues: Issue[] = [];
  let tested = 0;

  // Generate core test cases (not full Cartesian — that's millions; use representative coverage)
  for (const mood of MOODS) {
    for (const personality of PERSONALITY_SETS) {
      for (const budget of BUDGETS) {
        for (const [startMin, endMin, timeLabel] of TIME_WINDOWS) {
          for (const [dayOfWeek, month, wetDay, dayLabel] of DAY_CONFIGS) {
            // Skip logically impossible cases
            if (startMin >= endMin) continue;

            const foods = FOOD_SETS[tested % FOOD_SETS.length];
            const ans: Answers = {
              who: "Amruta",
              mood,
              moodList: [mood],
              personality,
              foods,
              budget,
              startMin,
              endMin,
              dayOfWeek,
              month,
              wetDay,
              dislikes: ["mushroom"],
            };

            const label = `${mood} | ${personality.join("+")} | ₹${budget} | ${timeLabel} | ${dayLabel}`;
            try {
              const plan = buildPlan(ans);
              const issues = validate(plan, ans, label);
              allIssues.push(...issues);
            } catch (e: any) {
              allIssues.push({ test: label, issue: `CRASH: ${e.message}`, severity: "error" });
            }
            tested++;
          }
        }
      }
    }
  }

  // Also run "must include" tests — each with a scenario realistic for that activity
  // (right budget, right time window, right personality for the corridor that has the place)
  const mustIncludeCases: { mustInclude: string[]; budget: number; startMin: number; endMin: number; personality: string[]; dayOfWeek: number; month: number }[] = [
    { mustInclude: ["spa or massage"],   budget: 10000, startMin: 600,  endMin: 1320, personality: ["peaceful", "queen"],    dayOfWeek: 0, month: 1 },
    { mustInclude: ["beach time"],       budget: 5000,  startMin: 600,  endMin: 1320, personality: ["peaceful", "nature"],   dayOfWeek: 0, month: 1 },
    { mustInclude: ["live music"],       budget: 5000,  startMin: 1080, endMin: 1440, personality: ["playful", "nightlife"], dayOfWeek: 0, month: 1 },
    { mustInclude: ["stand up comedy"],  budget: 5000,  startMin: 1080, endMin: 1440, personality: ["playful", "culture"],   dayOfWeek: 0, month: 1 },
    { mustInclude: ["art gallery"],      budget: 5000,  startMin: 600,  endMin: 1320, personality: ["artsy", "culture"],     dayOfWeek: 0, month: 1 },
    { mustInclude: ["boat ride"],        budget: 5000,  startMin: 480,  endMin: 960,  personality: ["adventure", "nature"],  dayOfWeek: 0, month: 1 },
    { mustInclude: ["watch a movie"],    budget: 5000,  startMin: 600,  endMin: 1320, personality: ["cozy", "playful"],      dayOfWeek: 0, month: 1 },
    { mustInclude: ["bookstore café"],   budget: 5000,  startMin: 600,  endMin: 1320, personality: ["peaceful", "culture"],  dayOfWeek: 0, month: 1 },
    { mustInclude: ["picnic"],           budget: 2000,  startMin: 480,  endMin: 960,  personality: ["peaceful", "nature"],   dayOfWeek: 0, month: 1 },
    { mustInclude: ["arcade or gaming"], budget: 5000,  startMin: 840,  endMin: 1320, personality: ["playful"],              dayOfWeek: 0, month: 1 },
  ];
  for (const { mustInclude, budget, startMin, endMin, personality, dayOfWeek, month } of mustIncludeCases) {
    const ans: Answers = {
      who: "Amruta", mood: "chill", moodList: ["chill"],
      personality, foods: ["indian"],
      budget, startMin, endMin,
      dayOfWeek, month, wetDay: false,
      mustInclude,
    };
    const label = `mustInclude: ${mustInclude.join(", ")} | ₹5000 | Sat Feb`;
    try {
      const plan = buildPlan(ans);
      const issues = validate(plan, ans, label);
      // Extra: check must-include was satisfied (a block matching the request exists)
      const satisfied = mustInclude.every(req => {
        const words = req.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
        return plan.blocks.some(b =>
          words.some(w =>
            b.title.toLowerCase().includes(w) ||
            (b.place?.tags ?? []).some(t => t.includes(w)) ||
            (b.place?.name ?? "").toLowerCase().includes(w)
          )
        );
      });
      if (!satisfied) {
        issues.push({
          test: label,
          issue: `mustInclude "${mustInclude}" not satisfied — no matching block in plan`,
          severity: "warn",
        });
      }
      allIssues.push(...issues);
    } catch (e: any) {
      allIssues.push({ test: label, issue: `CRASH: ${e.message}`, severity: "error" });
    }
    tested++;
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  const errors = allIssues.filter(i => i.severity === "error");
  const warns  = allIssues.filter(i => i.severity === "warn");

  console.log(`\n${"=".repeat(70)}`);
  console.log(`RESULTS: ${tested} tests | ${errors.length} errors | ${warns.length} warnings`);
  console.log("=".repeat(70));

  if (errors.length) {
    console.log("\n── ERRORS ──────────────────────────────────────────────────────────");
    for (const e of errors) {
      console.log(`\n[ERROR] ${e.issue}`);
      console.log(`        ${e.test}`);
    }
  }

  if (warns.length) {
    console.log("\n── WARNINGS ────────────────────────────────────────────────────────");
    // Group warnings by issue text so repeated patterns are obvious
    const groups = new Map<string, string[]>();
    for (const w of warns) {
      const key = w.issue.replace(/₹\d+/g, "₹N").replace(/\d+ min/g, "N min").slice(0, 80);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(w.test);
    }
    for (const [key, tests] of groups) {
      console.log(`\n[WARN] ${key} (×${tests.length})`);
      for (const t of tests.slice(0, 3)) console.log(`       ${t}`);
      if (tests.length > 3) console.log(`       … and ${tests.length - 3} more`);
    }
  }

  if (allIssues.length === 0) {
    console.log("\n All tests passed — no issues found.");
  }

  console.log(`\n${"=".repeat(70)}\n`);
  process.exit(errors.length > 0 ? 1 : 0);
}

run();
