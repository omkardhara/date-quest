// Run: npx tsx --tsconfig tsconfig.json scripts/test-plans.ts
import { Answers } from "../lib/types";
import { buildPlan } from "../lib/engine";

const COMBOS: Array<{ startMin: number; endMin: number; label: string }> = [
  { startMin: 360,  endMin: 1440, label: "6am–midnight " },
  { startMin: 480,  endMin: 1320, label: "8am–10pm    " },
  { startMin: 600,  endMin: 1200, label: "10am–8pm    " },
  { startMin: 720,  endMin: 1440, label: "noon–midnight" },
  { startMin: 840,  endMin: 1440, label: "2pm–midnight " },
  { startMin: 960,  endMin: 1440, label: "4pm–midnight " },
  { startMin: 1080, endMin: 1440, label: "6pm–midnight " },
  { startMin: 1200, endMin: 1440, label: "8pm–midnight " },
];

const BUDGETS = [1000, 2000, 5000, 10000, 20000];

const BASE: Omit<Answers, "budget" | "startMin" | "endMin"> = {
  who: "Amruta",
  mood: "birthday",
  moodList: ["birthday", "romantic"],
  personality: ["peaceful", "foodie"],
  foods: ["arabic", "indian", "dessert"],
  dayOfWeek: 3,   // Wednesday (Jul 8 2026)
  month: 6,       // July — monsoon
  wetDay: true,
  dislikes: ["mushroom", "capsicum", "oily", "spicy"],
};

let fails = 0;
const rows: string[] = [];

for (const combo of COMBOS) {
  const dayMins = combo.endMin - combo.startMin;
  const minStops = dayMins >= 480 ? 3 : dayMins >= 240 ? 2 : 1;
  const minCoverage = 40; // % of window the plan should reach

  for (const budget of BUDGETS) {
    const ans: Answers = { ...BASE, startMin: combo.startMin, endMin: combo.endMin, budget };
    const plan = buildPlan(ans, []);

    const stops = plan.blocks.length;
    const planMins = stops > 0
      ? plan.blocks[stops - 1].endMin - combo.startMin
      : 0;
    const coverage = Math.round((planMins / dayMins) * 100);
    const ok = stops >= minStops && coverage >= minCoverage;
    if (!ok) fails++;

    const budgetK = budget >= 1000 ? `₹${budget / 1000}k` : `₹${budget}`;
    const marker = ok ? "✓" : "✗";
    rows.push(
      `${marker} ${combo.label}  ${budgetK.padEnd(5)}  ${String(stops).padStart(2)} stops  ${String(coverage).padStart(3)}%  ₹${plan.totalCost.toLocaleString("en-IN").padEnd(8)}`
    );
  }
  rows.push("");
}

rows.forEach(r => console.log(r));
console.log(`Total failures: ${fails}`);
