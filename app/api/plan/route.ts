import { NextRequest, NextResponse } from "next/server";
import { buildPlan } from "@/lib/engine";
import { Answers, MovieInfo } from "@/lib/types";
import { readFileSync } from "fs";
import { join } from "path";

function loadMovies(): MovieInfo[] {
  try {
    const raw = readFileSync(join(process.cwd(), "data", "movies-cache.json"), "utf-8");
    const data = JSON.parse(raw) as { movies?: MovieInfo[] };
    return Array.isArray(data.movies) ? data.movies : [];
  } catch { return []; }
}

export async function POST(req: NextRequest) {
  try {
    const ans: Answers = await req.json();
    const plan = buildPlan(ans, [], loadMovies());
    return NextResponse.json({ blocks: plan.blocks, totalCost: plan.totalCost, budget: plan.budget });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
