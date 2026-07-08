/**
 * Budget-utilization audit across budget tiers and personality profiles, for
 * well-covered zones (not the sparse day-trip ones already known to be thin).
 * Run: node scripts/audit-budget.mjs   (needs `npm run dev` running on :3000)
 */
const BASE = "http://127.0.0.1:3000";

const ZONES = [["Bandra", "bandra"], ["Andheri", "andheri_w"], ["South Mumbai", "south"], ["Central Mumbai", "central"]];
const BUDGETS = [1000, 2000, 5000, 10000, 20000];
const PROFILE = { personality: ["foodie", "playful"], foods: ["chinese", "dessert"], mood: "birthday" };

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

const results = [];
for (const [label, zoneKey] of ZONES) {
  for (const budget of BUDGETS) {
    const ans = {
      who: "Amruta", mood: PROFILE.mood, moodList: [PROFILE.mood],
      personality: PROFILE.personality, foods: PROFILE.foods,
      areas: [zoneKey], areaLabels: [label],
      budget, startMin: 600, endMin: 1320, dayOfWeek: 3, month: 6, outingDate: "2026-07-08",
    };
    const discover = await post("/api/discover", ans);
    const extra = Array.isArray(discover.places) ? discover.places : [];
    const plan = await post("/api/plan", { ...ans, extra });
    if (plan.error) { results.push({ label, budget, error: plan.error }); continue; }
    const util = plan.budget ? Math.round((plan.totalCost / plan.budget) * 100) : 0;
    results.push({ label, budget, totalCost: plan.totalCost, util, stops: (plan.blocks ?? []).length });
  }
}

console.log("\n=== BUDGET UTILIZATION AUDIT ===\n");
for (const r of results) {
  if (r.error) { console.log(`ERROR ${r.label} @${r.budget}: ${r.error}`); continue; }
  const flag = r.util < 60 ? "  <-- LOW" : "";
  console.log(`${r.label.padEnd(16)} budget=${String(r.budget).padStart(6)} spent=${String(r.totalCost).padStart(6)} util=${String(r.util).padStart(3)}% stops=${r.stops}${flag}`);
}
