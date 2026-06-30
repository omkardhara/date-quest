import { NextRequest, NextResponse } from "next/server";
import { searchEvents } from "@/lib/events";

export const runtime = "nodejs";

// Called by Vercel cron daily at 5:30 AM IST (midnight UTC).
// Warms the module-level event cache so the first real user request is fast.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await searchEvents("events in Mumbai");
  return NextResponse.json({ refreshed: events.length });
}
