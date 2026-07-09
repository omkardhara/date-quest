/**
 * Getaway-flow audit: runs every destination x every night count through the
 * real /api/getaway endpoint (live search included) and checks for crashes,
 * empty/undefined blocks, and timing sanity (no negative or overlapping legs).
 * Run: node scripts/audit-getaway.mjs   (needs `npm run dev` running on :3000)
 */
const BASE = "http://127.0.0.1:3000";

const DESTS = ["lonavala", "karjat", "mulshi", "malshej", "mahabaleshwar", "alibaug", "nashik", "bhandardara", "goa", "palghar", "jawhar"];
const NIGHTS = [0, 1, 2];

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const status = res.status;
  const json = await res.json().catch(() => ({ error: "bad json" }));
  return { status, json };
}

let total = 0, errors = 0, timingIssues = 0, emptyIssues = 0;
const findings = [];

for (const destId of DESTS) {
  for (const nights of NIGHTS) {
    total++;
    const { status, json } = await post("/api/getaway", {
      destId, nights, monsoon: [5, 6, 7, 8].includes(6), date: "2026-07-08", preferences: [], hotelBooked: "", customStops: [],
    });
    if (status !== 200 || json.error) {
      errors++;
      findings.push(`[${destId} n=${nights}] HTTP ${status} error=${json.error}`);
      continue;
    }
    const plan = json.plan;
    if (!plan?.days?.length) {
      emptyIssues++;
      findings.push(`[${destId} n=${nights}] no days in plan`);
      continue;
    }
    // Expect nights+1 days (getting-there day + middle days + heading-home day, or just
    // getting-there for a 0-night day trip).
    const expectedDays = nights === 0 ? 1 : nights + 1;
    if (plan.days.length !== expectedDays) {
      findings.push(`[${destId} n=${nights}] expected ${expectedDays} days, got ${plan.days.length}`);
    }
    for (const day of plan.days) {
      if (!day.blocks?.length) { emptyIssues++; findings.push(`[${destId} n=${nights}] ${day.label}: zero blocks`); continue; }
      let prevEnd = -1;
      for (const b of day.blocks) {
        if (!b.title || b.title.includes("undefined")) {
          emptyIssues++;
          findings.push(`[${destId} n=${nights}] ${day.label}: bad title "${b.title}"`);
        }
        if (b.endMin <= b.startMin) {
          timingIssues++;
          findings.push(`[${destId} n=${nights}] ${day.label}: "${b.title}" non-positive duration (${b.startMin}-${b.endMin})`);
        }
        if (b.startMin < prevEnd) {
          timingIssues++;
          findings.push(`[${destId} n=${nights}] ${day.label}: "${b.title}" overlaps previous block (starts ${b.startMin}, prev ended ${prevEnd})`);
        }
        if (b.endMin > 1440) {
          timingIssues++;
          findings.push(`[${destId} n=${nights}] ${day.label}: "${b.title}" ends past midnight (${b.endMin})`);
        }
        prevEnd = b.endMin;
      }
    }
  }
}

console.log("\n=== GETAWAY AUDIT ===\n");
findings.forEach(f => console.log(f));
console.log(`\nTotals: ${total} plans | errors=${errors} | emptyIssues=${emptyIssues} | timingIssues=${timingIssues}`);
