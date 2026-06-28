import { NextRequest, NextResponse } from "next/server";
import { buildGetaway } from "@/lib/getaway";
import { searchEvents } from "@/lib/events";

export const runtime = "nodejs";

// Builds a multiday getaway itinerary. POST { destId, nights, monsoon?, date? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const destId: string = body.destId;
    const nights: number = Math.max(0, Math.min(2, Number(body.nights) || 1));
    const monsoon: boolean = !!body.monsoon;

    const plan = await buildGetaway(destId, nights, monsoon);
    if (!plan) return NextResponse.json({ error: "unknown destination" }, { status: 404 });

    // Events in the destination around the date (best-effort).
    try {
      const events = await searchEvents(`events in ${plan.destination}`, body.date);
      if (events.length) plan.events = events;
    } catch { /* ignore */ }

    return NextResponse.json({ plan });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
