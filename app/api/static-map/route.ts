import { NextRequest, NextResponse } from "next/server";
import { staticMapUrl, hasKey } from "@/lib/google";

export const runtime = "nodejs";

// Proxies a Google Static Map image so the API key stays server-side.
export async function GET(req: NextRequest) {
  if (!hasKey()) return new NextResponse(null, { status: 404 });

  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return new NextResponse(null, { status: 400 });

  try {
    const r = await fetch(staticMapUrl(lat, lng));
    if (!r.ok) return new NextResponse(null, { status: 502 });
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
