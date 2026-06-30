import { NextRequest, NextResponse } from "next/server";
import { buildGetaway } from "@/lib/getaway";
import { searchEvents } from "@/lib/events";
import { getWeather, COORDS } from "@/lib/weather";

export const runtime = "nodejs";

// Builds a multiday getaway itinerary. POST { destId, nights, monsoon?, date? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const destId: string = body.destId;
    const nights: number = Math.max(0, Math.min(2, Number(body.nights) || 1));

    // Live forecast for the destination; fall back to the season hint.
    let wet = !!body.monsoon;
    let weatherSummary: string | undefined;
    const coord = COORDS[destId];
    if (coord && body.date) {
      const wx = await getWeather(coord[0], coord[1], body.date);
      if (wx.available) { wet = wx.wet; weatherSummary = wx.summary; }
    }

    const month = body.date ? new Date(body.date + "T00:00:00").getMonth() : undefined;
    const plan = await buildGetaway(destId, nights, wet, weatherSummary, month);
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
