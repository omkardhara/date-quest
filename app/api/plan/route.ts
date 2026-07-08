import { NextRequest, NextResponse } from "next/server";
import { buildPlan } from "@/lib/engine";
import { Answers, MovieInfo, Place } from "@/lib/types";
import { readFileSync } from "fs";
import { join } from "path";

function loadMovies(): MovieInfo[] {
  try {
    const raw = readFileSync(join(process.cwd(), "data", "movies-cache.json"), "utf-8");
    const data = JSON.parse(raw) as { movies?: MovieInfo[] };
    return Array.isArray(data.movies) ? data.movies : [];
  } catch { return []; }
}

// Debug/test-only endpoint (used by scripts/test-plans.mjs). Optionally pass `extra`
// (the array /api/discover returns) so it can be tested with live places included, not
// just curated data.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { extra, ...ans } = body as Answers & { extra?: Place[] };
    const plan = buildPlan(ans, Array.isArray(extra) ? extra : [], loadMovies());
    return NextResponse.json({ blocks: plan.blocks, totalCost: plan.totalCost, budget: plan.budget, flags: plan.flags });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
