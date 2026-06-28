import { NextRequest, NextResponse } from "next/server";
import { getWeather, COORDS } from "@/lib/weather";

export const runtime = "nodejs";

// Live forecast for a place + date. ?date=YYYY-MM-DD&place=mumbai  (or &lat=&lng=)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const date = sp.get("date");
  if (!date) return NextResponse.json({ available: false });

  const place = sp.get("place") ?? "mumbai";
  const coord = COORDS[place];
  const lat = coord ? coord[0] : Number(sp.get("lat"));
  const lng = coord ? coord[1] : Number(sp.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ available: false });

  const weather = await getWeather(lat, lng, date);
  return NextResponse.json(weather, { headers: { "Cache-Control": "public, max-age=3600" } });
}
