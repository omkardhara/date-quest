import { NextRequest, NextResponse } from "next/server";
import { searchEvents } from "@/lib/events";

export const runtime = "nodejs";

// Live events around the outing date. ?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const date = sp.get("date") ?? undefined;

  const events = await searchEvents("events in Mumbai", date);
  return NextResponse.json(
    { events },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" } }
  );
}
