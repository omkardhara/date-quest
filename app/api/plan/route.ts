import { NextRequest, NextResponse } from "next/server";
import { buildPlan } from "@/lib/engine";
import { Answers } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const ans: Answers = await req.json();
    const plan = buildPlan(ans, []);
    return NextResponse.json({ blocks: plan.blocks, totalCost: plan.totalCost, budget: plan.budget });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
