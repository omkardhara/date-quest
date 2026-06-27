import { NextRequest, NextResponse } from "next/server";
import { searchEvents, hasEventsKey } from "@/lib/events";

export const runtime = "nodejs";

// Live events around the outing date. ?date=YYYY-MM-DD&q=<optional query>
export async function GET(req: NextRequest) {
  if (!hasEventsKey()) return NextResponse.json({ events: [] });

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date") ?? undefined;
  let q = sp.get("q") || "events in Mumbai";
  if (date) {
    const monthYear = new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    q = `${q} ${monthYear}`;
  }

  const events = await searchEvents(q, date);
  return NextResponse.json({ events }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
