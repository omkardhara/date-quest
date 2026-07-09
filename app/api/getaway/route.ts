import { NextRequest, NextResponse } from "next/server";
import { buildGetaway } from "@/lib/getaway";
import { getWeather, COORDS } from "@/lib/weather";

export const runtime = "nodejs";

// Builds a multiday getaway itinerary. POST { destId, nights, monsoon?, date? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const destId: string = body.destId;
    // `Number(body.nights) || 1` looked like a safe "default to 1 night" fallback, but
    // 0 is a legitimate, explicit choice (the "Day trip" option) and 0 is falsy in JS —
    // so every day-trip request was silently getting a 1-night itinerary (hotel check-in,
    // a full second day, the works) instead of the single day the user actually picked.
    const rawNights = Number(body.nights);
    const nights: number = Math.max(0, Math.min(2, Number.isFinite(rawNights) ? rawNights : 1));

    // Live forecast for the destination; fall back to the season hint.
    let wet = !!body.monsoon;
    let weatherSummary: string | undefined;
    const coord = COORDS[destId];
    if (coord && body.date) {
      const wx = await getWeather(coord[0], coord[1], body.date);
      if (wx.available) { wet = wx.wet; weatherSummary = wx.summary; }
    }

    const month       = body.date ? new Date(body.date + "T00:00:00").getMonth() : undefined;
    const preferences = Array.isArray(body.preferences) ? (body.preferences as string[]) : [];
    const hotelBooked = typeof body.hotelBooked === "string" ? body.hotelBooked : "";
    const customStops = Array.isArray(body.customStops) ? (body.customStops as string[]) : [];
    const plan = await buildGetaway(destId, nights, wet, weatherSummary, month, preferences, hotelBooked, customStops);
    if (!plan) return NextResponse.json({ error: "unknown destination" }, { status: 404 });

    return NextResponse.json({ plan });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
