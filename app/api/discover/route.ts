import { NextRequest, NextResponse } from "next/server";
import { discoverPlaces } from "@/lib/discover";
import { hasKey } from "@/lib/google";
import { Answers } from "@/lib/types";

export const runtime = "nodejs";

// Returns live, real Mumbai places for the day's zones + tastes, normalised for the engine.
export async function POST(req: NextRequest) {
  if (!hasKey()) return NextResponse.json({ places: [] });
  try {
    const ans = (await req.json()) as Answers;
    const places = await discoverPlaces(ans);
    return NextResponse.json({ places });
  } catch {
    return NextResponse.json({ places: [] });
  }
}
